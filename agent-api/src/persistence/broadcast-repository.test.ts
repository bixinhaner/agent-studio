import { describe, expect, it } from "vitest";

import { BroadcastRepository } from "./broadcast-repository.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

type FakeBroadcastMessageRow = {
  id: string;
  title: string;
  bodyMarkdown: string;
  status: string;
  dingtalkDeliveryEnabled: boolean;
  createdByUserId: string | null;
  publishedAt: Date | null;
  publishedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type FakeBroadcastTargetRow = {
  id: string;
  broadcastId: string;
  targetType: string;
  targetId: string | null;
  createdAt: Date;
};

class FakeBroadcastDb {
  private messageCounter = 0;
  private targetCounter = 0;

  constructor(readonly messages: FakeBroadcastMessageRow[] = [], readonly targets: FakeBroadcastTargetRow[] = []) {}

  readonly broadcastMessage = {
    findMany: async ({
      where,
      orderBy
    }: {
      where?: { status?: string };
      orderBy?: { createdAt?: "asc" | "desc" };
    } = {}) => {
      const rows = this.messages.filter((item) => (where?.status ? item.status === where.status : true));
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      const row = this.messages.find((message) => message.id === where.id);
      return row ? clone(row) : null;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeBroadcastMessageRow = {
        id: typeof data.id === "string" ? data.id : `broadcast-${++this.messageCounter}`,
        title: typeof data.title === "string" ? data.title : "",
        bodyMarkdown: typeof data.bodyMarkdown === "string" ? data.bodyMarkdown : "",
        status: typeof data.status === "string" ? data.status : "draft",
        dingtalkDeliveryEnabled: typeof data.dingtalkDeliveryEnabled === "boolean" ? data.dingtalkDeliveryEnabled : false,
        createdByUserId: typeof data.createdByUserId === "string" ? data.createdByUserId : null,
        publishedAt: data.publishedAt instanceof Date ? data.publishedAt : null,
        publishedByUserId: typeof data.publishedByUserId === "string" ? data.publishedByUserId : null,
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.messages.push(row);
      return clone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.messages.find((message) => message.id === where.id);
      if (!row) throw new Error("broadcast not found");
      Object.assign(row, clone(data));
      row.updatedAt = data.updatedAt instanceof Date ? data.updatedAt : new Date();
      return clone(row);
    }
  };

  readonly broadcastTarget = {
    findMany: async ({
      where,
      orderBy
    }: {
      where: { broadcastId: string };
      orderBy?: { createdAt?: "asc" | "desc" };
    }) => {
      const rows = this.targets.filter((item) => item.broadcastId === where.broadcastId);
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    deleteMany: async ({ where }: { where: { broadcastId: string } }) => {
      const before = this.targets.length;
      this.targets.splice(0, this.targets.length, ...this.targets.filter((item) => item.broadcastId !== where.broadcastId));
      return { count: before - this.targets.length };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: FakeBroadcastTargetRow = {
        id: typeof data.id === "string" ? data.id : `broadcast-target-${++this.targetCounter}`,
        broadcastId: typeof data.broadcastId === "string" ? data.broadcastId : "",
        targetType: typeof data.targetType === "string" ? data.targetType : "",
        targetId: typeof data.targetId === "string" ? data.targetId : null,
        createdAt: data.createdAt instanceof Date ? data.createdAt : new Date()
      };
      this.targets.push(row);
      return clone(row);
    }
  };

  async $transaction<T>(callback: (tx: FakeBroadcastDb) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

describe("BroadcastRepository", () => {
  it("creates draft broadcasts and persists targets", async () => {
    const repository = new BroadcastRepository(new FakeBroadcastDb() as never);

    const draft = await repository.createDraft({
      title: "Heads up",
      bodyMarkdown: "Message body",
      createdByUserId: "admin-1",
      dingtalkDeliveryEnabled: true,
      targets: [
        { targetType: "department", targetId: "dept-1" },
        { targetType: "all_users" }
      ]
    });

    expect(draft.status).toBe("draft");
    expect(draft.targets).toHaveLength(2);
    expect(draft.dingtalkDeliveryEnabled).toBe(true);
  });

  it("publishes a draft broadcast after targets are set", async () => {
    const db = new FakeBroadcastDb();
    const repository = new BroadcastRepository(db as never);

    const draft = await repository.createDraft({
      title: "Heads up",
      bodyMarkdown: "Message body",
      createdByUserId: "admin-1",
      targets: [{ targetType: "department", targetId: "dept-1" }]
    });

    const updated = await repository.updateDraft({
      id: draft.id,
      bodyMarkdown: "Updated body",
      targets: [{ targetType: "role", targetId: "role-1" }]
    });
    const published = await repository.publish({ id: draft.id, publishedByUserId: "admin-2" });

    expect(updated.bodyMarkdown).toBe("Updated body");
    expect(updated.targets).toEqual([{ id: expect.any(String), broadcastId: draft.id, targetType: "role", targetId: "role-1", createdAt: expect.any(String) }]);
    expect(published.status).toBe("published");
    expect(published.publishedByUserId).toBe("admin-2");
    expect(published.publishedAt).toEqual(expect.any(String));
  });
});
