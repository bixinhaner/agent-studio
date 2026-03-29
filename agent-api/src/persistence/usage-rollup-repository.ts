export type UsageDailyRollupScopeType = "platform" | "user" | "department" | "model" | "feature";

export type UsageDailyRollupRecord = {
  id: string;
  organizationId?: string;
  rollupDate: string;
  scopeType: UsageDailyRollupScopeType;
  scopeId: string;
  model?: string;
  featureType?: string;
  requestCount: number;
  successCount: number;
  failureCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedCost: string;
  internalCost: string;
  createdAt: string;
  updatedAt: string;
};

export type UsageDailyRollupInput = {
  id?: string;
  organizationId?: string;
  rollupDate?: string | Date;
  scopeType: UsageDailyRollupScopeType;
  scopeId: string;
  model?: string;
  featureType?: string;
  requestCount?: number;
  successCount?: number;
  failureCount?: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  estimatedCost?: string;
  internalCost?: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
};

export type ListUsageDailyRollupsInput = {
  organizationId?: string;
  rollupDate?: string | Date;
  scopeType?: UsageDailyRollupScopeType;
  scopeId?: string;
  model?: string;
  featureType?: string;
};

type UsageDailyRollupRow = {
  id: string;
  organizationId: string | null;
  rollupDate: string;
  scopeType: string;
  scopeId: string;
  model: string | null;
  featureType: string | null;
  requestCount: number;
  successCount: number;
  failureCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedCost: unknown;
  internalCost: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type UsageDailyRollupTable = {
  create(args: { data: Record<string, unknown> }): Promise<UsageDailyRollupRow>;
  findMany(args?: {
    where?: {
      organizationId?: string | null;
      rollupDate?: string;
      scopeType?: string;
      scopeId?: string;
      model?: string | null;
      featureType?: string | null;
    };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<UsageDailyRollupRow[]>;
  deleteMany(args?: { where?: { organizationId?: string | null; rollupDate?: string } }): Promise<{ count: number }>;
};

export type UsageRollupRepositoryDb = {
  usageDailyRollup: UsageDailyRollupTable;
};

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

function toIsoString(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
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

function mapUsageDailyRollup(row: UsageDailyRollupRow): UsageDailyRollupRecord {
  return {
    id: row.id,
    organizationId: trimOrUndefined(row.organizationId),
    rollupDate: row.rollupDate,
    scopeType: row.scopeType as UsageDailyRollupScopeType,
    scopeId: row.scopeId,
    model: trimOrUndefined(row.model),
    featureType: trimOrUndefined(row.featureType),
    requestCount: row.requestCount,
    successCount: row.successCount,
    failureCount: row.failureCount,
    inputTokens: row.inputTokens,
    cachedInputTokens: row.cachedInputTokens,
    outputTokens: row.outputTokens,
    estimatedCost: formatDecimal(row.estimatedCost),
    internalCost: formatDecimal(row.internalCost),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

export class UsageRollupRepository {
  constructor(private readonly db: UsageRollupRepositoryDb) {}

  async replaceDaily(input: { rollupDate: string | Date; organizationId?: string; records: UsageDailyRollupInput[] }): Promise<UsageDailyRollupRecord[]> {
    const rollupDate = toDayKey(input.rollupDate);
    const organizationId = trimOrUndefined(input.organizationId);
    const deleteWhere = {
      ...(organizationId ? { organizationId } : {}),
      rollupDate
    };

    await this.db.usageDailyRollup.deleteMany({ where: deleteWhere });

    const created: UsageDailyRollupRecord[] = [];
    for (const record of input.records) {
      const createdRow = await this.db.usageDailyRollup.create({
        data: {
          id: trimOrUndefined(record.id),
          organizationId: trimOrUndefined(record.organizationId) ?? organizationId ?? null,
          rollupDate,
          scopeType: record.scopeType,
          scopeId: trimOrUndefined(record.scopeId) ?? record.scopeId,
          model: trimOrUndefined(record.model) ?? null,
          featureType: trimOrUndefined(record.featureType) ?? null,
          requestCount: record.requestCount ?? 0,
          successCount: record.successCount ?? 0,
          failureCount: record.failureCount ?? 0,
          inputTokens: record.inputTokens ?? 0,
          cachedInputTokens: record.cachedInputTokens ?? 0,
          outputTokens: record.outputTokens ?? 0,
          estimatedCost: trimOrUndefined(record.estimatedCost) ?? "0.000000",
          internalCost: trimOrUndefined(record.internalCost) ?? "0.000000",
          createdAt: record.createdAt instanceof Date ? record.createdAt : record.createdAt ? new Date(record.createdAt) : undefined,
          updatedAt: record.updatedAt instanceof Date ? record.updatedAt : record.updatedAt ? new Date(record.updatedAt) : undefined
        }
      });
      created.push(mapUsageDailyRollup(createdRow));
    }

    return created.sort(compareRollups);
  }

  async list(input: ListUsageDailyRollupsInput = {}): Promise<UsageDailyRollupRecord[]> {
    const where = {
      ...(input.organizationId !== undefined ? { organizationId: input.organizationId ?? null } : {}),
      ...(input.rollupDate ? { rollupDate: toDayKey(input.rollupDate) } : {}),
      ...(input.scopeType ? { scopeType: input.scopeType } : {}),
      ...(trimOrUndefined(input.scopeId) ? { scopeId: trimOrUndefined(input.scopeId) } : {}),
      ...(input.model !== undefined ? { model: trimOrUndefined(input.model) ?? null } : {}),
      ...(input.featureType !== undefined ? { featureType: trimOrUndefined(input.featureType) ?? null } : {})
    };
    const rows = await this.db.usageDailyRollup.findMany({
      where,
      orderBy: { createdAt: "asc" }
    });

    return rows.map(mapUsageDailyRollup).sort(compareRollups);
  }
}

function compareRollups(left: UsageDailyRollupRecord, right: UsageDailyRollupRecord): number {
  const scopeTypeOrder: Record<UsageDailyRollupScopeType, number> = {
    platform: 0,
    user: 1,
    department: 2,
    model: 3,
    feature: 4
  };
  return (
    scopeTypeOrder[left.scopeType] - scopeTypeOrder[right.scopeType] ||
    left.scopeId.localeCompare(right.scopeId, "en") ||
    (left.model ?? "").localeCompare(right.model ?? "", "en") ||
    (left.featureType ?? "").localeCompare(right.featureType ?? "", "en")
  );
}
