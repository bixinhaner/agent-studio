import { describe, expect, it } from "vitest";

import { FakeRbacDb } from "../persistence/rbac-test-helpers.js";
import { RolePermissionRepository } from "../persistence/role-permission-repository.js";
import { RoleRepository } from "../persistence/role-repository.js";
import { UserRoleRepository } from "../persistence/user-role-repository.js";
import { PermissionService } from "./permission-service.js";

function buildPermissionServiceForTest(db: FakeRbacDb): PermissionService {
  return new PermissionService({
    roles: new RoleRepository(db as never),
    userRoles: new UserRoleRepository(db as never),
    rolePermissions: new RolePermissionRepository(db as never)
  });
}

describe("PermissionService", () => {
  it("grants a permission when any assigned active role contains it", async () => {
    const db = new FakeRbacDb(
      [{ id: "user-1", externalId: null, email: null, displayName: null, role: "employee", status: "active", statusSource: "sync", syncState: "active", manualDisabled: false, adminNote: null, lastSyncedAt: null, dingtalkOpenId: null, dingtalkUserId: null, dingtalkCorpId: null, createdAt: new Date("2026-03-29T00:00:00Z"), updatedAt: new Date("2026-03-29T00:00:00Z") }],
      [
        { id: "role-employee", organizationId: null, slug: "employee", name: "Employee", description: null, isSystem: false, isActive: true, createdAt: new Date("2026-03-29T00:00:00Z"), updatedAt: new Date("2026-03-29T00:00:00Z") },
        { id: "role-auditor", organizationId: null, slug: "auditor", name: "Auditor", description: null, isSystem: false, isActive: true, createdAt: new Date("2026-03-29T00:00:00Z"), updatedAt: new Date("2026-03-29T00:00:00Z") }
      ],
      [
        { id: "permission-audit-read", key: "audit.read", name: "Read audit logs", description: null, category: "audit", isSystem: true, isActive: true, createdAt: new Date("2026-03-29T00:00:00Z"), updatedAt: new Date("2026-03-29T00:00:00Z") }
      ],
      [
        { id: "user-role-1", userId: "user-1", roleId: "role-employee", isPrimary: true, createdAt: new Date("2026-03-29T00:00:00Z"), updatedAt: new Date("2026-03-29T00:00:00Z") },
        { id: "user-role-2", userId: "user-1", roleId: "role-auditor", isPrimary: false, createdAt: new Date("2026-03-29T00:00:01Z"), updatedAt: new Date("2026-03-29T00:00:01Z") }
      ],
      [{ id: "binding-1", roleId: "role-auditor", permissionId: "permission-audit-read", createdAt: new Date("2026-03-29T00:00:00Z"), updatedAt: new Date("2026-03-29T00:00:00Z") }]
    );

    const service = buildPermissionServiceForTest(db);

    await expect(service.hasPermission({ userId: "user-1", legacyRole: "employee", permissionKey: "audit.read" })).resolves.toBe(true);
  });

  it("falls back to the mirrored legacy role when no user-role bindings exist", async () => {
    const db = new FakeRbacDb(
      [{ id: "user-1", externalId: null, email: null, displayName: null, role: "admin", status: "active", statusSource: "sync", syncState: "active", manualDisabled: false, adminNote: null, lastSyncedAt: null, dingtalkOpenId: null, dingtalkUserId: null, dingtalkCorpId: null, createdAt: new Date("2026-03-29T00:00:00Z"), updatedAt: new Date("2026-03-29T00:00:00Z") }],
      [
        { id: "role-admin", organizationId: null, slug: "admin", name: "Admin", description: null, isSystem: true, isActive: true, createdAt: new Date("2026-03-29T00:00:00Z"), updatedAt: new Date("2026-03-29T00:00:00Z") }
      ],
      [
        { id: "permission-role-read", key: "role.read", name: "Read roles", description: null, category: "role_management", isSystem: true, isActive: true, createdAt: new Date("2026-03-29T00:00:00Z"), updatedAt: new Date("2026-03-29T00:00:00Z") }
      ],
      [],
      [{ id: "binding-1", roleId: "role-admin", permissionId: "permission-role-read", createdAt: new Date("2026-03-29T00:00:00Z"), updatedAt: new Date("2026-03-29T00:00:00Z") }]
    );

    const service = buildPermissionServiceForTest(db);

    await expect(service.listEffectiveRoleIdsForUser({ userId: "user-1", legacyRole: "admin" })).resolves.toEqual(["role-admin"]);
    await expect(service.hasPermission({ userId: "user-1", legacyRole: "admin", permissionKey: "role.read" })).resolves.toBe(true);
  });

  it("lets super_admin bypass explicit permission assignment", async () => {
    const service = buildPermissionServiceForTest(new FakeRbacDb());

    await expect(service.hasPermission({ userId: "root-1", legacyRole: "super_admin", permissionKey: "role.write" })).resolves.toBe(true);
  });
});
