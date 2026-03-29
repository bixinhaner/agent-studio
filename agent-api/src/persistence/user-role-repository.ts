export type UserRoleAssignmentRecord = {
  roleId: string;
  roleSlug: string;
  roleName: string;
  roleIsSystem: boolean;
  roleIsActive: boolean;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
};

type UserRoleRow = {
  id: string;
  userId: string;
  roleId: string;
  isPrimary: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
  role?: {
    id: string;
    slug: string;
    name: string;
    isSystem: boolean;
    isActive: boolean;
  } | null;
};

type RoleRow = {
  id: string;
  slug: string;
  name: string;
  isSystem: boolean;
  isActive: boolean;
};

type UserRoleTable = {
  findMany(args?: {
    where?: { userId?: string; roleId?: string; roleIdIn?: string[] };
    include?: { role?: boolean };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<UserRoleRow[]>;
  deleteMany(args: { where: { userId: string } }): Promise<{ count: number }>;
  create?(args: { data: Record<string, unknown> }): Promise<UserRoleRow>;
  createMany?(args: { data: Array<Record<string, unknown>> }): Promise<unknown>;
};

type RoleTable = {
  findUnique?(args: { where: { id?: string; slug?: string } }): Promise<RoleRow | null>;
  findMany?(args?: { where?: { id?: { in: string[] } } }): Promise<RoleRow[]>;
};

type UserRow = {
  id: string;
  role: string | null;
};

type UserTable = {
  findUnique?(args: { where: { id?: string; externalId?: string; email?: string } }): Promise<UserRow | null>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<UserRow>;
};

export type UserRoleRepositoryDb = {
  userRole: UserRoleTable;
  role: RoleTable;
  user: UserTable;
  $transaction?<T>(callback: (tx: Pick<UserRoleRepositoryDb, "userRole" | "user">) => Promise<T>): Promise<T>;
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

function mapAssignment(row: UserRoleRow): UserRoleAssignmentRecord {
  return {
    roleId: row.roleId,
    roleSlug: row.role?.slug ?? "",
    roleName: row.role?.name ?? "",
    roleIsSystem: Boolean(row.role?.isSystem),
    roleIsActive: Boolean(row.role?.isActive),
    isPrimary: row.isPrimary,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

export class UserRoleRepository {
  constructor(private readonly db: UserRoleRepositoryDb) {}

  async listForUser(userId: string): Promise<UserRoleAssignmentRecord[]> {
    const normalized = trimOrUndefined(userId);
    if (!normalized) return [];
    const rows = await this.db.userRole.findMany({
      where: { userId: normalized },
      include: { role: true },
      orderBy: { createdAt: "asc" }
    });
    return rows.map(mapAssignment);
  }

  async replaceUserRoles(input: {
    userId: string;
    assignments: Array<{ roleId: string; isPrimary: boolean }>;
    mirrorLegacyRole: string;
  }): Promise<UserRoleAssignmentRecord[]> {
    const userId = trimOrUndefined(input.userId);
    const mirrorLegacyRole = trimOrUndefined(input.mirrorLegacyRole);
    if (!userId || !mirrorLegacyRole) {
      throw new Error("userId and mirrorLegacyRole are required");
    }

    const assignments = input.assignments
      .map((assignment) => ({
        roleId: trimOrUndefined(assignment.roleId),
        isPrimary: Boolean(assignment.isPrimary)
      }))
      .filter((assignment): assignment is { roleId: string; isPrimary: boolean } => Boolean(assignment.roleId));

    const uniqueRoleIds = [...new Set(assignments.map((assignment) => assignment.roleId))];
    if (uniqueRoleIds.length !== assignments.length) {
      throw new Error("role assignment 重复");
    }
    const primaryAssignments = assignments.filter((assignment) => assignment.isPrimary);
    if (primaryAssignments.length > 1) {
      throw new Error("只能有一个主角色");
    }
    if (assignments.length > 0 && primaryAssignments.length !== 1) {
      throw new Error("必须指定一个主角色");
    }

    if (typeof this.db.user.findUnique === "function") {
      const existingUser = await this.db.user.findUnique({ where: { id: userId } });
      if (!existingUser) {
        throw new Error("user 不存在");
      }
    }

    const roles =
      typeof this.db.role.findMany === "function"
        ? await this.db.role.findMany({ where: { id: { in: uniqueRoleIds } } })
        : await Promise.all(uniqueRoleIds.map(async (roleId) => this.db.role.findUnique?.({ where: { id: roleId } })));
    const normalizedRoles = roles.filter((role): role is RoleRow => Boolean(role));
    if (normalizedRoles.length !== uniqueRoleIds.length) {
      throw new Error("role 不存在");
    }
    if (normalizedRoles.some((role) => !role.isActive)) {
      throw new Error("不能分配已禁用角色");
    }
    const primaryRole = primaryAssignments[0]
      ? normalizedRoles.find((role) => role.id === primaryAssignments[0].roleId)
      : undefined;
    if (primaryRole && primaryRole.slug !== mirrorLegacyRole) {
      throw new Error("主角色与 legacy role 镜像不一致");
    }

    const run = async (tx: Pick<UserRoleRepositoryDb, "userRole" | "user">) => {
      await tx.userRole.deleteMany({ where: { userId } });
      if (assignments.length > 0) {
        if (typeof tx.userRole.createMany === "function") {
          await tx.userRole.createMany({
            data: assignments.map((assignment) => ({
              userId,
              roleId: assignment.roleId,
              isPrimary: assignment.isPrimary
            }))
          });
        } else if (typeof tx.userRole.create === "function") {
          for (const assignment of assignments) {
            await tx.userRole.create({
              data: {
                userId,
                roleId: assignment.roleId,
                isPrimary: assignment.isPrimary
              }
            });
          }
        } else {
          throw new Error("userRole create operation is unavailable");
        }
      }
      await tx.user.update({
        where: { id: userId },
        data: {
          role: mirrorLegacyRole,
          updatedAt: new Date()
        }
      });
      const rows = await tx.userRole.findMany({
        where: { userId },
        include: { role: true },
        orderBy: { createdAt: "asc" }
      });
      return rows.map(mapAssignment);
    };

    if (typeof this.db.$transaction === "function") {
      return this.db.$transaction(async (tx) => run(tx));
    }
    return run(this.db);
  }
}
