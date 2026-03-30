import { describe, expect, it } from "vitest";

import { ThreadCollaborationRepository } from "./thread-collaboration-repository.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

type FakeThreadAssignmentRow = {
  id: string;
  threadId: string;
  ownerUserId: string;
  assignedByUserId: string | null;
  assignedAt: Date;
  updatedAt: Date;
};

type FakeThreadFollowerRow = {
  id: string;
  threadId: string;
  userId: string;
  addedByUserId: string | null;
  createdAt: Date;
};

type FakeKnowledgeCaptureMarkRow = {
  id: string;
  threadId: string;
  status: string;
  markedByUserId: string | null;
  markedAt: Date;
  note: string | null;
  updatedAt: Date;
};

class FakeThreadCollaborationDb {
  private assignmentCounter = 0;
  private followerCounter = 0;
  private captureCounter = 0;

  constructor(
    readonly assignments: FakeThreadAssignmentRow[] = [],
    readonly followers: FakeThreadFollowerRow[] = [],
    readonly captureMarks: FakeKnowledgeCaptureMarkRow[] = []
  ) {}

  readonly threadAssignment = {
    findUnique: async ({ where }: { where: { threadId: string } }) => {
      const row = this.assignments.find((item) => item.threadId === where.threadId);
      return row ? clone(row) : null;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeThreadAssignmentRow = {
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
    findMany: async ({
      where,
      orderBy
    }: {
      where: { threadId: string };
      orderBy?: { createdAt?: "asc" | "desc" };
    }) => {
      const rows = this.followers.filter((item) => item.threadId === where.threadId);
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
      const row: FakeThreadFollowerRow = {
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
      const row: FakeKnowledgeCaptureMarkRow = {
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

describe("ThreadCollaborationRepository", () => {
  it("tracks assignment, followers, and capture state for a thread", async () => {
    const repository = new ThreadCollaborationRepository(new FakeThreadCollaborationDb() as never);

    const assignment = await repository.setAssignment({
      threadId: "thread-1",
      ownerUserId: "user-1",
      assignedByUserId: "admin-1"
    });
    const followers = await repository.replaceFollowers("thread-1", ["user-2", "user-2", "user-3"], "admin-1");
    const captureMark = await repository.setCaptureMark({
      threadId: "thread-1",
      status: "pending_capture",
      markedByUserId: "admin-1",
      note: "capture later"
    });
    const state = await repository.getState("thread-1");

    expect(assignment.ownerUserId).toBe("user-1");
    expect(followers.map((follower) => follower.userId)).toEqual(["user-2", "user-3"]);
    expect(captureMark?.status).toBe("pending_capture");
    expect(state.assignment?.ownerUserId).toBe("user-1");
    expect(state.followers).toHaveLength(2);
    expect(state.captureMark?.note).toBe("capture later");
  });

  it("clears a capture mark when requested", async () => {
    const repository = new ThreadCollaborationRepository(
      new FakeThreadCollaborationDb(
        [],
        [],
        [
          {
            id: "capture-mark-1",
            threadId: "thread-1",
            status: "pending_capture",
            markedByUserId: "admin-1",
            markedAt: new Date("2026-03-30T00:00:00Z"),
            note: "capture later",
            updatedAt: new Date("2026-03-30T00:00:00Z")
          }
        ]
      ) as never
    );

    const cleared = await repository.setCaptureMark(null, "thread-1");

    expect(cleared).toBeNull();
    expect((await repository.getState("thread-1")).captureMark).toBeNull();
  });
});
