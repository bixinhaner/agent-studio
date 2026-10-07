import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import readline from "node:readline";

import { resolveCodexAppServerBinaryPath } from "../codex-app-server-runtime.js";
import type {
  CodexQuotaSnapshotRepository,
  UpsertCodexQuotaSnapshotInput
} from "../persistence/codex-quota-snapshot-repository.js";

type JsonRecord = Record<string, unknown>;

export type CodexQuotaSnapshotServiceOptions = {
  codexHome: string;
  binaryPath?: string;
  intervalMs?: number;
  logger?: Pick<Console, "warn">;
  now?: () => Date;
};

export const DEFAULT_CODEX_QUOTA_SNAPSHOT_INTERVAL_MS = 60 * 60_000;

type RateLimit = {
  usedPercent: number;
  windowDurationMins: number;
  resetsAt: number;
};

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : undefined;
}

function asNumber(value: unknown): number | undefined {
  const result = typeof value === "number" ? value : typeof value === "string" ? Number(value) : undefined;
  return result !== undefined && Number.isFinite(result) ? result : undefined;
}

function rateLimitFrom(value: unknown): RateLimit | undefined {
  const record = asRecord(value);
  const usedPercent = asNumber(record?.usedPercent);
  const windowDurationMins = asNumber(record?.windowDurationMins);
  const resetsAt = asNumber(record?.resetsAt);
  if (usedPercent === undefined || windowDurationMins === undefined || resetsAt === undefined) return undefined;
  return { usedPercent, windowDurationMins, resetsAt };
}

function primaryRateLimit(payload: unknown): RateLimit | undefined {
  const root = asRecord(payload);
  const byLimit = asRecord(root?.rateLimitsByLimitId);
  return rateLimitFrom(asRecord(byLimit?.codex)?.primary) ?? rateLimitFrom(asRecord(root?.rateLimits)?.primary);
}

function accountIdFromAuth(auth: unknown): string | undefined {
  const root = asRecord(auth);
  const tokens = asRecord(root?.tokens);
  const accountId = tokens?.account_id ?? root?.account_id;
  return typeof accountId === "string" && accountId.trim() ? accountId.trim() : undefined;
}

function creditsFrom(payload: unknown): { available?: boolean; balance?: string } {
  const root = asRecord(payload);
  const credits = asRecord(root?.credits);
  const balance = credits?.balance;
  return {
    ...(typeof credits?.hasCredits === "boolean" ? { available: credits.hasCredits } : {}),
    ...(typeof balance === "number" || typeof balance === "string" ? { balance: String(balance) } : {})
  };
}

async function requestRateLimits(binaryPath: string, codexHome: string): Promise<JsonRecord> {
  const child = spawn(binaryPath, ["app-server", "--disable", "enable_mcp_apps", "--listen", "stdio://"], {
    detached: process.platform !== "win32",
    env: { ...process.env, CODEX_HOME: codexHome },
    stdio: ["pipe", "pipe", "pipe"]
  });
  if (!child.stdin || !child.stdout) throw new Error("Codex app-server stdio was not available");
  let nextId = 1;
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-2000);
  });
  const responses = new Map<number, (value: JsonRecord) => void>();
  const failures = new Map<number, (error: Error) => void>();
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  rl.on("line", (line) => {
    try {
      const message = JSON.parse(line) as JsonRecord;
      const id = asNumber(message.id);
      if (id === undefined) return;
      const result = asRecord(message.result);
      const resolve = responses.get(id);
      const reject = failures.get(id);
      if (result && resolve) {
        responses.delete(id);
        failures.delete(id);
        resolve(result);
      } else if (reject) {
        responses.delete(id);
        failures.delete(id);
        reject(new Error(String(asRecord(message.error)?.message ?? "Codex app-server request failed")));
      }
    } catch {
      // Ignore non-JSON diagnostics on stdout; app-server responses remain JSON lines.
    }
  });
  const request = (method: string, params?: JsonRecord): Promise<JsonRecord> => {
    const id = nextId++;
    return new Promise<JsonRecord>((resolve, reject) => {
      const timer = setTimeout(() => {
        responses.delete(id);
        failures.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, 30_000);
      responses.set(id, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      failures.set(id, (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.stdin?.write(`${JSON.stringify({ id, method, ...(params ? { params } : {}) })}\n`);
    });
  };
  try {
    await request("initialize", {
      clientInfo: { name: "agent-studio-quota-snapshot", title: "Agent Studio quota snapshot", version: "1.0.0" },
      capabilities: { experimentalApi: true }
    });
    child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
    return await request("account/rateLimits/read");
  } catch (error) {
    const suffix = stderr.trim() ? ` (${stderr.trim()})` : "";
    throw new Error(`${error instanceof Error ? error.message : String(error)}${suffix}`);
  } finally {
    rl.close();
    child.kill();
  }
}

export class CodexQuotaSnapshotService {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly repository: Pick<CodexQuotaSnapshotRepository, "upsertHourly">,
    private readonly options: CodexQuotaSnapshotServiceOptions
  ) {}

  async collectOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = this.options.now?.() ?? new Date();
      const auth = JSON.parse(await readFile(`${this.options.codexHome}/auth.json`, "utf8")) as unknown;
      const accountId = accountIdFromAuth(auth);
      if (!accountId) throw new Error("Codex auth.json does not contain an account id");
      const payload = await requestRateLimits(this.options.binaryPath ?? resolveCodexAppServerBinaryPath(), this.options.codexHome);
      const rateLimit = primaryRateLimit(payload);
      if (!rateLimit) throw new Error("Codex app-server returned no primary rate limit");
      const resetAt = new Date(rateLimit.resetsAt * 1000);
      if (Number.isNaN(resetAt.getTime())) throw new Error("Codex app-server returned an invalid reset time");
      const sampleBucket = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
      const credits = creditsFrom(payload);
      const input: UpsertCodexQuotaSnapshotInput = {
        credentialHash: createHash("sha256").update(accountId).digest("hex"),
        limitId: "codex",
        resetAt: resetAt.toISOString(),
        windowDurationMins: Math.round(rateLimit.windowDurationMins),
        usedPercent: Math.max(0, Math.min(100, Math.round(rateLimit.usedPercent))),
        remainingPercent: Math.max(0, Math.min(100, 100 - Math.round(rateLimit.usedPercent))),
        ordinaryUsageAllowed: Boolean(asRecord(payload)?.rateLimitsByLimitId),
        ...(typeof asRecord(payload)?.planType === "string" ? { planType: String(asRecord(payload)?.planType) } : {}),
        ...(credits.available === undefined ? {} : { creditsAvailable: credits.available }),
        ...(credits.balance === undefined ? {} : { creditsBalance: credits.balance }),
        observedAt: now,
        sampleBucket: sampleBucket.toISOString()
      };
      await this.repository.upsertHourly(input);
    } finally {
      this.running = false;
    }
  }

  get intervalMs(): number {
    return this.options.intervalMs ?? DEFAULT_CODEX_QUOTA_SNAPSHOT_INTERVAL_MS;
  }

  start(): void {
    if (this.timer) return;
    void this.collectOnce().catch((error) => this.options.logger?.warn("codex quota snapshot failed", error));
    this.timer = setInterval(() => {
      void this.collectOnce().catch((error) => this.options.logger?.warn("codex quota snapshot failed", error));
    }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
