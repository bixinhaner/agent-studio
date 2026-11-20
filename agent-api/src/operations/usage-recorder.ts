import type { RuntimeUsageSnapshot } from "../live-runtime-session.js";
import type { UsageEventRecord } from "../persistence/usage-event-repository.js";
import type { ManagedCodexProviderKind } from "../managed-codex-provider.js";
import type { RecordUsageInput, UsageBilling, UsageIngestionService } from "./usage-ingestion-service.js";

export type UsageResultStatus = "success" | "failed" | string;

export type RecordCodexUsageInput = {
  organizationId?: string;
  userId?: string;
  departmentIdSnapshot?: string;
  threadId?: string;
  sessionId?: string;
  model: string;
  featureType?: string;
  /**
   * The provider the Codex runtime ran on (falls back to metadata.provider); decides whether OpenAI's
   * API long-context surcharge applies.
   */
  provider?: ManagedCodexProviderKind;
  usage?: RuntimeUsageSnapshot;
  codexThreadId?: string;
  resultStatus?: UsageResultStatus;
  createdAt?: string | Date;
  metadata?: Record<string, unknown>;
};

export type RecordDirectUsageInput = Omit<RecordUsageInput, "codexRuntimeUsageKind" | "codexRuntimeCumulativeUsage" | "codexThreadId">;

type UsageIngestion = Pick<UsageIngestionService, "record" | "recordCodexRuntimeUsage">;

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function cumulativeUsageFromSnapshot(usage: RuntimeUsageSnapshot | undefined): RecordUsageInput["codexRuntimeCumulativeUsage"] {
  if (
    usage?.cumulativeInputTokens === undefined ||
    usage.cumulativeCachedInputTokens === undefined ||
    usage.cumulativeOutputTokens === undefined
  ) {
    return undefined;
  }
  return {
    inputTokens: usage.cumulativeInputTokens,
    cachedInputTokens: usage.cumulativeCachedInputTokens,
    cacheWriteTokens: usage.cumulativeCacheWriteTokens,
    outputTokens: usage.cumulativeOutputTokens
  };
}

function metadataWithCodexThread(input: {
  metadata?: Record<string, unknown>;
  codexThreadId?: string;
}): Record<string, unknown> | undefined {
  const codexThreadId = trimOrUndefined(input.codexThreadId);
  if (!input.metadata && !codexThreadId) return undefined;
  return {
    ...(input.metadata ?? {}),
    ...(codexThreadId ? { codexThreadId } : {})
  };
}

/** ChatGPT sign-in is plan usage; API key and Azure providers are billed at API prices. */
export function billingForProvider(provider: string | undefined): UsageBilling | undefined {
  if (provider === "chatgpt") return "chatgpt";
  if (provider === "openai_api" || provider === "azure_openai") return "api";
  return undefined;
}

export class UsageRecorder {
  constructor(private readonly deps: { usageIngestion: UsageIngestion }) {}

  async recordCodexUsage(input: RecordCodexUsageInput): Promise<UsageEventRecord> {
    const codexThreadId = trimOrUndefined(input.usage?.codexThreadId) ?? trimOrUndefined(input.codexThreadId);
    return this.deps.usageIngestion.recordCodexRuntimeUsage({
      organizationId: input.organizationId,
      userId: input.userId,
      departmentIdSnapshot: input.departmentIdSnapshot,
      threadId: input.threadId,
      sessionId: input.sessionId,
      model: input.model,
      featureType: input.featureType ?? "chat",
      billing: billingForProvider(input.provider ?? (typeof input.metadata?.provider === "string" ? input.metadata.provider : undefined)),
      inputTokens: input.usage?.inputTokens ?? 0,
      cachedInputTokens: input.usage?.cachedInputTokens ?? 0,
      cacheWriteTokens: input.usage?.cacheWriteTokens,
      outputTokens: input.usage?.outputTokens ?? 0,
      codexRuntimeUsageKind: input.usage?.kind ?? "turn_delta",
      codexRuntimeCumulativeUsage: cumulativeUsageFromSnapshot(input.usage),
      codexRuntimeModelInvocations: input.usage?.modelInvocations,
      codexTurnId: input.usage?.codexTurnId,
      codexTurnIds: input.usage?.codexTurnIds,
      accountingSource: input.usage?.accountingSource,
      codexThreadId,
      resultStatus: input.resultStatus,
      createdAt: input.createdAt,
      metadata: metadataWithCodexThread({
        metadata: input.metadata,
        codexThreadId
      })
    });
  }

  async recordDirectUsage(input: RecordDirectUsageInput): Promise<UsageEventRecord> {
    return this.deps.usageIngestion.record(input);
  }
}
