import type {
  ListUsageEventsByExactRangeInput,
  ListUsageEventsInput,
  UsageEventRecord,
  UsageEventRepository
} from "../persistence/usage-event-repository.js";

export type UsageLedgerRanking = {
  key: string;
  requestCount: number;
  estimatedCost: string;
  internalCost: string;
};

export type UsageLedgerTrend = {
  rollupDate: string;
  requestCount: number;
  successCount: number;
  failureCount: number;
  estimatedCost: string;
  internalCost: string;
};

export type UsageLedgerOverview = {
  totalRequests: number;
  totalEstimatedCost: string;
  totalInternalCost: string;
  trends: UsageLedgerTrend[];
};

export type UsageLedgerRankings = {
  topUsers: Array<Omit<UsageLedgerRanking, "key"> & { userId: string }>;
  topDepartments: Array<Omit<UsageLedgerRanking, "key"> & { departmentId: string }>;
  topModels: Array<Omit<UsageLedgerRanking, "key"> & { model: string }>;
  topFeatures: Array<Omit<UsageLedgerRanking, "key"> & { featureType: string }>;
};

type UsageEventStore = Pick<UsageEventRepository, "list" | "listByExactCreatedAtRange">;

const EXTERNAL_API_FEATURE_TYPE = "external_openai_api";

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toDateKey(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const trimmed = value.trim();
  if (!trimmed) return new Date().toISOString().slice(0, 10);
  return trimmed.slice(0, 10);
}

function aggregateRankings<T extends UsageEventRecord>(
  records: T[],
  selectKey: (record: T) => string | undefined
): UsageLedgerRanking[] {
  const buckets = new Map<string, { requestCount: number; estimatedCost: number; internalCost: number }>();
  for (const record of records) {
    const key = trimOrUndefined(selectKey(record));
    if (!key) continue;
    const existing = buckets.get(key) ?? { requestCount: 0, estimatedCost: 0, internalCost: 0 };
    existing.requestCount += 1;
    existing.estimatedCost += toNumber(record.estimatedCost);
    existing.internalCost += toNumber(record.internalCost);
    buckets.set(key, existing);
  }

  return [...buckets.entries()]
    .map(([key, value]) => ({
      key,
      requestCount: value.requestCount,
      estimatedCost: value.estimatedCost.toFixed(6),
      internalCost: value.internalCost.toFixed(6)
    }))
    .sort(
      (left, right) =>
        right.requestCount - left.requestCount ||
        toNumber(right.estimatedCost) - toNumber(left.estimatedCost) ||
        left.key.localeCompare(right.key)
    );
}

function buildTrends(records: UsageEventRecord[]): UsageLedgerTrend[] {
  const buckets = new Map<string, UsageLedgerTrend>();
  for (const record of records) {
    const rollupDate = toDateKey(record.createdAt);
    const existing = buckets.get(rollupDate) ?? {
      rollupDate,
      requestCount: 0,
      successCount: 0,
      failureCount: 0,
      estimatedCost: "0.000000",
      internalCost: "0.000000"
    };
    existing.requestCount += 1;
    existing.successCount += record.resultStatus === "success" ? 1 : 0;
    existing.failureCount += record.resultStatus === "success" ? 0 : 1;
    existing.estimatedCost = (toNumber(existing.estimatedCost) + toNumber(record.estimatedCost)).toFixed(6);
    existing.internalCost = (toNumber(existing.internalCost) + toNumber(record.internalCost)).toFixed(6);
    buckets.set(rollupDate, existing);
  }
  return [...buckets.values()].sort((left, right) => left.rollupDate.localeCompare(right.rollupDate));
}

export class UsageLedgerService {
  constructor(private readonly deps: { usageEvents: UsageEventStore }) {}

  async listEvents(input: ListUsageEventsInput = {}): Promise<UsageEventRecord[]> {
    return this.deps.usageEvents.list(input);
  }

  async listEventsByExactCreatedAtRange(input: ListUsageEventsByExactRangeInput): Promise<UsageEventRecord[]> {
    return this.deps.usageEvents.listByExactCreatedAtRange(input);
  }

  async listExternalApiEvents(input: Omit<ListUsageEventsInput, "featureType"> = {}): Promise<UsageEventRecord[]> {
    return this.listEvents({
      ...input,
      featureType: EXTERNAL_API_FEATURE_TYPE
    });
  }

  buildTrends(records: UsageEventRecord[]): UsageLedgerTrend[] {
    return buildTrends(records);
  }

  buildRankings(records: UsageEventRecord[]): UsageLedgerRankings {
    return {
      topUsers: aggregateRankings(records, (record) => record.userId).map(({ key, ...item }) => ({
        ...item,
        userId: key
      })),
      topDepartments: aggregateRankings(records, (record) => record.departmentIdSnapshot).map(({ key, ...item }) => ({
        ...item,
        departmentId: key
      })),
      topModels: aggregateRankings(records, (record) => record.model).map(({ key, ...item }) => ({
        ...item,
        model: key
      })),
      topFeatures: aggregateRankings(records, (record) => record.featureType).map(({ key, ...item }) => ({
        ...item,
        featureType: key
      }))
    };
  }

  buildOverview(records: UsageEventRecord[]): UsageLedgerOverview {
    return {
      totalRequests: records.length,
      totalEstimatedCost: records.reduce((sum, item) => sum + toNumber(item.estimatedCost), 0).toFixed(6),
      totalInternalCost: records.reduce((sum, item) => sum + toNumber(item.internalCost), 0).toFixed(6),
      trends: buildTrends(records)
    };
  }
}
