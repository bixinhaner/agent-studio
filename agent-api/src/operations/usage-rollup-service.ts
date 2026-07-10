import { UsageEventRepository, type UsageEventRecord } from "../persistence/usage-event-repository.js";
import { UsageRollupRepository, type UsageDailyRollupRecord } from "../persistence/usage-rollup-repository.js";

export type RebuildUsageRollupsInput = {
  rollupDate: string | Date;
  organizationId?: string | null;
};

type Aggregate = Omit<UsageDailyRollupRecord, "id" | "createdAt" | "updatedAt"> & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export class UsageRollupService {
  constructor(
    private readonly deps: {
      usageEvents: Pick<UsageEventRepository, "listByCreatedAtRange">;
      rollups: UsageRollupRepository;
    }
  ) {}

  async rebuildDaily(input: RebuildUsageRollupsInput): Promise<{ rollupDate: string; records: UsageDailyRollupRecord[] }> {
    const rollupDate = toDayKey(input.rollupDate);
    const from = toDayStart(rollupDate);
    const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);

    const [events, existingRollups] = await Promise.all([
      this.deps.usageEvents.listByCreatedAtRange({
        organizationId: input.organizationId === undefined ? undefined : input.organizationId ?? null,
        from,
        to
      }),
      this.deps.rollups.listByRollupDate({
        rollupDate,
        organizationId: input.organizationId
      })
    ]);

    const targetOrganizations = new Set<string | null>();
    for (const event of events) {
      targetOrganizations.add(normalizeOrgId(event.organizationId));
    }
    for (const rollup of existingRollups) {
      targetOrganizations.add(normalizeOrgId(rollup.organizationId));
    }
    if (input.organizationId !== undefined) {
      targetOrganizations.add(input.organizationId);
    }

    const records: UsageDailyRollupRecord[] = [];
    for (const organizationId of targetOrganizations) {
      const scopedEvents = events.filter((event) => normalizeOrgId(event.organizationId) === organizationId);
      const aggregates = aggregateEvents(organizationId, rollupDate, scopedEvents);
      const persisted = await this.deps.rollups.replaceDaily({
        rollupDate,
        organizationId,
        records: aggregates
      });
      records.push(...persisted);
    }

    return {
      rollupDate,
      records: records.sort(compareRollups)
    };
  }
}

function aggregateEvents(
  organizationId: string | null,
  rollupDate: string,
  events: UsageEventRecord[]
): UsageDailyRollupRecord[] {
  const aggregates = new Map<string, Aggregate>();
  for (const event of events) {
    const requestCount = 1;
    const successCount = event.resultStatus === "success" ? 1 : 0;
    const failureCount = event.resultStatus === "success" ? 0 : 1;
    const inputTokens = event.inputTokens ?? 0;
    const cachedInputTokens = event.cachedInputTokens ?? 0;
    const cacheWriteTokens = event.cacheWriteTokens ?? 0;
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
      cacheWriteTokens,
      outputTokens,
      estimatedCost,
      internalCost
    });

    if (normalizeOrgId(event.userId)) {
      accumulate(aggregates, {
        organizationId,
        rollupDate,
        scopeType: "user",
        scopeId: normalizeOrgId(event.userId) ?? "",
        model: event.model,
        featureType: event.featureType,
        requestCount,
        successCount,
        failureCount,
        inputTokens,
        cachedInputTokens,
        cacheWriteTokens,
        outputTokens,
        estimatedCost,
        internalCost
      });
    }

    if (normalizeOrgId(event.departmentIdSnapshot)) {
      accumulate(aggregates, {
        organizationId,
        rollupDate,
        scopeType: "department",
        scopeId: normalizeOrgId(event.departmentIdSnapshot) ?? "",
        model: event.model,
        featureType: event.featureType,
        requestCount,
        successCount,
        failureCount,
        inputTokens,
        cachedInputTokens,
        cacheWriteTokens,
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
      cacheWriteTokens,
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
      cacheWriteTokens,
      outputTokens,
      estimatedCost,
      internalCost
    });
  }

  return [...aggregates.values()].sort(compareRollups);
}

function accumulate(
  aggregates: Map<string, Aggregate>,
  input: {
    organizationId: string | null;
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
    cacheWriteTokens: number;
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
    const now = new Date().toISOString();
    aggregates.set(key, {
      id: key,
      organizationId: input.organizationId ?? undefined,
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
      cacheWriteTokens: input.cacheWriteTokens,
      outputTokens: input.outputTokens,
      estimatedCost: input.estimatedCost,
      internalCost: input.internalCost,
      createdAt: now,
      updatedAt: now
    });
    return;
  }

  existing.requestCount += input.requestCount;
  existing.successCount += input.successCount;
  existing.failureCount += input.failureCount;
  existing.inputTokens += input.inputTokens;
  existing.cachedInputTokens += input.cachedInputTokens;
  existing.cacheWriteTokens = (existing.cacheWriteTokens ?? 0) + input.cacheWriteTokens;
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

function normalizeOrgId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function toDayKey(value: string | Date): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) return trimmed.slice(0, 10);
    return new Date().toLocaleDateString("en-CA");
  }
  return value.toLocaleDateString("en-CA");
}

function toDayStart(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }
  return parsed;
}

function formatDecimal(value: unknown): string {
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toFixed(6) : value;
  }
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
