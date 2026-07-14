import { describe, expect, it, vi } from "vitest";

import { SecurityDomainConflictError, SecurityDomainService } from "./service.js";

function createDb(domains: Array<Record<string, unknown>>) {
  const createMany = vi.fn(async () => ({ count: 0 }));
  const updateMany = vi.fn(async () => ({ count: 0 }));
  const tx = {
    securityDomain: {
      findMany: vi.fn(async (args: { where?: { status?: string }; select?: unknown }) => {
        if (args.select) return domains.map((domain) => ({ id: domain.id, organizationId: domain.organizationId }));
        return args.where?.status === "active" ? domains.filter((domain) => domain.status === "active") : domains;
      })
    },
    department: {
      findMany: vi.fn(async () => [{ id: "dept-finance", parentDepartmentId: null }])
    },
    departmentMembership: {
      findMany: vi.fn(async () => [{ userId: "user-1", departmentId: "dept-finance" }])
    },
    user: {
      findMany: vi.fn(async () => [{ id: "user-1" }])
    },
    securityDomainMember: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany
    },
    thread: {
      updateMany
    }
  };
  const db = {
    ...tx,
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
  };
  return { db, createMany, updateMany };
}

describe("SecurityDomainService", () => {
  it("materializes a department member for one active domain", async () => {
    const { db, createMany, updateMany } = createDb([
      {
        id: "domain-finance",
        organizationId: "org-1",
        name: "财务保密域",
        status: "active",
        createdAt: new Date(),
        rules: [
          {
            id: "rule-1",
            subjectType: "department",
            subjectId: "dept-finance",
            includeChildren: true,
            createdAt: new Date()
          }
        ]
      }
    ]);

    await new SecurityDomainService(db as never).refresh("org-1");

    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          securityDomainId: "domain-finance",
          userId: "user-1",
          sourceType: "department",
          sourceId: "dept-finance"
        }
      ]
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        userId: { in: ["user-1"] },
        channel: "portal",
        securityDomainId: null
      },
      data: { securityDomainId: "domain-finance" }
    });
  });

  it("rejects a user resolved into two active domains", async () => {
    const rule = {
      id: "rule-1",
      subjectType: "department",
      subjectId: "dept-finance",
      includeChildren: true,
      createdAt: new Date()
    };
    const { db } = createDb([
      {
        id: "domain-a",
        organizationId: "org-1",
        name: "保密域 A",
        status: "active",
        createdAt: new Date(),
        rules: [rule]
      },
      {
        id: "domain-b",
        organizationId: "org-1",
        name: "保密域 B",
        status: "active",
        createdAt: new Date(),
        rules: [{ ...rule, id: "rule-2" }]
      }
    ]);

    await expect(new SecurityDomainService(db as never).refresh("org-1")).rejects.toBeInstanceOf(
      SecurityDomainConflictError
    );
  });
});
