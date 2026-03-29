import { describe, expect, it } from "vitest";

import { PermissionRepository } from "../persistence/permission-repository.js";
import { FakeRbacDb } from "../persistence/rbac-test-helpers.js";
import { RolePermissionRepository } from "../persistence/role-permission-repository.js";
import { RoleRepository } from "../persistence/role-repository.js";
import { BUILTIN_PERMISSIONS, SeedSystemRbacService } from "./seed-system-rbac.js";

describe("SeedSystemRbacService", () => {
  it("creates system roles and built-in permissions idempotently", async () => {
    const db = new FakeRbacDb();
    const service = new SeedSystemRbacService({
      roles: new RoleRepository(db as never),
      permissions: new PermissionRepository(db as never),
      rolePermissions: new RolePermissionRepository(db as never)
    });

    await service.run();
    await service.run();

    expect(db.roles.map((item) => item.slug)).toEqual(["super_admin", "admin"]);
    expect(db.permissions).toHaveLength(BUILTIN_PERMISSIONS.length);
    expect(new Set(db.permissions.map((item) => item.key))).toContain("role.write");
    expect(new Set(db.rolePermissions.map((item) => item.roleId))).toEqual(new Set(db.roles.map((item) => item.id)));
  });

  it("refreshes canonical permission bindings for both system roles", async () => {
    const db = new FakeRbacDb();
    const service = new SeedSystemRbacService({
      roles: new RoleRepository(db as never),
      permissions: new PermissionRepository(db as never),
      rolePermissions: new RolePermissionRepository(db as never)
    });

    await service.run();

    const expectedPermissionCount = BUILTIN_PERMISSIONS.length;
    for (const role of db.roles) {
      expect(db.rolePermissions.filter((binding) => binding.roleId === role.id)).toHaveLength(expectedPermissionCount);
    }
  });
});
