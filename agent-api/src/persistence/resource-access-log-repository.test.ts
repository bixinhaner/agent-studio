import { describe, expect, it } from "vitest";

import { FakeOperationsDb } from "./operations-test-helpers.js";
import { ResourceAccessLogRepository } from "./resource-access-log-repository.js";

describe("ResourceAccessLogRepository", () => {
  it("records a resource access log with session and thread context", async () => {
    const repository = new ResourceAccessLogRepository(new FakeOperationsDb() as never);

    const created = await repository.create({
      userId: "user-1",
      departmentIdSnapshot: "dept-rd",
      threadId: "thread-1",
      sessionId: "session-1",
      resourceType: "knowledge_set",
      resourceId: "ks-faq",
      actionType: "mount",
      resultStatus: "success"
    });

    expect(created.resourceType).toBe("knowledge_set");
    expect(created.threadId).toBe("thread-1");
    expect(created.sessionId).toBe("session-1");
  });

  it("lists access logs by user and newest first", async () => {
    const db = new FakeOperationsDb();
    const repository = new ResourceAccessLogRepository(db as never);

    await repository.create({
      userId: "user-1",
      resourceType: "workspace",
      resourceId: "workspace-a",
      actionType: "mount",
      resultStatus: "success"
    });
    await repository.create({
      userId: "user-2",
      resourceType: "workspace",
      resourceId: "workspace-b",
      actionType: "mount",
      resultStatus: "success"
    });

    const logs = await repository.list({ userId: "user-1" });

    expect(logs).toHaveLength(1);
    expect(logs[0]?.userId).toBe("user-1");
  });
});
