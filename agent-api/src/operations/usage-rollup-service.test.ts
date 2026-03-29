import { describe, expect, it } from "vitest";

import { FakeOperationsDb } from "../persistence/operations-test-helpers.js";
import { UsageEventRepository } from "../persistence/usage-event-repository.js";
import { UsageRollupRepository } from "../persistence/usage-rollup-repository.js";
import { UsageRollupService } from "./usage-rollup-service.js";

describe("UsageRollupService", () => {
  it("rebuilds daily rollups idempotently from persisted usage events", async () => {
    const db = new FakeOperationsDb(
      [],
      [],
      [
        {
          id: "stale-org-3",
          organizationId: "org-3",
          rollupDate: "2026-03-30",
          scopeType: "platform",
          scopeId: "platform",
          model: "gpt-5.4",
          featureType: "chat",
          requestCount: 9,
          successCount: 9,
          failureCount: 0,
          inputTokens: 900,
          cachedInputTokens: 90,
          outputTokens: 180,
          estimatedCost: "9.000000",
          internalCost: "18.000000",
          createdAt: new Date("2026-03-30T00:00:00.000Z"),
          updatedAt: new Date("2026-03-30T00:00:00.000Z")
        }
      ]
    );
    const repository = new UsageRollupRepository(db as never);
    const usageEvents = new UsageEventRepository(db as never);
    const service = new UsageRollupService({
      usageEvents,
      rollups: repository
    });

    await usageEvents.create({
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
      resultStatus: "success",
      createdAt: "2026-03-30T01:00:00.000Z"
    });
    await usageEvents.create({
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
      resultStatus: "failed",
      createdAt: "2026-03-30T02:00:00.000Z"
    });
    await usageEvents.create({
      organizationId: "org-2",
      userId: "user-2",
      departmentIdSnapshot: "dept-ops",
      model: "gpt-5.4-mini",
      featureType: "tool",
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 5,
      estimatedCost: "0.100000",
      internalCost: "0.200000",
      resultStatus: "success",
      createdAt: "2026-03-29T01:00:00.000Z"
    });

    const first = await service.rebuildDaily({
      rollupDate: "2026-03-30"
    });
    const second = await service.rebuildDaily({
      rollupDate: "2026-03-30"
    });

    expect(first.records).toHaveLength(5);
    expect(second.records).toHaveLength(5);
    expect(second.records.find((row) => row.scopeType === "platform" && row.organizationId === "org-1")?.requestCount).toBe(2);
    expect(second.records.find((row) => row.scopeType === "platform" && row.organizationId === "org-1")?.failureCount).toBe(1);
    expect(await repository.list({ rollupDate: "2026-03-30" })).toHaveLength(5);
    expect((await repository.list({ rollupDate: "2026-03-30" })).some((row) => row.organizationId === "org-3")).toBe(false);
    expect(await repository.list({ rollupDate: "2026-03-29" })).toHaveLength(0);
  });
});
