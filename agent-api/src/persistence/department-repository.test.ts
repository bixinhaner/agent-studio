import { describe, expect, it } from "vitest";

import { DepartmentMembershipRepository } from "./department-membership-repository.js";
import { DepartmentRepository } from "./department-repository.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

type FakeDepartmentRow = {
  id: string;
  organizationId: string | null;
  externalId: string;
  name: string;
  parentDepartmentId: string | null;
  sortOrder: number;
  status: string | null;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type FakeDepartmentMembershipRow = {
  id: string;
  userId: string;
  departmentId: string;
  isPrimary: boolean;
  source: string;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

class FakeDepartmentDb {
  private departmentCounter = 0;
  private membershipCounter = 0;

  constructor(
    readonly departments: FakeDepartmentRow[] = [],
    readonly memberships: FakeDepartmentMembershipRow[] = []
  ) {}

  readonly department = {
    findUnique: async ({ where }: { where: { id?: string; externalId?: string } }) => {
      const row = this.departments.find((item) => {
        if (where.id) return item.id === where.id;
        if (where.externalId) return item.externalId === where.externalId;
        return false;
      });
      return row ? clone(row) : null;
    },
    findMany: async ({
      orderBy
    }: {
      orderBy?: { sortOrder?: "asc" | "desc"; createdAt?: "asc" | "desc" };
    } = {}) => {
      const rows = [...this.departments];
      rows.sort((left, right) => {
        if (orderBy?.sortOrder) {
          const diff = left.sortOrder - right.sortOrder;
          if (diff !== 0) return orderBy.sortOrder === "asc" ? diff : -diff;
        }
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeDepartmentRow = {
        id: typeof data.id === "string" ? data.id : `department-${++this.departmentCounter}`,
        organizationId: typeof data.organizationId === "string" ? data.organizationId : null,
        externalId: typeof data.externalId === "string" ? data.externalId : "",
        name: typeof data.name === "string" ? data.name : "",
        parentDepartmentId: typeof data.parentDepartmentId === "string" ? data.parentDepartmentId : null,
        sortOrder: typeof data.sortOrder === "number" ? data.sortOrder : 0,
        status: typeof data.status === "string" ? data.status : null,
        lastSyncedAt: data.lastSyncedAt instanceof Date ? data.lastSyncedAt : null,
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.departments.push(row);
      return clone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.departments.find((item) => item.id === where.id);
      if (!row) throw new Error("department not found");
      Object.assign(row, clone(data));
      row.updatedAt = data.updatedAt instanceof Date ? data.updatedAt : new Date();
      return clone(row);
    }
  };

  readonly departmentMembership = {
    findMany: async ({
      where,
      orderBy,
      select
    }: {
      where: { userId: string };
      orderBy?: { createdAt?: "asc" | "desc" };
      select?: { departmentId?: boolean };
    }) => {
      const rows = this.memberships.filter((item) => item.userId === where.userId);
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      if (select?.departmentId || select?.isPrimary) {
        return clone(
          rows.map((item) => ({
            departmentId: item.departmentId,
            isPrimary: item.isPrimary
          }))
        );
      }
      return clone(rows);
    },
    deleteMany: async ({ where }: { where: { userId: string; source?: string } }) => {
      const before = this.memberships.length;
      const remaining = this.memberships.filter((item) => {
        if (item.userId !== where.userId) return true;
        if (where.source && item.source !== where.source) return true;
        return false;
      });
      this.memberships.splice(0, this.memberships.length, ...remaining);
      return { count: before - this.memberships.length };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeDepartmentMembershipRow = {
        id: typeof data.id === "string" ? data.id : `membership-${++this.membershipCounter}`,
        userId: typeof data.userId === "string" ? data.userId : "",
        departmentId: typeof data.departmentId === "string" ? data.departmentId : "",
        isPrimary: typeof data.isPrimary === "boolean" ? data.isPrimary : false,
        source: typeof data.source === "string" ? data.source : "",
        lastSyncedAt: data.lastSyncedAt instanceof Date ? data.lastSyncedAt : null,
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.memberships.push(row);
      return clone(row);
    }
  };

  async $transaction<T>(callback: (tx: FakeDepartmentDb) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

describe("DepartmentRepository", () => {
  it("upserts a department tree and preserves parent-child links", async () => {
    const repository = new DepartmentRepository(new FakeDepartmentDb() as never);

    await repository.upsertMany([
      { externalId: "root", name: "总部", parentExternalId: null, sortOrder: 10, status: "active" },
      { externalId: "rd", name: "研发", parentExternalId: "root", sortOrder: 20, status: "active" }
    ]);

    const tree = await repository.listTree();
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({
      externalId: "root",
      name: "总部",
      children: [
        {
          externalId: "rd",
          name: "研发",
          children: []
        }
      ]
    });

    const root = await repository.getByExternalId("root");
    const child = await repository.getByExternalId("rd");
    expect(root).toBeTruthy();
    expect(child?.parentDepartmentId).toBe(root?.id);
  });
});

describe("DepartmentMembershipRepository", () => {
  it("replaces synced memberships for a user and keeps one primary record", async () => {
    const db = new FakeDepartmentDb([], [
      {
        id: "membership-old-sync",
        userId: "user-1",
        departmentId: "dept-old",
        isPrimary: true,
        source: "sync",
        lastSyncedAt: new Date("2026-03-28T00:00:00.000Z"),
        createdAt: new Date("2026-03-28T00:00:00.000Z"),
        updatedAt: new Date("2026-03-28T00:00:00.000Z")
      },
      {
        id: "membership-manual",
        userId: "user-1",
        departmentId: "dept-manual",
        isPrimary: false,
        source: "manual",
        lastSyncedAt: null,
        createdAt: new Date("2026-03-28T00:00:00.000Z"),
        updatedAt: new Date("2026-03-28T00:00:00.000Z")
      }
    ]);
    const repository = new DepartmentMembershipRepository(db as never);

    await repository.replaceSyncedMemberships({
      userId: "user-1",
      memberships: [
        { departmentId: "dept-a", isPrimary: false },
        { departmentId: "dept-b", isPrimary: true }
      ],
      syncedAt: new Date("2026-03-29T00:00:00.000Z")
    });

    expect(await repository.listForUser("user-1")).toEqual([
      { departmentId: "dept-manual", isPrimary: false },
      { departmentId: "dept-a", isPrimary: false },
      { departmentId: "dept-b", isPrimary: true }
    ]);
    expect(db.memberships.filter((item) => item.userId === "user-1" && item.isPrimary)).toHaveLength(1);
    expect(db.memberships.find((item) => item.id === "membership-manual")).toBeDefined();
    expect(
      db.memberships
        .filter((item) => item.userId === "user-1" && item.source === "sync")
        .map((item) => item.departmentId)
    ).toEqual(["dept-a", "dept-b"]);
  });

  it("rejects synced membership replacement when multiple primaries are provided", async () => {
    const repository = new DepartmentMembershipRepository(new FakeDepartmentDb() as never);

    await expect(
      repository.replaceSyncedMemberships({
        userId: "user-1",
        memberships: [
          { departmentId: "dept-a", isPrimary: true },
          { departmentId: "dept-b", isPrimary: true }
        ]
      })
    ).rejects.toThrow(/primary/i);
  });
});
