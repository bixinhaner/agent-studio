import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { findThreadRollout } from "./codex-usage-ledger.js";
import type { RecordDirectUsageInput } from "./usage-recorder.js";

/**
 * Codex background work (native memory consolidation and similar internal agents) calls the model
 * outside any user turn: it writes no rollout and emits no thread/tokenUsage notification, so the
 * runtime ledger never sees it. Codex does export every model response through OpenTelemetry, so each
 * app-server sends its OTEL logs back to this process, and responses whose conversation has no
 * rollout in that CODEX_HOME are recorded as background usage. Conversations with a rollout (user
 * threads, subagents) are already metered from the rollout and are skipped, so nothing is counted twice.
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

export async function readCodexHomeManifest(codexHome: string): Promise<CodexHomeManifest | undefined> {
  const raw = await fs.readFile(path.join(codexHome, ".agent-studio", "manifest.json"), "utf8").catch(() => undefined);
  if (!raw) return undefined;
  try {
    const manifest = asRecord(JSON.parse(raw));
    if (!manifest) return undefined;
    return {
      scope: text(manifest.scope),
      organizationKey: text(manifest.organizationKey),
      userId: text(manifest.userId),
      integrationInstanceId: text(manifest.integrationInstanceId),
      provider: text(manifest.provider),
      modeId: text(manifest.modeId)
    };
  } catch {
    return undefined;
  }
}

export function codexBackgroundUsageId(codexHome: string, event: CodexOtelTokenEvent): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([path.resolve(codexHome), event.conversationId, event.timestamp ?? "", event.inputTokens, event.cachedInputTokens, event.outputTokens]))
    .digest("hex");
  return `codex-bg-${digest.slice(0, 40)}`;
}

function isDuplicateKeyError(error: unknown): boolean {
  return asRecord(error)?.code === "P2002" || /unique constraint/i.test(error instanceof Error ? error.message : "");
}

export class CodexBackgroundUsageCollector {
  private readonly pending = new Set<ReturnType<typeof setTimeout>>();
  private readonly rolloutDelayMs: number;

  constructor(
    private readonly deps: {
      recordDirectUsage(input: RecordDirectUsageInput): Promise<unknown>;
      resolveOwner(manifest: CodexHomeManifest | undefined, codexHome: string): Promise<CodexHomeOwner | undefined>;
      findRollout?: (codexHome: string, conversationId: string) => Promise<string | undefined>;
      /** Conversations Agent Studio has bound to a thread are user work, metered by the runtime ledger. */
      isKnownThread?: (conversationId: string) => Promise<boolean>;
      logger?: Logger;
      /** A new thread's rollout is created as its first turn starts; wait before calling a conversation rollout-less. */
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
      if (rollout) return "skipped_rollout";
      if (await this.deps.isKnownThread?.(event.conversationId)) return "skipped_thread";
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
