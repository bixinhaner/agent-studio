export type SubscriptionPrincipalType = "user" | "organization";

export type SubscriptionGrantRecord = {
  id: string;
  principalType: SubscriptionPrincipalType;
  principalId: string;
  planId?: string;
  status: string;
  startsAt: string;
  expiresAt?: string;
  cycleAnchorAt: string;
  completedTurnLimitOverride?: number;
  tokenLimitOverride?: number;
  note?: string;
  createdByUserId?: string;
  createdAt: string;
  updatedAt: string;
};

export type UpsertSubscriptionGrantInput = {
  principalType: SubscriptionPrincipalType;
  principalId: string;
  planId?: string | null;
  status?: string;
  startsAt: string | Date;
  expiresAt?: string | Date | null;
  cycleAnchorAt?: string | Date | null;
  completedTurnLimitOverride?: number | null;
  tokenLimitOverride?: number | null;
  note?: string | null;
  createdByUserId?: string | null;
};

type SubscriptionGrantRow = {
  id: string;
  principalType: string;
  principalId: string;
  planId: string | null;
  status: string;
  startsAt: Date | string;
  expiresAt: Date | string | null;
  cycleAnchorAt: Date | string;
  completedTurnLimitOverride: number | null;
  tokenLimitOverride: number | null;
  note: string | null;
  createdByUserId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type SubscriptionGrantTable = {
  findMany(args?: {
    where?: {
      principalType?: SubscriptionPrincipalType;
      principalId?: { in: string[] };
      planId?: string;
    };
    orderBy?: Array<Record<string, "asc" | "desc">>;
  }): Promise<SubscriptionGrantRow[]>;
  findUnique(args: {
    where: {
      principalType_principalId: {
        principalType: SubscriptionPrincipalType;
        principalId: string;
      };
    };
  }): Promise<SubscriptionGrantRow | null>;
  upsert(args: {
    where: {
      principalType_principalId: {
        principalType: SubscriptionPrincipalType;
        principalId: string;
      };
    };
    update: {
      planId?: string | null;
      status?: string;
      startsAt?: Date;
      expiresAt?: Date | null;
      cycleAnchorAt?: Date;
      completedTurnLimitOverride?: number | null;
      tokenLimitOverride?: number | null;
      note?: string | null;
      createdByUserId?: string | null;
    };
    create: {
      principalType: SubscriptionPrincipalType;
      principalId: string;
      planId: string | null;
      status: string;
      startsAt: Date;
      expiresAt: Date | null;
      cycleAnchorAt: Date;
      completedTurnLimitOverride: number | null;
      tokenLimitOverride: number | null;
      note: string | null;
      createdByUserId: string | null;
    };
  }): Promise<SubscriptionGrantRow>;
  delete(args: {
    where: {
      principalType_principalId: {
        principalType: SubscriptionPrincipalType;
        principalId: string;
      };
    };
  }): Promise<SubscriptionGrantRow>;
};

export type SubscriptionGrantRepositoryDb = {
  subscriptionGrant: SubscriptionGrantTable;
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

function toDate(value: string | Date | null | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function mapGrant(row: {
  id: string;
  principalType: string;
  principalId: string;
  planId: string | null;
  status: string;
  startsAt: Date | string;
  expiresAt: Date | string | null;
  cycleAnchorAt: Date | string;
  completedTurnLimitOverride: number | null;
  tokenLimitOverride: number | null;
  note: string | null;
  createdByUserId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}): SubscriptionGrantRecord {
  return {
    id: row.id,
    principalType: row.principalType as SubscriptionPrincipalType,
    principalId: row.principalId,
    planId: trimOrUndefined(row.planId),
    status: row.status,
    startsAt: toIsoString(row.startsAt),
    expiresAt: row.expiresAt ? toIsoString(row.expiresAt) : undefined,
    cycleAnchorAt: toIsoString(row.cycleAnchorAt),
    completedTurnLimitOverride: row.completedTurnLimitOverride ?? undefined,
    tokenLimitOverride: row.tokenLimitOverride ?? undefined,
    note: trimOrUndefined(row.note),
    createdByUserId: trimOrUndefined(row.createdByUserId),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

export class SubscriptionGrantRepository {
  constructor(private readonly db: SubscriptionGrantRepositoryDb) {}

  async list(input?: { principalType?: SubscriptionPrincipalType; principalIds?: string[]; planId?: string }): Promise<SubscriptionGrantRecord[]> {
    const rows = await this.db.subscriptionGrant.findMany({
      where: {
        principalType: input?.principalType,
        principalId: input?.principalIds?.length ? { in: input.principalIds } : undefined,
        planId: trimOrUndefined(input?.planId)
      },
      orderBy: [{ principalType: "asc" }, { updatedAt: "desc" }]
    });
    return rows.map(mapGrant);
  }

  async getByPrincipal(
    principalType: SubscriptionPrincipalType,
    principalId: string
  ): Promise<SubscriptionGrantRecord | null> {
    const trimmedPrincipalId = trimOrUndefined(principalId);
    if (!trimmedPrincipalId) return null;
    const row = await this.db.subscriptionGrant.findUnique({
      where: {
        principalType_principalId: {
          principalType,
          principalId: trimmedPrincipalId
        }
      }
    });
    return row ? mapGrant(row) : null;
  }

  async upsertForPrincipal(input: UpsertSubscriptionGrantInput): Promise<SubscriptionGrantRecord> {
    const principalId = trimOrUndefined(input.principalId);
    if (!principalId) {
      throw new Error("principalId is required");
    }
    const startsAt = toDate(input.startsAt);
    if (!startsAt) {
      throw new Error("startsAt is required");
    }
    const cycleAnchorAt = toDate(input.cycleAnchorAt ?? input.startsAt);
    if (!cycleAnchorAt) {
      throw new Error("cycleAnchorAt is required");
    }

    const row = await this.db.subscriptionGrant.upsert({
      where: {
        principalType_principalId: {
          principalType: input.principalType,
          principalId
        }
      },
      update: {
        planId: trimOrUndefined(input.planId) ?? null,
        status: trimOrUndefined(input.status) ?? "active",
        startsAt,
        expiresAt: input.expiresAt === undefined ? undefined : toDate(input.expiresAt) ?? null,
        cycleAnchorAt,
        completedTurnLimitOverride:
          input.completedTurnLimitOverride === undefined ? undefined : input.completedTurnLimitOverride,
        tokenLimitOverride: input.tokenLimitOverride === undefined ? undefined : input.tokenLimitOverride,
        note: input.note === undefined ? undefined : trimOrUndefined(input.note) ?? null,
        createdByUserId: input.createdByUserId === undefined ? undefined : trimOrUndefined(input.createdByUserId) ?? null
      },
      create: {
        principalType: input.principalType,
        principalId,
        planId: trimOrUndefined(input.planId) ?? null,
        status: trimOrUndefined(input.status) ?? "active",
        startsAt,
        expiresAt: toDate(input.expiresAt) ?? null,
        cycleAnchorAt,
        completedTurnLimitOverride: input.completedTurnLimitOverride ?? null,
        tokenLimitOverride: input.tokenLimitOverride ?? null,
        note: trimOrUndefined(input.note) ?? null,
        createdByUserId: trimOrUndefined(input.createdByUserId) ?? null
      }
    });
    return mapGrant(row);
  }

  async deleteByPrincipal(principalType: SubscriptionPrincipalType, principalId: string): Promise<void> {
    const trimmedPrincipalId = trimOrUndefined(principalId);
    if (!trimmedPrincipalId) return;
    await this.db.subscriptionGrant
      .delete({
        where: {
          principalType_principalId: {
            principalType,
            principalId: trimmedPrincipalId
          }
        }
      })
      .catch(() => undefined);
  }
}
