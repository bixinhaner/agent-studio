import { describe, expect, it, vi } from "vitest";

import { UsageEventRepository, type UsageEventRepositoryDb } from "./usage-event-repository.js";

describe("UsageEventRepository", () => {
  it("acquires the cumulative cursor lock without returning PostgreSQL void to Prisma", async () => {
    const rawQueries: Array<{ query: string; values: unknown[] }> = [];
    const createdAt = new Date("2026-07-28T00:00:00.000Z");
    const usageEvent = {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "usage-1",
        organizationId: null,
        userId: null,
        departmentIdSnapshot: null,
        threadId: null,
        sessionId: null,
        model: String(data.model),
        featureType: String(data.featureType),
        inputTokens: Number(data.inputTokens),
        cachedInputTokens: Number(data.cachedInputTokens),
        cacheWriteTokens: Number(data.cacheWriteTokens),
        outputTokens: Number(data.outputTokens),
        estimatedCost: String(data.estimatedCost),
        internalCost: String(data.internalCost),
        resultStatus: String(data.resultStatus),
        metadata: data.metadata,
        createdAt
      })),
      findMany: vi.fn()
    };
    const transaction = {
      usageEvent,
      async $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T> {
        rawQueries.push({ query, values });
        if (query.includes("pg_advisory_xact_lock")) {
          return [{ locked: 1 }] as T;
        }
        return [{
          inputTokens: null,
          cachedInputTokens: null,
          cacheWriteTokens: null,
          outputTokens: null
        }] as T;
      }
    };
    const db = {
      usageEvent,
      async $transaction<T>(callback: (input: typeof transaction) => Promise<T>): Promise<T> {
        return callback(transaction);
      }
    } as unknown as UsageEventRepositoryDb;

    const repository = new UsageEventRepository(db);
    const created = await repository.createCodexCumulative({
      codexThreadId: "thread-1",
      featureType: "chat",
      buildInput: () => ({
        model: "gpt-5.6-sol",
        featureType: "chat",
        inputTokens: 10,
        cachedInputTokens: 4,
        cacheWriteTokens: 0,
        outputTokens: 2,
        estimatedCost: "0.000100",
        internalCost: "0.000010",
        resultStatus: "success"
      })
    });

    expect(rawQueries[0]).toEqual({
      query: 'SELECT 1::int AS "locked" FROM pg_advisory_xact_lock(hashtextextended($1, 0))',
      values: ["codex-usage:chat:thread-1"]
    });
    expect(created).toMatchObject({
      id: "usage-1",
      inputTokens: 10,
      cachedInputTokens: 4,
      outputTokens: 2
    });
  });
});
