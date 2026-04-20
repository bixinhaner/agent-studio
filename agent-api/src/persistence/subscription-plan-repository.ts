export type SubscriptionPlanRecord = {
  id: string;
  slug: string;
  name: string;
  description?: string;
  status: string;
  featureType: string;
  monthlyCompletedTurnLimit?: number;
  monthlyTokenLimit?: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateSubscriptionPlanInput = {
  slug: string;
  name: string;
  description?: string | null;
  status?: string;
  featureType?: string;
  monthlyCompletedTurnLimit?: number | null;
  monthlyTokenLimit?: number | null;
};

export type UpdateSubscriptionPlanInput = {
  slug?: string;
  name?: string;
  description?: string | null;
  status?: string;
  featureType?: string;
  monthlyCompletedTurnLimit?: number | null;
  monthlyTokenLimit?: number | null;
};

type SubscriptionPlanRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  featureType: string;
  monthlyCompletedTurnLimit: number | null;
  monthlyTokenLimit: number | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type SubscriptionPlanTable = {
  findMany(args?: {
    orderBy?: Array<Record<string, "asc" | "desc">>;
  }): Promise<SubscriptionPlanRow[]>;
  findUnique(args: { where: { id: string } }): Promise<SubscriptionPlanRow | null>;
  create(args: {
    data: {
      slug: string;
      name: string;
      description: string | null;
      status: string;
      featureType: string;
      monthlyCompletedTurnLimit: number | null;
      monthlyTokenLimit: number | null;
    };
  }): Promise<SubscriptionPlanRow>;
  update(args: {
    where: { id: string };
    data: {
      slug?: string;
      name?: string;
      description?: string | null;
      status?: string;
      featureType?: string;
      monthlyCompletedTurnLimit?: number | null;
      monthlyTokenLimit?: number | null;
    };
  }): Promise<SubscriptionPlanRow>;
};

export type SubscriptionPlanRepositoryDb = {
  subscriptionPlan: SubscriptionPlanTable;
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

function mapPlan(row: {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  featureType: string;
  monthlyCompletedTurnLimit: number | null;
  monthlyTokenLimit: number | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}): SubscriptionPlanRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: trimOrUndefined(row.description),
    status: row.status,
    featureType: row.featureType,
    monthlyCompletedTurnLimit: row.monthlyCompletedTurnLimit ?? undefined,
    monthlyTokenLimit: row.monthlyTokenLimit ?? undefined,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

export class SubscriptionPlanRepository {
  constructor(private readonly db: SubscriptionPlanRepositoryDb) {}

  async list(): Promise<SubscriptionPlanRecord[]> {
    const rows = await this.db.subscriptionPlan.findMany({
      orderBy: [{ status: "asc" }, { name: "asc" }]
    });
    return rows.map(mapPlan);
  }

  async getById(id: string): Promise<SubscriptionPlanRecord | null> {
    const trimmedId = trimOrUndefined(id);
    if (!trimmedId) return null;
    const row = await this.db.subscriptionPlan.findUnique({
      where: { id: trimmedId }
    });
    return row ? mapPlan(row) : null;
  }

  async create(input: CreateSubscriptionPlanInput): Promise<SubscriptionPlanRecord> {
    const slug = trimOrUndefined(input.slug);
    const name = trimOrUndefined(input.name);
    if (!slug || !name) {
      throw new Error("套餐标识和名称不能为空");
    }

    const row = await this.db.subscriptionPlan.create({
      data: {
        slug,
        name,
        description: trimOrUndefined(input.description) ?? null,
        status: trimOrUndefined(input.status) ?? "active",
        featureType: trimOrUndefined(input.featureType) ?? "chat",
        monthlyCompletedTurnLimit: input.monthlyCompletedTurnLimit ?? null,
        monthlyTokenLimit: input.monthlyTokenLimit ?? null
      }
    });
    return mapPlan(row);
  }

  async update(planId: string, input: UpdateSubscriptionPlanInput): Promise<SubscriptionPlanRecord> {
    const trimmedPlanId = trimOrUndefined(planId);
    if (!trimmedPlanId) {
      throw new Error("planId is required");
    }

    const row = await this.db.subscriptionPlan.update({
      where: { id: trimmedPlanId },
      data: {
        slug: input.slug === undefined ? undefined : trimOrUndefined(input.slug),
        name: input.name === undefined ? undefined : trimOrUndefined(input.name),
        description: input.description === undefined ? undefined : trimOrUndefined(input.description) ?? null,
        status: input.status === undefined ? undefined : trimOrUndefined(input.status),
        featureType: input.featureType === undefined ? undefined : trimOrUndefined(input.featureType),
        monthlyCompletedTurnLimit: input.monthlyCompletedTurnLimit === undefined ? undefined : input.monthlyCompletedTurnLimit,
        monthlyTokenLimit: input.monthlyTokenLimit === undefined ? undefined : input.monthlyTokenLimit
      }
    });
    return mapPlan(row);
  }
}
