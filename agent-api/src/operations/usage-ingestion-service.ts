import type {
  CostProfileRecord,
  CostProfileRepository
} from "../persistence/cost-profile-repository.js";
import type {
  CreateUsageEventInput,
  UsageEventRecord,
  UsageEventRepository
} from "../persistence/usage-event-repository.js";
import { billableUncachedInputTokens } from "./usage-metrics.js";

export type RecordUsageInput = Omit<CreateUsageEventInput, "estimatedCost" | "internalCost" | "resultStatus"> & {
  resultStatus?: string;
};

const CODEX_RUNTIME_USAGE_METADATA_KEY = "_codexRuntimeUsage";

type CodexRuntimeUsageMetadata = {
  version: 1;
  kind: "cumulative_snapshot";
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function toTokenCount(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return undefined;
  return Math.round(numeric);
}

function codexRuntimeUsageMetadata(input: {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}): CodexRuntimeUsageMetadata {
  return {
    version: 1,
    kind: "cumulative_snapshot",
    inputTokens: Math.max(0, Math.round(input.inputTokens)),
    cachedInputTokens: Math.max(0, Math.round(input.cachedInputTokens)),
    outputTokens: Math.max(0, Math.round(input.outputTokens))
  };
}

function snapshotFromMetadata(value: unknown): CodexRuntimeUsageMetadata | undefined {
  const root = asRecord(value);
  const snapshot = asRecord(root?.[CODEX_RUNTIME_USAGE_METADATA_KEY]);
  if (!snapshot || snapshot.kind !== "cumulative_snapshot") return undefined;
  const inputTokens = toTokenCount(snapshot.inputTokens);
  const cachedInputTokens = toTokenCount(snapshot.cachedInputTokens);
  const outputTokens = toTokenCount(snapshot.outputTokens);
  if (inputTokens === undefined || cachedInputTokens === undefined || outputTokens === undefined) return undefined;
  return codexRuntimeUsageMetadata({
    inputTokens,
    cachedInputTokens,
    outputTokens
  });
}

function metadataWithCodexRuntimeSnapshot(input: {
  metadata?: unknown;
  snapshot: CodexRuntimeUsageMetadata;
}): Record<string, unknown> {
  return {
    ...(asRecord(input.metadata) ?? {}),
    [CODEX_RUNTIME_USAGE_METADATA_KEY]: input.snapshot
  };
}

function deltaFromCumulative(current: number, previous: number | undefined): number {
  if (previous === undefined) return current;
  if (current >= previous) return current - previous;
  return current;
}

function parseDecimal(value: string | undefined, fallback = 0): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatCost(value: number): string {
  if (!Number.isFinite(value)) return "0.000000";
  return value.toFixed(6);
}

function pricePerToken(pricePerMillionTokens: number): number {
  return pricePerMillionTokens / 1_000_000;
}

function calculateEstimatedCost(input: {
  profile: CostProfileRecord | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}): { estimatedCost: string; internalCost: string } {
  if (!input.profile) {
    return {
      estimatedCost: "0.000000",
      internalCost: "0.000000"
    };
  }

  const inputTokenPrice = pricePerToken(parseDecimal(input.profile.inputTokenPrice));
  const cachedInputTokenPrice = pricePerToken(parseDecimal(input.profile.cachedInputTokenPrice));
  const outputTokenPrice = pricePerToken(parseDecimal(input.profile.outputTokenPrice));
  const internalCostMultiplier = parseDecimal(input.profile.internalCostMultiplier, 1);
  const uncachedInputTokens = billableUncachedInputTokens(input.inputTokens, input.cachedInputTokens);

  const estimated =
    uncachedInputTokens * inputTokenPrice +
    input.cachedInputTokens * cachedInputTokenPrice +
    input.outputTokens * outputTokenPrice;
  const internal = estimated * internalCostMultiplier;

  return {
    estimatedCost: formatCost(estimated),
    internalCost: formatCost(internal)
  };
}

export class UsageIngestionService {
  constructor(
    private readonly dependencies: {
      usageEvents: Pick<UsageEventRepository, "create" | "list">;
      costProfiles: Pick<CostProfileRepository, "getActiveByModel">;
    }
  ) {}

  async record(input: RecordUsageInput): Promise<UsageEventRecord> {
    const model = trimOrUndefined(input.model);
    const featureType = trimOrUndefined(input.featureType);
    if (!model || !featureType) {
      throw new Error("usage event model and featureType are required");
    }

    const profile = await this.dependencies.costProfiles.getActiveByModel({
      organizationId: trimOrUndefined(input.organizationId),
      model
    });
    const costs = calculateEstimatedCost({
      profile,
      inputTokens: input.inputTokens ?? 0,
      cachedInputTokens: input.cachedInputTokens ?? 0,
      outputTokens: input.outputTokens ?? 0
    });

    return this.dependencies.usageEvents.create({
      ...input,
      model,
      featureType,
      estimatedCost: costs.estimatedCost,
      internalCost: costs.internalCost,
      resultStatus: trimOrUndefined(input.resultStatus) ?? "success"
    });
  }

  async recordCodexRuntimeUsage(input: RecordUsageInput): Promise<UsageEventRecord> {
    const currentSnapshot = codexRuntimeUsageMetadata({
      inputTokens: input.inputTokens ?? 0,
      cachedInputTokens: input.cachedInputTokens ?? 0,
      outputTokens: input.outputTokens ?? 0
    });

    const sessionId = trimOrUndefined(input.sessionId);
    const previousEvent = sessionId
      ? (await this.dependencies.usageEvents.list({
          sessionId,
          featureType: input.featureType,
          take: 1
        }))[0]
      : undefined;
    const previousSnapshot = snapshotFromMetadata(previousEvent?.metadata) ?? (
      previousEvent
        ? codexRuntimeUsageMetadata({
            inputTokens: previousEvent.inputTokens,
            cachedInputTokens: previousEvent.cachedInputTokens,
            outputTokens: previousEvent.outputTokens
          })
        : undefined
    );

    return this.record({
      ...input,
      inputTokens: deltaFromCumulative(currentSnapshot.inputTokens, previousSnapshot?.inputTokens),
      cachedInputTokens: deltaFromCumulative(currentSnapshot.cachedInputTokens, previousSnapshot?.cachedInputTokens),
      outputTokens: deltaFromCumulative(currentSnapshot.outputTokens, previousSnapshot?.outputTokens),
      metadata: metadataWithCodexRuntimeSnapshot({
        metadata: input.metadata,
        snapshot: currentSnapshot
      })
    });
  }
}
