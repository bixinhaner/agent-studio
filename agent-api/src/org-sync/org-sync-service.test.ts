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
    primaryOrganizationId: null,
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

function buildInternalOrganization() {
  return {
    id: "org_internal",
    slug: "internal",
    name: "Internal Organization",
    type: "internal",
    status: "active",
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
    updatedAt: new Date("2026-04-01T00:00:00.000Z")
  };
}

function buildOrganizationDependencies() {
  return {
    getById: vi.fn(async (id: string) => (id === "org_internal" ? buildInternalOrganization() : undefined)),
    getBySlug: vi.fn(async (slug: string) => (slug === "internal" ? buildInternalOrganization() : undefined)),
    create: vi.fn(async () => buildInternalOrganization())
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
          title: "Support Engineer",
          jobNumber: "E001",
          mobile: "13800138000",
          workPlace: "Xi'an",
          managerDingTalkUserId: "manager-1",
          departmentExternalIds: ["dept-1"],
          primaryDepartmentExternalId: "dept-1",
          departmentPositions: [
            {
              departmentExternalId: "dept-1",
              position: "Support Engineer",
              isPrimary: true,
              sortOrder: 177917621779460500,
              isLeader: false
            }
          ],
          detailAttemptedAt: "2026-06-14T00:00:00.000Z",
          detailSyncedAt: "2026-06-14T00:00:00.000Z",
          detailSyncStatus: "success",
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
      enterpriseUserProfile: {
        upsert: vi.fn(async (args: Record<string, unknown>) => args)
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
    const organizations = buildOrganizationDependencies();
    const organizationMemberships = {
      upsert: vi.fn(async (input: Record<string, unknown>) => ({
        id: `membership-${input.userId}`,
        organizationId: input.organizationId,
        userId: input.userId,
        membershipType: input.membershipType,
        status: input.status,
        createdAt: new Date("2026-04-01T00:00:00.000Z").toISOString(),
        updatedAt: new Date("2026-04-01T00:00:00.000Z").toISOString()
      }))
    };

    const upsertDepartments = vi.fn(async () => undefined);
    const refreshSecurityDomains = vi.fn(async () => undefined);
    const service = new OrgSyncService({
      provider: {
        fetchFullOrganization: vi.fn(async () => snapshot),
        fetchDepartmentScope: vi.fn(async () => snapshot),
        fetchUserScope: vi.fn(async () => snapshot),
        confirmUserPresence: vi.fn(async (userId: string) =>
          userId === "stale-ding-user" ? "missing" : "present"
        )
      },
      departments: {
        upsertMany: upsertDepartments
      },
      users: {},
      memberships: {
        replaceSyncedMemberships
      },
      organizations,
      organizationMemberships,
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
      },
      afterSuccessfulSync: refreshSecurityDomains
    } as unknown as ConstructorParameters<typeof OrgSyncService>[0]);

    const result = await service.run({ scopeType: "full", triggerType: "manual" });

    expect(result).toEqual({ jobId: "job-1", status: "succeeded" });
    expect(upsertDepartments).toHaveBeenCalledWith([
      expect.objectContaining({
        organizationId: "org_internal",
        externalId: "dept-1"
      })
    ]);
    expect(refreshSecurityDomains).toHaveBeenCalledOnce();
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "login-user" },
      data: expect.objectContaining({
        externalId: "union-1",
        email: "alice@example.com",
        displayName: "Alice",
        primaryOrganizationId: "org_internal",
        dingtalkOpenId: "open-1",
        dingtalkUserId: "ding-user-1",
        dingtalkCorpId: "corp-1"
      })
    });
    expect(replaceSyncedMemberships).toHaveBeenCalledWith({
      userId: "login-user",
      memberships: [
        expect.objectContaining({
          departmentId: "dept-row-1",
          isPrimary: true,
          position: "Support Engineer",
          sortOrder: null,
          isLeader: false
        })
      ],
      syncedAt: expect.any(Date)
    });
    expect(organizationMemberships.upsert).toHaveBeenCalledWith({
      organizationId: "org_internal",
      userId: "login-user",
      membershipType: "employee",
      status: "active",
      title: "Support Engineer",
      joinedAt: expect.any(Date)
    });
    expect(db.enterpriseUserProfile.upsert).toHaveBeenCalledWith({
      where: { userId: "login-user" },
      create: expect.objectContaining({
        userId: "login-user",
        employeeNo: "E001",
        title: "Support Engineer",
        mobile: "13800138000",
        workPlace: "Xi'an",
        managerDingTalkUserId: "manager-1",
        detailAttemptedAt: new Date("2026-06-14T00:00:00.000Z"),
        detailSyncedAt: new Date("2026-06-14T00:00:00.000Z"),
        detailSyncStatus: "success"
      }),
      update: expect.objectContaining({
        userId: "login-user",
        employeeNo: "E001",
        title: "Support Engineer",
        updatedAt: expect.any(Date)
      })
    });
    expect(users).toHaveLength(1);
  });

  it("disables previously synced DingTalk users missing from a full organization sync", async () => {
    const activeUsers = Array.from({ length: 11 }, (_, index) =>
      buildUserRow({
        id: `active-user-${index}`,
        externalId: `active-union-${index}`,
        displayName: `Active Employee ${index}`,
        statusSource: "sync",
        lastSyncedAt: new Date("2026-04-01T00:00:00.000Z"),
        dingtalkUserId: `active-ding-user-${index}`
      })
    );
    const alreadyDepartedUsers = Array.from({ length: 100 }, (_, index) =>
      buildUserRow({
        id: `departed-user-${index}`,
        externalId: `departed-union-${index}`,
        displayName: `Departed Employee ${index}`,
        status: "disabled",
        statusSource: "sync",
        syncState: "departed",
        lastSyncedAt: new Date("2026-04-01T00:00:00.000Z"),
        dingtalkUserId: `departed-ding-user-${index}`
      })
    );
    const users = [
      buildUserRow({
        id: "stale-user",
        externalId: "stale-union",
        displayName: "Former Employee",
        statusSource: "sync",
        lastSyncedAt: new Date("2026-04-01T00:00:00.000Z"),
        dingtalkUserId: "stale-ding-user"
      }),
      ...activeUsers,
      ...alreadyDepartedUsers,
      buildUserRow({
        id: "local-user",
        externalId: "local-dev-admin",
        displayName: "Local Admin",
        lastSyncedAt: null
      })
    ];
    const departments = [
      buildDepartmentRow({ lastSyncedAt: new Date("2026-04-01T00:00:00.000Z") }),
      ...Array.from({ length: 3 }, (_, index) =>
        buildDepartmentRow({
          id: `dept-row-${index + 2}`,
          externalId: `dept-${index + 2}`,
          name: `Department ${index + 2}`,
          lastSyncedAt: new Date("2026-04-01T00:00:00.000Z")
        })
      ),
      buildDepartmentRow({
        id: "stale-dept-row",
        externalId: "stale-dept",
        name: "Former Department",
        lastSyncedAt: new Date("2026-04-01T00:00:00.000Z")
      })
    ];
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
        },
        ...Array.from({ length: 3 }, (_, index) => ({
          externalId: `dept-${index + 2}`,
          name: `Department ${index + 2}`,
          parentExternalId: null,
          sortOrder: index + 2
        }))
      ],
      users: activeUsers.map((user, index) => ({
        userId: user.dingtalkUserId ?? `active-ding-user-${index}`,
        unionId: user.externalId ?? `active-union-${index}`,
        displayName: user.displayName ?? `Active Employee ${index}`,
        email: `active-${index}@example.com`,
        departmentExternalIds: ["dept-1"],
        primaryDepartmentExternalId: "dept-1",
        lifecycleState: "active" as const
      }))
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
        findUnique: vi.fn(async () => null),
        update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          const department = departments.find((row) => row.id === args.where.id);
          if (!department) throw new Error("department not found");
          Object.assign(department, args.data);
          return department;
        })
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
    const organizations = buildOrganizationDependencies();
    const organizationMemberships = {
      upsert: vi.fn(async (input: Record<string, unknown>) => ({
        id: `membership-${input.userId}`,
        organizationId: input.organizationId,
        userId: input.userId,
        membershipType: input.membershipType,
        status: input.status,
        createdAt: new Date("2026-04-01T00:00:00.000Z").toISOString(),
        updatedAt: new Date("2026-04-01T00:00:00.000Z").toISOString()
      }))
    };

    const service = new OrgSyncService({
      provider: {
        fetchFullOrganization: vi.fn(async () => snapshot),
        fetchDepartmentScope: vi.fn(async () => snapshot),
        fetchUserScope: vi.fn(async () => snapshot),
        confirmUserPresence: vi.fn(async (userId: string) =>
          userId === "stale-ding-user" ? "missing" : "present"
        )
      },
      departments: {
        upsertMany: vi.fn(async () => undefined)
      },
      users: {},
      memberships: {
        replaceSyncedMemberships
      },
      organizations,
      organizationMemberships,
      jobs: {
        db,
        getLatestSuccessfulFullSnapshot: vi.fn(async () => ({
          jobId: "job-previous",
          departments: [
            { externalId: "dept-1" },
            { externalId: "dept-2" },
            { externalId: "dept-3" },
            { externalId: "dept-4" },
            { externalId: "stale-dept" }
          ],
          users: Array.from({ length: 12 }, (_, index) => ({ userId: `previous-user-${index}` }))
        })),
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
    expect(organizationMemberships.upsert).toHaveBeenCalledWith({
      organizationId: "org_internal",
      userId: "active-user-0",
      membershipType: "employee",
      status: "active",
      title: null,
      joinedAt: expect.any(Date)
    });
    expect(db.department.update).toHaveBeenCalledWith({
      where: { id: "stale-dept-row" },
      data: {
        status: "disabled",
        lastSyncedAt: expect.any(Date)
      }
    });
    expect(organizationMemberships.upsert).toHaveBeenCalledWith({
      organizationId: "org_internal",
      userId: "stale-user",
      membershipType: "employee",
      status: "disabled",
      title: null,
      joinedAt: expect.any(Date)
    });
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

  it("ignores unchanged department parents and preserved DingTalk identity fields in diffs", async () => {
    const users = [
      buildUserRow({
        id: "synced-user",
        externalId: "union-1",
        email: "alice@example.com",
        displayName: "Alice",
        primaryOrganizationId: "org_internal",
        statusSource: "sync",
        dingtalkOpenId: "open-1",
        dingtalkUserId: "ding-user-1"
      })
    ];
    const departments = [
      buildDepartmentRow({
        id: "dept-parent-row",
        externalId: "dept-parent",
        name: "Engineering",
        parentDepartmentId: null,
        sortOrder: 1
      }),
      buildDepartmentRow({
        id: "dept-child-row",
        externalId: "dept-child",
        name: "Platform",
        parentDepartmentId: "dept-parent-row",
        sortOrder: 2
      })
    ];
    const memberships: Array<{ userId: string; departmentId: string; isPrimary: boolean; source: string }> = [
      {
        userId: "synced-user",
        departmentId: "dept-child-row",
        isPrimary: true,
        source: "sync"
      }
    ];
    const snapshot: NormalizedOrgSnapshot = {
      departments: [
        {
          externalId: "dept-parent",
          name: "Engineering",
          parentExternalId: "1",
          sortOrder: 1
        },
        {
          externalId: "dept-child",
          name: "Platform",
          parentExternalId: "dept-parent",
          sortOrder: 2
        }
      ],
      users: [
        {
          userId: "ding-user-1",
          unionId: "union-1",
          displayName: "Alice",
          email: "alice@example.com",
          departmentExternalIds: ["dept-child"],
          primaryDepartmentExternalId: "dept-child",
          lifecycleState: "active"
        }
      ]
    };

    const db = {
      user: {
        findMany: vi.fn(async () => users),
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => {
          throw new Error("unexpected user create");
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
    const replaceDiffs = vi.fn(async () => undefined);
    const markSucceeded = vi.fn(async () => undefined);
    const organizations = buildOrganizationDependencies();
    const organizationMemberships = {
      upsert: vi.fn(async (input: Record<string, unknown>) => ({
        id: `membership-${input.userId}`,
        organizationId: input.organizationId,
        userId: input.userId,
        membershipType: input.membershipType,
        status: input.status,
        createdAt: new Date("2026-04-01T00:00:00.000Z").toISOString(),
        updatedAt: new Date("2026-04-01T00:00:00.000Z").toISOString()
      }))
    };

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
      organizations,
      organizationMemberships,
      jobs: {
        db,
        create: vi.fn(async () => ({ id: "job-1" })),
        markRunning: vi.fn(async () => undefined),
        appendEvent: vi.fn(async () => undefined),
        replaceSnapshots: vi.fn(async () => undefined),
        replaceDiffs,
        markSucceeded,
        markFailed: vi.fn(async () => undefined),
        touch: vi.fn(async () => undefined)
      }
    } as unknown as ConstructorParameters<typeof OrgSyncService>[0]);

    const result = await service.run({ scopeType: "full", triggerType: "manual" });

    expect(result).toEqual({ jobId: "job-1", status: "succeeded" });
    expect(replaceDiffs).toHaveBeenCalledWith("job-1", []);
    expect(markSucceeded).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        total: 0,
        department: 0,
        user: 0,
        membership: 0,
        byChangeType: {},
        reconciliation: expect.objectContaining({ enabled: true })
      })
    );
    expect(users[0]).toMatchObject({
      dingtalkOpenId: "open-1",
      dingtalkUserId: "ding-user-1"
    });
  });
});
