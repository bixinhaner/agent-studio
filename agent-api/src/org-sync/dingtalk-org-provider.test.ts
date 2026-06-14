import { describe, expect, it, vi } from "vitest";

import type { DingTalkClient } from "../auth/dingtalk.js";
import { DingTalkOrgProvider } from "./dingtalk-org-provider.js";

describe("DingTalkOrgProvider", () => {
  function buildClient(overrides: Partial<DingTalkClient> = {}): DingTalkClient {
    return {
      exchangeCode: vi.fn(async () => {
        throw new Error("not used");
      }),
      listDepartments: vi.fn(async ({ parentId }) => {
        if (parentId === "1") {
          return [
            {
              externalId: "dept-a",
              name: "Dept A",
              parentExternalId: "1",
              sortOrder: 1
            }
          ];
        }
        return [];
      }),
      listDepartmentUsers: vi.fn(async () => [
        {
          userId: "user-1",
          displayName: "Alice",
          departmentExternalIds: ["dept-a"],
          lifecycleState: "active" as const
        }
      ]),
      getUser: vi.fn(async () => null),
      ...overrides
    };
  }

  it("starts full organization sync from DingTalk root department 1", async () => {
    const requestedParentIds: Array<string | null | undefined> = [];
    const requestedMemberDepartmentIds: string[] = [];
    const client: DingTalkClient = {
      exchangeCode: vi.fn(async () => {
        throw new Error("not used");
      }),
      listDepartments: vi.fn(async ({ parentId }) => {
        requestedParentIds.push(parentId);
        if (parentId === "1") {
          return [
            {
              externalId: "dept-a",
              name: "Dept A",
              parentExternalId: "1",
              sortOrder: 1
            }
          ];
        }
        return [];
      }),
      listDepartmentUsers: vi.fn(async ({ departmentId }) => {
        requestedMemberDepartmentIds.push(departmentId);
        return [];
      }),
      getUser: vi.fn(async () => null)
    };

    const provider = new DingTalkOrgProvider(client);
    const snapshot = await provider.fetchFullOrganization();

    expect(requestedParentIds).toEqual(["1", "dept-a"]);
    expect(requestedMemberDepartmentIds).toEqual(["dept-a"]);
    expect(snapshot.departments).toEqual([
      {
        externalId: "dept-a",
        name: "Dept A",
        parentExternalId: "1",
        sortOrder: 1
      }
    ]);
  });

  it("uses cached user details within refresh interval without calling DingTalk detail API", async () => {
    const getUser = vi.fn(async () => {
      throw new Error("detail API should not be called");
    });
    const client = buildClient({ getUser });
    const provider = new DingTalkOrgProvider(client, {
      now: () => new Date("2026-06-14T00:00:00.000Z"),
      detailRefreshIntervalMs: 7 * 24 * 60 * 60 * 1000,
      loadUserDetailCache: vi.fn(async () =>
        new Map([
          [
            "user-1",
            {
              detailAttemptedAt: new Date("2026-06-13T00:00:00.000Z"),
              detailSyncedAt: new Date("2026-06-13T00:00:00.000Z"),
              detail: {
                managerDingTalkUserId: "manager-1",
                departmentPositions: [
                  {
                    departmentExternalId: "dept-a",
                    sortOrder: 9,
                    isLeader: true
                  }
                ]
              }
            }
          ]
        ])
      )
    });

    const snapshot = await provider.fetchFullOrganization();

    expect(getUser).not.toHaveBeenCalled();
    expect(snapshot.users[0]).toMatchObject({
      userId: "user-1",
      managerDingTalkUserId: "manager-1",
      detailAttemptedAt: "2026-06-13T00:00:00.000Z",
      detailSyncedAt: "2026-06-13T00:00:00.000Z",
      departmentPositions: [
        {
          departmentExternalId: "dept-a",
          sortOrder: 9,
          isLeader: true
        }
      ]
    });
  });

  it("refreshes DingTalk details when cached attempt is older than interval", async () => {
    const getUser = vi.fn(async () => ({
      userId: "user-1",
      displayName: "Alice",
      departmentExternalIds: ["dept-a"],
      lifecycleState: "active" as const,
      managerDingTalkUserId: "manager-new",
      departmentPositions: [
        {
          departmentExternalId: "dept-a",
          sortOrder: 3
        }
      ]
    }));
    const client = buildClient({ getUser });
    const provider = new DingTalkOrgProvider(client, {
      now: () => new Date("2026-06-14T00:00:00.000Z"),
      detailRefreshIntervalMs: 7 * 24 * 60 * 60 * 1000,
      loadUserDetailCache: vi.fn(async () =>
        new Map([
          [
            "user-1",
            {
              detailAttemptedAt: new Date("2026-06-01T00:00:00.000Z"),
              detailSyncedAt: new Date("2026-06-01T00:00:00.000Z")
            }
          ]
        ])
      )
    });

    const snapshot = await provider.fetchFullOrganization();

    expect(getUser).toHaveBeenCalledTimes(1);
    expect(getUser).toHaveBeenCalledWith({ userId: "user-1" });
    expect(snapshot.users[0]).toMatchObject({
      userId: "user-1",
      managerDingTalkUserId: "manager-new",
      detailAttemptedAt: "2026-06-14T00:00:00.000Z",
      detailSyncedAt: "2026-06-14T00:00:00.000Z",
      detailSyncStatus: "success",
      departmentPositions: [
        {
          departmentExternalId: "dept-a",
          sortOrder: 3
        }
      ]
    });
  });
});
