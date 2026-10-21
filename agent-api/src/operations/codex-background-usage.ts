import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { findThreadRollout } from "./codex-usage-ledger.js";
import type { RecordDirectUsageInput } from "./usage-recorder.js";

/**
 * Codex background work (native memory consolidation and similar internal agents) calls the model
 * outside any user turn: it writes no rollout and emits no thread/tokenUsage notification, so the
 * runtime ledger never sees it. Codex does export every model response through OpenTelemetry, so each
 * app-server sends its OTEL logs back to this process. A response is background usage when its exact
 * (input, cached, output) token counts are not among the calls recorded in its conversation's rollout:
 * - memory consolidation runs as its own conversation and writes no rollout at all;
 * - memory stage-1 extraction is tagged with the user thread that triggered it, but never reaches that
 *   thread's rollout.
 * User-turn calls are always in the rollout (token_usage_record / token_count) and are already metered
 * by the runtime ledger, so they are skipped and nothing is counted twice.
 */

export const CODEX_OTEL_PATH = "/internal/codex-otel/v1/logs";
export const CODEX_OTEL_HOME_HEADER = "x-agent-studio-codex-home";
export const CODEX_OTEL_SIGNATURE_HEADER = "x-agent-studio-otel-signature";
export const CODEX_BACKGROUND_FEATURE_TYPE = "codex_background";

export type CodexOtelTokenEvent = {
  conversationId: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens?: number;
  outputTokens: number;
  reasoningTokens?: number;
  timestamp?: string;
  originator?: string;
};

export type CodexHomeOwner = {
  organizationId?: string;
  userId?: string;
  scope: string;
  integrationInstanceId?: string;
};

export type CodexHomeManifest = {
  scope?: string;
  organizationKey?: string;
  userId?: string;
  integrationInstanceId?: string;
  provider?: string;
  modeId?: string;
};

type Logger = Pick<Console, "warn">;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function otlpValue(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return undefined;
  for (const key of ["stringValue", "intValue", "doubleValue", "boolValue"]) {
    if (key in record) return record[key];
  }
  return undefined;
}

function otlpAttributes(value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!Array.isArray(value)) return out;
  for (const item of value) {
    const attribute = asRecord(item);
    if (typeof attribute?.key === "string") out[attribute.key] = otlpValue(attribute.value);
  }
  return out;
}

function tokenCount(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Extracts per-response token usage from an OTLP/JSON logs export (`codex.sse_event` / `response.completed`). */
export function parseCodexOtelTokenEvents(body: unknown): CodexOtelTokenEvent[] {
  const events: CodexOtelTokenEvent[] = [];
  const resourceLogs = asRecord(body)?.resourceLogs;
  if (!Array.isArray(resourceLogs)) return events;
  for (const resourceLog of resourceLogs) {
    const scopeLogs = asRecord(resourceLog)?.scopeLogs;
    if (!Array.isArray(scopeLogs)) continue;
    for (const scopeLog of scopeLogs) {
      const records = asRecord(scopeLog)?.logRecords;
      if (!Array.isArray(records)) continue;
      for (const record of records) {
        const attrs = otlpAttributes(asRecord(record)?.attributes);
        if (attrs["event.name"] !== "codex.sse_event" || attrs["event.kind"] !== "response.completed") continue;
        const conversationId = text(attrs["conversation.id"]);
        const model = text(attrs.model) ?? text(attrs.slug);
        const inputTokens = tokenCount(attrs.input_token_count);
        const outputTokens = tokenCount(attrs.output_token_count);
        // Codex emits a second response.completed without token fields (timing only); skip it.
        if (!conversationId || !model || inputTokens === undefined || outputTokens === undefined) continue;
        const cachedInputTokens = Math.min(tokenCount(attrs.cached_token_count) ?? 0, inputTokens);
        const cacheWriteTokens = tokenCount(attrs.cache_write_token_count);
        events.push({
          conversationId,
          model,
          inputTokens,
          cachedInputTokens,
          ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens: Math.min(cacheWriteTokens, inputTokens - cachedInputTokens) }),
          outputTokens,
          reasoningTokens: tokenCount(attrs.reasoning_token_count),
          timestamp: text(attrs["event.timestamp"]),
          originator: text(attrs.originator)
        });
      }
    }
  }
  return events;
}

export function signCodexHome(secret: string, codexHome: string): string {
  return createHmac("sha256", secret).update(path.resolve(codexHome)).digest("hex");
}

export function verifyCodexHomeSignature(secret: string, codexHome: string, signature: string): boolean {
  const expected = Buffer.from(signCodexHome(secret, codexHome));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * `codex app-server -c` arguments that make the process export its OTEL logs to this service, tagged
 * with its CODEX_HOME. The exporter is set up once per process, so this cannot go in thread config.
 * Values are TOML; JSON string literals are valid TOML basic strings.
 */
export function buildCodexOtelLaunchArgs(input: { endpoint: string; secret: string; codexHome: string }): string[] {
  const codexHome = path.resolve(input.codexHome);
  const headers = [
    `${JSON.stringify(CODEX_OTEL_HOME_HEADER)} = ${JSON.stringify(codexHome)}`,
    `${JSON.stringify(CODEX_OTEL_SIGNATURE_HEADER)} = ${JSON.stringify(signCodexHome(input.secret, codexHome))}`
  ].join(", ");
  return [
    "-c", "otel.log_user_prompt=false",
    "-c", `otel.environment=${JSON.stringify("agent-studio")}`,
    "-c", `otel.exporter={ otlp-http = { endpoint = ${JSON.stringify(input.endpoint)}, protocol = "json", headers = { ${headers} } } }`
  ];
}

/**
 * Reads who a CODEX_HOME belongs to. Materialized homes write manifest v2, which only carries the
 * scope path segments built by runtime-scope-resolver: `[organizationKey, userId, agent-…]` for a
 * user, `["integrations", provider, instanceId, agent-…]` for an integration.
 */
export async function readCodexHomeManifest(codexHome: string): Promise<CodexHomeManifest | undefined> {
  const raw = await fs.readFile(path.join(codexHome, ".agent-studio", "manifest.json"), "utf8").catch(() => undefined);
  if (!raw) return undefined;
  let manifest: Record<string, unknown> | undefined;
  try {
    manifest = asRecord(JSON.parse(raw));
  } catch {
    return undefined;
  }
  if (!manifest) return undefined;
  const segments = Array.isArray(manifest.scopeSegments) ? manifest.scopeSegments.map(text) : [];
  const fromSegments: CodexHomeManifest =
    segments[0] === "integrations" && segments[2]
      ? { scope: "integration_agent", provider: segments[1], integrationInstanceId: segments[2] }
      : segments.length >= 3 && segments[0] && segments[1] && segments[2]?.startsWith("agent-")
        ? { scope: "user_agent", organizationKey: segments[0], userId: segments[1] }
        : {};
  return {
    scope: text(manifest.scope) ?? fromSegments.scope,
    organizationKey: text(manifest.organizationKey) ?? fromSegments.organizationKey,
    userId: text(manifest.userId) ?? fromSegments.userId,
    integrationInstanceId: text(manifest.integrationInstanceId) ?? fromSegments.integrationInstanceId,
    provider: text(manifest.provider) ?? fromSegments.provider,
    modeId: text(manifest.modeId)
  };
}

export function codexBackgroundUsageId(codexHome: string, event: CodexOtelTokenEvent): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([path.resolve(codexHome), event.conversationId, event.timestamp ?? "", event.inputTokens, event.cachedInputTokens, event.outputTokens]))
    .digest("hex");
  return `codex-bg-${digest.slice(0, 40)}`;
}

const usageKey = (input: unknown, cached: unknown, output: unknown): string | undefined =>
  [input, cached, output].every((value) => typeof value === "number" && Number.isSafeInteger(value)) ? `${input}/${cached}/${output}` : undefined;

const ROLLOUT_READ_CHUNK_BYTES = 4 * 1024 * 1024;

/** Token triples of every model call a rollout recorded, read incrementally as the rollout grows. */
export class RolloutCallIndex {
  private readonly files = new Map<string, { offset: number; calls: Set<string> }>();

  constructor(private readonly maxFiles = 200) {}

  async has(file: string, event: Pick<CodexOtelTokenEvent, "inputTokens" | "cachedInputTokens" | "outputTokens">): Promise<boolean> {
    const calls = await this.calls(file);
    return calls.has(`${event.inputTokens}/${event.cachedInputTokens}/${event.outputTokens}`);
  }

  private async calls(file: string): Promise<Set<string>> {
    let entry = this.files.get(file);
    const size = (await fs.stat(file)).size;
    if (!entry || size < entry.offset) entry = { offset: 0, calls: new Set() };
    this.files.delete(file);
    this.files.set(file, entry);
    while (this.files.size > this.maxFiles) this.files.delete(this.files.keys().next().value!);
    if (size === entry.offset) return entry.calls;
    const handle = await fs.open(file, "r");
    try {
      // Rollouts can reach tens of MB; read in bounded chunks and only consume whole lines.
      const chunk = Buffer.alloc(Math.min(ROLLOUT_READ_CHUNK_BYTES, size - entry.offset));
      // Bytes from entry.offset not yet ending in a newline (split lines and split UTF-8 characters).
      let carry = Buffer.alloc(0);
      let position = entry.offset;
      while (position < size) {
        const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, size - position), position);
        if (bytesRead === 0) break;
        position += bytesRead;
        const data = Buffer.concat([carry, chunk.subarray(0, bytesRead)]);
        const end = data.lastIndexOf(0x0a);
        if (end < 0) {
          carry = data;
          continue;
        }
        for (const line of data.subarray(0, end).toString("utf8").split("\n")) this.indexLine(line, entry.calls);
        entry.offset += end + 1;
        carry = Buffer.from(data.subarray(end + 1));
      }
      return entry.calls;
    } finally {
      await handle.close();
    }
  }

  private indexLine(line: string, calls: Set<string>): void {
    if (!line.includes("token_usage_record") && !line.includes("token_count")) return;
    let row: any;
    try { row = JSON.parse(line); } catch { return; }
    const payload = row?.payload ?? {};
    const usage = row?.type === "token_usage_record" ? payload.usage
      : row?.type === "event_msg" && payload.type === "token_count" ? payload.info?.last_token_usage : undefined;
    const key = usage && usageKey(usage.input_tokens, usage.cached_input_tokens, usage.output_tokens);
    if (key) calls.add(key);
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return asRecord(error)?.code === "P2002" || /unique constraint/i.test(error instanceof Error ? error.message : "");
}

export class CodexBackgroundUsageCollector {
  private readonly pending = new Set<ReturnType<typeof setTimeout>>();
  private readonly rolloutDelayMs: number;
  private readonly rolloutCalls = new RolloutCallIndex();

  constructor(
    private readonly deps: {
      recordDirectUsage(input: RecordDirectUsageInput): Promise<unknown>;
      resolveOwner(manifest: CodexHomeManifest | undefined, codexHome: string): Promise<CodexHomeOwner | undefined>;
      findRollout?: (codexHome: string, conversationId: string) => Promise<string | undefined>;
      /** Conversations Agent Studio has bound to a thread are user work, metered by the runtime ledger. */
      isKnownThread?: (conversationId: string) => Promise<boolean>;
      logger?: Logger;
      /** A call reaches its rollout right after it completes; wait before deciding the rollout lacks it. */
      rolloutDelayMs?: number;
    }
  ) {
    this.rolloutDelayMs = deps.rolloutDelayMs ?? 60_000;
  }

  /** Accepts one OTLP/JSON export; returns how many token events were queued for classification. */
  accept(codexHome: string, body: unknown): number {
    const events = parseCodexOtelTokenEvents(body);
    for (const event of events) {
      const timer = setTimeout(() => {
        this.pending.delete(timer);
        void this.classify(codexHome, event);
      }, this.rolloutDelayMs);
      timer.unref?.();
      this.pending.add(timer);
    }
    return events.length;
  }

  stop(): void {
    for (const timer of this.pending) clearTimeout(timer);
    this.pending.clear();
  }

  /** Records the event unless its conversation is a rollout-backed thread (already metered). */
  async classify(codexHome: string, event: CodexOtelTokenEvent): Promise<"recorded" | "skipped_rollout" | "skipped_thread" | "duplicate" | "failed"> {
    try {
      const rollout = await (this.deps.findRollout ?? findThreadRollout)(codexHome, event.conversationId);
      if (rollout && await this.rolloutCalls.has(rollout, event)) return "skipped_rollout";
      // A known thread whose rollout is not in this home (moved or archived) cannot be checked call by call.
      if (!rollout && await this.deps.isKnownThread?.(event.conversationId)) return "skipped_thread";
      const manifest = await readCodexHomeManifest(codexHome);
      const owner = await this.deps.resolveOwner(manifest, codexHome);
      await this.deps.recordDirectUsage({
        id: codexBackgroundUsageId(codexHome, event),
        organizationId: owner?.organizationId,
        userId: owner?.userId,
        model: event.model,
        featureType: CODEX_BACKGROUND_FEATURE_TYPE,
        inputTokens: event.inputTokens,
        cachedInputTokens: event.cachedInputTokens,
        cacheWriteTokens: event.cacheWriteTokens,
        outputTokens: event.outputTokens,
        resultStatus: "success",
        createdAt: event.timestamp,
        metadata: {
          source: "codex_otel",
          // memory_agent: own conversation (consolidation); outside_rollout: tagged with a user thread (stage-1 extraction).
          backgroundKind: rollout ? "outside_rollout" : "memory_agent",
          codexConversationId: event.conversationId,
          codexHomeScope: owner?.scope ?? manifest?.scope ?? "unknown",
          ...(owner?.integrationInstanceId ? { integrationInstanceId: owner.integrationInstanceId } : {}),
          ...(manifest?.modeId ? { modeId: manifest.modeId } : {}),
          ...(event.reasoningTokens !== undefined ? { reasoningTokens: event.reasoningTokens } : {}),
          ...(event.originator ? { originator: event.originator } : {})
        }
      });
      return "recorded";
    } catch (error) {
      if (isDuplicateKeyError(error)) return "duplicate";
      this.deps.logger?.warn("codex background usage record failed", {
        conversationId: event.conversationId,
        detail: error instanceof Error ? error.message : String(error)
      });
      return "failed";
    }
  }
}
