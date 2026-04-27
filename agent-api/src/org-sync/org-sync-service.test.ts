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
});
