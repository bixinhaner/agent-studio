import { RolePermissionRepository } from "../persistence/role-permission-repository.js";
import { RoleRepository } from "../persistence/role-repository.js";
import { UserRoleRepository } from "../persistence/user-role-repository.js";

type PermissionServiceDependencies = {
  roles: Pick<RoleRepository, "getById" | "getBySlug">;
  userRoles: Pick<UserRoleRepository, "listForUser">;
  rolePermissions: Pick<RolePermissionRepository, "listPermissionKeysForRoleIds">;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export class PermissionService {
  constructor(private readonly dependencies: PermissionServiceDependencies) {}

  async listEffectiveRoleIdsForUser(input: { userId: string; legacyRole?: string }): Promise<string[]> {
    const userId = trimOrUndefined(input.userId);
    const legacyRole = trimOrUndefined(input.legacyRole);
    if (!userId) {
      return [];
    }

    const assignments = await this.dependencies.userRoles.listForUser(userId);
    const activeAssignedRoleIds: string[] = [];
    for (const assignment of assignments) {
      const role = await this.dependencies.roles.getById(assignment.roleId);
      if (role?.isActive) {
        activeAssignedRoleIds.push(role.id);
      }
    }
    if (assignments.length > 0) {
      return [...new Set(activeAssignedRoleIds)];
    }

    if (!legacyRole) {
      return [];
    }

    const fallbackRole = await this.dependencies.roles.getBySlug(legacyRole);
    if (!fallbackRole?.isActive) {
      return [];
    }
    return [fallbackRole.id];
  }

  async hasPermission(input: { userId: string; legacyRole?: string; permissionKey: string }): Promise<boolean> {
    const permissionKey = trimOrUndefined(input.permissionKey);
    if (!permissionKey) {
      return false;
    }

    if (trimOrUndefined(input.legacyRole) === "super_admin") {
      return true;
    }

    const effectiveRoleIds = await this.listEffectiveRoleIdsForUser({
      userId: input.userId,
      legacyRole: input.legacyRole
    });
    if (effectiveRoleIds.length === 0) {
      return false;
    }

    const grantedPermissionKeys = await this.dependencies.rolePermissions.listPermissionKeysForRoleIds(effectiveRoleIds);
    return grantedPermissionKeys.includes(permissionKey);
  }
}
