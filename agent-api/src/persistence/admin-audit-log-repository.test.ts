import { describe, expect, it } from "vitest";

import { AdminAuditLogRepository } from "./admin-audit-log-repository.js";
import { FakeRbacDb } from "./rbac-test-helpers.js";

describe("AdminAuditLogRepository", () => {
  it("stores before and after payloads for a target", async () => {
    const db = new FakeRbacDb();
    const repository = new AdminAuditLogRepository(db as never);

    await repository.create({
      actorUserId: "user-1",
      actionType: "role.update",
      targetType: "role",
      targetId: "role-1",
      beforePayload: { name: "Old Role" },
      afterPayload: { name: "New Role" },
      metadata: { source: "test" }
    });

    await expect(repository.listForTarget("role", "role-1")).resolves.toEqual([
      expect.objectContaining({
        actorUserId: "user-1",
        actionType: "role.update",
        targetType: "role",
        targetId: "role-1",
        beforePayload: { name: "Old Role" },
        afterPayload: { name: "New Role" },
        metadata: { source: "test" }
      })
    ]);
  });
});
