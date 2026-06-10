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
  codexRuntimeUsageKind?: "turn_delta" | "cumulative_snapshot";
  codexRuntimeCumulativeUsage?: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
  };
  codexThreadId?: string;
};

const CODEX_RUNTIME_USAGE_METADATA_KEY = "_codexRuntimeUsage";
const COST_PROFILE_METADATA_KEY = "_costProfile";

type CodexRuntimeUsageMetadata = {
  version: 1;
  kind: "cumulative_snapshot" | "turn_delta";
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  codexThreadId?: string;
  cumulative?: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
  };
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
  kind?: CodexRuntimeUsageMetadata["kind"];
  codexThreadId?: string;
  cumulative?: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
  };
}): CodexRuntimeUsageMetadata {
  return {
    version: 1,
    kind: input.kind ?? "cumulative_snapshot",
    inputTokens: Math.max(0, Math.round(input.inputTokens)),
    cachedInputTokens: Math.max(0, Math.round(input.cachedInputTokens)),
    outputTokens: Math.max(0, Math.round(input.outputTokens)),
    ...(trimOrUndefined(input.codexThreadId) ? { codexThreadId: trimOrUndefined(input.codexThreadId) } : {}),
    ...(input.cumulative
      ? {
          cumulative: {
            inputTokens: Math.max(0, Math.round(input.cumulative.inputTokens)),
            cachedInputTokens: Math.max(0, Math.round(input.cumulative.cachedInputTokens)),
            outputTokens: Math.max(0, Math.round(input.cumulative.outputTokens))
          }
        }
      : {})
  };
}

function snapshotFromMetadata(value: unknown): CodexRuntimeUsageMetadata | undefined {
  const root = asRecord(value);
  const snapshot = asRecord(root?.[CODEX_RUNTIME_USAGE_METADATA_KEY]);
  if (!snapshot) return undefined;
  const cumulative = snapshot.kind === "turn_delta" ? asRecord(snapshot.cumulative) : snapshot;
  if (!cumulative) return undefined;
  const inputTokens = toTokenCount(cumulative.inputTokens);
  const cachedInputTokens = toTokenCount(cumulative.cachedInputTokens);
  const outputTokens = toTokenCount(cumulative.outputTokens);
  if (inputTokens === undefined || cachedInputTokens === undefined || outputTokens === undefined) return undefined;
  return codexRuntimeUsageMetadata({
    inputTokens,
    cachedInputTokens,
    outputTokens,
    codexThreadId: typeof snapshot.codexThreadId === "string" ? snapshot.codexThreadId : undefined
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

function codexThreadIdFromMetadata(value: unknown): string | undefined {
  const root = asRecord(value);
  const direct = typeof root?.codexThreadId === "string" ? root.codexThreadId : undefined;
  const snapshot = asRecord(root?.[CODEX_RUNTIME_USAGE_METADATA_KEY]);
  const fromSnapshot = typeof snapshot?.codexThreadId === "string" ? snapshot.codexThreadId : undefined;
  return trimOrUndefined(fromSnapshot) ?? trimOrUndefined(direct);
}

function sanitizeUsage(input: {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
}): {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
} {
  const inputTokens = Math.max(0, Math.round(input.inputTokens ?? 0));
  const cachedInputTokens = Math.min(inputTokens, Math.max(0, Math.round(input.cachedInputTokens ?? 0)));
  const outputTokens = Math.max(0, Math.round(input.outputTokens ?? 0));
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens
  };
}

function metadataWithCostProfile(input: {
  metadata?: unknown;
  profile: CostProfileRecord | null;
}): Record<string, unknown> {
  const profileMetadata = input.profile
    ? Object.fromEntries(
        Object.entries({
          version: 1,
          matched: true,
          profileId: input.profile.id,
          organizationId: input.profile.organizationId,
          model: input.profile.model,
          inputTokenPrice: input.profile.inputTokenPrice,
          cachedInputTokenPrice: input.profile.cachedInputTokenPrice,
          outputTokenPrice: input.profile.outputTokenPrice,
          internalCostMultiplier: input.profile.internalCostMultiplier
        }).filter(([, value]) => value !== undefined)
      )
    : {
        version: 1,
        matched: false
      };
  return {
    ...(asRecord(input.metadata) ?? {}),
    [COST_PROFILE_METADATA_KEY]: profileMetadata
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
      afterRecord?: (event: UsageEventRecord) => Promise<void>;
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
    const usage = sanitizeUsage({
      inputTokens: input.inputTokens,
      cachedInputTokens: input.cachedInputTokens,
      outputTokens: input.outputTokens
    });
    const costs = calculateEstimatedCost({
      profile,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens
    });

    const created = await this.dependencies.usageEvents.create({
      ...input,
      model,
      featureType,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
      estimatedCost: costs.estimatedCost,
      internalCost: costs.internalCost,
      resultStatus: trimOrUndefined(input.resultStatus) ?? "success",
      metadata: metadataWithCostProfile({
        metadata: input.metadata,
        profile
      })
    });
    await this.dependencies.afterRecord?.(created);
    return created;
  }

  async recordCodexRuntimeUsage(input: RecordUsageInput): Promise<UsageEventRecord> {
    const codexThreadId = trimOrUndefined(input.codexThreadId) ?? codexThreadIdFromMetadata(input.metadata);
    const cumulativeUsage = input.codexRuntimeCumulativeUsage
      ? sanitizeUsage(input.codexRuntimeCumulativeUsage)
      : undefined;
    const currentSnapshot = codexRuntimeUsageMetadata({
      inputTokens: input.inputTokens ?? 0,
      cachedInputTokens: input.cachedInputTokens ?? 0,
      outputTokens: input.outputTokens ?? 0,
      kind: input.codexRuntimeUsageKind ?? "cumulative_snapshot",
      codexThreadId,
      cumulative: cumulativeUsage
    });

    if (currentSnapshot.kind === "turn_delta") {
      return this.record({
        ...input,
        inputTokens: currentSnapshot.inputTokens,
        cachedInputTokens: currentSnapshot.cachedInputTokens,
        outputTokens: currentSnapshot.outputTokens,
        metadata: metadataWithCodexRuntimeSnapshot({
          metadata: {
            ...(asRecord(input.metadata) ?? {}),
            ...(codexThreadId ? { codexThreadId } : {})
          },
          snapshot: currentSnapshot
        })
      });
    }

    const sessionId = trimOrUndefined(input.sessionId);
    const previousEvents = sessionId
      ? await this.dependencies.usageEvents.list({
          sessionId,
          featureType: input.featureType,
          take: 50
        })
      : [];
    const previousEvent = codexThreadId
      ? previousEvents.find((event) => codexThreadIdFromMetadata(event.metadata) === codexThreadId) ??
        (previousEvents.some((event) => codexThreadIdFromMetadata(event.metadata)) ? undefined : previousEvents[0])
      : previousEvents[0];
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
        metadata: {
          ...(asRecord(input.metadata) ?? {}),
          ...(codexThreadId ? { codexThreadId } : {})
        },
        snapshot: currentSnapshot
      })
    });
  }
}
