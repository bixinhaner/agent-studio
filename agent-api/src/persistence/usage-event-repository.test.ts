import { describe, expect, it, vi } from "vitest";

import { UsageEventRepository, type UsageEventRepositoryDb } from "./usage-event-repository.js";

describe("UsageEventRepository", () => {
  it("uses a durable turn primary key to prevent replay and upgrades provisional usage in place", async () => {
    const rows = new Map<string, any>();
    const table = {
      create: vi.fn(async ({ data }: any) => { const row = { ...data, createdAt: new Date("2026-09-20T10:00:00Z") }; rows.set(data.id, row); return row; }),
      findMany: vi.fn(async ({ where }: any) => rows.has(where.id) ? [rows.get(where.id)] : []),
      update: vi.fn(async ({ where, data }: any) => { const row = { ...rows.get(where.id), ...data }; rows.set(where.id, row); return row; })
    };
    const tx = { usageEvent: table, $queryRawUnsafe: vi.fn(async () => [{ locked: 1 }]) };
    const db = { usageEvent: table, $transaction: async (fn: any) => fn(tx) } as unknown as UsageEventRepositoryDb;
    const repo = new UsageEventRepository(db);
    const input = { id: "turn-key", model: "gpt-5.6-sol", featureType: "chat", inputTokens: 10, cachedInputTokens: 5, cacheWriteTokens: 0, outputTokens: 2, estimatedCost: "0.100000", internalCost: "0.010000", resultStatus: "success", metadata: { _usageAccounting: { status: "pending_reconciliation" } } };
    const first = await repo.createCodexTurn(input);
    const exact = { ...input, inputTokens: 25, metadata: { _usageAccounting: { status: "complete" } } };
    const second = await repo.createCodexTurn(exact);
    await repo.createCodexTurn(exact);
    expect(first.id).toBe(second.id);
    expect(first.createdAt).toBe(second.createdAt);
    expect(table.create).toHaveBeenCalledTimes(1);
    expect(table.update).toHaveBeenCalledTimes(1);
    await expect(repo.createCodexTurn({ ...exact, inputTokens: 26 })).rejects.toThrow("conflicting complete turn usage");
    await expect(repo.createCodexTurn({ ...exact, organizationId: "other-tenant" })).rejects.toThrow("ownership conflict");
    await repo.createCodexTurn({ ...exact, id: "second-real-turn" });
    expect(rows.size).toBe(2);
  });

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
