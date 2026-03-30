import { describe, expect, it, vi } from "vitest";

import { InboxItemRepository } from "../persistence/inbox-item-repository.js";
import { ThreadCollaborationRepository } from "../persistence/thread-collaboration-repository.js";
import { ThreadCommentRepository } from "../persistence/thread-comment-repository.js";
import type { ThreadRecord } from "../persistence/thread-repository.js";
import { ThreadShareRepository } from "../persistence/thread-share-repository.js";
import { ThreadCollaborationService } from "./thread-collaboration-service.js";

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

class FakeThreadShareDb {
  private counter = 0;

  constructor(readonly rows: Array<Record<string, unknown>> = []) {}

  readonly threadShare = {
    findMany: async ({ where, orderBy }: { where?: { threadId?: string; revokedAt?: null }; orderBy?: { createdAt?: "asc" | "desc" } } = {}) => {
      const rows = this.rows.filter((row) => {
        if (where?.threadId && row.threadId !== where.threadId) return false;
        if (where?.revokedAt === null && row.revokedAt !== null) return false;
        return true;
      }) as Array<Record<string, unknown> & { createdAt: Date }>;
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row = {
        id: typeof data.id === "string" ? data.id : `thread-share-${++this.counter}`,
        threadId: typeof data.threadId === "string" ? data.threadId : "",
        subjectType: typeof data.subjectType === "string" ? data.subjectType : "",
        subjectId: typeof data.subjectId === "string" ? data.subjectId : "",
        permissionLevel: typeof data.permissionLevel === "string" ? data.permissionLevel : "",
        sharedByUserId: typeof data.sharedByUserId === "string" ? data.sharedByUserId : null,
        revokedByUserId: typeof data.revokedByUserId === "string" ? data.revokedByUserId : null,
        revokedAt: data.revokedAt instanceof Date ? data.revokedAt : null,
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.rows.push(row);
      return clone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.rows.find((item) => item.id === where.id);
      if (!row) throw new Error("thread share not found");
      Object.assign(row, clone(data));
      row.updatedAt = data.updatedAt instanceof Date ? data.updatedAt : new Date();
      return clone(row);
    }
  };

  async $transaction<T>(callback: (tx: FakeThreadShareDb) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

class FakeThreadCommentDb {
  private counter = 0;

  constructor(readonly rows: Array<Record<string, unknown>> = []) {}

  readonly threadComment = {
    findMany: async ({ where, orderBy }: { where: { threadId: string }; orderBy?: { createdAt?: "asc" | "desc" } }) => {
      const rows = this.rows.filter((row) => row.threadId === where.threadId) as Array<Record<string, unknown> & { createdAt: Date }>;
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row = {
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

class FakeThreadCollaborationDb {
  private assignmentCounter = 0;
  private followerCounter = 0;
  private captureCounter = 0;

  constructor(
    readonly assignments: Array<Record<string, unknown>> = [],
    readonly followers: Array<Record<string, unknown>> = [],
    readonly captureMarks: Array<Record<string, unknown>> = []
  ) {}

  readonly threadAssignment = {
    findUnique: async ({ where }: { where: { threadId: string } }) => {
      const row = this.assignments.find((item) => item.threadId === where.threadId);
      return row ? clone(row) : null;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row = {
        id: typeof data.id === "string" ? data.id : `thread-assignment-${++this.assignmentCounter}`,
        threadId: typeof data.threadId === "string" ? data.threadId : "",
        ownerUserId: typeof data.ownerUserId === "string" ? data.ownerUserId : "",
        assignedByUserId: typeof data.assignedByUserId === "string" ? data.assignedByUserId : null,
        assignedAt: data.assignedAt instanceof Date ? data.assignedAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.assignments.push(row);
      return clone(row);
    },
    update: async ({ where, data }: { where: { threadId: string }; data: Record<string, unknown> }) => {
      const row = this.assignments.find((item) => item.threadId === where.threadId);
      if (!row) throw new Error("thread assignment not found");
      Object.assign(row, clone(data));
      row.updatedAt = data.updatedAt instanceof Date ? data.updatedAt : new Date();
      return clone(row);
    }
  };

  readonly threadFollower = {
    findMany: async ({ where, orderBy }: { where: { threadId: string }; orderBy?: { createdAt?: "asc" | "desc" } }) => {
      const rows = this.followers.filter((item) => item.threadId === where.threadId) as Array<Record<string, unknown> & { createdAt: Date }>;
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    deleteMany: async ({ where }: { where: { threadId: string } }) => {
      const before = this.followers.length;
      this.followers.splice(0, this.followers.length, ...this.followers.filter((item) => item.threadId !== where.threadId));
      return { count: before - this.followers.length };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = {
        id: typeof data.id === "string" ? data.id : `thread-follower-${++this.followerCounter}`,
        threadId: typeof data.threadId === "string" ? data.threadId : "",
        userId: typeof data.userId === "string" ? data.userId : "",
        addedByUserId: typeof data.addedByUserId === "string" ? data.addedByUserId : null,
        createdAt: data.createdAt instanceof Date ? data.createdAt : new Date()
      };
      this.followers.push(row);
      return clone(row);
    }
  };

  readonly knowledgeCaptureMark = {
    findUnique: async ({ where }: { where: { threadId: string } }) => {
      const row = this.captureMarks.find((item) => item.threadId === where.threadId);
      return row ? clone(row) : null;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row = {
        id: typeof data.id === "string" ? data.id : `capture-mark-${++this.captureCounter}`,
        threadId: typeof data.threadId === "string" ? data.threadId : "",
        status: typeof data.status === "string" ? data.status : "",
        markedByUserId: typeof data.markedByUserId === "string" ? data.markedByUserId : null,
        markedAt: data.markedAt instanceof Date ? data.markedAt : now,
        note: typeof data.note === "string" ? data.note : null,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.captureMarks.push(row);
      return clone(row);
    },
    update: async ({ where, data }: { where: { threadId: string }; data: Record<string, unknown> }) => {
      const row = this.captureMarks.find((item) => item.threadId === where.threadId);
      if (!row) throw new Error("knowledge capture mark not found");
      Object.assign(row, clone(data));
      row.updatedAt = data.updatedAt instanceof Date ? data.updatedAt : new Date();
      return clone(row);
    },
    delete: async ({ where }: { where: { threadId: string } }) => {
      const index = this.captureMarks.findIndex((item) => item.threadId === where.threadId);
      if (index < 0) throw new Error("knowledge capture mark not found");
      const [row] = this.captureMarks.splice(index, 1);
      return clone(row);
    }
  };

  async $transaction<T>(callback: (tx: FakeThreadCollaborationDb) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

function createService() {
  const inboxDb = new FakeInboxDb();
  const inbox = new InboxItemRepository(inboxDb as never);
  const shareDb = new FakeThreadShareDb();
  const collaborationDb = new FakeThreadCollaborationDb();
  const threadRecord: ThreadRecord = {
    id: "thread-1",
    userId: "owner-1",
    status: "regular",
    title: "Thread 1",
    model: "gpt-5",
    reasoningEffort: "medium",
    workspace: "default",
    createdAt: new Date("2026-03-31T00:00:00Z").toISOString(),
    updatedAt: new Date("2026-03-31T00:00:00Z").toISOString(),
    messages: [],
    feedback: []
  };
  const deps = {
    threads: {
      get: async (threadId: string) => (threadId === "thread-1" ? threadRecord : undefined)
    },
    shares: new ThreadShareRepository(shareDb as never),
    comments: new ThreadCommentRepository(new FakeThreadCommentDb() as never),
    collaboration: new ThreadCollaborationRepository(collaborationDb as never),
    inboxProjection: {
      projectCollaborationEvent: vi.fn(async (input) => {
        for (const userId of input.recipientUserIds) {
          await inbox.create({
            userId,
            eventType: input.eventType,
            category: "collaboration",
            title: input.title,
            body: input.body,
            threadId: input.threadId,
            relatedEntityType: input.relatedEntityType,
            relatedEntityId: input.relatedEntityId,
            sourceActorUserId: input.actorUserId,
            payload: input.payload
          });
        }
      })
    },
    directory: {
      listDepartmentIdsForUser: async (userId: string) => (userId === "user-2" ? ["dept-ops"] : []),
      listUserIdsForDepartment: async (departmentId: string) => (departmentId === "dept-ops" ? ["user-2", "user-4"] : []),
      ensureUsersExist: async () => undefined
    }
  };
  return {
    inbox,
    shareDb,
    collaborationDb,
    deps,
    service: new ThreadCollaborationService(deps)
  };
}

describe("ThreadCollaborationService", () => {
  it("allows shared users to comment but not continue runtime ownership", async () => {
    const { service } = createService();

    await service.replaceShares({
      actorUserId: "owner-1",
      threadId: "thread-1",
      shares: [{ subjectType: "user", subjectId: "user-2" }]
    });

    const summary = await service.getThreadCollaborationView({
      actorUserId: "user-2",
      departmentIds: [],
      threadId: "thread-1"
    });

    expect(summary.access.canRead).toBe(true);
    expect(summary.access.canComment).toBe(true);
    expect(summary.access.canRun).toBe(false);
    expect(summary.shares).toHaveLength(1);
  });

  it("creates inbox items for mentions, assignees, and followers", async () => {
    const { inbox, service } = createService();

    await service.replaceShares({
      actorUserId: "owner-1",
      threadId: "thread-1",
      shares: [{ subjectType: "user", subjectId: "user-2" }]
    });
    await service.addComment({
      actorUserId: "owner-1",
      threadId: "thread-1",
      bodyMarkdown: "ping @user-2",
      mentionedUserIds: ["user-2"]
    });
    await service.setAssignment({
      actorUserId: "owner-1",
      threadId: "thread-1",
      ownerUserId: "user-3",
      followerIds: ["user-2"]
    });

    expect((await inbox.listForUser("user-2")).map((item) => item.eventType)).toEqual(
      expect.arrayContaining(["thread.shared", "thread.mentioned", "thread.follower_added"])
    );
    expect((await inbox.listForUser("user-3")).map((item) => item.eventType)).toContain("thread.assigned");
  });

  it("filters mention notifications to users who can access the thread", async () => {
    const { inbox, service } = createService();

    await service.replaceShares({
      actorUserId: "owner-1",
      threadId: "thread-1",
      shares: [{ subjectType: "user", subjectId: "user-2" }]
    });

    await service.addComment({
      actorUserId: "owner-1",
      threadId: "thread-1",
      bodyMarkdown: "ping @user-2 and @user-9",
      mentionedUserIds: ["user-2", "user-9"]
    });

    expect((await inbox.listForUser("user-2")).map((item) => item.eventType)).toContain("thread.mentioned");
    expect(await inbox.listForUser("user-9")).toHaveLength(0);
  });

  it("includes the assigned owner in comment fanout even when they are not a follower", async () => {
    const { inbox, service } = createService();

    await service.setAssignment({
      actorUserId: "owner-1",
      threadId: "thread-1",
      ownerUserId: "user-3",
      followerIds: ["user-2"]
    });

    await service.addComment({
      actorUserId: "owner-1",
      threadId: "thread-1",
      bodyMarkdown: "owner update",
      mentionedUserIds: []
    });

    expect((await inbox.listForUser("user-3")).map((item) => item.eventType)).toEqual(
      expect.arrayContaining(["thread.assigned", "thread.comment_added"])
    );
  });

  it("only notifies newly added effective share recipients across share rewrites", async () => {
    const { inbox, service } = createService();

    await service.replaceShares({
      actorUserId: "owner-1",
      threadId: "thread-1",
      shares: [{ subjectType: "department", subjectId: "dept-ops" }]
    });
    await service.replaceShares({
      actorUserId: "owner-1",
      threadId: "thread-1",
      shares: [
        { subjectType: "department", subjectId: "dept-ops" },
        { subjectType: "user", subjectId: "user-2" }
      ]
    });
    await service.replaceShares({
      actorUserId: "owner-1",
      threadId: "thread-1",
      shares: [
        { subjectType: "department", subjectId: "dept-ops" },
        { subjectType: "user", subjectId: "user-4" }
      ]
    });

    expect((await inbox.listForUser("user-2")).map((item) => item.eventType)).toEqual(["thread.shared"]);
    expect((await inbox.listForUser("user-4")).map((item) => item.eventType)).toEqual(["thread.shared"]);
  });

  it("allows elevated admin collaboration rights without granting runtime ownership", async () => {
    const { deps } = createService();
    const adminService = new ThreadCollaborationService({
      ...deps,
      authorizer: {
        canReadThreadCollaboration: vi.fn(async ({ actorUserId }) => actorUserId === "admin-1"),
        canCommentThreadCollaboration: vi.fn(async () => false),
        canManageThreadCollaboration: vi.fn(async ({ actorUserId }) => actorUserId === "admin-1")
      }
    });

    const summary = await adminService.getThreadCollaborationView({
      actorUserId: "admin-1",
      departmentIds: [],
      threadId: "thread-1"
    });

    expect(summary.access.canRead).toBe(true);
    expect(summary.access.canComment).toBe(true);
    expect(summary.access.canRun).toBe(false);

    await expect(
      adminService.replaceShares({
        actorUserId: "admin-1",
        threadId: "thread-1",
        shares: [{ subjectType: "user", subjectId: "user-9" }]
      })
    ).resolves.toHaveLength(1);
  });

  it("does not let read-only elevated access comment or manage collaboration", async () => {
    const { deps } = createService();
    const readOnlyService = new ThreadCollaborationService({
      ...deps,
      authorizer: {
        canReadThreadCollaboration: vi.fn(async ({ actorUserId }) => actorUserId === "auditor-1"),
        canCommentThreadCollaboration: vi.fn(async () => false),
        canManageThreadCollaboration: vi.fn(async () => false)
      }
    });

    const summary = await readOnlyService.getThreadCollaborationView({
      actorUserId: "auditor-1",
      departmentIds: [],
      threadId: "thread-1"
    });

    expect(summary.access.canRead).toBe(true);
    expect(summary.access.canComment).toBe(false);
    expect(summary.access.canRun).toBe(false);

    await expect(
      readOnlyService.addComment({
        actorUserId: "auditor-1",
        threadId: "thread-1",
        bodyMarkdown: "cannot comment",
        mentionedUserIds: []
      })
    ).rejects.toThrow("thread collaboration access denied");

    await expect(
      readOnlyService.replaceShares({
        actorUserId: "auditor-1",
        threadId: "thread-1",
        shares: [{ subjectType: "user", subjectId: "user-9" }]
      })
    ).rejects.toThrow("thread collaboration access denied");
  });
});
