import { describe, expect, it } from "vitest";

import { ThreadCommentRepository } from "./thread-comment-repository.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

type FakeThreadCommentRow = {
  id: string;
  threadId: string;
  authorUserId: string | null;
  bodyMarkdown: string;
  mentionedUserIds: unknown;
  createdAt: Date;
  updatedAt: Date;
};

class FakeThreadCommentDb {
  private counter = 0;

  constructor(readonly rows: FakeThreadCommentRow[] = []) {}

  readonly threadComment = {
    findMany: async ({
      where,
      orderBy
    }: {
      where: { threadId: string };
      orderBy?: { createdAt?: "asc" | "desc" };
    }) => {
      const rows = this.rows.filter((row) => row.threadId === where.threadId);
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeThreadCommentRow = {
        id: typeof data.id === "string" ? data.id : `thread-comment-${++this.counter}`,
        threadId: typeof data.threadId === "string" ? data.threadId : "",
        authorUserId: typeof data.authorUserId === "string" ? data.authorUserId : null,
        bodyMarkdown: typeof data.bodyMarkdown === "string" ? data.bodyMarkdown : "",
        mentionedUserIds: clone(data.mentionedUserIds),
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.rows.push(row);
      return clone(row);
    }
  };

  async $transaction<T>(callback: (tx: FakeThreadCommentDb) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

describe("ThreadCommentRepository", () => {
  it("stores flat comments in created order with mentioned users", async () => {
    const repository = new ThreadCommentRepository(new FakeThreadCommentDb() as never);

    await repository.create({
      threadId: "thread-1",
      authorUserId: "user-1",
      bodyMarkdown: "hello @u2",
      mentionedUserIds: ["user-2"]
    });

    const comments = await repository.listForThread("thread-1");

    expect(comments).toHaveLength(1);
    expect(comments[0]?.mentionedUserIds).toEqual(["user-2"]);
    expect(comments[0]?.bodyMarkdown).toBe("hello @u2");
  });

  it("returns comments newest-last", async () => {
    const db = new FakeThreadCommentDb([
      {
        id: "comment-2",
        threadId: "thread-1",
        authorUserId: "user-2",
        bodyMarkdown: "second",
        mentionedUserIds: [],
        createdAt: new Date("2026-03-30T00:01:00Z"),
        updatedAt: new Date("2026-03-30T00:01:00Z")
      },
      {
        id: "comment-1",
        threadId: "thread-1",
        authorUserId: "user-1",
        bodyMarkdown: "first",
        mentionedUserIds: ["user-2"],
        createdAt: new Date("2026-03-30T00:00:00Z"),
        updatedAt: new Date("2026-03-30T00:00:00Z")
      }
    ]);
    const repository = new ThreadCommentRepository(db as never);

    const comments = await repository.listForThread("thread-1");

    expect(comments.map((comment) => comment.bodyMarkdown)).toEqual(["first", "second"]);
    expect(comments[0]?.mentionedUserIds).toEqual(["user-2"]);
  });
});
