import { describe, expect, it } from "vitest";

import { FakeRbacDb } from "./rbac-test-helpers.js";
import { PermissionRepository } from "./permission-repository.js";

describe("PermissionRepository", () => {
  it("upserts system permissions idempotently", async () => {
    const db = new FakeRbacDb();
    const repository = new PermissionRepository(db as never);

    await repository.upsertMany([
      { key: "role.write", name: "Role write", category: "role" },
      { key: "user.read", name: "User read", category: "user" }
    ]);
    await repository.upsertMany([
      { key: "role.write", name: "Role write updated", category: "role", description: "updated" },
      { key: "user.read", name: "User read", category: "user" }
    ]);

    const permissions = await repository.list();
    expect(permissions).toHaveLength(2);
    expect(permissions.find((item) => item.key === "role.write")).toMatchObject({
      name: "Role write updated",
      description: "updated"
    });
  });
});
