export type QuotaPolicyScopeType = "platform" | "department";
export type QuotaPolicyMetricType = "request_count" | "total_tokens" | "estimated_cost" | "internal_cost";
export type QuotaPolicyWindowType = "daily";
export type QuotaPolicyEnforcementMode = "alert_only" | "soft_block";

export type QuotaPolicyRecord = {
  id: string;
  organizationId?: string;
  scopeType: QuotaPolicyScopeType;
  scopeId: string;
  featureType?: string;
  model?: string;
  metricType: QuotaPolicyMetricType;
  windowType: QuotaPolicyWindowType;
  thresholdValue: string;
  enforcementMode: QuotaPolicyEnforcementMode;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type UpsertQuotaPolicyInput = {
  id?: string;
  organizationId?: string;
  scopeType: QuotaPolicyScopeType;
  scopeId: string;
  featureType?: string;
  model?: string;
  metricType: QuotaPolicyMetricType;
  windowType: QuotaPolicyWindowType;
  thresholdValue: string | number;
  enforcementMode?: QuotaPolicyEnforcementMode;
  isActive?: boolean;
  createdAt?: string | Date;
  updatedAt?: string | Date;
};

export type UpdateQuotaPolicyInput = {
  thresholdValue?: string | number;
  enforcementMode?: QuotaPolicyEnforcementMode;
  isActive?: boolean;
};

export type ListQuotaPoliciesInput = {
  organizationId?: string | null;
  scopeType?: QuotaPolicyScopeType;
  scopeId?: string;
  featureType?: string;
  model?: string;
  metricType?: QuotaPolicyMetricType;
  windowType?: QuotaPolicyWindowType;
  isActive?: boolean;
};

type QuotaPolicyRow = {
  id: string;
  organizationId: string | null;
  scopeType: string;
  scopeId: string;
  featureType: string | null;
  model: string | null;
  metricType: string;
  windowType: string;
  thresholdValue: unknown;
  enforcementMode: string;
  isActive: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type QuotaPolicyTable = {
  create(args: { data: Record<string, unknown> }): Promise<QuotaPolicyRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<QuotaPolicyRow>;
  findFirst(args?: {
    where?: {
      organizationId?: string | null;
      scopeType?: string;
      scopeId?: string;
      featureType?: string | null;
      model?: string | null;
      metricType?: string;
      windowType?: string;
      isActive?: boolean;
    };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<QuotaPolicyRow | null>;
  findMany(args?: {
    where?: {
      organizationId?: string | null;
      scopeType?: string;
      scopeId?: string;
      featureType?: string | null;
      model?: string | null;
      metricType?: string;
      windowType?: string;
      isActive?: boolean;
    };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<QuotaPolicyRow[]>;
};

export type QuotaPolicyRepositoryDb = {
  quotaPolicy: QuotaPolicyTable;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
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

function mapQuotaPolicy(row: QuotaPolicyRow): QuotaPolicyRecord {
  return {
    id: row.id,
    organizationId: trimOrUndefined(row.organizationId),
    scopeType: row.scopeType as QuotaPolicyScopeType,
    scopeId: row.scopeId,
    featureType: trimOrUndefined(row.featureType),
    model: trimOrUndefined(row.model),
    metricType: row.metricType as QuotaPolicyMetricType,
    windowType: row.windowType as QuotaPolicyWindowType,
    thresholdValue: formatDecimal(row.thresholdValue),
    enforcementMode: row.enforcementMode as QuotaPolicyEnforcementMode,
    isActive: row.isActive,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

export class QuotaPolicyRepository {
  constructor(private readonly db: QuotaPolicyRepositoryDb) {}

  async upsert(input: UpsertQuotaPolicyInput): Promise<QuotaPolicyRecord> {
    const scopeType = input.scopeType;
    const scopeId = trimOrUndefined(input.scopeId);
    const metricType = input.metricType;
    const windowType = input.windowType;
    if (!scopeId) {
      throw new Error("quota policy scopeId is required");
    }

    const organizationId = trimOrUndefined(input.organizationId);
    const featureType = trimOrUndefined(input.featureType);
    const model = trimOrUndefined(input.model);

    const existing = await this.db.quotaPolicy.findFirst({
      where: {
        organizationId: organizationId ?? null,
        scopeType,
        scopeId,
        featureType: featureType ?? null,
        model: model ?? null,
        metricType,
        windowType
      },
      orderBy: { createdAt: "desc" }
    });

    const payload = {
      organizationId: organizationId ?? null,
      scopeType,
      scopeId,
      featureType: featureType ?? null,
      model: model ?? null,
      metricType,
      windowType,
      thresholdValue: formatDecimal(input.thresholdValue),
      enforcementMode: input.enforcementMode ?? "soft_block",
      isActive: input.isActive ?? true,
      updatedAt: new Date()
    };

    if (!existing) {
      const created = await this.db.quotaPolicy.create({
        data: {
          id: trimOrUndefined(input.id),
          ...payload,
          createdAt: input.createdAt instanceof Date ? input.createdAt : input.createdAt ? new Date(input.createdAt) : undefined
        }
      });
      return mapQuotaPolicy(created);
    }

    const updated = await this.db.quotaPolicy.update({
      where: { id: existing.id },
      data: payload
    });
    return mapQuotaPolicy(updated);
  }

  async list(input: ListQuotaPoliciesInput = {}): Promise<QuotaPolicyRecord[]> {
    const rows = await this.db.quotaPolicy.findMany({
      where: {
        ...(input.organizationId !== undefined ? { organizationId: input.organizationId ?? null } : {}),
        ...(input.scopeType ? { scopeType: input.scopeType } : {}),
        ...(trimOrUndefined(input.scopeId) ? { scopeId: trimOrUndefined(input.scopeId) } : {}),
        ...(input.featureType !== undefined ? { featureType: trimOrUndefined(input.featureType) ?? null } : {}),
        ...(input.model !== undefined ? { model: trimOrUndefined(input.model) ?? null } : {}),
        ...(input.metricType ? { metricType: input.metricType } : {}),
        ...(input.windowType ? { windowType: input.windowType } : {}),
        ...(typeof input.isActive === "boolean" ? { isActive: input.isActive } : {})
      },
      orderBy: { createdAt: "asc" }
    });

    return rows.map(mapQuotaPolicy);
  }

  async getById(id: string): Promise<QuotaPolicyRecord | null> {
    const normalized = trimOrUndefined(id);
    if (!normalized) return null;
    const rows = await this.db.quotaPolicy.findMany({
      orderBy: { createdAt: "desc" }
    });
    const row = rows.find((item) => item.id === normalized);
    return row ? mapQuotaPolicy(row) : null;
  }

  async update(input: { id: string; changes: UpdateQuotaPolicyInput }): Promise<QuotaPolicyRecord> {
    const existing = await this.getById(input.id);
    if (!existing) {
      throw new Error("quota policy 不存在");
    }

    const updated = await this.db.quotaPolicy.update({
      where: { id: existing.id },
      data: {
        ...(input.changes.thresholdValue !== undefined ? { thresholdValue: formatDecimal(input.changes.thresholdValue) } : {}),
        ...(input.changes.enforcementMode !== undefined ? { enforcementMode: input.changes.enforcementMode } : {}),
        ...(typeof input.changes.isActive === "boolean" ? { isActive: input.changes.isActive } : {}),
        updatedAt: new Date()
      }
    });
    return mapQuotaPolicy(updated);
  }
}
