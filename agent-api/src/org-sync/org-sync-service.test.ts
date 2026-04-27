import { describe, expect, it, vi } from "vitest";

import type { NormalizedOrgSnapshot } from "./dingtalk-org-provider.js";
import { OrgSyncService } from "./org-sync-service.js";

function buildUserRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "login-user",
    externalId: null,
    email: "alice@example.com",
    displayName: "Alice Local",
    role: "employee",
    status: "active",
    statusSource: "manual",
    syncState: "active",
    manualDisabled: false,
    adminNote: null,
    lastSyncedAt: null,
    dingtalkOpenId: null,
    dingtalkUserId: null,
    dingtalkCorpId: null,
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
    updatedAt: new Date("2026-04-01T00:00:00.000Z"),
    ...overrides
  };
}

function buildDepartmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "dept-row-1",
    organizationId: "org_internal",
    externalId: "dept-1",
    name: "Engineering",
    parentDepartmentId: null,
    sortOrder: 1,
    status: "active",
    lastSyncedAt: null,
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
    updatedAt: new Date("2026-04-01T00:00:00.000Z"),
    ...overrides
  };
}

describe("OrgSyncService", () => {
  it("matches DingTalk login users by auth identity subject before creating sync users", async () => {
    const users = [buildUserRow()];
    const departments = [buildDepartmentRow()];
    const memberships: Array<{ userId: string; departmentId: string; isPrimary: boolean; source: string }> = [];
    const snapshot: NormalizedOrgSnapshot = {
      departments: [
        {
          externalId: "dept-1",
          name: "Engineering",
          parentExternalId: null,
          sortOrder: 1
        }
      ],
      users: [
        {
          userId: "ding-user-1",
          unionId: "union-1",
          openId: "open-1",
          corpId: "corp-1",
          displayName: "Alice",
          email: "alice@example.com",
          departmentExternalIds: ["dept-1"],
          primaryDepartmentExternalId: "dept-1",
          lifecycleState: "active"
        }
      ]
    };

    const db = {
      user: {
        findMany: vi.fn(async () => users),
        findUnique: vi.fn(async () => null),
        create: vi.fn(async (args: { data: Record<string, unknown> }) => {
          const created = buildUserRow({ id: `user-${users.length + 1}`, ...args.data });
          users.push(created);
          return created;
        }),
        update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          const index = users.findIndex((user) => user.id === args.where.id);
          if (index < 0) throw new Error("user not found");
          users[index] = { ...users[index], ...args.data };
          return users[index];
        })
      },
      department: {
        findMany: vi.fn(async () => departments),
        findUnique: vi.fn(async () => null)
      },
      departmentMembership: {
        findMany: vi.fn(
          async (args?: { where?: { userId?: string; departmentId?: { in: string[] } } }) => {
            if (args?.where?.userId) {
              return memberships.filter((membership) => membership.userId === args.where?.userId);
            }
            if (args?.where?.departmentId?.in) {
              return memberships.filter((membership) =>
                args.where?.departmentId?.in.includes(membership.departmentId)
              );
            }
            return memberships;
          }
        )
      },
      authIdentity: {
        findMany: vi.fn(async () => [
          {
            userId: "login-user",
            provider: "dingtalk",
            providerSubject: "union-1"
          }
        ])
      },
      syncJob: {
        findMany: vi.fn(async () => [])
      }
    };

    const replaceSyncedMemberships = vi.fn(
      async (input: {
        userId: string;
        memberships: Array<{ departmentId: string; isPrimary: boolean }>;
      }) => {
        memberships.splice(0, memberships.length);
        memberships.push(
          ...input.memberships.map((membership) => ({
            userId: input.userId,
            departmentId: membership.departmentId,
            isPrimary: membership.isPrimary,
            source: "sync"
          }))
        );
      }
    );

    const service = new OrgSyncService({
      provider: {
        fetchFullOrganization: vi.fn(async () => snapshot),
        fetchDepartmentScope: vi.fn(async () => snapshot),
        fetchUserScope: vi.fn(async () => snapshot)
      },
      departments: {
        upsertMany: vi.fn(async () => undefined)
      },
      users: {},
      memberships: {
        replaceSyncedMemberships
      },
      jobs: {
        db,
        create: vi.fn(async () => ({ id: "job-1" })),
        markRunning: vi.fn(async () => undefined),
        appendEvent: vi.fn(async () => undefined),
        replaceSnapshots: vi.fn(async () => undefined),
        replaceDiffs: vi.fn(async () => undefined),
        markSucceeded: vi.fn(async () => undefined),
        markFailed: vi.fn(async () => undefined),
        touch: vi.fn(async () => undefined)
      }
    } as unknown as ConstructorParameters<typeof OrgSyncService>[0]);

    const result = await service.run({ scopeType: "full", triggerType: "manual" });

    expect(result).toEqual({ jobId: "job-1", status: "succeeded" });
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "login-user" },
      data: expect.objectContaining({
        externalId: "union-1",
        email: "alice@example.com",
        displayName: "Alice",
        dingtalkOpenId: "open-1",
        dingtalkUserId: "ding-user-1",
        dingtalkCorpId: "corp-1"
      })
    });
    expect(replaceSyncedMemberships).toHaveBeenCalledWith({
      userId: "login-user",
      memberships: [{ departmentId: "dept-row-1", isPrimary: true }],
      syncedAt: expect.any(Date)
    });
    expect(users).toHaveLength(1);
  });

  it("disables previously synced DingTalk users missing from a full organization sync", async () => {
    const users = [
      buildUserRow({
        id: "stale-user",
        externalId: "stale-union",
        displayName: "Former Employee",
        statusSource: "sync",
        lastSyncedAt: new Date("2026-04-01T00:00:00.000Z"),
        dingtalkUserId: "stale-ding-user"
      }),
      buildUserRow({
        id: "active-user",
        externalId: "active-union",
        displayName: "Active Employee",
        statusSource: "sync",
        lastSyncedAt: new Date("2026-04-01T00:00:00.000Z"),
        dingtalkUserId: "active-ding-user"
      }),
      buildUserRow({
        id: "local-user",
        externalId: "local-dev-admin",
        displayName: "Local Admin",
        lastSyncedAt: null
      })
    ];
    const departments = [buildDepartmentRow()];
    const memberships: Array<{ userId: string; departmentId: string; isPrimary: boolean; source: string }> = [
      {
        userId: "stale-user",
        departmentId: "dept-row-1",
        isPrimary: true,
        source: "sync"
      }
    ];
    const snapshot: NormalizedOrgSnapshot = {
      departments: [
        {
          externalId: "dept-1",
          name: "Engineering",
          parentExternalId: null,
          sortOrder: 1
        }
      ],
      users: [
        {
          userId: "active-ding-user",
          unionId: "active-union",
          displayName: "Active Employee",
          email: "active@example.com",
          departmentExternalIds: ["dept-1"],
          primaryDepartmentExternalId: "dept-1",
          lifecycleState: "active"
        }
      ]
    };

    const db = {
      user: {
        findMany: vi.fn(async () => users),
        findUnique: vi.fn(async () => null),
        create: vi.fn(async (args: { data: Record<string, unknown> }) => {
          const created = buildUserRow({ id: `user-${users.length + 1}`, ...args.data });
          users.push(created);
          return created;
        }),
        update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          const index = users.findIndex((user) => user.id === args.where.id);
          if (index < 0) throw new Error("user not found");
          users[index] = { ...users[index], ...args.data };
          return users[index];
        })
      },
      department: {
        findMany: vi.fn(async () => departments),
        findUnique: vi.fn(async () => null)
      },
      departmentMembership: {
        findMany: vi.fn(
          async (args?: { where?: { userId?: string; departmentId?: { in: string[] } } }) => {
            if (args?.where?.userId) {
              return memberships.filter((membership) => membership.userId === args.where?.userId);
            }
            if (args?.where?.departmentId?.in) {
              return memberships.filter((membership) =>
                args.where?.departmentId?.in.includes(membership.departmentId)
              );
            }
            return memberships;
          }
        )
      },
      authIdentity: {
        findMany: vi.fn(async () => [])
      },
      syncJob: {
        findMany: vi.fn(async () => [])
      }
    };

    const replaceSyncedMemberships = vi.fn(
      async (input: {
        userId: string;
        memberships: Array<{ departmentId: string; isPrimary: boolean }>;
      }) => {
        for (let index = memberships.length - 1; index >= 0; index -= 1) {
          if (memberships[index]?.userId === input.userId && memberships[index]?.source === "sync") {
            memberships.splice(index, 1);
          }
        }
        memberships.push(
          ...input.memberships.map((membership) => ({
            userId: input.userId,
            departmentId: membership.departmentId,
            isPrimary: membership.isPrimary,
            source: "sync"
          }))
        );
      }
    );

    const service = new OrgSyncService({
      provider: {
        fetchFullOrganization: vi.fn(async () => snapshot),
        fetchDepartmentScope: vi.fn(async () => snapshot),
        fetchUserScope: vi.fn(async () => snapshot)
      },
      departments: {
        upsertMany: vi.fn(async () => undefined)
      },
      users: {},
      memberships: {
        replaceSyncedMemberships
      },
      jobs: {
        db,
        create: vi.fn(async () => ({ id: "job-1" })),
        markRunning: vi.fn(async () => undefined),
        appendEvent: vi.fn(async () => undefined),
        replaceSnapshots: vi.fn(async () => undefined),
        replaceDiffs: vi.fn(async () => undefined),
        markSucceeded: vi.fn(async () => undefined),
        markFailed: vi.fn(async () => undefined),
        touch: vi.fn(async () => undefined)
      }
    } as unknown as ConstructorParameters<typeof OrgSyncService>[0]);

    const result = await service.run({ scopeType: "full", triggerType: "manual" });

    expect(result).toEqual({ jobId: "job-1", status: "succeeded" });
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "stale-user" },
      data: expect.objectContaining({
        status: "disabled",
        statusSource: "sync",
        syncState: "departed",
        lastSyncedAt: expect.any(Date)
      })
    });
    expect(replaceSyncedMemberships).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "stale-user",
        memberships: [],
        syncedAt: expect.any(Date)
      })
    );
    expect(users.find((user) => user.id === "stale-user")).toMatchObject({
      status: "disabled",
      statusSource: "sync",
      syncState: "departed"
    });
    expect(users.find((user) => user.id === "local-user")).toMatchObject({
      status: "active",
      syncState: "active"
    });
    expect(memberships.filter((membership) => membership.userId === "stale-user")).toEqual([]);
  });
});
