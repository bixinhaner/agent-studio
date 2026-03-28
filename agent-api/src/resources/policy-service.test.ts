import { describe, expect, it } from "vitest";

import { ResourcePolicyRepository } from "../persistence/resource-policy-repository.js";
import { PolicyService } from "./policy-service.js";

type FakePolicyRow = {
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
  constructor(readonly rows: FakePolicyRow[] = []) {}

  readonly resourcePolicy = {
    findMany: async ({ where, orderBy }: { where?: { resourceType?: string; OR?: Array<{ subjectType: string; subjectId: string }> }; orderBy?: { createdAt?: "asc" | "desc" } }) => {
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
      return structuredClone(rows);
    },
    deleteMany: async ({
      where
    }: {
      where: { resourceType?: string; OR?: Array<{ subjectType: string; subjectId: string }> };
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
      const row: FakePolicyRow = {
        id: typeof data.id === "string" ? data.id : `policy-${this.rows.length + 1}`,
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
      return structuredClone(row);
    }
  };

  async $transaction<T>(callback: (tx: FakeResourcePolicyDb) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

describe("PolicyService", () => {
  it("allows resources matched by role, department, and user scopes", async () => {
    const { repository, service } = createPolicyServiceForTest();

    await repository.replacePolicies([
      {
        subjectType: "role",
        subjectId: "employee",
        resourceType: "workspace",
        resourceId: "workspace-role",
        effect: "allow"
      },
      {
        subjectType: "department",
        subjectId: "dept-1",
        resourceType: "workspace",
        resourceId: "workspace-department",
        effect: "allow"
      },
      {
        subjectType: "user",
        subjectId: "user-1",
        resourceType: "workspace",
        resourceId: "workspace-user",
        effect: "allow"
      }
    ]);

    const visible = await service.filterAllowedResources({
      userId: "user-1",
      roleIds: ["employee"],
      departmentIds: ["dept-1"],
      resourceType: "workspace",
      candidateIds: ["workspace-role", "workspace-department", "workspace-user", "workspace-other"]
    });

    expect(visible).toEqual(["workspace-role", "workspace-department", "workspace-user"]);
  });

  it("lets deny override allow across scopes", async () => {
    const { repository, service } = createPolicyServiceForTest();

    await repository.replacePolicies([
      {
        subjectType: "role",
        subjectId: "employee",
        resourceType: "workspace",
        resourceId: "ws-1",
        effect: "allow"
      },
      {
        subjectType: "department",
        subjectId: "dept-1",
        resourceType: "workspace",
        resourceId: "ws-1",
        effect: "allow"
      },
      {
        subjectType: "user",
        subjectId: "user-1",
        resourceType: "workspace",
        resourceId: "ws-1",
        effect: "deny"
      }
    ]);

    const visible = await service.filterAllowedResources({
      userId: "user-1",
      roleIds: ["employee"],
      departmentIds: ["dept-1"],
      resourceType: "workspace",
      candidateIds: ["ws-1"]
    });

    expect(visible).toEqual([]);
  });

  it("evaluates knowledge-set access independently from workspace policies", async () => {
    const { repository, service } = createPolicyServiceForTest();

    await repository.replacePolicies([
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
        resourceType: "knowledge_set",
        resourceId: "knowledge-set-1",
        effect: "allow"
      }
    ]);

    const visible = await service.filterAllowedResources({
      userId: "user-1",
      roleIds: ["employee"],
      departmentIds: [],
      resourceType: "knowledge_set",
      candidateIds: ["knowledge-set-1", "workspace-1"]
    });

    expect(visible).toEqual(["knowledge-set-1"]);
  });
});

function createPolicyServiceForTest(): {
  repository: ResourcePolicyRepository;
  service: PolicyService;
} {
  const db = new FakeResourcePolicyDb();
  const repository = new ResourcePolicyRepository(db as never);

  return {
    repository,
    service: new PolicyService(repository)
  };
}
