import { describe, expect, it } from "vitest";

import { buildActionConnectorRuntimePrompt } from "./prompt.js";

describe("buildActionConnectorRuntimePrompt", () => {
  it("renders the configurable action connector runtime prompt", () => {
    const prompt = buildActionConnectorRuntimePrompt({
      config: {
        displayName: "Operations System",
        agentModeId: "operations-agent",
        runtimePrompt: [
          "Connector: {{displayName}}",
          "CLI: node {{cliPathJson}} catalog \"query text\"",
          "Policy: {{policyJson}}",
          "Context: {{contextJson}}",
          "Question: {{message}}"
        ].join("\n"),
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
    expect(prompt).toContain("Connector: Operations System");
    expect(prompt).toContain("Context:");
    expect(prompt).toContain("show online devices");
    expect(prompt).toContain("\"allowedMethods\"");
  });

  it("does not read the removed legacy runtimeInstruction field", () => {
    const prompt = buildActionConnectorRuntimePrompt({
      config: {
        displayName: "Operations System",
        agentModeId: "operations-agent",
        runtimePrompt: "",
        policy: {
          allowReadActions: true,
          allowLowRiskActions: false,
          allowHighRiskActions: false,
          allowedMethods: ["GET"],
          blockedPathPrefixes: [],
          toolTimeoutSeconds: 30,
          maxResponseBytes: 262144
        },
        runtimeInstruction: "Use this legacy connector prompt."
      } as never,
      request: {
        message: "show online devices",
        mode: "execute",
        locale: "zh-CN",
        timezone: "Asia/Shanghai",
        context: {}
      },
      conversationId: "conversation-1",
      runId: "run-1",
      cliPath: "/tmp/action-connector-cli.mjs"
    });

    expect(prompt).toContain("可用 CLI");
    expect(prompt).toContain("优先遵循已启用 Skill");
    expect(prompt).toContain("同一对话中已读取的 Skill 不要重复打开");
    expect(prompt).toContain("完整本地 API 手册");
    expect(prompt).toContain("校验手册版本");
    expect(prompt).toContain("读取一个分类索引和一个操作文档");
    expect(prompt).toContain("版本匹配时不要调用 catalog 或 describe");
    expect(prompt).toContain("只有未启用完整本地手册的 Connector 才使用 catalog/describe");
    expect(prompt).not.toContain("先用 catalog/describe");
    expect(prompt).not.toContain("仅当操作未知时才搜索 catalog");
    expect(prompt).not.toContain("Use this legacy connector prompt.");
  });
});
