import { describe, expect, it, vi } from "vitest";

import { createDingTalkClient } from "./dingtalk.js";

describe("createDingTalkClient", () => {
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
