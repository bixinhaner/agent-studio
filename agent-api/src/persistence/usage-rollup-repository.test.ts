import { describe, expect, it } from "vitest";

import { UsageRollupRepository, type UsageRollupRepositoryDb } from "./usage-rollup-repository.js";

function createDb(overrides: Partial<UsageRollupRepositoryDb["usageDailyRollup"]> = {}): UsageRollupRepositoryDb {
  return {
    usageDailyRollup: {
      async create(args) {
        return {
          id: String(args.data.id ?? "rollup-1"),
          organizationId: (args.data.organizationId as string | null | undefined) ?? null,
          rollupDate: args.data.rollupDate as Date,
          scopeType: String(args.data.scopeType),
          scopeId: String(args.data.scopeId),
          model: (args.data.model as string | null | undefined) ?? null,
          featureType: (args.data.featureType as string | null | undefined) ?? null,
          requestCount: Number(args.data.requestCount ?? 0),
          successCount: Number(args.data.successCount ?? 0),
          failureCount: Number(args.data.failureCount ?? 0),
          inputTokens: Number(args.data.inputTokens ?? 0),
          cachedInputTokens: Number(args.data.cachedInputTokens ?? 0),
          outputTokens: Number(args.data.outputTokens ?? 0),
          estimatedCost: args.data.estimatedCost ?? "0.000000",
          internalCost: args.data.internalCost ?? "0.000000",
          createdAt: new Date("2026-06-10T00:00:00.000Z"),
          updatedAt: new Date("2026-06-10T00:00:00.000Z")
        };
      },
      async findMany() {
        return [];
      },
      async deleteMany() {
        return { count: 0 };
      },
      ...overrides
    }
  };
}

describe("UsageRollupRepository", () => {
  it("uses UTC Date values for replacing daily rollups", async () => {
    let deletedRollupDate: unknown;
    let createdRollupDate: unknown;
    const repo = new UsageRollupRepository(createDb({
      async deleteMany(args) {
        deletedRollupDate = args?.where?.rollupDate;
        return { count: 1 };
      },
      async create(args) {
        createdRollupDate = args.data.rollupDate;
        return {
          id: "rollup-1",
          organizationId: "org-1",
          rollupDate: args.data.rollupDate as Date,
          scopeType: "platform",
          scopeId: "platform",
          model: "gpt-5.5",
          featureType: "chat",
          requestCount: 1,
          successCount: 1,
          failureCount: 0,
          inputTokens: 100,
          cachedInputTokens: 10,
          outputTokens: 20,
          estimatedCost: "0.001000",
          internalCost: "0.000100",
          createdAt: new Date("2026-06-10T00:00:00.000Z"),
          updatedAt: new Date("2026-06-10T00:00:00.000Z")
        };
      }
    }));

    const records = await repo.replaceDaily({
      organizationId: "org-1",
      rollupDate: "2026-06-10",
      records: [
        {
          organizationId: "org-1",
          rollupDate: "2026-06-10",
          scopeType: "platform",
          scopeId: "platform",
          model: "gpt-5.5",
          featureType: "chat",
          requestCount: 1,
          successCount: 1,
          inputTokens: 100,
          cachedInputTokens: 10,
          outputTokens: 20
        }
      ]
    });

    expect(deletedRollupDate).toBeInstanceOf(Date);
    expect(createdRollupDate).toBeInstanceOf(Date);
    expect((deletedRollupDate as Date).toISOString()).toBe("2026-06-10T00:00:00.000Z");
    expect((createdRollupDate as Date).toISOString()).toBe("2026-06-10T00:00:00.000Z");
    expect(records[0]?.rollupDate).toBe("2026-06-10");
  });

  it("uses UTC Date values for listing rollups while returning day keys", async () => {
    let queriedRollupDate: unknown;
    const repo = new UsageRollupRepository(createDb({
      async findMany(args) {
        queriedRollupDate = args?.where?.rollupDate;
        return [
          {
            id: "rollup-1",
            organizationId: "org-1",
            rollupDate: new Date("2026-06-10T00:00:00.000Z"),
            scopeType: "platform",
            scopeId: "platform",
            model: "gpt-5.5",
            featureType: "chat",
            requestCount: 1,
            successCount: 1,
            failureCount: 0,
            inputTokens: 100,
            cachedInputTokens: 10,
            outputTokens: 20,
            estimatedCost: "0.001000",
            internalCost: "0.000100",
            createdAt: new Date("2026-06-10T00:00:00.000Z"),
            updatedAt: new Date("2026-06-10T00:00:00.000Z")
          }
        ];
      }
    }));

    const records = await repo.list({
      organizationId: "org-1",
      rollupDate: new Date("2026-06-10T19:45:00.000Z")
    });

    expect(queriedRollupDate).toBeInstanceOf(Date);
    expect((queriedRollupDate as Date).toISOString()).toBe("2026-06-10T00:00:00.000Z");
    expect(records[0]?.rollupDate).toBe("2026-06-10");
  });
});
