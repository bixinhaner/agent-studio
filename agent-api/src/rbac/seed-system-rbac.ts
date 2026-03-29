import { PermissionRepository, type PermissionDefinition } from "../persistence/permission-repository.js";
import { RolePermissionRepository } from "../persistence/role-permission-repository.js";
import { RoleRepository } from "../persistence/role-repository.js";

export const SYSTEM_ROLE_SLUGS = {
  superAdmin: "super_admin",
  admin: "admin"
} as const;

export const BUILTIN_PERMISSIONS: PermissionDefinition[] = [
  { key: "admin.overview.read", name: "View admin overview", category: "admin" },
  { key: "user.read", name: "View users", category: "user" },
  { key: "user.write", name: "Manage users", category: "user" },
  { key: "department.read", name: "View departments", category: "department" },
  { key: "role.read", name: "View roles", category: "role" },
  { key: "role.write", name: "Manage roles", category: "role" },
  { key: "role.assign", name: "Assign roles", category: "role" },
  { key: "permission.read", name: "View permissions", category: "permission" },
  { key: "resource_policy.read", name: "View resource policies", category: "resource_policy" },
  { key: "resource_policy.write", name: "Manage resource policies", category: "resource_policy" },
  { key: "org_sync.read", name: "View org sync", category: "org_sync" },
  { key: "org_sync.trigger", name: "Trigger org sync", category: "org_sync" },
  { key: "workspace.read", name: "View workspaces", category: "workspace" },
  { key: "workspace.write", name: "Manage workspaces", category: "workspace" },
  { key: "knowledge_set.read", name: "View knowledge sets", category: "knowledge_set" },
  { key: "knowledge_set.write", name: "Manage knowledge sets", category: "knowledge_set" },
  { key: "agent_mode.read", name: "View agent modes", category: "agent_mode" },
  { key: "agent_mode.write", name: "Manage agent modes", category: "agent_mode" },
  { key: "skill_package.read", name: "View skill packages", category: "skill_package" },
  { key: "skill_package.write", name: "Manage skill packages", category: "skill_package" },
  { key: "run_profile.read", name: "View run profiles", category: "run_profile" },
  { key: "run_profile.write", name: "Manage run profiles", category: "run_profile" },
  { key: "integration.read", name: "View integrations", category: "integration" },
  { key: "integration.write", name: "Manage integrations", category: "integration" },
  { key: "audit.read", name: "View audit logs", category: "audit" }
];

export class SeedSystemRbacService {
  constructor(
    private readonly dependencies: {
      roles: RoleRepository;
      permissions: PermissionRepository;
      rolePermissions: RolePermissionRepository;
    }
  ) {}

  async run(): Promise<void> {
    let superAdmin = await this.dependencies.roles.getBySlug(SYSTEM_ROLE_SLUGS.superAdmin);
    if (!superAdmin) {
      superAdmin = await this.dependencies.roles.create({
        slug: SYSTEM_ROLE_SLUGS.superAdmin,
        name: "Super Admin",
        description: "Full platform access",
        isSystem: true,
        isActive: true
      });
    }

    let admin = await this.dependencies.roles.getBySlug(SYSTEM_ROLE_SLUGS.admin);
    if (!admin) {
      admin = await this.dependencies.roles.create({
        slug: SYSTEM_ROLE_SLUGS.admin,
        name: "Admin",
        description: "Platform administrator",
        isSystem: true,
        isActive: true
      });
    }

    const permissions = await this.dependencies.permissions.upsertMany(BUILTIN_PERMISSIONS);
    const allPermissionIds = permissions.map((permission) => permission.id);

    await this.dependencies.rolePermissions.replaceRolePermissions({
      roleId: superAdmin.id,
      permissionIds: allPermissionIds
    });
    await this.dependencies.rolePermissions.replaceRolePermissions({
      roleId: admin.id,
      permissionIds: allPermissionIds
    });
  }
}
