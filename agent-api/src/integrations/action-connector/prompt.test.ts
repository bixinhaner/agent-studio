import { describe, expect, it } from "vitest";

import { buildActionConnectorRuntimePrompt } from "./prompt.js";

describe("buildActionConnectorRuntimePrompt", () => {
  it("keeps connector runtimeInstruction out of the Codex prompt", () => {
    const prompt = buildActionConnectorRuntimePrompt({
      config: {
        displayName: "Operations System",
        baseUrl: "",
        delegationHeader: "Authorization",
        agentModeId: "operations-agent",
        runtimeInstruction: "Use this legacy connector prompt.",
        policy: {
          allowReadActions: true,
          allowLowRiskActions: false,
          allowHighRiskActions: false,
          allowedMethods: ["GET"],
          blockedPathPrefixes: ["/api/v1/auth/*"],
          toolTimeoutSeconds: 30,
          maxResponseBytes: 262144
        }
      },
      request: {
        message: "show online devices",
        mode: "execute",
        locale: "zh-CN",
        timezone: "Asia/Shanghai",
        context: { path: "/devices", externalIdentity: { externalUserId: "user-1" } }
      },
      conversationId: "conversation-1",
      runId: "run-1",
      cliPath: "/tmp/action-connector-cli.mjs"
    });

    expect(prompt).toContain("node \"/tmp/action-connector-cli.mjs\" catalog \"query text\"");
    expect(prompt).toContain("当前页面上下文");
    expect(prompt).toContain("show online devices");
    expect(prompt).toContain("\"allowedMethods\"");
    expect(prompt).not.toContain("Connector 运行说明");
    expect(prompt).not.toContain("Use this legacy connector prompt.");
  });
});
