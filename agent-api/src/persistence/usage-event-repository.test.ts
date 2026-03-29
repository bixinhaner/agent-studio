import { describe, expect, it } from "vitest";

import { FakeOperationsDb } from "./operations-test-helpers.js";
import { UsageEventRepository } from "./usage-event-repository.js";

describe("UsageEventRepository", () => {
  it("records a usage event with token counts and costs", async () => {
    const repository = new UsageEventRepository(new FakeOperationsDb() as never);

    const created = await repository.create({
      userId: "user-1",
      departmentIdSnapshot: "dept-rd",
      sessionId: "session-1",
      threadId: "thread-1",
      model: "gpt-5.4",
      featureType: "chat",
      inputTokens: 1000,
      cachedInputTokens: 100,
      outputTokens: 500,
      estimatedCost: "1.250000",
      internalCost: "1.500000",
      resultStatus: "success"
    });

    expect(created.model).toBe("gpt-5.4");
    expect(created.estimatedCost).toBe("1.250000");
    expect(created.internalCost).toBe("1.500000");
  });

  it("lists usage events within a created-at date range", async () => {
    const repository = new UsageEventRepository(new FakeOperationsDb() as never);

    await repository.create({
      organizationId: "org-1",
      userId: "user-1",
      model: "gpt-5.4",
      featureType: "chat",
      resultStatus: "success",
      createdAt: "2026-03-29T23:59:59.000Z"
    });
    await repository.create({
      organizationId: "org-1",
      userId: "user-1",
      model: "gpt-5.4",
      featureType: "chat",
      resultStatus: "success",
      createdAt: "2026-03-30T01:00:00.000Z"
    });

    const events = await repository.listByCreatedAtRange({
      organizationId: "org-1",
      from: "2026-03-30T00:00:00.000Z",
      to: "2026-03-31T00:00:00.000Z"
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.createdAt).toBe("2026-03-30T01:00:00.000Z");
  });
});
