import { describe, expect, it } from "vitest";
import { portalFailedAssistantMessage } from "./chat-failure-message.js";

describe("portalFailedAssistantMessage", () => {
  it("persists a user-safe message and a hidden admin audit detail", () => {
    const message = portalFailedAssistantMessage({
      id: "assistant-1",
      runId: "run-1",
      presentation: {
        userMessage: "系统正在升级，请几分钟后重试。",
        rawDetail: "System is updating. Please retry in a few minutes.",
        code: "DEPLOYMENT_DRAIN",
        reasonCode: "deployment_drain"
      }
    });

    expect(message.content[0]).toEqual({
      type: "text",
      text: "系统正在升级，请几分钟后重试。"
    });
    expect(message.content[1]).toMatchObject({
      type: "data",
      name: "codex_process_audit",
      data: {
        rawDetail: "System is updating. Please retry in a few minutes.",
        code: "DEPLOYMENT_DRAIN"
      }
    });
    expect(message.status).toEqual({ type: "incomplete", reason: "error" });
    expect(message.metadata.custom).toMatchObject({ serverPersisted: true, failed: true });
  });
});
