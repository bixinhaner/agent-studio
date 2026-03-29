export type RolePermissionRecord = {
  roleId: string;
  permissionId: string;
  createdAt: string;
  updatedAt: string;
};

type RolePermissionRow = {
  id: string;
  roleId: string;
  permissionId: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type PermissionRow = {
  id: string;
  key: string;
  isActive: boolean;
};

type RolePermissionTable = {
  findMany(args?: {
    where?: { roleId?: string; roleIdIn?: string[] };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<RolePermissionRow[]>;
  deleteMany(args: { where: { roleId: string } }): Promise<{ count: number }>;
  create?(args: { data: Record<string, unknown> }): Promise<RolePermissionRow>;
  createMany?(args: { data: Array<Record<string, unknown>> }): Promise<unknown>;
};

type PermissionTable = {
  findMany(args?: { orderBy?: { createdAt?: "asc" | "desc" } }): Promise<PermissionRow[]>;
};

export type RolePermissionRepositoryDb = {
  rolePermission: RolePermissionTable;
  permission: PermissionTable;
  $transaction?<T>(callback: (tx: Pick<RolePermissionRepositoryDb, "rolePermission" | "permission">) => Promise<T>): Promise<T>;
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

function mapRolePermission(row: RolePermissionRow): RolePermissionRecord {
  return {
    roleId: row.roleId,
    permissionId: row.permissionId,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

export class RolePermissionRepository {
  constructor(private readonly db: RolePermissionRepositoryDb) {}

  async listForRole(roleId: string): Promise<RolePermissionRecord[]> {
    const normalized = trimOrUndefined(roleId);
    if (!normalized) return [];
    const rows = await this.db.rolePermission.findMany({ where: { roleId: normalized }, orderBy: { createdAt: "asc" } });
    return rows.map(mapRolePermission);
  }

  async listPermissionKeysForRoleIds(roleIds: string[]): Promise<string[]> {
    const normalizedRoleIds = roleIds.map(trimOrUndefined).filter((value): value is string => Boolean(value));
    if (normalizedRoleIds.length === 0) return [];
    const bindings = await this.db.rolePermission.findMany({ where: { roleIdIn: normalizedRoleIds }, orderBy: { createdAt: "asc" } });
    const permissions = await this.db.permission.findMany({ orderBy: { createdAt: "asc" } });
    const keyById = new Map(permissions.filter((item) => item.isActive).map((item) => [item.id, item.key]));
    return [
      ...new Set(
        bindings.map((binding) => keyById.get(binding.permissionId)).filter((value): value is string => Boolean(value))
      )
    ];
  }

  async replaceRolePermissions(
    roleIdOrInput: string | { roleId: string; permissionIds: string[] },
    maybePermissionIds?: string[]
  ): Promise<RolePermissionRecord[]> {
    const roleId =
      typeof roleIdOrInput === "string" ? trimOrUndefined(roleIdOrInput) : trimOrUndefined(roleIdOrInput.roleId);
    const rawPermissionIds = typeof roleIdOrInput === "string" ? maybePermissionIds ?? [] : roleIdOrInput.permissionIds;
    if (!roleId) {
      throw new Error("role 不存在");
    }
    const permissionIds = [...new Set(rawPermissionIds.map(trimOrUndefined).filter((value): value is string => Boolean(value)))];

    const run = async (tx: Pick<RolePermissionRepositoryDb, "rolePermission" | "permission">) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      if (permissionIds.length > 0) {
        if (typeof tx.rolePermission.createMany === "function") {
          await tx.rolePermission.createMany({
            data: permissionIds.map((permissionId) => ({ roleId, permissionId }))
          });
        } else if (typeof tx.rolePermission.create === "function") {
          for (const permissionId of permissionIds) {
            await tx.rolePermission.create({ data: { roleId, permissionId } });
          }
        } else {
          throw new Error("rolePermission create operation is unavailable");
        }
      }
      const rows = await tx.rolePermission.findMany({ where: { roleId }, orderBy: { createdAt: "asc" } });
      return rows.map(mapRolePermission);
    };

    if (typeof this.db.$transaction === "function") {
      return this.db.$transaction(async (tx) => run(tx));
    }
    return run(this.db);
  }
}
