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
  }): Promise<Array<Pick<DepartmentMembershipRow, "departmentId" | "isPrimary" | "source">>>;
  deleteMany?(args: { where: { userId: string; source?: string } }): Promise<{ count: number }>;
  create?(args: { data: Record<string, unknown> }): Promise<DepartmentMembershipRow>;
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
      orderBy: { createdAt: "asc" },
      select: { departmentId: true, isPrimary: true }
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
    if (!this.db.departmentMembership.deleteMany || !this.db.departmentMembership.create) {
      throw new Error("department membership repository does not support replacement");
    }

    const existingMemberships = await this.db.departmentMembership.findMany({
      where: { userId: normalizedUserId },
      orderBy: { createdAt: "asc" },
      select: { departmentId: true, isPrimary: true, source: true }
    });
    const preservedPrimaryCount = existingMemberships.filter(
      (membership) => membership.source !== "sync" && membership.isPrimary
    ).length;
    if (preservedPrimaryCount + incomingPrimaryCount > 1) {
      throw new Error("department memberships cannot contain multiple primary records");
    }

    await this.db.$transaction(async (tx) => {
      await tx.departmentMembership.deleteMany!({
        where: {
          userId: normalizedUserId,
          source: "sync"
        }
      });

      for (const membership of input.memberships) {
        const departmentId = trimOrUndefined(membership.departmentId);
        if (!departmentId) {
          throw new Error("department membership departmentId is required");
        }
        await tx.departmentMembership.create!({
          data: {
            userId: normalizedUserId,
            departmentId,
            isPrimary: membership.isPrimary,
            source: "sync",
            lastSyncedAt: input.syncedAt ?? null
          }
        });
      }
    });
  }
}
