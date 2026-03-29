import { describe, expect, it } from "vitest";

import { FakeOperationsDb } from "./operations-test-helpers.js";
import { UsageRollupRepository } from "./usage-rollup-repository.js";

describe("UsageRollupRepository", () => {
  it("replaces daily rollups without duplicating records", async () => {
    const repository = new UsageRollupRepository(new FakeOperationsDb() as never);

    await repository.replaceDaily({
      rollupDate: "2026-03-30",
      records: [
        {
          organizationId: "org-1",
          scopeType: "platform",
          scopeId: "platform",
          model: "gpt-5.4",
          featureType: "chat",
          requestCount: 1,
          successCount: 1,
          failureCount: 0,
          inputTokens: 100,
          cachedInputTokens: 10,
          outputTokens: 20,
          estimatedCost: "1.000000",
          internalCost: "2.000000"
        }
      ]
    });

    await repository.replaceDaily({
      rollupDate: "2026-03-30",
      records: [
        {
          organizationId: "org-1",
          scopeType: "platform",
          scopeId: "platform",
          model: "gpt-5.4",
          featureType: "chat",
          requestCount: 3,
          successCount: 2,
          failureCount: 1,
          inputTokens: 300,
          cachedInputTokens: 30,
          outputTokens: 60,
          estimatedCost: "3.000000",
          internalCost: "6.000000"
        },
        {
          organizationId: "org-1",
          scopeType: "user",
          scopeId: "user-1",
          model: "gpt-5.4",
          featureType: "chat",
          requestCount: 3,
          successCount: 2,
          failureCount: 1,
          inputTokens: 300,
          cachedInputTokens: 30,
          outputTokens: 60,
          estimatedCost: "3.000000",
          internalCost: "6.000000"
        }
      ]
    });

    const rows = await repository.list({ rollupDate: "2026-03-30" });

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.scopeType === "platform")?.requestCount).toBe(3);
    expect(rows.find((row) => row.scopeType === "user")?.scopeId).toBe("user-1");
  });
});
