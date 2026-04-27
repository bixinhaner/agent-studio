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
});
