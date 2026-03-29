import { describe, expect, it, vi } from "vitest";

import { createDingTalkClient } from "./dingtalk.js";

describe("createDingTalkClient", () => {
  it("lists departments and normalizes the payload", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          result: {
            departments: [
              {
                dept_id: "1",
                name: "总部",
                parent_id: "0",
                order: 10
              }
            ]
          }
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
    );

    const client = createDingTalkClient(
      {
        clientId: "ding-client-id",
        clientSecret: "ding-client-secret",
        redirectUri: "https://agent.example.com/auth/dingtalk/callback",
        scope: "openid"
      },
      fetchMock
    );

    await expect(client.listDepartments!({ parentId: "0" })).resolves.toEqual([
      {
        externalId: "1",
        name: "总部",
        parentExternalId: "0",
        sortOrder: 10
      }
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.dingtalk.com/v1.0/contact/departments?parentId=0",
      expect.objectContaining({
        method: "GET"
      })
    );
  });

  it("lists department users and normalizes lifecycle and department ids", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          result: {
            list: [
              {
                userid: "u1",
                unionid: "union-1",
                openId: "open-1",
                org_email: "alice@example.com",
                name: "Alice",
                dept_id_list: ["1", "2", "1"],
                leader_in_dept: [{ dept_id: "2", leader: true }],
                active: true
              },
              {
                userid: "u2",
                name: "Bob",
                department: [3],
                status: "resigned"
              }
            ]
          }
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
    );

    const client = createDingTalkClient(
      {
        clientId: "ding-client-id",
        clientSecret: "ding-client-secret",
        redirectUri: "https://agent.example.com/auth/dingtalk/callback",
        scope: "openid"
      },
      fetchMock
    );

    await expect(client.listDepartmentUsers!({ departmentId: "1" })).resolves.toEqual([
      {
        userId: "u1",
        unionId: "union-1",
        openId: "open-1",
        displayName: "Alice",
        email: "alice@example.com",
        departmentExternalIds: ["1", "2"],
        primaryDepartmentExternalId: "2",
        lifecycleState: "active"
      },
      {
        userId: "u2",
        displayName: "Bob",
        departmentExternalIds: ["3"],
        lifecycleState: "departed"
      }
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.dingtalk.com/v1.0/contact/users?departmentId=1",
      expect.objectContaining({
        method: "GET"
      })
    );
  });

  it("gets a single organization user and normalizes disabled state", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          result: {
            userid: "u-disabled",
            unionId: "union-disabled",
            corpId: "corp-1",
            name: "Disabled User",
            email: "disabled@example.com",
            dept_id_list: ["8", "8"],
            dept_id: "8",
            enabled: false
          }
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
    );

    const client = createDingTalkClient(
      {
        clientId: "ding-client-id",
        clientSecret: "ding-client-secret",
        redirectUri: "https://agent.example.com/auth/dingtalk/callback",
        scope: "openid"
      },
      fetchMock
    );

    await expect(client.getUser!({ userId: "u-disabled" })).resolves.toEqual({
      userId: "u-disabled",
      unionId: "union-disabled",
      corpId: "corp-1",
      displayName: "Disabled User",
      email: "disabled@example.com",
      departmentExternalIds: ["8"],
      primaryDepartmentExternalId: "8",
      lifecycleState: "disabled"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.dingtalk.com/v1.0/contact/users/u-disabled",
      expect.objectContaining({
        method: "GET"
      })
    );
  });

  it("rejects a DingTalk user profile that lacks unionId", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: "token-1" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { openId: "open-only", nick: "Agent" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );

    const client = createDingTalkClient(
      {
        clientId: "ding-client-id",
        clientSecret: "ding-client-secret",
        redirectUri: "https://agent.example.com/auth/dingtalk/callback",
        scope: "openid"
      },
      fetchMock
    );

    await expect(client.exchangeCode("auth-code")).rejects.toThrow(/unionId/i);
  });
});
