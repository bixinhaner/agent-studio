import type {
  CostProfileRecord,
  CostProfileRepository
} from "../persistence/cost-profile-repository.js";
import type {
  CreateUsageEventInput,
  UsageEventRecord,
  UsageEventRepository
} from "../persistence/usage-event-repository.js";

export type RecordUsageInput = Omit<CreateUsageEventInput, "estimatedCost" | "internalCost" | "resultStatus"> & {
  resultStatus?: string;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
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

  const estimated =
    input.inputTokens * inputTokenPrice +
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
      usageEvents: Pick<UsageEventRepository, "create">;
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
}
