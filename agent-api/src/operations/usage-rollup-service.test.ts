import { describe, expect, it } from "vitest";

import { FakeOperationsDb } from "../persistence/operations-test-helpers.js";
import { UsageRollupRepository } from "../persistence/usage-rollup-repository.js";
import { UsageRollupService } from "./usage-rollup-service.js";

describe("UsageRollupService", () => {
  it("rebuilds daily rollups idempotently from raw usage events", async () => {
    const db = new FakeOperationsDb();
    const repository = new UsageRollupRepository(db as never);
    const service = new UsageRollupService(repository);

    const events = [
      {
        organizationId: "org-1",
        userId: "user-1",
        departmentIdSnapshot: "dept-rd",
        model: "gpt-5.4",
        featureType: "chat",
        inputTokens: 100,
        cachedInputTokens: 10,
        outputTokens: 20,
        estimatedCost: "1.500000",
        internalCost: "2.500000",
        resultStatus: "success"
      },
      {
        organizationId: "org-1",
        userId: "user-1",
        departmentIdSnapshot: "dept-rd",
        model: "gpt-5.4",
        featureType: "chat",
        inputTokens: 25,
        cachedInputTokens: 5,
        outputTokens: 10,
        estimatedCost: "0.500000",
        internalCost: "1.000000",
        resultStatus: "failed"
      }
    ];

    const first = await service.rebuildDaily({
      rollupDate: "2026-03-30",
      events
    });
    const second = await service.rebuildDaily({
      rollupDate: "2026-03-30",
      events
    });

    expect(first.records).toHaveLength(5);
    expect(second.records).toHaveLength(5);
    expect(second.records.find((row) => row.scopeType === "platform")?.requestCount).toBe(2);
    expect(second.records.find((row) => row.scopeType === "platform")?.failureCount).toBe(1);
    expect(await repository.list({ rollupDate: "2026-03-30" })).toHaveLength(5);
  });
});
