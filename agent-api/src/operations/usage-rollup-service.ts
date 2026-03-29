import { UsageRollupRepository, type UsageDailyRollupRecord } from "../persistence/usage-rollup-repository.js";

export type UsageRollupSourceEvent = {
  organizationId?: string;
  userId?: string;
  departmentIdSnapshot?: string;
  model: string;
  featureType: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  estimatedCost?: string;
  internalCost?: string;
  resultStatus: string;
};

export type RebuildUsageRollupsInput = {
  rollupDate: string | Date;
  organizationId?: string;
  events: UsageRollupSourceEvent[];
};

export class UsageRollupService {
  constructor(private readonly rollups: UsageRollupRepository) {}

  async rebuildDaily(input: RebuildUsageRollupsInput): Promise<{ rollupDate: string; records: UsageDailyRollupRecord[] }> {
    const rollupDate = toDayKey(input.rollupDate);
    const aggregates = new Map<string, UsageDailyRollupRecord>();

    for (const event of input.events) {
      const organizationId = trimOrUndefined(event.organizationId) ?? trimOrUndefined(input.organizationId);
      const requestCount = 1;
      const successCount = event.resultStatus === "success" ? 1 : 0;
      const failureCount = event.resultStatus === "success" ? 0 : 1;
      const inputTokens = event.inputTokens ?? 0;
      const cachedInputTokens = event.cachedInputTokens ?? 0;
      const outputTokens = event.outputTokens ?? 0;
      const estimatedCost = formatDecimal(event.estimatedCost);
      const internalCost = formatDecimal(event.internalCost);

      accumulate(aggregates, {
        organizationId,
        rollupDate,
        scopeType: "platform",
        scopeId: "platform",
        model: event.model,
        featureType: event.featureType,
        requestCount,
        successCount,
        failureCount,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        estimatedCost,
        internalCost
      });

      if (trimOrUndefined(event.userId)) {
        accumulate(aggregates, {
          organizationId,
          rollupDate,
          scopeType: "user",
          scopeId: trimOrUndefined(event.userId) ?? "",
          model: event.model,
          featureType: event.featureType,
          requestCount,
          successCount,
          failureCount,
          inputTokens,
          cachedInputTokens,
          outputTokens,
          estimatedCost,
          internalCost
        });
      }

      if (trimOrUndefined(event.departmentIdSnapshot)) {
        accumulate(aggregates, {
          organizationId,
          rollupDate,
          scopeType: "department",
          scopeId: trimOrUndefined(event.departmentIdSnapshot) ?? "",
          model: event.model,
          featureType: event.featureType,
          requestCount,
          successCount,
          failureCount,
          inputTokens,
          cachedInputTokens,
          outputTokens,
          estimatedCost,
          internalCost
        });
      }

      accumulate(aggregates, {
        organizationId,
        rollupDate,
        scopeType: "model",
        scopeId: event.model,
        model: event.model,
        featureType: event.featureType,
        requestCount,
        successCount,
        failureCount,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        estimatedCost,
        internalCost
      });

      accumulate(aggregates, {
        organizationId,
        rollupDate,
        scopeType: "feature",
        scopeId: event.featureType,
        model: event.model,
        featureType: event.featureType,
        requestCount,
        successCount,
        failureCount,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        estimatedCost,
        internalCost
      });
    }

    const records = [...aggregates.values()].sort(compareRollups);
    const persisted = await this.rollups.replaceDaily({
      rollupDate,
      organizationId: trimOrUndefined(input.organizationId),
      records
    });

    return {
      rollupDate,
      records: persisted
    };
  }
}

function accumulate(
  aggregates: Map<string, UsageDailyRollupRecord>,
  input: {
    organizationId?: string;
    rollupDate: string;
    scopeType: "platform" | "user" | "department" | "model" | "feature";
    scopeId: string;
    model: string;
    featureType: string;
    requestCount: number;
    successCount: number;
    failureCount: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    estimatedCost: string;
    internalCost: string;
  }
) {
  const key = [
    input.organizationId ?? "",
    input.rollupDate,
    input.scopeType,
    input.scopeId,
    input.model,
    input.featureType
  ].join("|");
  const existing = aggregates.get(key);
  if (!existing) {
    aggregates.set(key, {
      id: key,
      organizationId: input.organizationId,
      rollupDate: input.rollupDate,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      model: input.model,
      featureType: input.featureType,
      requestCount: input.requestCount,
      successCount: input.successCount,
      failureCount: input.failureCount,
      inputTokens: input.inputTokens,
      cachedInputTokens: input.cachedInputTokens,
      outputTokens: input.outputTokens,
      estimatedCost: input.estimatedCost,
      internalCost: input.internalCost,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    return;
  }

  existing.requestCount += input.requestCount;
  existing.successCount += input.successCount;
  existing.failureCount += input.failureCount;
  existing.inputTokens += input.inputTokens;
  existing.cachedInputTokens += input.cachedInputTokens;
  existing.outputTokens += input.outputTokens;
  existing.estimatedCost = addDecimals(existing.estimatedCost, input.estimatedCost);
  existing.internalCost = addDecimals(existing.internalCost, input.internalCost);
  existing.updatedAt = new Date().toISOString();
}

function compareRollups(left: UsageDailyRollupRecord, right: UsageDailyRollupRecord): number {
  const order: Record<string, number> = {
    platform: 0,
    user: 1,
    department: 2,
    model: 3,
    feature: 4
  };
  return (
    (order[left.scopeType] ?? 99) - (order[right.scopeType] ?? 99) ||
    left.scopeId.localeCompare(right.scopeId, "en") ||
    (left.model ?? "").localeCompare(right.model ?? "", "en") ||
    (left.featureType ?? "").localeCompare(right.featureType ?? "", "en")
  );
}

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toDayKey(value: string | Date): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) return trimmed.slice(0, 10);
    return new Date().toLocaleDateString("en-CA");
  }
  return value.toLocaleDateString("en-CA");
}

function formatDecimal(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toFixed(6);
  if (value && typeof value === "object" && "toFixed" in value && typeof value.toFixed === "function") {
    return value.toFixed(6);
  }
  if (value && typeof value === "object" && "toString" in value && typeof value.toString === "function") {
    return String(value.toString());
  }
  return "0.000000";
}

function addDecimals(left: string, right: string): string {
  return (Number(left) + Number(right)).toFixed(6);
}
