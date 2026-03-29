import { describe, expect, it } from "vitest";

import { FakeOperationsDb } from "./operations-test-helpers.js";
import { UsageRollupRepository } from "./usage-rollup-repository.js";

describe("UsageRollupRepository", () => {
  it("replaces scoped daily rollups without touching unrelated org rows", async () => {
    const db = new FakeOperationsDb(
      [],
      [],
      [
        {
          id: "rollup-1",
          organizationId: "org-1",
          rollupDate: "2026-03-30",
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
          internalCost: "2.000000",
          createdAt: new Date("2026-03-30T00:00:00.000Z"),
          updatedAt: new Date("2026-03-30T00:00:00.000Z")
        },
        {
          id: "rollup-2",
          organizationId: "org-2",
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

    await repository.replaceDaily({
      rollupDate: "2026-03-30",
      organizationId: "org-1",
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
        }
      ]
    });

    const rows = await repository.list({ rollupDate: "2026-03-30" });

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.organizationId === "org-1")?.requestCount).toBe(3);
    expect(rows.find((row) => row.organizationId === "org-2")?.requestCount).toBe(9);
  });

  it("pins inserted rows to the scoped organization during replace", async () => {
    const db = new FakeOperationsDb(
      [],
      [],
      [
        {
          id: "rollup-1",
          organizationId: "org-1",
          rollupDate: "2026-03-30",
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
          internalCost: "2.000000",
          createdAt: new Date("2026-03-30T00:00:00.000Z"),
          updatedAt: new Date("2026-03-30T00:00:00.000Z")
        },
        {
          id: "rollup-2",
          organizationId: "org-2",
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

    await repository.replaceDaily({
      rollupDate: "2026-03-30",
      organizationId: "org-1",
      records: [
        {
          organizationId: "org-2",
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
        }
      ]
    });

    const rows = await repository.list({ rollupDate: "2026-03-30" });

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.organizationId === "org-1")?.requestCount).toBe(3);
    expect(rows.find((row) => row.organizationId === "org-2")?.requestCount).toBe(9);
  });

  it("replaces unscoped daily rollups only for organizations present in the rebuild set", async () => {
    const db = new FakeOperationsDb(
      [],
      [],
      [
        {
          id: "rollup-1",
          organizationId: "org-1",
          rollupDate: "2026-03-30",
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
          internalCost: "2.000000",
          createdAt: new Date("2026-03-30T00:00:00.000Z"),
          updatedAt: new Date("2026-03-30T00:00:00.000Z")
        },
        {
          id: "rollup-2",
          organizationId: "org-2",
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
        },
        {
          id: "rollup-3",
          organizationId: "org-3",
          rollupDate: "2026-03-30",
          scopeType: "platform",
          scopeId: "platform",
          model: "gpt-5.4",
          featureType: "chat",
          requestCount: 7,
          successCount: 7,
          failureCount: 0,
          inputTokens: 700,
          cachedInputTokens: 70,
          outputTokens: 140,
          estimatedCost: "7.000000",
          internalCost: "14.000000",
          createdAt: new Date("2026-03-30T00:00:00.000Z"),
          updatedAt: new Date("2026-03-30T00:00:00.000Z")
        }
      ]
    );
    const repository = new UsageRollupRepository(db as never);

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
          organizationId: "org-4",
          scopeType: "platform",
          scopeId: "platform",
          model: "gpt-5.4",
          featureType: "chat",
          requestCount: 4,
          successCount: 4,
          failureCount: 0,
          inputTokens: 400,
          cachedInputTokens: 40,
          outputTokens: 80,
          estimatedCost: "4.000000",
          internalCost: "8.000000"
        }
      ]
    });

    const rows = await repository.list({ rollupDate: "2026-03-30" });

    expect(rows).toHaveLength(4);
    expect(rows.find((row) => row.organizationId === "org-2")?.requestCount).toBe(9);
    expect(rows.find((row) => row.organizationId === "org-3")?.requestCount).toBe(7);
  });
});
