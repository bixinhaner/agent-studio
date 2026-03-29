import { describe, expect, it } from "vitest";

import {
  ResourcePolicyRepository,
  type ResourcePolicyEffect,
  type ResourcePolicyResourceType,
  type ResourcePolicySubjectType
} from "../persistence/resource-policy-repository.js";
import { PolicyService } from "./policy-service.js";

type ExtendedResourceType = "workspace" | "knowledge_set" | "agent_mode" | "skill_package" | "run_profile";

type FakePolicyRow = {
  id: string;
  organizationId: string | null;
  subjectType: ResourcePolicySubjectType;
  subjectId: string;
  resourceType: ResourcePolicyResourceType;
  resourceId: string;
  effect: ResourcePolicyEffect;
  createdAt: Date;
  updatedAt: Date;
};

class FakeResourcePolicyDb {
  readonly supportedResourceTypes = new Set<ExtendedResourceType>([
    "workspace",
    "knowledge_set",
    "agent_mode",
    "skill_package",
    "run_profile"
  ]);

  constructor(readonly rows: FakePolicyRow[] = []) {}

  readonly resourcePolicy = {
    findMany: async ({
      where,
      orderBy
    }: {
      where?: {
        resourceType?: ResourcePolicyResourceType;
        OR?: Array<{ subjectType: ResourcePolicySubjectType; subjectId: string }>;
      };
      orderBy?: { createdAt?: "asc" | "desc" };
    }) => {
      if (where?.resourceType && !this.supportedResourceTypes.has(where.resourceType as ExtendedResourceType)) {
        throw new Error(`unsupported resource type: ${where.resourceType}`);
      }
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
      where: {
        resourceType?: ResourcePolicyResourceType;
        OR?: Array<{ subjectType: ResourcePolicySubjectType; subjectId: string }>;
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
      const row: FakePolicyRow = {
        id: typeof data.id === "string" ? data.id : `policy-${this.rows.length + 1}`,
        organizationId: typeof data.organizationId === "string" ? data.organizationId : null,
        subjectType:
          data.subjectType === "role" || data.subjectType === "department" || data.subjectType === "user"
            ? data.subjectType
            : "user",
        subjectId: typeof data.subjectId === "string" ? data.subjectId : "",
        resourceType:
          data.resourceType === "workspace" ||
          data.resourceType === "knowledge_set" ||
          data.resourceType === "agent_mode" ||
          data.resourceType === "skill_package" ||
          data.resourceType === "run_profile"
            ? data.resourceType
            : "workspace",
        resourceId: typeof data.resourceId === "string" ? data.resourceId : "",
        effect: data.effect === "allow" || data.effect === "deny" ? data.effect : "allow",
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

  it.each([
    ["agent_mode", "mode-chat", "mode-code", "mode-review"],
    ["skill_package", "package-chat", "package-code", "package-review"],
    ["run_profile", "profile-chat", "profile-code", "profile-review"]
  ] as Array<[ExtendedResourceType, string, string, string]>)(
    "filters %s through role, department, and user policies",
    async (resourceType, allowedByRole, allowedByDepartment, deniedByUser) => {
      const { repository, service } = createPolicyServiceForTest();

      await repository.replacePolicies([
        {
          subjectType: "role",
          subjectId: "employee",
          resourceType,
          resourceId: allowedByRole,
          effect: "allow"
        },
        {
          subjectType: "department",
          subjectId: "dept-1",
          resourceType,
          resourceId: allowedByDepartment,
          effect: "allow"
        },
        {
          subjectType: "user",
          subjectId: "user-1",
          resourceType,
          resourceId: deniedByUser,
          effect: "deny"
        }
      ]);

      const visible = await service.filterAllowedResources({
        userId: "user-1",
        roleIds: ["employee"],
        departmentIds: ["dept-1"],
        resourceType,
        candidateIds: [allowedByRole, allowedByDepartment, deniedByUser]
      });

      expect(visible).toEqual([allowedByRole, allowedByDepartment]);
    }
  );

  it("replaces only the selected role subject and resource type group", async () => {
    const { repository, service } = createPolicyServiceForTest();

    await repository.replacePolicies([
      {
        subjectType: "role",
        subjectId: "role-ops",
        resourceType: "workspace",
        resourceId: "workspace-legacy",
        effect: "allow"
      },
      {
        subjectType: "role",
        subjectId: "role-ops",
        resourceType: "knowledge_set",
        resourceId: "knowledge-legacy",
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

    const replaced = await service.replaceSubjectPolicies({
      subjectType: "role",
      subjectId: "role-ops",
      resourceType: "workspace",
      policies: [{ resourceId: "workspace-rd", effect: "allow" }]
    });

    expect(replaced).toEqual([
      expect.objectContaining({
        subjectType: "role",
        subjectId: "role-ops",
        resourceType: "workspace",
        resourceId: "workspace-rd",
        effect: "allow"
      })
    ]);

    await expect(
      service.listSubjectPolicies({ subjectType: "role", subjectId: "role-ops", resourceType: "workspace" })
    ).resolves.toEqual([
      expect.objectContaining({
        resourceId: "workspace-rd"
      })
    ]);

    await expect(
      service.listSubjectPolicies({ subjectType: "role", subjectId: "role-ops", resourceType: "knowledge_set" })
    ).resolves.toEqual([
      expect.objectContaining({
        resourceId: "knowledge-legacy"
      })
    ]);

    await expect(
      service.listSubjectPolicies({ subjectType: "user", subjectId: "user-1", resourceType: "workspace" })
    ).resolves.toEqual([
      expect.objectContaining({
        resourceId: "workspace-user"
      })
    ]);
  });
});

function createPolicyServiceForTest(): {
  repository: ResourcePolicyRepository;
  service: PolicyService;
} {
  const db = new FakeResourcePolicyDb();
  const repository = new ResourcePolicyRepository(db);

  return {
    repository,
    service: new PolicyService(repository)
  };
}
