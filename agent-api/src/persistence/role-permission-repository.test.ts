import { describe, expect, it } from "vitest";

import { FakeRbacDb } from "./rbac-test-helpers.js";
import { RolePermissionRepository } from "./role-permission-repository.js";

describe("RolePermissionRepository", () => {
  it("replaces permissions for a role without touching other roles", async () => {
    const db = new FakeRbacDb(
      [],
      [],
      [
        {
          id: "permission-user-read",
          key: "user.read",
          name: "User read",
          description: null,
          category: "user",
          isSystem: true,
          isActive: true,
          createdAt: new Date("2026-03-29T00:00:00.000Z"),
          updatedAt: new Date("2026-03-29T00:00:00.000Z")
        },
        {
          id: "permission-user-write",
          key: "user.write",
          name: "User write",
          description: null,
          category: "user",
          isSystem: true,
          isActive: true,
          createdAt: new Date("2026-03-29T00:00:00.000Z"),
          updatedAt: new Date("2026-03-29T00:00:00.000Z")
        },
        {
          id: "permission-audit-read",
          key: "audit.read",
          name: "Audit read",
          description: null,
          category: "audit",
          isSystem: true,
          isActive: true,
          createdAt: new Date("2026-03-29T00:00:00.000Z"),
          updatedAt: new Date("2026-03-29T00:00:00.000Z")
        }
      ],
      [],
      [
        {
          id: "role-permission-1",
          roleId: "role-admin",
          permissionId: "permission-user-read",
          createdAt: new Date("2026-03-29T00:00:00.000Z"),
          updatedAt: new Date("2026-03-29T00:00:00.000Z")
        },
        {
          id: "role-permission-2",
          roleId: "role-auditor",
          permissionId: "permission-audit-read",
          createdAt: new Date("2026-03-29T00:00:00.000Z"),
          updatedAt: new Date("2026-03-29T00:00:00.000Z")
        }
      ]
    );
    const repository = new RolePermissionRepository(db as never);

    await repository.replaceRolePermissions({
      roleId: "role-admin",
      permissionIds: ["permission-user-write", "permission-user-write", "permission-audit-read"]
    });

    expect((await repository.listForRole("role-admin")).map((item) => item.permissionId)).toEqual([
      "permission-user-write",
      "permission-audit-read"
    ]);
    expect((await repository.listForRole("role-auditor")).map((item) => item.permissionId)).toEqual([
      "permission-audit-read"
    ]);
  });
});
