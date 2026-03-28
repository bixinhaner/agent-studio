type DepartmentMembershipRow = {
  id: string;
  userId: string;
  departmentId: string;
  createdAt: Date | string;
};

type DepartmentMembershipTable = {
  findMany(args: {
    where: { userId: string };
    orderBy?: { createdAt?: "asc" | "desc" };
    select?: { departmentId?: boolean };
  }): Promise<Array<Pick<DepartmentMembershipRow, "departmentId">>>;
};

export type DepartmentMembershipRepositoryDb = {
  departmentMembership: DepartmentMembershipTable;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export class DepartmentMembershipRepository {
  constructor(private readonly db: DepartmentMembershipRepositoryDb) {}

  async listIdsForUser(userId: string): Promise<string[]> {
    const normalizedUserId = trimOrUndefined(userId);
    if (!normalizedUserId) return [];

    const rows = await this.db.departmentMembership.findMany({
      where: { userId: normalizedUserId },
      orderBy: { createdAt: "asc" },
      select: { departmentId: true }
    });

    return rows
      .map((row) => trimOrUndefined(row.departmentId))
      .filter((departmentId): departmentId is string => Boolean(departmentId));
  }
}
