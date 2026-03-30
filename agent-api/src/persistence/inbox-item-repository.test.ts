import { describe, expect, it } from "vitest";

import { InboxItemRepository } from "./inbox-item-repository.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

type FakeInboxItemRow = {
  id: string;
  userId: string;
  eventType: string;
  category: string;
  title: string;
  body: string;
  status: string;
  threadId: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  sourceActorUserId: string | null;
  payload: unknown;
  readAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

class FakeInboxItemDb {
  private counter = 0;

  constructor(readonly rows: FakeInboxItemRow[] = []) {}

  readonly inboxItem = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeInboxItemRow = {
        id: typeof data.id === "string" ? data.id : `inbox-item-${++this.counter}`,
        userId: typeof data.userId === "string" ? data.userId : "",
        eventType: typeof data.eventType === "string" ? data.eventType : "",
        category: typeof data.category === "string" ? data.category : "",
        title: typeof data.title === "string" ? data.title : "",
        body: typeof data.body === "string" ? data.body : "",
        status: typeof data.status === "string" ? data.status : "unread",
        threadId: typeof data.threadId === "string" ? data.threadId : null,
        relatedEntityType: typeof data.relatedEntityType === "string" ? data.relatedEntityType : null,
        relatedEntityId: typeof data.relatedEntityId === "string" ? data.relatedEntityId : null,
        sourceActorUserId: typeof data.sourceActorUserId === "string" ? data.sourceActorUserId : null,
        payload: clone(data.payload),
        readAt: data.readAt instanceof Date ? data.readAt : null,
        archivedAt: data.archivedAt instanceof Date ? data.archivedAt : null,
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.rows.push(row);
      return clone(row);
    },
    findMany: async ({
      where,
      orderBy
    }: {
      where?: { userId?: string };
      orderBy?: { createdAt?: "asc" | "desc" };
    } = {}) => {
      const rows = this.rows.filter((row) => (where?.userId ? row.userId === where.userId : true));
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      const row = this.rows.find((item) => item.id === where.id);
      return row ? clone(row) : null;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.rows.find((item) => item.id === where.id);
      if (!row) throw new Error("inbox item not found");
      Object.assign(row, clone(data));
      row.updatedAt = data.updatedAt instanceof Date ? data.updatedAt : new Date();
      return clone(row);
    }
  };

  async $transaction<T>(callback: (tx: FakeInboxItemDb) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

describe("InboxItemRepository", () => {
  it("updates inbox item read/archive states", async () => {
    const repository = new InboxItemRepository(new FakeInboxItemDb() as never);

    const item = await repository.create({
      userId: "user-1",
      eventType: "thread.shared",
      category: "collaboration",
      title: "shared",
      body: "body"
    });

    await repository.markRead(item.id, "user-1");
    await repository.archive(item.id, "user-1");

    const stored = await repository.getForUser(item.id, "user-1");

    expect(stored?.status).toBe("archived");
    expect(stored?.readAt).toEqual(expect.any(String));
    expect((await repository.listForUser("user-1"))[0]?.id).toBe(item.id);
  });

  it("restores an archived item to unread state", async () => {
    const repository = new InboxItemRepository(
      new FakeInboxItemDb([
        {
          id: "item-1",
          userId: "user-1",
          eventType: "thread.comment_added",
          category: "collaboration",
          title: "comment",
          body: "hello",
          status: "archived",
          threadId: null,
          relatedEntityType: null,
          relatedEntityId: null,
          sourceActorUserId: null,
          payload: null,
          readAt: new Date("2026-03-30T00:00:00Z"),
          archivedAt: new Date("2026-03-30T00:01:00Z"),
          createdAt: new Date("2026-03-30T00:00:00Z"),
          updatedAt: new Date("2026-03-30T00:01:00Z")
        }
      ]) as never
    );

    const updated = await repository.markUnread("item-1", "user-1");

    expect(updated.status).toBe("unread");
    expect(updated.readAt).toBeUndefined();
    expect(updated.archivedAt).toBeUndefined();
  });
});
