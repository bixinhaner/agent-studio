import { describe, expect, it, vi } from "vitest";

import { InboxItemRepository } from "../persistence/inbox-item-repository.js";
import { BroadcastRepository } from "../persistence/broadcast-repository.js";
import { BroadcastService } from "./broadcast-service.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

class FakeInboxDb {
  private counter = 0;

  constructor(readonly rows: Array<Record<string, unknown>> = []) {}

  readonly inboxItem = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row = {
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
    findMany: async ({ where, orderBy }: { where?: { userId?: string }; orderBy?: { createdAt?: "asc" | "desc" } } = {}) => {
      const rows = this.rows.filter((row) => (where?.userId ? row.userId === where.userId : true)) as Array<Record<string, unknown> & { createdAt: Date }>;
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

  async $transaction<T>(callback: (tx: FakeInboxDb) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

class FakeBroadcastDb {
  private messageCounter = 0;
  private targetCounter = 0;

  constructor(readonly messages: Array<Record<string, unknown>> = [], readonly targets: Array<Record<string, unknown>> = []) {}

  readonly broadcastMessage = {
    findMany: async ({ where, orderBy }: { where?: { status?: string }; orderBy?: { createdAt?: "asc" | "desc" } } = {}) => {
      const rows = this.messages.filter((item) => (where?.status ? item.status === where.status : true)) as Array<Record<string, unknown> & { createdAt: Date }>;
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
      const row = {
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
    findMany: async ({ where, orderBy }: { where: { broadcastId: string }; orderBy?: { createdAt?: "asc" | "desc" } }) => {
      const rows = this.targets.filter((item) => item.broadcastId === where.broadcastId) as Array<Record<string, unknown> & { createdAt: Date }>;
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
      const row = {
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

describe("BroadcastService", () => {
  it("publishes broadcasts into inbox items for resolved users and optionally sends DingTalk", async () => {
    const inbox = new InboxItemRepository(new FakeInboxDb() as never);
    const notifications = { dispatchBroadcast: vi.fn(async () => undefined) };
    const service = new BroadcastService({
      broadcasts: new BroadcastRepository(new FakeBroadcastDb() as never),
      inboxProjection: {
        projectCollaborationEvent: vi.fn(async (input) => {
          for (const userId of input.recipientUserIds) {
            await inbox.create({
              userId,
              eventType: input.eventType,
              category: "broadcast",
              title: input.title,
              body: input.body,
              relatedEntityType: input.relatedEntityType,
              relatedEntityId: input.relatedEntityId,
              sourceActorUserId: input.actorUserId,
              payload: input.payload
            });
          }
        })
      },
      recipientDirectory: {
        listAllUserIds: async () => ["all-user-1"],
        listUserIdsForDepartment: async (departmentId: string) => (departmentId === "dept-1" ? ["dept-user-1", "dept-user-2"] : []),
        listUserIdsForRole: async (roleId: string) => (roleId === "role-1" ? ["role-user-1", "dept-user-2"] : [])
      },
      notifications
    });

    const draft = await service.createDraft({
      actorUserId: "admin-1",
      title: "Heads up",
      bodyMarkdown: "Message",
      dingtalkDeliveryEnabled: true,
      targets: [
        { targetType: "department", targetId: "dept-1" },
        { targetType: "role", targetId: "role-1" }
      ]
    });
    await service.publish({ actorUserId: "admin-1", broadcastId: draft.id });

    expect((await inbox.listForUser("dept-user-1")).some((item) => item.category === "broadcast")).toBe(true);
    expect((await inbox.listForUser("dept-user-2"))).toHaveLength(1);
    expect((await inbox.listForUser("role-user-1"))).toHaveLength(1);
    expect(notifications.dispatchBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserIds: ["dept-user-1", "dept-user-2", "role-user-1"]
      })
    );
  });
});
