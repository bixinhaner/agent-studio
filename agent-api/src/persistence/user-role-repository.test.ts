import { describe, expect, it } from "vitest";

import { FakeRbacDb } from "./rbac-test-helpers.js";
import { UserRoleRepository } from "./user-role-repository.js";

describe("UserRoleRepository", () => {
  it("replaces a user's assigned roles while preserving exactly one primary role", async () => {
    const db = new FakeRbacDb(
      [
        {
          id: "user-1",
          externalId: null,
          email: null,
          displayName: "User One",
          role: "employee",
          status: "active",
          statusSource: "sync",
          syncState: "active",
          manualDisabled: false,
          adminNote: null,
          lastSyncedAt: null,
          dingtalkOpenId: null,
          dingtalkUserId: null,
          dingtalkCorpId: null,
          createdAt: new Date("2026-03-29T00:00:00.000Z"),
          updatedAt: new Date("2026-03-29T00:00:00.000Z")
        }
      ],
      [
        {
          id: "role-employee",
          organizationId: null,
          slug: "employee",
          name: "Employee",
          description: null,
          isSystem: false,
          isActive: true,
          createdAt: new Date("2026-03-29T00:00:00.000Z"),
          updatedAt: new Date("2026-03-29T00:00:00.000Z")
        },
        {
          id: "role-admin",
          organizationId: null,
          slug: "admin",
          name: "Admin",
          description: null,
          isSystem: true,
          isActive: true,
          createdAt: new Date("2026-03-29T00:00:00.000Z"),
          updatedAt: new Date("2026-03-29T00:00:00.000Z")
        }
      ]
    );
    const repository = new UserRoleRepository(db as never);

    await repository.replaceUserRoles({
      userId: "user-1",
      assignments: [
        { roleId: "role-employee", isPrimary: false },
        { roleId: "role-admin", isPrimary: true }
      ],
      mirrorLegacyRole: "admin"
    });

    expect(await repository.listForUser("user-1")).toEqual([
      expect.objectContaining({ roleId: "role-employee", isPrimary: false }),
      expect.objectContaining({ roleId: "role-admin", isPrimary: true })
    ]);
    expect(db.users[0]?.role).toBe("admin");
  });

  it("rejects multiple primary assignments", async () => {
    const db = new FakeRbacDb(
      [
        {
          id: "user-1",
          externalId: null,
          email: null,
          displayName: "User One",
          role: "employee",
          status: "active",
          statusSource: "sync",
          syncState: "active",
          manualDisabled: false,
          adminNote: null,
          lastSyncedAt: null,
          dingtalkOpenId: null,
          dingtalkUserId: null,
          dingtalkCorpId: null,
          createdAt: new Date("2026-03-29T00:00:00.000Z"),
          updatedAt: new Date("2026-03-29T00:00:00.000Z")
        }
      ],
      [
        {
          id: "role-1",
          organizationId: null,
          slug: "employee",
          name: "Employee",
          description: null,
          isSystem: false,
          isActive: true,
          createdAt: new Date("2026-03-29T00:00:00.000Z"),
          updatedAt: new Date("2026-03-29T00:00:00.000Z")
        },
        {
          id: "role-2",
          organizationId: null,
          slug: "auditor",
          name: "Auditor",
          description: null,
          isSystem: false,
          isActive: true,
          createdAt: new Date("2026-03-29T00:00:00.000Z"),
          updatedAt: new Date("2026-03-29T00:00:00.000Z")
        }
      ]
    );
    const repository = new UserRoleRepository(db as never);

    await expect(
      repository.replaceUserRoles({
        userId: "user-1",
        assignments: [
          { roleId: "role-1", isPrimary: true },
          { roleId: "role-2", isPrimary: true }
        ],
        mirrorLegacyRole: "employee"
      })
    ).rejects.toThrow(/只能有一个主角色/);
  });

  it("rejects assignments to disabled roles", async () => {
    const db = new FakeRbacDb(
      [
        {
          id: "user-1",
          externalId: null,
          email: null,
          displayName: "User One",
          role: "employee",
          status: "active",
          statusSource: "sync",
          syncState: "active",
          manualDisabled: false,
          adminNote: null,
          lastSyncedAt: null,
          dingtalkOpenId: null,
          dingtalkUserId: null,
          dingtalkCorpId: null,
          createdAt: new Date("2026-03-29T00:00:00.000Z"),
          updatedAt: new Date("2026-03-29T00:00:00.000Z")
        }
      ],
      [
        {
          id: "role-disabled",
          organizationId: null,
          slug: "auditor",
          name: "Auditor",
          description: null,
          isSystem: false,
          isActive: false,
          createdAt: new Date("2026-03-29T00:00:00.000Z"),
          updatedAt: new Date("2026-03-29T00:00:00.000Z")
        }
      ]
    );
    const repository = new UserRoleRepository(db as never);

    await expect(
      repository.replaceUserRoles({
        userId: "user-1",
        assignments: [{ roleId: "role-disabled", isPrimary: true }],
        mirrorLegacyRole: "auditor"
      })
    ).rejects.toThrow(/已禁用角色/);
  });
});
