import { describe, expect, it, vi } from "vitest";

import { buildIndexWhere, ConversationSummaryIndex, type ConversationIndexQuery, type SummaryIndexRawDb } from "./conversation-summary-index.js";

const baseQuery: ConversationIndexQuery = {
  status: "all",
  feedback: "all",
  source: "all",
  sort: "updated_desc",
  page: 1,
  pageSize: 24
};

describe("buildIndexWhere", () => {
  it("only applies visibility filters by default", () => {
    const where = buildIndexWhere(baseQuery);
    expect(where.values).toEqual([]);
    expect(where.sql).toContain(`t."workspace_trash_batch_id" IS NULL`);
    expect(where.sql).toContain(`t."security_domain_id" IS NULL`);
    expect(where.sql).toContain(`s."summary" IS NOT NULL`);
  });

  it("parameterizes status, audience source and a lowercased search needle", () => {
    const where = buildIndexWhere({ ...baseQuery, status: "archived", source: "brand_employee", feedback: "negative", query: "  Foo'Bar " });
    expect(where.values).toEqual(["archived", "brand_employee", "foo'bar"]);
    expect(where.sql).toContain(`s."status" = $1`);
    expect(where.sql).toContain(`s."has_channel" = false AND s."audience" = $2`);
    expect(where.sql).toContain(`position($3 in s."search_text") > 0`);
    expect(where.sql).toContain(`s."feedback_negative" > 0`);
    expect(where.sql).not.toContain("Foo");
  });

  it("maps channel sources to channel types", () => {
    expect(buildIndexWhere({ ...baseQuery, source: "zendesk" }).sql).toContain(`s."channel_type" = 'zendesk'`);
    expect(buildIndexWhere({ ...baseQuery, source: "dingtalk" }).sql).toContain(`s."channel_type" = 'dingtalk_bot'`);
    expect(buildIndexWhere({ ...baseQuery, source: "action_connector" }).sql).toContain(`s."channel_type" = 'action_connector'`);
    expect(buildIndexWhere({ ...baseQuery, feedback: "none" }).sql).toContain(`s."feedback_total" = 0`);
    expect(buildIndexWhere({ ...baseQuery, feedback: "with_feedback" }).sql).toContain(`s."feedback_total" > 0`);
  });
});

function fields(threadId: string) {
  return {
    status: "active",
    audience: "internal",
    hasChannel: false,
    channelType: null,
    userId: `user-${threadId}`,
    feedbackTotal: 0,
    feedbackPositive: 0,
    feedbackNegative: 0,
    searchText: `title ${threadId}\u0000`
  };
}

describe("ConversationSummaryIndex.refresh", () => {
  it("rebuilds stale rows and records the dirty_seq that was read as clean_seq", async () => {
    const executed: Array<{ sql: string; values: unknown[] }> = [];
    const db: SummaryIndexRawDb = {
      $queryRawUnsafe: vi.fn(async (_sql: string, afterId: unknown) =>
        afterId === "" ? [{ threadId: "t1", dirtySeq: 7n }, { threadId: "t2", dirtySeq: "9" }] : []
      ) as SummaryIndexRawDb["$queryRawUnsafe"],
      $executeRawUnsafe: vi.fn(async (sql: string, ...values: unknown[]) => {
        executed.push({ sql, values });
        return values.length > 0 ? 2 : 0;
      })
    };
    const buildSummaries = vi.fn(async (ids: string[]) =>
      // t2 disappeared (e.g. moved into a security domain) and is skipped.
      ids.filter((id) => id !== "t2").map((id) => ({ threadId: id, summary: { id }, fields: fields(id) }))
    );
    const index = new ConversationSummaryIndex({ db: () => db, buildSummaries });

    const rebuilt = await index.refresh();

    expect(rebuilt).toBe(2);
    expect(buildSummaries).toHaveBeenCalledWith(["t1", "t2"]);
    const update = executed.find((item) => item.sql.includes("UPDATE"));
    expect(update?.sql).toContain("FOR UPDATE SKIP LOCKED");
    const payload = JSON.parse(String(update?.values[0])) as Array<Record<string, unknown>>;
    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({ thread_id: "t1", seq: "7", user_id: "user-t1", search_text: "title t1" });
  });

  it("shares one in-flight refresh between concurrent callers", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const db: SummaryIndexRawDb = {
      $queryRawUnsafe: vi.fn(async () => []) as SummaryIndexRawDb["$queryRawUnsafe"],
      $executeRawUnsafe: vi.fn(async () => {
        await gate;
        return 0;
      })
    };
    const index = new ConversationSummaryIndex({ db: () => db, buildSummaries: vi.fn(async () => []) });
    const first = index.refresh();
    const second = index.refresh();
    expect(second).toBe(first);
    release();
    await Promise.all([first, second]);
    expect(db.$executeRawUnsafe).toHaveBeenCalledTimes(1);
  });
});

describe("ConversationSummaryIndex.query", () => {
  it("returns aggregate counts, clamps the page and orders by the requested column", async () => {
    const calls: string[] = [];
    const db: SummaryIndexRawDb = {
      $queryRawUnsafe: vi.fn(async (sql: string) => {
        calls.push(sql);
        if (sql.includes("COUNT(*)")) {
          return [{ totalThreads: 30, threadsWithFeedback: 4, totalFeedback: 6, positiveFeedback: 5, negativeFeedback: 1, uniqueUsers: 3 }];
        }
        return [{ summary: { id: "a" } }, { summary: { id: "b" } }];
      }) as SummaryIndexRawDb["$queryRawUnsafe"],
      $executeRawUnsafe: vi.fn(async () => 0)
    };
    const index = new ConversationSummaryIndex<{ id: string }>({ db: () => db, buildSummaries: vi.fn(async () => []) });

    const result = await index.query({ ...baseQuery, sort: "created_desc", page: 99, pageSize: 24 });

    expect(result.totalPages).toBe(2);
    expect(result.page).toBe(2);
    expect(result.aggregate).toEqual({ totalThreads: 30, threadsWithFeedback: 4, totalFeedback: 6, positiveFeedback: 5, negativeFeedback: 1, uniqueUsers: 3 });
    expect(result.items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(calls[1]).toContain(`ORDER BY t."created_at" DESC, t."id" DESC`);
    expect(calls[1]).toContain("LIMIT 24 OFFSET 24");
  });
});
