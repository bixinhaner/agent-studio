type DepartmentMembershipRow = {
  id: string;
  userId: string;
  departmentId: string;
  isPrimary?: boolean;
  source?: string;
  lastSyncedAt?: Date | string | null;
  createdAt: Date | string;
  updatedAt?: Date | string;
};

type DepartmentMembershipTable = {
  findMany(args: {
    where: { userId: string };
    orderBy?: { createdAt?: "asc" | "desc" };
    select?: { departmentId?: boolean; isPrimary?: boolean; source?: boolean };
  }): Promise<DepartmentMembershipRow[]>;
  deleteMany?(args: { where: { userId: string; source?: string } }): Promise<{ count: number }>;
  create?(args: { data: Record<string, unknown> }): Promise<DepartmentMembershipRow>;
  update?(args: { where: { id: string }; data: Record<string, unknown> }): Promise<DepartmentMembershipRow>;
};

export type DepartmentMembershipRepositoryDb = {
  departmentMembership: DepartmentMembershipTable;
  $transaction<T>(callback: (tx: DepartmentMembershipRepositoryDb) => Promise<T>): Promise<T>;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export class DepartmentMembershipRepository {
  constructor(private readonly db: DepartmentMembershipRepositoryDb) {}

  async listIdsForUser(userId: string): Promise<string[]> {
    const memberships = await this.listForUser(userId);
    return memberships.map((membership) => membership.departmentId);
  }

  async listForUser(userId: string): Promise<Array<{ departmentId: string; isPrimary: boolean }>> {
    const normalizedUserId = trimOrUndefined(userId);
    if (!normalizedUserId) return [];

    const rows = await this.db.departmentMembership.findMany({
      where: { userId: normalizedUserId },
      orderBy: { createdAt: "asc" }
    });

    return rows
      .map((row) => {
        const departmentId = trimOrUndefined(row.departmentId);
        if (!departmentId) return null;
        return {
          departmentId,
          isPrimary: Boolean(row.isPrimary)
        };
      })
      .filter((membership): membership is { departmentId: string; isPrimary: boolean } => Boolean(membership));
  }

  async replaceSyncedMemberships(input: {
    userId: string;
    memberships: Array<{ departmentId: string; isPrimary: boolean }>;
    syncedAt?: Date;
  }): Promise<void> {
    const normalizedUserId = trimOrUndefined(input.userId);
    if (!normalizedUserId) {
      throw new Error("department membership userId is required");
    }

    const incomingPrimaryCount = input.memberships.filter((membership) => membership.isPrimary).length;
    if (incomingPrimaryCount > 1) {
      throw new Error("department memberships cannot contain multiple primary records");
    }
    if (
      !this.db.departmentMembership.deleteMany ||
      !this.db.departmentMembership.create ||
      !this.db.departmentMembership.update
    ) {
      throw new Error("department membership repository does not support replacement");
    }

    const existingMemberships = await this.db.departmentMembership.findMany({
      where: { userId: normalizedUserId },
      orderBy: { createdAt: "asc" }
    });

    const incomingByDepartmentId = new Map<string, { departmentId: string; isPrimary: boolean }>();
    for (const membership of input.memberships) {
      const departmentId = trimOrUndefined(membership.departmentId);
      if (!departmentId) {
        throw new Error("department membership departmentId is required");
      }
      const existing = incomingByDepartmentId.get(departmentId);
      incomingByDepartmentId.set(departmentId, {
        departmentId,
        isPrimary: Boolean(existing?.isPrimary) || membership.isPrimary
      });
    }

    const finalMemberships = new Map<
      string,
      | { kind: "preserved"; row: DepartmentMembershipRow; isPrimary: boolean; lastSyncedAt: Date | string | null }
      | { kind: "sync"; departmentId: string; isPrimary: boolean; lastSyncedAt: Date | null }
    >();

    for (const membership of existingMemberships) {
      const departmentId = trimOrUndefined(membership.departmentId);
      if (!departmentId || membership.source === "sync") continue;
      const incoming = incomingByDepartmentId.get(departmentId);
      finalMemberships.set(departmentId, {
        kind: "preserved",
        row: membership,
        isPrimary: Boolean(membership.isPrimary) || Boolean(incoming?.isPrimary),
        lastSyncedAt: incoming ? input.syncedAt ?? membership.lastSyncedAt ?? null : membership.lastSyncedAt ?? null
      });
      if (incoming) {
        incomingByDepartmentId.delete(departmentId);
      }
    }

    for (const membership of incomingByDepartmentId.values()) {
      finalMemberships.set(membership.departmentId, {
        kind: "sync",
        departmentId: membership.departmentId,
        isPrimary: membership.isPrimary,
        lastSyncedAt: input.syncedAt ?? null
      });
    }

    const finalPrimaryCount = [...finalMemberships.values()].filter((membership) => membership.isPrimary).length;
    if (finalPrimaryCount > 1) {
      throw new Error("department memberships cannot contain multiple primary records");
    }

    await this.db.$transaction(async (tx) => {
      await tx.departmentMembership.deleteMany!({
        where: {
          userId: normalizedUserId,
          source: "sync"
        }
      });

      for (const membership of finalMemberships.values()) {
        if (membership.kind === "preserved") {
          await tx.departmentMembership.update!({
            where: { id: membership.row.id },
            data: {
              isPrimary: membership.isPrimary,
              lastSyncedAt: membership.lastSyncedAt,
              updatedAt: new Date()
            }
          });
          continue;
        }

        await tx.departmentMembership.create!({
          data: {
            userId: normalizedUserId,
            departmentId: membership.departmentId,
            isPrimary: membership.isPrimary,
            source: "sync",
            lastSyncedAt: membership.lastSyncedAt
          }
        });
      }
    });
  }
}
