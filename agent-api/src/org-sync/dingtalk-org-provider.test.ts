import { describe, expect, it } from "vitest";

import type {
  DingTalkClient,
  DingTalkDepartment,
  DingTalkOrganizationUser
} from "../auth/dingtalk.js";
import type { DingTalkUserIdentity } from "../persistence/user-repository.js";
import { DingTalkOrgProvider } from "./dingtalk-org-provider.js";

class FakeDingTalkClient implements DingTalkClient {
  constructor(
    private readonly options: {
      departmentsByParentId?: Record<string, DingTalkDepartment[]>;
      usersByDepartmentId?: Record<string, DingTalkOrganizationUser[]>;
      usersById?: Record<string, DingTalkOrganizationUser | null>;
    } = {}
  ) {}

  async exchangeCode(): Promise<DingTalkUserIdentity> {
    throw new Error("not implemented for org provider tests");
  }

  async listDepartments(input: { parentId?: string | null }): Promise<DingTalkDepartment[]> {
    return this.options.departmentsByParentId?.[input.parentId ?? "0"] ?? [];
  }

  async listDepartmentUsers(input: { departmentId: string }): Promise<DingTalkOrganizationUser[]> {
    return this.options.usersByDepartmentId?.[input.departmentId] ?? [];
  }

  async getUser(input: { userId: string }): Promise<DingTalkOrganizationUser | null> {
    return this.options.usersById?.[input.userId] ?? null;
  }
}

describe("DingTalkOrgProvider", () => {
  it("fetches the full organization without dropping departments or duplicate users", async () => {
    const provider = new DingTalkOrgProvider(
      new FakeDingTalkClient({
        departmentsByParentId: {
          "0": [
            { externalId: "1", name: "总部", parentExternalId: "0", sortOrder: 10 },
            { externalId: "2", name: "研发", parentExternalId: "0", sortOrder: 20 }
          ],
          "1": [{ externalId: "3", name: "销售", parentExternalId: "1", sortOrder: 30 }],
          "2": [],
          "3": []
        },
        usersByDepartmentId: {
          "1": [
            {
              userId: "u1",
              unionId: "union-1",
              corpId: "corp-1",
              displayName: "Alice",
              email: "alice@example.com",
              departmentExternalIds: ["1", "3", "1"],
              primaryDepartmentExternalId: "1",
              lifecycleState: "active"
            }
          ],
          "2": [
            {
              userId: "u2",
              displayName: "Bob",
              departmentExternalIds: ["2"],
              lifecycleState: "disabled"
            }
          ],
          "3": [
            {
              userId: "u1",
              unionId: "union-1",
              corpId: "corp-1",
              displayName: "Alice",
              email: "alice@example.com",
              departmentExternalIds: ["3", "1"],
              primaryDepartmentExternalId: "1",
              lifecycleState: "active"
            }
          ]
        }
      })
    );

    await expect(provider.fetchFullOrganization()).resolves.toEqual({
      departments: [
        { externalId: "1", name: "总部", parentExternalId: "0", sortOrder: 10 },
        { externalId: "2", name: "研发", parentExternalId: "0", sortOrder: 20 },
        { externalId: "3", name: "销售", parentExternalId: "1", sortOrder: 30 }
      ],
      users: [
        {
          userId: "u1",
          unionId: "union-1",
          corpId: "corp-1",
          displayName: "Alice",
          email: "alice@example.com",
          departmentExternalIds: ["1", "3"],
          primaryDepartmentExternalId: "1",
          lifecycleState: "active"
        },
        {
          userId: "u2",
          displayName: "Bob",
          departmentExternalIds: ["2"],
          lifecycleState: "disabled"
        }
      ]
    });
  });

  it("fetches a department scope as the selected subtree and its current members", async () => {
    const provider = new DingTalkOrgProvider(
      new FakeDingTalkClient({
        departmentsByParentId: {
          "0": [{ externalId: "1", name: "总部", parentExternalId: "0", sortOrder: 10 }],
          "1": [{ externalId: "3", name: "销售", parentExternalId: "1", sortOrder: 30 }],
          "3": [{ externalId: "4", name: "渠道", parentExternalId: "3", sortOrder: 40 }],
          "4": []
        },
        usersByDepartmentId: {
          "1": [
            {
              userId: "u1",
              displayName: "Alice",
              departmentExternalIds: ["1", "9"],
              lifecycleState: "active"
            }
          ],
          "3": [
            {
              userId: "u2",
              displayName: "Bob",
              departmentExternalIds: ["3", "4"],
              lifecycleState: "active"
            }
          ],
          "4": [
            {
              userId: "u3",
              displayName: "Carol",
              departmentExternalIds: ["4"],
              lifecycleState: "departed"
            }
          ]
        }
      })
    );

    await expect(provider.fetchDepartmentScope("1")).resolves.toEqual({
      departments: [
        { externalId: "1", name: "总部", parentExternalId: "0", sortOrder: 10 },
        { externalId: "3", name: "销售", parentExternalId: "1", sortOrder: 30 },
        { externalId: "4", name: "渠道", parentExternalId: "3", sortOrder: 40 }
      ],
      users: [
        {
          userId: "u1",
          displayName: "Alice",
          departmentExternalIds: ["1"],
          lifecycleState: "active"
        },
        {
          userId: "u2",
          displayName: "Bob",
          departmentExternalIds: ["3", "4"],
          lifecycleState: "active"
        },
        {
          userId: "u3",
          displayName: "Carol",
          departmentExternalIds: ["4"],
          lifecycleState: "departed"
        }
      ]
    });
  });

  it("fetches a user scope with only the linked departments", async () => {
    const provider = new DingTalkOrgProvider(
      new FakeDingTalkClient({
        usersById: {
          u7: {
            userId: "u7",
            unionId: "union-7",
            openId: "open-7",
            corpId: "corp-7",
            displayName: "Eve",
            email: "eve@example.com",
            departmentExternalIds: ["2", "2", "5"],
            primaryDepartmentExternalId: "5",
            lifecycleState: "active"
          }
        },
        departmentsByParentId: {
          "0": [{ externalId: "2", name: "研发", parentExternalId: "0", sortOrder: 20 }],
          "2": [{ externalId: "5", name: "平台", parentExternalId: "2", sortOrder: 50 }],
          "5": []
        }
      })
    );

    await expect(provider.fetchUserScope("u7")).resolves.toEqual({
      departments: [
        { externalId: "2", name: "研发", parentExternalId: "0", sortOrder: 20 },
        { externalId: "5", name: "平台", parentExternalId: "2", sortOrder: 50 }
      ],
      users: [
        {
          userId: "u7",
          unionId: "union-7",
          openId: "open-7",
          corpId: "corp-7",
          displayName: "Eve",
          email: "eve@example.com",
          departmentExternalIds: ["2", "5"],
          primaryDepartmentExternalId: "5",
          lifecycleState: "active"
        }
      ]
    });
  });

  it("returns an empty snapshot when the requested user does not exist", async () => {
    const provider = new DingTalkOrgProvider(
      new FakeDingTalkClient({
        usersById: {
          missing: null
        }
      })
    );

    await expect(provider.fetchUserScope("missing")).resolves.toEqual({
      departments: [],
      users: []
    });
  });
});
