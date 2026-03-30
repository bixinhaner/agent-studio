import { describe, expect, it } from "vitest";

import { AlertEventRecord } from "../persistence/alert-event-repository.js";
import { InboxItemRepository } from "../persistence/inbox-item-repository.js";
import { InboxProjectionService } from "./inbox-projection-service.js";

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

describe("InboxProjectionService", () => {
  it("creates collaboration inbox items for each unique recipient except the actor", async () => {
    const inbox = new InboxItemRepository(new FakeInboxDb() as never);
    const service = new InboxProjectionService({ inbox });

    await service.projectCollaborationEvent({
      eventType: "thread.shared",
      actorUserId: "owner-1",
      recipientUserIds: ["user-1", "user-1", "owner-1", "user-2"],
      threadId: "thread-1",
      title: "Thread shared",
      body: "Owner shared a thread",
      relatedEntityType: "thread",
      relatedEntityId: "thread-1",
      payload: { permissionLevel: "read_comment" }
    });

    expect((await inbox.listForUser("user-1")).map((item) => item.eventType)).toEqual(["thread.shared"]);
    expect((await inbox.listForUser("user-2")).map((item) => item.eventType)).toEqual(["thread.shared"]);
    expect(await inbox.listForUser("owner-1")).toHaveLength(0);
  });

  it("projects alert events into inbox items for explicit recipients", async () => {
    const inbox = new InboxItemRepository(new FakeInboxDb() as never);
    const service = new InboxProjectionService({ inbox });

    const event: AlertEventRecord = {
      id: "alert-1",
      organizationId: "org-1",
      alertRuleId: "rule-1",
      scopeType: "department",
      scopeId: "dept-rd",
      severity: "warning",
      status: "open",
      title: "Quota threshold exceeded",
      detail: "Cost exceeded threshold",
      payload: { metricType: "internal_cost" },
      createdAt: new Date("2026-03-31T00:00:00Z").toISOString(),
      updatedAt: new Date("2026-03-31T00:00:00Z").toISOString()
    };

    await service.projectAlertEvent({
      event,
      recipientUserIds: ["user-1", "user-2", "user-1"]
    });

    expect((await inbox.listForUser("user-1"))[0]).toMatchObject({
      category: "alert",
      eventType: "alert.opened",
      relatedEntityType: "alert_event",
      relatedEntityId: "alert-1"
    });
    expect(await inbox.listForUser("user-2")).toHaveLength(1);
  });

  it("fans out department security alerts by department audience even when payload.userId exists", async () => {
    const inbox = new InboxItemRepository(new FakeInboxDb() as never);
    const service = new InboxProjectionService({
      inbox,
      alerts: {
        listUserIdsForDepartment: async (departmentId) => (departmentId === "dept-rd" ? ["user-1", "user-2"] : [])
      }
    });

    const event: AlertEventRecord = {
      id: "alert-2",
      organizationId: "org-1",
      alertRuleId: "rule-1",
      scopeType: "department",
      scopeId: "dept-rd",
      severity: "warning",
      status: "open",
      title: "Denied resource access detected",
      detail: "Access denied",
      payload: { category: "resource_access_denied", userId: "actor-1" },
      createdAt: new Date("2026-03-31T00:00:00Z").toISOString(),
      updatedAt: new Date("2026-03-31T00:00:00Z").toISOString()
    };

    await service.projectAlertEvent({ event });

    expect(await inbox.listForUser("actor-1")).toHaveLength(0);
    expect(await inbox.listForUser("user-1")).toHaveLength(1);
    expect(await inbox.listForUser("user-2")).toHaveLength(1);
  });

  it("fans out platform security alerts to the platform audience", async () => {
    const inbox = new InboxItemRepository(new FakeInboxDb() as never);
    const service = new InboxProjectionService({
      inbox,
      alerts: {
        listAllUserIds: async () => ["user-1", "user-2", "user-3"]
      }
    });

    const event: AlertEventRecord = {
      id: "alert-3",
      organizationId: "org-1",
      alertRuleId: "rule-1",
      scopeType: "platform",
      scopeId: "platform",
      severity: "critical",
      status: "open",
      title: "Repeated permission denial detected",
      detail: "Denied repeatedly",
      payload: { category: "permission_denial_pattern", userId: "actor-1" },
      createdAt: new Date("2026-03-31T00:00:00Z").toISOString(),
      updatedAt: new Date("2026-03-31T00:00:00Z").toISOString()
    };

    await service.projectAlertEvent({ event });

    expect(await inbox.listForUser("actor-1")).toHaveLength(0);
    expect(await inbox.listForUser("user-1")).toHaveLength(1);
    expect(await inbox.listForUser("user-2")).toHaveLength(1);
    expect(await inbox.listForUser("user-3")).toHaveLength(1);
  });
});
