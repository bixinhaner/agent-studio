import { describe, expect, it, vi } from "vitest";

import type { UsageEventRecord } from "../persistence/usage-event-repository.js";
import { UsageLedgerService } from "./usage-ledger-service.js";

function usageEvent(patch: Partial<UsageEventRecord>): UsageEventRecord {
  return {
    id: patch.id ?? "usage-1",
    organizationId: patch.organizationId,
    userId: patch.userId,
    departmentIdSnapshot: patch.departmentIdSnapshot,
    threadId: patch.threadId,
    sessionId: patch.sessionId,
    model: patch.model ?? "gpt-5-codex",
    featureType: patch.featureType ?? "chat",
    inputTokens: patch.inputTokens ?? 0,
    cachedInputTokens: patch.cachedInputTokens ?? 0,
    outputTokens: patch.outputTokens ?? 0,
    estimatedCost: patch.estimatedCost ?? "0.000000",
    internalCost: patch.internalCost ?? "0.000000",
    resultStatus: patch.resultStatus ?? "success",
    metadata: patch.metadata,
    createdAt: patch.createdAt ?? "2026-06-10T08:00:00.000Z"
  };
}

describe("UsageLedgerService", () => {
  it("keeps overview and ranking calculations in one read model", () => {
    const service = new UsageLedgerService({
      usageEvents: {
        list: vi.fn(),
        listByExactCreatedAtRange: vi.fn()
      } as never
    });
    const events = [
      usageEvent({
        id: "usage-1",
        userId: "user-1",
        model: "model-a",
        estimatedCost: "0.100000",
        internalCost: "0.200000",
        createdAt: "2026-06-09T10:00:00.000Z"
      }),
      usageEvent({
        id: "usage-2",
        userId: "user-1",
        model: "model-b",
        resultStatus: "failed",
        estimatedCost: "0.300000",
        internalCost: "0.400000",
        createdAt: "2026-06-10T10:00:00.000Z"
      })
    ];

    expect(service.buildOverview(events)).toEqual({
      totalRequests: 2,
      totalEstimatedCost: "0.400000",
      totalInternalCost: "0.600000",
      trends: [
        {
          rollupDate: "2026-06-09",
          requestCount: 1,
          successCount: 1,
          failureCount: 0,
          estimatedCost: "0.100000",
          internalCost: "0.200000"
        },
        {
          rollupDate: "2026-06-10",
          requestCount: 1,
          successCount: 0,
          failureCount: 1,
          estimatedCost: "0.300000",
          internalCost: "0.400000"
        }
      ]
    });
    expect(service.buildRankings(events).topUsers[0]).toMatchObject({
      userId: "user-1",
      requestCount: 2,
      estimatedCost: "0.400000",
      internalCost: "0.600000"
    });
    expect(service.buildRankings(events).topUsers[0]).not.toHaveProperty("key");
  });

  it("routes external API event reads through the canonical feature filter", async () => {
    const list = vi.fn(async () => []);
    const service = new UsageLedgerService({
      usageEvents: {
        list,
        listByExactCreatedAtRange: vi.fn()
      } as never
    });

    await service.listExternalApiEvents({ take: 10 });

    expect(list).toHaveBeenCalledWith({
      take: 10,
      featureType: "external_openai_api"
    });
  });
});
