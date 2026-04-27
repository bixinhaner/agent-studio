import { describe, expect, it, vi } from "vitest";

import type { DingTalkClient } from "../auth/dingtalk.js";
import { DingTalkOrgProvider } from "./dingtalk-org-provider.js";

describe("DingTalkOrgProvider", () => {
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
});
