import { describe, expect, it } from "vitest";

import { ResourcePolicyRepository } from "./resource-policy-repository.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

type FakeResourcePolicyRow = {
  id: string;
  organizationId: string | null;
  subjectType: string;
  subjectId: string;
  resourceType: string;
  resourceId: string;
  effect: string;
  createdAt: Date;
  updatedAt: Date;
};

class FakeResourcePolicyDb {
  private counter = 0;

  constructor(readonly rows: FakeResourcePolicyRow[] = []) {}

  readonly resourcePolicy = {
    findMany: async ({
      where,
      orderBy
    }: {
      where?: {
        resourceType?: string;
        OR?: Array<{
          subjectType: string;
          subjectId: string;
        }>;
      };
      orderBy?: { createdAt?: "asc" | "desc" };
    }) => {
      const rows = this.rows.filter((item) => {
        if (where?.resourceType && item.resourceType !== where.resourceType) {
          return false;
        }
        if (where?.OR?.length) {
          return where.OR.some(
            (subject) => item.subjectType === subject.subjectType && item.subjectId === subject.subjectId
          );
        }
        return true;
      });
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    deleteMany: async ({
      where
    }: {
      where: {
        resourceType?: string;
        OR?: Array<{
          subjectType: string;
          subjectId: string;
        }>;
      };
    }) => {
      const before = this.rows.length;
      const remaining = this.rows.filter((item) => {
        if (where.resourceType && item.resourceType !== where.resourceType) {
          return true;
        }
        if (!where.OR?.length) {
          return false;
        }
        return !where.OR.some(
          (subject) => item.subjectType === subject.subjectType && item.subjectId === subject.subjectId
        );
      });
      this.rows.splice(0, this.rows.length, ...remaining);
      return { count: before - this.rows.length };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeResourcePolicyRow = {
        id: typeof data.id === "string" ? data.id : `policy-${++this.counter}`,
        organizationId: typeof data.organizationId === "string" ? data.organizationId : null,
        subjectType: typeof data.subjectType === "string" ? data.subjectType : "",
        subjectId: typeof data.subjectId === "string" ? data.subjectId : "",
        resourceType: typeof data.resourceType === "string" ? data.resourceType : "",
        resourceId: typeof data.resourceId === "string" ? data.resourceId : "",
        effect: typeof data.effect === "string" ? data.effect : "",
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.rows.push(row);
      return clone(row);
    }
  };

  async $transaction<T>(callback: (tx: FakeResourcePolicyDb) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

describe("ResourcePolicyRepository", () => {
  it("replaces policies for the given subject refs", async () => {
    const db = new FakeResourcePolicyDb([
      {
        id: "policy-existing-role",
        organizationId: null,
        subjectType: "role",
        subjectId: "employee",
        resourceType: "workspace",
        resourceId: "workspace-old",
        effect: "allow",
        createdAt: new Date("2026-03-27T00:00:00.000Z"),
        updatedAt: new Date("2026-03-27T00:00:00.000Z")
      },
      {
        id: "policy-other-subject",
        organizationId: null,
        subjectType: "user",
        subjectId: "user-2",
        resourceType: "workspace",
        resourceId: "workspace-2",
        effect: "deny",
        createdAt: new Date("2026-03-27T00:00:00.000Z"),
        updatedAt: new Date("2026-03-27T00:00:00.000Z")
      },
      {
        id: "policy-existing-knowledge-set",
        organizationId: null,
        subjectType: "role",
        subjectId: "employee",
        resourceType: "knowledge_set",
        resourceId: "knowledge-set-existing",
        effect: "allow",
        createdAt: new Date("2026-03-27T00:00:00.000Z"),
        updatedAt: new Date("2026-03-27T00:00:00.000Z")
      }
    ]);
    const repository = new ResourcePolicyRepository(db as never);

    const records = await repository.replacePolicies([
      {
        subjectType: "role",
        subjectId: "employee",
        resourceType: "workspace",
        resourceId: "workspace-1",
        effect: "allow"
      },
      {
        subjectType: "role",
        subjectId: "employee",
        resourceType: "workspace",
        resourceId: "workspace-3",
        effect: "deny"
      },
      {
        subjectType: "department",
        subjectId: "dept-1",
        resourceType: "knowledge_set",
        resourceId: "knowledge-set-1",
        effect: "allow"
      }
    ]);

    expect(records).toEqual([
      {
        id: expect.any(String),
        organizationId: undefined,
        subjectType: "role",
        subjectId: "employee",
        resourceType: "workspace",
        resourceId: "workspace-1",
        effect: "allow",
        createdAt: expect.any(String),
        updatedAt: expect.any(String)
      },
      {
        id: expect.any(String),
        organizationId: undefined,
        subjectType: "role",
        subjectId: "employee",
        resourceType: "workspace",
        resourceId: "workspace-3",
        effect: "deny",
        createdAt: expect.any(String),
        updatedAt: expect.any(String)
      },
      {
        id: expect.any(String),
        organizationId: undefined,
        subjectType: "department",
        subjectId: "dept-1",
        resourceType: "knowledge_set",
        resourceId: "knowledge-set-1",
        effect: "allow",
        createdAt: expect.any(String),
        updatedAt: expect.any(String)
      }
    ]);
    expect(db.rows).toHaveLength(4);
    expect(
      db.rows
        .filter((item) => item.subjectType === "role" && item.subjectId === "employee")
        .map((item) => `${item.resourceType}:${item.resourceId}:${item.effect}`)
    ).toEqual(["workspace:workspace-1:allow", "workspace:workspace-3:deny"]);
    expect(db.rows.find((item) => item.id === "policy-other-subject")).toBeDefined();
  });

  it("lists policies matching the requested subjects and resource type", async () => {
    const repository = new ResourcePolicyRepository(
      new FakeResourcePolicyDb([
        {
          id: "policy-1",
          organizationId: null,
          subjectType: "role",
          subjectId: "employee",
          resourceType: "workspace",
          resourceId: "workspace-1",
          effect: "allow",
          createdAt: new Date("2026-03-27T00:00:00.000Z"),
          updatedAt: new Date("2026-03-27T00:00:00.000Z")
        },
        {
          id: "policy-2",
          organizationId: null,
          subjectType: "department",
          subjectId: "dept-1",
          resourceType: "workspace",
          resourceId: "workspace-2",
          effect: "deny",
          createdAt: new Date("2026-03-28T00:00:00.000Z"),
          updatedAt: new Date("2026-03-28T00:00:00.000Z")
        },
        {
          id: "policy-3",
          organizationId: null,
          subjectType: "user",
          subjectId: "user-1",
          resourceType: "knowledge_set",
          resourceId: "knowledge-set-1",
          effect: "allow",
          createdAt: new Date("2026-03-29T00:00:00.000Z"),
          updatedAt: new Date("2026-03-29T00:00:00.000Z")
        }
      ]) as never
    );

    const records = await repository.listForSubjects({
      resourceType: "workspace",
      subjectRefs: [
        { subjectType: "department", subjectId: "dept-1" },
        { subjectType: "role", subjectId: "employee" },
        { subjectType: "user", subjectId: "user-1" }
      ]
    });

    expect(records.map((item) => item.id)).toEqual(["policy-1", "policy-2"]);
    expect(records.map((item) => item.effect)).toEqual(["allow", "deny"]);
  });
});
