import { describe, expect, it, vi } from "vitest";

import { createDingTalkClient } from "./dingtalk.js";

describe("createDingTalkClient", () => {
  it("lists departments through the app-authorized server API", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: "app-token-1" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          result: {
            dept_list: [
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

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.dingtalk.com/v1.0/oauth2/accessToken",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          appKey: "ding-client-id",
          appSecret: "ding-client-secret"
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.dingtalk.com/topapi/v2/department/listsub",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-acs-dingtalk-access-token": "app-token-1"
        },
        body: JSON.stringify({
          dept_id: "0"
        })
      })
    );
  });

  it("lists department users with explicit lifecycle mapping and main-department detection", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: "app-token-2" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
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
                dept_position_list: [
                  { dept_id: "1", is_main: false },
                  { dept_id: "2", is_main: true }
                ],
                active: true
              },
              {
                userid: "u2",
                name: "Bob",
                department: [3],
                active: false,
                status: "resigned"
              },
              {
                userid: "u3",
                name: "Carol",
                dept_id_list: ["6", "7"],
                primaryDepartmentExternalId: "6",
                dept_position_list: [{ dept_id: "7", is_main: 1 }],
                disable_status: 1,
                active: false
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
        primaryDepartmentExternalId: "3",
        lifecycleState: "departed"
      },
      {
        userId: "u3",
        displayName: "Carol",
        departmentExternalIds: ["6", "7"],
        primaryDepartmentExternalId: "7",
        lifecycleState: "disabled"
      }
    ]);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.dingtalk.com/v1.0/oauth2/accessToken",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          appKey: "ding-client-id",
          appSecret: "ding-client-secret"
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.dingtalk.com/topapi/v2/user/list",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-acs-dingtalk-access-token": "app-token-2"
        },
        body: JSON.stringify({
          dept_id: "1"
        })
      })
    );
  });

  it("gets a single organization user through the server API and only falls back to primary when one department exists", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: "app-token-3" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          result: {
            userid: "u-disabled",
            unionId: "union-disabled",
            corpId: "corp-1",
            name: "Disabled User",
            email: "disabled@example.com",
            dept_id_list: ["8", "8"],
            disable_status: 0,
            active: false
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
      lifecycleState: "active"
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.dingtalk.com/v1.0/oauth2/accessToken",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          appKey: "ding-client-id",
          appSecret: "ding-client-secret"
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.dingtalk.com/topapi/v2/user/get",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-acs-dingtalk-access-token": "app-token-3"
        },
        body: JSON.stringify({
          userid: "u-disabled"
        })
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

  it("retries app token acquisition after a transient failure", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("temporary token outage"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: "app-token-retry" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              dept_list: [{ dept_id: "2", name: "研发", parent_id: "0", order: 20 }]
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

    await expect(client.listDepartments({ parentId: "0" })).rejects.toThrow("temporary token outage");
    await expect(client.listDepartments({ parentId: "0" })).resolves.toEqual([
      {
        externalId: "2",
        name: "研发",
        parentExternalId: "0",
        sortOrder: 20
      }
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
