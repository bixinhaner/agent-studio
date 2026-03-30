import { describe, expect, it, vi } from "vitest";

import { DingTalkIntegrationAdapter } from "./dingtalk-adapter.js";

describe("DingTalkIntegrationAdapter", () => {
  it("validates credentials through the DingTalk client", async () => {
    const validateCredentials = vi.fn(async () => undefined);
    const adapter = new DingTalkIntegrationAdapter(() => ({
      validateCredentials,
      async listDepartments() {
        return [];
      }
    }));

    const result = await adapter.validate({
      clientId: "ding-client-id",
      clientSecret: "ding-client-secret",
      redirectUri: "https://agent.example.com/auth/dingtalk/callback"
    });

    expect(validateCredentials).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "success",
      summary: "DingTalk credential validation succeeded"
    });
  });

  it("returns a failed validation outcome when the DingTalk client rejects", async () => {
    const adapter = new DingTalkIntegrationAdapter(() => ({
      async validateCredentials() {
        throw new Error("invalid dingtalk credentials");
      },
      async listDepartments() {
        return [];
      }
    }));

    const result = await adapter.validate({
      clientId: "ding-client-id"
    });

    expect(result).toMatchObject({
      status: "failed",
      summary: "DingTalk credential validation failed",
      detail: {
        message: "invalid dingtalk credentials"
      }
    });
  });
});
