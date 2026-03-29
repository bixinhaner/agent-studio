import { describe, expect, it } from "vitest";

import { FakeRbacDb } from "./rbac-test-helpers.js";
import { RoleRepository } from "./role-repository.js";

describe("RoleRepository", () => {
  it("creates and normalizes a custom role", async () => {
    const repository = new RoleRepository(new FakeRbacDb() as never);

    const role = await repository.create({
      organizationId: "  org-1  ",
      slug: "ops_manager",
      name: "Ops Manager",
      description: "  ",
      isSystem: false
    });

    expect(role).toMatchObject({
      organizationId: "org-1",
      slug: "ops_manager",
      name: "Ops Manager",
      description: undefined,
      isSystem: false,
      isActive: true
    });
  });

  it("forbids disabling protected system roles", async () => {
    const db = new FakeRbacDb([], [
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
    ]);
    const repository = new RoleRepository(db as never);

    await expect(repository.disable("role-admin")).rejects.toThrow(/不能被禁用/);
  });

  it("clones a system role into an active custom role", async () => {
    const db = new FakeRbacDb([], [
      {
        id: "role-admin",
        organizationId: null,
        slug: "admin",
        name: "Admin",
        description: "System admin",
        isSystem: true,
        isActive: true,
        createdAt: new Date("2026-03-29T00:00:00.000Z"),
        updatedAt: new Date("2026-03-29T00:00:00.000Z")
      }
    ]);
    const repository = new RoleRepository(db as never);

    const cloned = await repository.clone({
      sourceRoleId: "role-admin",
      slug: "support_admin",
      name: "Support Admin"
    });

    expect(cloned).toMatchObject({
      slug: "support_admin",
      name: "Support Admin",
      description: "System admin",
      isSystem: false,
      isActive: true
    });
    expect(db.roles).toHaveLength(2);
  });
});
