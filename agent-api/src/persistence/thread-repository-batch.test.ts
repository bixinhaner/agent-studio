import { describe, expect, it } from "vitest";

import { ThreadRepository } from "./thread-repository.js";

function threadRow(id: string) {
  return {
    id,
    organizationId: "o1",
    userId: "u1",
    externalId: null,
    title: id,
    status: "active",
    model: "gpt",
    reasoningEffort: "high",
    workspace: "",
    codexRunConfig: null,
    headId: null,
    feedback: [],
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z")
  };
}

function messageRow(threadId: string, position: number, text: string) {
  return {
    id: `${threadId}-${position}`,
    threadId,
    externalId: null,
    role: "user",
    content: { id: `${threadId}-${position}`, role: "user", content: [{ type: "text", text }] },
    parentId: null,
    runConfig: null,
    position,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z")
  };
}

describe("ThreadRepository.list batching", () => {
  it("loads messages and sessions for many threads with batched queries", async () => {
    const messageCalls: unknown[] = [];
    const messages = [messageRow("t2", 1, "b2"), messageRow("t1", 0, "a1"), messageRow("t2", 0, "b1"), messageRow("t1", 1, "a2")];
    const db = {
      thread: { findMany: async () => [threadRow("t1"), threadRow("t2"), threadRow("t3")] },
      message: {
        findMany: async (args: { where: { threadId: string | { in: string[] } } }) => {
          messageCalls.push(args.where.threadId);
          const ids = typeof args.where.threadId === "string" ? [args.where.threadId] : args.where.threadId.in;
          return messages
            .filter((row) => ids.includes(row.threadId))
            .sort((a, b) => a.threadId.localeCompare(b.threadId) || a.position - b.position);
        }
      },
      runtimeSession: {
        findFirst: async () => {
          throw new Error("per-thread session lookup should not run");
        },
        findMany: async () => [
          { threadId: "t2", externalId: "newest" },
          { threadId: "t2", externalId: "older" }
        ]
      },
      $transaction: async () => {
        throw new Error("unused");
      }
    };

    const records = await new ThreadRepository(db as never).list(undefined, true);

    expect(messageCalls).toEqual([{ in: ["t1", "t2", "t3"] }]);
    expect(records.map((record) => record.id)).toEqual(["t1", "t2", "t3"]);
    expect(records[0].messages.map((item) => (item.message as { id: string }).id)).toEqual(["t1-0", "t1-1"]);
    expect(records[1].messages.map((item) => (item.message as { id: string }).id)).toEqual(["t2-0", "t2-1"]);
    expect(records[2].messages).toEqual([]);
    expect(records[1].sessionId).toBe("newest");
    expect(records[0].sessionId).toBeUndefined();
  });
});
