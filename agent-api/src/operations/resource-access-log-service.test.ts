import { describe, expect, it } from "vitest";

import { ResourceAccessLogRepository } from "../persistence/resource-access-log-repository.js";
import { FakeOperationsDb } from "../persistence/operations-test-helpers.js";
import { ResourceAccessLogService } from "./resource-access-log-service.js";

describe("ResourceAccessLogService", () => {
  it("records resource access events through the repository", async () => {
    const repository = new ResourceAccessLogRepository(new FakeOperationsDb() as never);
    const service = new ResourceAccessLogService(repository);

    const created = await service.record({
      userId: "user-1",
      resourceType: "knowledge_set",
      resourceId: "ks-faq",
      actionType: "mount",
      resultStatus: "success"
    });

    expect(created.actionType).toBe("mount");
    expect(created.resultStatus).toBe("success");
  });
});
