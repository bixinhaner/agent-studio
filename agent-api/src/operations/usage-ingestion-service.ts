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
    cacheWriteTokens?: number;
    outputTokens: number;
  };
  codexRuntimeModelInvocations?: Array<{
    inputTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens?: number;
    outputTokens: number;
    modelContextWindow?: number;
  }>;
  codexThreadId?: string;
};

const CODEX_RUNTIME_USAGE_METADATA_KEY = "_codexRuntimeUsage";
const COST_PROFILE_METADATA_KEY = "_costProfile";

type CodexRuntimeUsageMetadata = {
  version: 1;
  kind: "cumulative_snapshot" | "turn_delta";
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens?: number;
  outputTokens: number;
  codexThreadId?: string;
  cumulative?: {
    inputTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens?: number;
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
  cacheWriteTokens?: number;
  outputTokens: number;
  kind?: CodexRuntimeUsageMetadata["kind"];
  codexThreadId?: string;
  cumulative?: {
    inputTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens?: number;
    outputTokens: number;
  };
}): CodexRuntimeUsageMetadata {
  return {
    version: 1,
    kind: input.kind ?? "cumulative_snapshot",
    inputTokens: Math.max(0, Math.round(input.inputTokens)),
    cachedInputTokens: Math.max(0, Math.round(input.cachedInputTokens)),
    ...(input.cacheWriteTokens !== undefined
      ? { cacheWriteTokens: Math.max(0, Math.round(input.cacheWriteTokens)) }
      : {}),
    outputTokens: Math.max(0, Math.round(input.outputTokens)),
    ...(trimOrUndefined(input.codexThreadId) ? { codexThreadId: trimOrUndefined(input.codexThreadId) } : {}),
    ...(input.cumulative
      ? {
          cumulative: {
            inputTokens: Math.max(0, Math.round(input.cumulative.inputTokens)),
            cachedInputTokens: Math.max(0, Math.round(input.cumulative.cachedInputTokens)),
            ...(input.cumulative.cacheWriteTokens !== undefined
              ? { cacheWriteTokens: Math.max(0, Math.round(input.cumulative.cacheWriteTokens)) }
              : {}),
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
  const cacheWriteTokens = toTokenCount(cumulative.cacheWriteTokens);
  const outputTokens = toTokenCount(cumulative.outputTokens);
  if (inputTokens === undefined || cachedInputTokens === undefined || outputTokens === undefined) return undefined;
  return codexRuntimeUsageMetadata({
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
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
  cacheWriteTokens?: number;
  outputTokens?: number;
}): {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
} {
  const inputTokens = Math.max(0, Math.round(input.inputTokens ?? 0));
  const cachedInputTokens = Math.min(inputTokens, Math.max(0, Math.round(input.cachedInputTokens ?? 0)));
  const cacheWriteTokens = Math.min(
    Math.max(0, inputTokens - cachedInputTokens),
    Math.max(0, Math.round(input.cacheWriteTokens ?? 0))
  );
  const outputTokens = Math.max(0, Math.round(input.outputTokens ?? 0));
  return {
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    outputTokens
  };
}

function metadataWithCostProfile(input: {
  metadata?: unknown;
  profile: CostProfileRecord | null;
  cacheWriteTelemetryAvailable: boolean;
  pricing: Pick<CalculatedUsageCost,
    | "longContextApplied"
    | "longContextInvocationCount"
    | "maxInvocationInputTokens"
    | "longContextPricingBasis"
    | "longContextPricingComplete"
  >;
}): Record<string, unknown> {
  const cacheWritePrice = parseDecimal(input.profile?.cacheWriteTokenPrice);
  const profileMetadata = input.profile
    ? Object.fromEntries(
        Object.entries({
          version: 3,
          matched: true,
          profileId: input.profile.id,
          organizationId: input.profile.organizationId,
          model: input.profile.model,
          inputTokenPrice: input.profile.inputTokenPrice,
          cachedInputTokenPrice: input.profile.cachedInputTokenPrice,
          cacheWriteTokenPrice: input.profile.cacheWriteTokenPrice,
          outputTokenPrice: input.profile.outputTokenPrice,
          longContextThresholdTokens: input.profile.longContextThresholdTokens,
          longContextInputMultiplier: input.profile.longContextInputMultiplier,
          longContextOutputMultiplier: input.profile.longContextOutputMultiplier,
          longContextApplied: input.pricing.longContextApplied,
          longContextInvocationCount: input.pricing.longContextInvocationCount,
          maxInvocationInputTokens: input.pricing.maxInvocationInputTokens,
          longContextPricingBasis: input.pricing.longContextPricingBasis,
          longContextPricingComplete: input.pricing.longContextPricingComplete,
          internalCostMultiplier: input.profile.internalCostMultiplier,
          costCompleteness:
            cacheWritePrice > 0 && !input.cacheWriteTelemetryAvailable
              ? "upper_bound_missing_cache_write_tokens"
              : "complete"
        }).filter(([, value]) => value !== undefined)
      )
    : {
        version: 2,
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

export type CalculatedUsageCost = {
  estimatedCost: string;
  internalCost: string;
  longContextApplied: boolean;
  longContextInvocationCount: number;
  maxInvocationInputTokens: number;
  longContextPricingBasis: "aggregate_request" | "model_invocation";
  longContextPricingComplete: boolean;
};

type PricingInvocation = {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
};

function invocationCost(input: {
  usage: PricingInvocation;
  inputTokenPrice: number;
  cachedInputTokenPrice: number;
  cacheWriteTokenPrice: number;
  outputTokenPrice: number;
  cacheWriteTelemetryAvailable: boolean;
}): number {
  const billableUncachedTokens = billableUncachedInputTokens(input.usage.inputTokens, input.usage.cachedInputTokens);
  const cacheWriteTokens = input.cacheWriteTelemetryAvailable
    ? input.usage.cacheWriteTokens
    : input.cacheWriteTokenPrice > 0
      ? billableUncachedTokens
      : 0;
  const uncachedInputTokens = Math.max(0, billableUncachedTokens - cacheWriteTokens);
  return (
    uncachedInputTokens * input.inputTokenPrice +
    input.usage.cachedInputTokens * input.cachedInputTokenPrice +
    cacheWriteTokens * input.cacheWriteTokenPrice +
    input.usage.outputTokens * input.outputTokenPrice
  );
}

function sanitizePricingInvocations(input: {
  invocations: RecordUsageInput["codexRuntimeModelInvocations"];
  aggregate: PricingInvocation;
}): { invocations: PricingInvocation[]; complete: boolean } {
  if (!input.invocations) return { invocations: [], complete: false };
  const invocations = input.invocations.map((invocation) => sanitizeUsage(invocation));
  const totals = invocations.reduce(
    (sum, invocation) => ({
      inputTokens: sum.inputTokens + invocation.inputTokens,
      cachedInputTokens: sum.cachedInputTokens + invocation.cachedInputTokens,
      cacheWriteTokens: sum.cacheWriteTokens + invocation.cacheWriteTokens,
      outputTokens: sum.outputTokens + invocation.outputTokens
    }),
    { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }
  );
  const withinAggregate =
    totals.inputTokens <= input.aggregate.inputTokens &&
    totals.cachedInputTokens <= input.aggregate.cachedInputTokens &&
    totals.cacheWriteTokens <= input.aggregate.cacheWriteTokens &&
    totals.outputTokens <= input.aggregate.outputTokens;
  return {
    invocations: withinAggregate ? invocations : [],
    complete: withinAggregate && totals.inputTokens === input.aggregate.inputTokens && totals.outputTokens === input.aggregate.outputTokens
  };
}

export function calculateEstimatedCost(input: {
  profile: CostProfileRecord | null;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  cacheWriteTelemetryAvailable: boolean;
  outputTokens: number;
  modelInvocations?: RecordUsageInput["codexRuntimeModelInvocations"];
  longContextPricingBasis?: "aggregate_request" | "model_invocation";
}): CalculatedUsageCost {
  const longContextPricingBasis = input.longContextPricingBasis ?? "aggregate_request";
  if (!input.profile) {
    return {
      estimatedCost: "0.000000",
      internalCost: "0.000000",
      longContextApplied: false,
      longContextInvocationCount: 0,
      maxInvocationInputTokens: 0,
      longContextPricingBasis,
      longContextPricingComplete: longContextPricingBasis === "aggregate_request"
    };
  }

  const inputTokenPrice = pricePerToken(parseDecimal(input.profile.inputTokenPrice));
  const cachedInputTokenPrice = pricePerToken(parseDecimal(input.profile.cachedInputTokenPrice));
  const cacheWriteTokenPrice = pricePerToken(parseDecimal(input.profile.cacheWriteTokenPrice));
  const outputTokenPrice = pricePerToken(parseDecimal(input.profile.outputTokenPrice));
  const longContextThresholdTokens = input.profile.longContextThresholdTokens ?? 0;
  const inputPriceMultiplier = parseDecimal(input.profile.longContextInputMultiplier, 1);
  const outputPriceMultiplier = parseDecimal(input.profile.longContextOutputMultiplier, 1);
  const internalCostMultiplier = parseDecimal(input.profile.internalCostMultiplier, 1);
  const aggregateUsage = sanitizeUsage(input);
  const baseEstimated = invocationCost({
    usage: aggregateUsage,
    inputTokenPrice,
    cachedInputTokenPrice,
    cacheWriteTokenPrice,
    outputTokenPrice,
    cacheWriteTelemetryAvailable: input.cacheWriteTelemetryAvailable
  });
  const pricingInvocations = sanitizePricingInvocations({
    invocations: input.modelInvocations,
    aggregate: aggregateUsage
  });
  const candidates = longContextPricingBasis === "model_invocation"
    ? pricingInvocations.invocations
    : [aggregateUsage];
  const longInvocations = longContextThresholdTokens > 0
    ? candidates.filter((invocation) => invocation.inputTokens > longContextThresholdTokens)
    : [];
  const longContextExtra = longInvocations.reduce((sum, invocation) => {
    const normalInputCost = invocationCost({
      usage: { ...invocation, outputTokens: 0 },
      inputTokenPrice,
      cachedInputTokenPrice,
      cacheWriteTokenPrice,
      outputTokenPrice,
      cacheWriteTelemetryAvailable: input.cacheWriteTelemetryAvailable
    });
    const normalOutputCost = invocation.outputTokens * outputTokenPrice;
    return sum + normalInputCost * (inputPriceMultiplier - 1) + normalOutputCost * (outputPriceMultiplier - 1);
  }, 0);
  const estimated = baseEstimated + longContextExtra;
  const internal = estimated * internalCostMultiplier;
  const maxInvocationInputTokens = candidates.reduce((max, invocation) => Math.max(max, invocation.inputTokens), 0);

  return {
    estimatedCost: formatCost(estimated),
    internalCost: formatCost(internal),
    longContextApplied: longInvocations.length > 0,
    longContextInvocationCount: longInvocations.length,
    maxInvocationInputTokens,
    longContextPricingBasis,
    longContextPricingComplete:
      longContextPricingBasis === "aggregate_request" || pricingInvocations.complete
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
      cacheWriteTokens: input.cacheWriteTokens,
      outputTokens: input.outputTokens
    });
    const costs = calculateEstimatedCost({
      profile,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      cacheWriteTelemetryAvailable: input.cacheWriteTokens !== undefined,
      outputTokens: usage.outputTokens,
      modelInvocations: input.codexRuntimeModelInvocations,
      longContextPricingBasis: input.codexRuntimeModelInvocations !== undefined
        ? "model_invocation"
        : "aggregate_request"
    });

    const created = await this.dependencies.usageEvents.create({
      ...input,
      model,
      featureType,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      outputTokens: usage.outputTokens,
      estimatedCost: costs.estimatedCost,
      internalCost: costs.internalCost,
      resultStatus: trimOrUndefined(input.resultStatus) ?? "success",
      metadata: metadataWithCostProfile({
        metadata: input.metadata,
        profile,
        cacheWriteTelemetryAvailable: input.cacheWriteTokens !== undefined,
        pricing: costs
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
      cacheWriteTokens: input.cacheWriteTokens,
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
      cacheWriteTokens: currentSnapshot.cacheWriteTokens,
      outputTokens: currentSnapshot.outputTokens,
      codexRuntimeModelInvocations: input.codexRuntimeModelInvocations ?? [],
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
            cacheWriteTokens: previousEvent.cacheWriteTokens,
            outputTokens: previousEvent.outputTokens
          })
        : undefined
    );

    return this.record({
      ...input,
      inputTokens: deltaFromCumulative(currentSnapshot.inputTokens, previousSnapshot?.inputTokens),
      cachedInputTokens: deltaFromCumulative(currentSnapshot.cachedInputTokens, previousSnapshot?.cachedInputTokens),
      cacheWriteTokens:
        currentSnapshot.cacheWriteTokens === undefined
          ? undefined
          : deltaFromCumulative(currentSnapshot.cacheWriteTokens, previousSnapshot?.cacheWriteTokens),
      outputTokens: deltaFromCumulative(currentSnapshot.outputTokens, previousSnapshot?.outputTokens),
      codexRuntimeModelInvocations: input.codexRuntimeModelInvocations ?? [],
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
