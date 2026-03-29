export type CostProfileRecord = {
  id: string;
  organizationId?: string;
  model: string;
  inputTokenPrice: string;
  cachedInputTokenPrice: string;
  outputTokenPrice: string;
  internalCostMultiplier: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type UpsertCostProfileInput = {
  id?: string;
  organizationId?: string;
  model: string;
  inputTokenPrice: string;
  cachedInputTokenPrice: string;
  outputTokenPrice: string;
  internalCostMultiplier?: string;
  isActive?: boolean;
};

export type UpdateCostProfileInput = {
  model?: string;
  inputTokenPrice?: string;
  cachedInputTokenPrice?: string;
  outputTokenPrice?: string;
  internalCostMultiplier?: string;
  isActive?: boolean;
};

type CostProfileRow = {
  id: string;
  organizationId: string | null;
  model: string;
  inputTokenPrice: unknown;
  cachedInputTokenPrice: unknown;
  outputTokenPrice: unknown;
  internalCostMultiplier: unknown;
  isActive: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type CostProfileTable = {
  findMany(args?: {
    where?: { isActive?: boolean; model?: string };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<CostProfileRow[]>;
  findFirst(args?: {
    where?: { organizationId?: string | null; model?: string; isActive?: boolean };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<CostProfileRow | null>;
  create(args: { data: Record<string, unknown> }): Promise<CostProfileRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<CostProfileRow>;
};

export type CostProfileRepositoryDb = {
  costProfile: CostProfileTable;
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

function formatDecimal(value: unknown, digits = 6): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toFixed(digits);
  if (value && typeof value === "object" && "toFixed" in value && typeof value.toFixed === "function") {
    return value.toFixed(digits);
  }
  if (value && typeof value === "object" && "toString" in value && typeof value.toString === "function") {
    return String(value.toString());
  }
  return digits === 4 ? "1.0000" : "0.000000";
}

function mapCostProfile(row: CostProfileRow): CostProfileRecord {
  return {
    id: row.id,
    organizationId: trimOrUndefined(row.organizationId),
    model: row.model,
    inputTokenPrice: formatDecimal(row.inputTokenPrice, 6),
    cachedInputTokenPrice: formatDecimal(row.cachedInputTokenPrice, 6),
    outputTokenPrice: formatDecimal(row.outputTokenPrice, 6),
    internalCostMultiplier: formatDecimal(row.internalCostMultiplier, 4),
    isActive: row.isActive,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

export class CostProfileRepository {
  constructor(private readonly db: CostProfileRepositoryDb) {}

  async listActive(input: { organizationId?: string } = {}): Promise<CostProfileRecord[]> {
    const rows = await this.db.costProfile.findMany({
      where: {
        isActive: true,
        model: undefined
      },
      orderBy: { createdAt: "asc" }
    });
    const organizationId = trimOrUndefined(input.organizationId);
    return rows
      .filter((row) => {
        const rowOrganizationId = trimOrUndefined(row.organizationId);
        if (organizationId) {
          return !rowOrganizationId || rowOrganizationId === organizationId;
        }
        return !rowOrganizationId;
      })
      .map(mapCostProfile);
  }

  async getActiveByModel(input: { organizationId?: string; model: string }): Promise<CostProfileRecord | null> {
    const model = trimOrUndefined(input.model);
    if (!model) return null;

    const organizationId = trimOrUndefined(input.organizationId);
    if (organizationId) {
      const scoped = await this.db.costProfile.findFirst({
        where: { organizationId, model, isActive: true },
        orderBy: { createdAt: "desc" }
      });
      if (scoped) return mapCostProfile(scoped);
    }

    const globalProfile = await this.db.costProfile.findFirst({
      where: { organizationId: null, model, isActive: true },
      orderBy: { createdAt: "desc" }
    });
    return globalProfile ? mapCostProfile(globalProfile) : null;
  }

  async upsert(input: UpsertCostProfileInput): Promise<CostProfileRecord> {
    const model = trimOrUndefined(input.model);
    if (!model) {
      throw new Error("cost profile model is required");
    }

    const organizationId = trimOrUndefined(input.organizationId);
    const existing = await this.db.costProfile.findFirst({
      where: { organizationId: organizationId ?? null, model },
      orderBy: { createdAt: "desc" }
    });

    const payload = {
      organizationId: organizationId ?? null,
      model,
      inputTokenPrice: trimOrUndefined(input.inputTokenPrice) ?? "0.000000",
      cachedInputTokenPrice: trimOrUndefined(input.cachedInputTokenPrice) ?? "0.000000",
      outputTokenPrice: trimOrUndefined(input.outputTokenPrice) ?? "0.000000",
      internalCostMultiplier: trimOrUndefined(input.internalCostMultiplier) ?? "1.0000",
      isActive: input.isActive ?? true,
      updatedAt: new Date()
    };

    if (!existing) {
      const created = await this.db.costProfile.create({
        data: {
          id: trimOrUndefined(input.id),
          ...payload
        }
      });
      return mapCostProfile(created);
    }

    const updated = await this.db.costProfile.update({
      where: { id: existing.id },
      data: payload
    });
    return mapCostProfile(updated);
  }

  async getById(id: string): Promise<CostProfileRecord | null> {
    const normalized = trimOrUndefined(id);
    if (!normalized) return null;
    const rows = await this.db.costProfile.findMany({
      orderBy: { createdAt: "desc" }
    });
    const row = rows.find((item) => item.id === normalized);
    return row ? mapCostProfile(row) : null;
  }

  async update(input: { id: string; changes: UpdateCostProfileInput }): Promise<CostProfileRecord> {
    const existing = await this.getById(input.id);
    if (!existing) {
      throw new Error("cost profile 不存在");
    }

    const updated = await this.db.costProfile.update({
      where: { id: existing.id },
      data: {
        ...(input.changes.model !== undefined ? { model: trimOrUndefined(input.changes.model) ?? existing.model } : {}),
        ...(input.changes.inputTokenPrice !== undefined ? { inputTokenPrice: trimOrUndefined(input.changes.inputTokenPrice) ?? existing.inputTokenPrice } : {}),
        ...(input.changes.cachedInputTokenPrice !== undefined
          ? { cachedInputTokenPrice: trimOrUndefined(input.changes.cachedInputTokenPrice) ?? existing.cachedInputTokenPrice }
          : {}),
        ...(input.changes.outputTokenPrice !== undefined ? { outputTokenPrice: trimOrUndefined(input.changes.outputTokenPrice) ?? existing.outputTokenPrice } : {}),
        ...(input.changes.internalCostMultiplier !== undefined
          ? { internalCostMultiplier: trimOrUndefined(input.changes.internalCostMultiplier) ?? existing.internalCostMultiplier }
          : {}),
        ...(typeof input.changes.isActive === "boolean" ? { isActive: input.changes.isActive } : {}),
        updatedAt: new Date()
      }
    });
    return mapCostProfile(updated);
  }
}
