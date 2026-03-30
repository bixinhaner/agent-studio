import { describe, expect, it } from "vitest";

import { ThreadShareRepository } from "./thread-share-repository.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

type FakeThreadShareRow = {
  id: string;
  threadId: string;
  subjectType: string;
  subjectId: string;
  permissionLevel: string;
  sharedByUserId: string | null;
  revokedByUserId: string | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

class FakeThreadShareDb {
  private counter = 0;

  constructor(readonly rows: FakeThreadShareRow[] = []) {}

  readonly threadShare = {
    findMany: async ({
      where,
      orderBy
    }: {
      where?: { threadId?: string; revokedAt?: null; subjectType?: string; subjectId?: string };
      orderBy?: { createdAt?: "asc" | "desc" };
    } = {}) => {
      const rows = this.rows.filter((row) => {
        if (where?.threadId && row.threadId !== where.threadId) return false;
        if (where?.revokedAt === null && row.revokedAt !== null) return false;
        if (where?.subjectType && row.subjectType !== where.subjectType) return false;
        if (where?.subjectId && row.subjectId !== where.subjectId) return false;
        return true;
      });
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeThreadShareRow = {
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

describe("ThreadShareRepository", () => {
  it("lists effective direct and department shares for a user", async () => {
    const db = new FakeThreadShareDb();
    const repository = new ThreadShareRepository(db as never);

    await repository.replaceForThread("thread-1", [
      { subjectType: "user", subjectId: "user-1", permissionLevel: "read_comment", sharedByUserId: "owner-1" },
      { subjectType: "department", subjectId: "dept-1", permissionLevel: "read_comment", sharedByUserId: "owner-1" }
    ]);

    const effective = await repository.listEffectiveForUser({
      threadId: "thread-1",
      userId: "user-1",
      departmentIds: ["dept-1"]
    });

    expect(effective).toHaveLength(2);
    expect(effective.map((share) => `${share.subjectType}:${share.subjectId}`)).toEqual([
      "user:user-1",
      "department:dept-1"
    ]);
  });

  it("revokes previously active shares when a thread is replaced", async () => {
    const db = new FakeThreadShareDb([
      {
        id: "share-1",
        threadId: "thread-1",
        subjectType: "user",
        subjectId: "user-old",
        permissionLevel: "read_comment",
        sharedByUserId: "owner-1",
        revokedByUserId: null,
        revokedAt: null,
        createdAt: new Date("2026-03-30T00:00:00Z"),
        updatedAt: new Date("2026-03-30T00:00:00Z")
      }
    ]);
    const repository = new ThreadShareRepository(db as never);

    const current = await repository.replaceForThread(
      "thread-1",
      [{ subjectType: "user", subjectId: "user-new", permissionLevel: "read_comment", sharedByUserId: "owner-1" }],
      "owner-2"
    );

    expect(current).toHaveLength(1);
    expect(current[0]?.subjectId).toBe("user-new");
    expect(db.rows.find((row) => row.id === "share-1")?.revokedAt).toBeInstanceOf(Date);
    expect(db.rows.find((row) => row.id === "share-1")?.revokedByUserId).toBe("owner-2");
    expect(await repository.listForThread("thread-1")).toHaveLength(1);
  });

  it("rejects invalid subject types", async () => {
    const repository = new ThreadShareRepository(new FakeThreadShareDb() as never);

    await expect(
      repository.replaceForThread("thread-1", [
        { subjectType: "team" as never, subjectId: "dept-1", permissionLevel: "read_comment", sharedByUserId: "owner-1" }
      ])
    ).rejects.toThrow("thread share subjectType must be user or department");
  });
});
