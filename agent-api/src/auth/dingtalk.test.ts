import { afterEach, describe, expect, it, vi } from "vitest";

import { createDingTalkClient, type DingTalkConfig } from "./dingtalk.js";

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json"
    },
    ...init
  });
}

const TEST_CONFIG: DingTalkConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "https://example.com/auth/dingtalk/callback",
  scope: "openid"
};

describe("createDingTalkClient", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses root department 1 by default and parses listsub result arrays", async () => {
    const requestedDepartmentIds: unknown[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1.0/oauth2/accessToken")) {
        return jsonResponse({
          accessToken: "app-token",
          expireIn: 7200
        });
      }
      if (url.startsWith("https://oapi.dingtalk.com/topapi/v2/department/listsub")) {
        requestedDepartmentIds.push(JSON.parse(String(init?.body ?? "{}")).dept_id);
        return jsonResponse({
          errcode: 0,
          result: [
            {
              dept_id: 66894063,
              name: "Office",
              parent_id: 1,
              order: 10
            }
          ]
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const client = createDingTalkClient(TEST_CONFIG, fetchMock);
    const departments = await client.listDepartments({});

    expect(requestedDepartmentIds).toEqual(["1"]);
    expect(departments).toEqual([
      {
        externalId: "66894063",
        name: "Office",
        parentExternalId: "1",
        sortOrder: 10
      }
    ]);
  });

  it("paginates department user list requests with cursor and size", async () => {
    const requestedBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1.0/oauth2/accessToken")) {
        return jsonResponse({
          accessToken: "app-token",
          expireIn: 7200
        });
      }
      if (url.startsWith("https://oapi.dingtalk.com/topapi/v2/user/list")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        requestedBodies.push(body);
        if (body.cursor === 0) {
          return jsonResponse({
            errcode: 0,
            result: {
              has_more: "true",
              next_cursor: 100,
              list: [
                {
                  userid: "user-1",
                  name: "Alice",
                  dept_id_list: [66894063],
                  title: "Support Engineer",
                  job_number: "E001",
                  mobile: "13800138000",
                  telephone: "029-100000",
                  avatar: "https://example.com/avatar.png",
                  work_place: "Xi'an",
                  hired_date: 1770000000000,
                  manager_userid: "manager-1",
                  admin: true,
                  boss: false,
                  dept_position_list: [
                    {
                      dept_id: 66894063,
                      position: "Support Engineer",
                      is_main: true,
                      dept_order: 12,
                      leader: true
                    }
                  ],
                  extension: {
                    location: "office"
                  }
                }
              ]
            }
          });
        }
        return jsonResponse({
          errcode: 0,
          result: {
            has_more: false,
            list: [
              {
                userid: "user-2",
                name: "Bob",
                dept_id_list: [66894063]
              }
            ]
          }
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const client = createDingTalkClient(TEST_CONFIG, fetchMock);
    const users = await client.listDepartmentUsers({ departmentId: "66894063" });

    expect(requestedBodies).toEqual([
      {
        dept_id: "66894063",
        cursor: 0,
        size: 100
      },
      {
        dept_id: "66894063",
        cursor: 100,
        size: 100
      }
    ]);
    expect(users.map((user) => user.userId)).toEqual(["user-1", "user-2"]);
    expect(users[0]).toMatchObject({
      title: "Support Engineer",
      jobNumber: "E001",
      mobile: "13800138000",
      telephone: "029-100000",
      avatarUrl: "https://example.com/avatar.png",
      workPlace: "Xi'an",
      hiredAt: "2026-02-02T02:40:00.000Z",
      managerDingTalkUserId: "manager-1",
      isAdmin: true,
      isBoss: false,
      isLeader: true,
      extension: {
        extension: {
          location: "office"
        }
      },
      departmentPositions: [
        {
          departmentExternalId: "66894063",
          position: "Support Engineer",
          isPrimary: true,
          sortOrder: 12,
          isLeader: true
        }
      ]
    });
  });

  it("refreshes the cached app access token after it expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-03T00:00:00.000Z"));

    let issuedTokenCount = 0;
    const orgApiTokens: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/v1.0/oauth2/accessToken")) {
        issuedTokenCount += 1;
        return jsonResponse({
          accessToken: `app-token-${issuedTokenCount}`,
          expireIn: 120
        });
      }
      if (url.startsWith("https://oapi.dingtalk.com/topapi/v2/department/listsub")) {
        orgApiTokens.push(new URL(url).searchParams.get("access_token") ?? "");
        return jsonResponse({
          errcode: 0,
          result: {
            dept_list: []
          }
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const client = createDingTalkClient(TEST_CONFIG, fetchMock);

    await client.listDepartments({ parentId: "0" });
    vi.advanceTimersByTime(61_000);
    await client.listDepartments({ parentId: "0" });

    expect(orgApiTokens).toEqual(["app-token-1", "app-token-2"]);
  });

  it("retries org api calls with a fresh app access token after a 40014 error", async () => {
    let issuedTokenCount = 0;
    const unionLookupTokens: string[] = [];
    const userTokenRedirectUris: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1.0/oauth2/accessToken")) {
        issuedTokenCount += 1;
        return jsonResponse({
          accessToken: `app-token-${issuedTokenCount}`,
          expireIn: 7200
        });
      }
      if (url.endsWith("/v1.0/oauth2/userAccessToken")) {
        userTokenRedirectUris.push(String(JSON.parse(String(init?.body ?? "{}")).redirectUri ?? ""));
        return jsonResponse({
          accessToken: "user-access-token"
        });
      }
      if (url.endsWith("/v1.0/contact/users/me")) {
        return jsonResponse({
          unionId: "union-1"
        });
      }
      if (url.startsWith("https://oapi.dingtalk.com/topapi/user/getbyunionid")) {
        const accessToken = new URL(url).searchParams.get("access_token") ?? "";
        unionLookupTokens.push(accessToken);
        if (accessToken === "app-token-1") {
          return jsonResponse({
            errcode: 40014,
            errmsg: "invalid access_token"
          });
        }
        return jsonResponse({
          errcode: 0,
          result: {
            userid: "user-1"
          }
        });
      }
      if (url.startsWith("https://oapi.dingtalk.com/topapi/v2/user/get")) {
        expect(new URL(url).searchParams.get("access_token")).toBe("app-token-2");
        return jsonResponse({
          errcode: 0,
          result: {
            userid: "user-1",
            name: "Alice",
            email: "alice@example.com"
          }
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const client = createDingTalkClient(TEST_CONFIG, fetchMock);

    const identity = await client.exchangeCode("oauth-code", {
      redirectUri: "https://celix.baicells.com/auth/dingtalk/callback"
    });

    expect(identity).toMatchObject({
      unionId: "union-1",
      userId: "user-1",
      displayName: "Alice",
      email: "alice@example.com"
    });
    expect(userTokenRedirectUris).toEqual(["https://celix.baicells.com/auth/dingtalk/callback"]);
    expect(unionLookupTokens).toEqual(["app-token-1", "app-token-2"]);
  });

  it("creates todo tasks with app access tokens and unionId executors", async () => {
    const todoRequests: Array<{ url: string; body: Record<string, unknown>; token: string }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1.0/oauth2/accessToken")) {
        return jsonResponse({
          accessToken: "app-token",
          expireIn: 7200
        });
      }
      if (url.startsWith("https://api.dingtalk.com/v1.0/todo/users/union-1/tasks")) {
        todoRequests.push({
          url,
          token: String((init?.headers as Record<string, string>)?.["x-acs-dingtalk-access-token"] ?? ""),
          body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
        });
        return jsonResponse({
          id: "todo-task-1",
          sourceId: "review-1"
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const client = createDingTalkClient(TEST_CONFIG, fetchMock);
    const result = await client.createTodoTask?.({
      unionId: "union-1",
      sourceId: "review-1",
      subject: "Review Zendesk AI response",
      description: "Please score the AI output.",
      dueTime: 1770000000000,
      detailUrl: {
        pcUrl: "https://example.com/review/1",
        appUrl: "https://example.com/review/1"
      }
    });

    expect(result).toEqual({ taskId: "todo-task-1", sourceId: "review-1" });
    expect(todoRequests).toHaveLength(1);
    expect(new URL(todoRequests[0].url).searchParams.get("operatorId")).toBe("union-1");
    expect(todoRequests[0].token).toBe("app-token");
    expect(todoRequests[0].body).toMatchObject({
      sourceId: "review-1",
      creatorId: "union-1",
      executorIds: ["union-1"],
      isOnlyShowExecutor: true,
      notifyConfigs: {
        dingNotify: "1"
      }
    });
  });

  it("marks todo tasks done", async () => {
    const todoUpdates: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1.0/oauth2/accessToken")) {
        return jsonResponse({
          accessToken: "app-token",
          expireIn: 7200
        });
      }
      if (url.startsWith("https://api.dingtalk.com/v1.0/todo/users/union-1/tasks/todo-task-1")) {
        todoUpdates.push({
          url,
          body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
        });
        return jsonResponse({ result: true });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const client = createDingTalkClient(TEST_CONFIG, fetchMock);
    await client.completeTodoTask?.({
      unionId: "union-1",
      taskId: "todo-task-1"
    });

    expect(todoUpdates).toHaveLength(1);
    expect(new URL(todoUpdates[0].url).searchParams.get("operatorId")).toBe("union-1");
    expect(todoUpdates[0].body).toEqual({
      done: true,
      executorIds: ["union-1"],
      participantIds: []
    });
  });
});
