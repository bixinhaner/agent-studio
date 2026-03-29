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
});
