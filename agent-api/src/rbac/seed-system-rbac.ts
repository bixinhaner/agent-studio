import { PermissionRepository, type PermissionDefinition, type PermissionRecord } from "../persistence/permission-repository.js";
import { RolePermissionRepository } from "../persistence/role-permission-repository.js";
import { RoleRepository, type RoleRecord } from "../persistence/role-repository.js";

export const BUILTIN_PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  { key: "admin.overview.read", name: "Read admin overview", category: "admin_overview" },
  { key: "user.read", name: "Read users", category: "user_management" },
  { key: "user.write", name: "Edit users", category: "user_management" },
  { key: "user.role.assign", name: "Assign user roles", category: "user_management" },
  { key: "role.read", name: "Read roles", category: "role_management" },
  { key: "role.write", name: "Edit roles", category: "role_management" },
  { key: "role.clone", name: "Clone roles", category: "role_management" },
  { key: "role.disable", name: "Disable roles", category: "role_management" },
  { key: "permission.read", name: "Read permissions", category: "role_management" },
  { key: "permission.assign", name: "Assign permissions", category: "role_management" },
  { key: "resource_policy.read", name: "Read resource authorization", category: "resource_authorization" },
  { key: "resource_policy.write", name: "Edit resource authorization", category: "resource_authorization" },
  { key: "org_sync.read", name: "Read org sync", category: "org_sync" },
  { key: "org_sync.trigger", name: "Trigger org sync", category: "org_sync" },
  { key: "integration.read", name: "Read integrations", category: "integration_management" },
  { key: "integration.write", name: "Edit integrations", category: "integration_management" },
  { key: "audit.read", name: "Read audit logs", category: "audit" }
];

export const BUILTIN_PERMISSIONS = BUILTIN_PERMISSION_DEFINITIONS;

const SYSTEM_ROLE_DEFINITIONS = [
  { slug: "super_admin", name: "Super Admin", description: "Protected system super administrator role" },
  { slug: "admin", name: "Admin", description: "Protected system administrator role" }
] as const;

type SeedSystemRbacDependencies = {
  roles: Pick<RoleRepository, "getBySlug" | "create" | "update">;
  permissions: Pick<PermissionRepository, "getByKey" | "create" | "update">;
  rolePermissions: Pick<RolePermissionRepository, "replaceRolePermissions">;
};

async function ensureRole(
  repository: SeedSystemRbacDependencies["roles"],
  definition: (typeof SYSTEM_ROLE_DEFINITIONS)[number]
): Promise<RoleRecord> {
  const existing = await repository.getBySlug(definition.slug);
  if (existing) {
    return repository.update(existing.id, {
      name: definition.name,
      description: definition.description,
      isSystem: true,
      isActive: true
    });
  }
  return repository.create({
    slug: definition.slug,
    name: definition.name,
    description: definition.description,
    isSystem: true,
    isActive: true
  });
}

async function ensurePermission(
  repository: SeedSystemRbacDependencies["permissions"],
  definition: PermissionDefinition
): Promise<PermissionRecord> {
  const existing = await repository.getByKey(definition.key);
  if (existing) {
    return repository.update(existing.id, {
      name: definition.name,
      description: definition.description,
      category: definition.category,
      isSystem: true,
      isActive: true
    });
  }
  return repository.create({
    ...definition,
    isSystem: true,
    isActive: true
  });
}

export class SeedSystemRbacService {
  constructor(private readonly dependencies: SeedSystemRbacDependencies) {}

  async run(): Promise<void> {
    const ensuredRoles = await Promise.all(
      SYSTEM_ROLE_DEFINITIONS.map((definition) => ensureRole(this.dependencies.roles, definition))
    );
    const ensuredPermissions = await Promise.all(
      BUILTIN_PERMISSION_DEFINITIONS.map((definition) => ensurePermission(this.dependencies.permissions, definition))
    );

    const allPermissionIds = ensuredPermissions.map((permission) => permission.id);
    for (const role of ensuredRoles) {
      await this.dependencies.rolePermissions.replaceRolePermissions(role.id, allPermissionIds);
    }
  }
}
