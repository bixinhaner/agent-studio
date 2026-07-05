import { describe, expect, it } from "vitest";

import { isDingTalkResetCommand, normalizeDingTalkBotConfig } from "./bot-config.js";

describe("normalizeDingTalkBotConfig", () => {
  it("uses safe defaults when robot config is missing", () => {
    const config = normalizeDingTalkBotConfig({});

    expect(config.enabled).toBe(false);
    expect(config.receiveMode).toBe("stream");
    expect(config.replyMode).toBe("markdown");
    expect(config.singleChatEnabled).toBe(true);
    expect(config.groupChatEnabled).toBe(true);
    expect(config.autoSyncUsers).toBe(true);
    expect(config.streamingCardContentKey).toBe("content");
    expect(config.streamingCardUpdateIntervalMs).toBe(700);
    expect(config.streamingCardMinUpdateChars).toBe(24);
    expect(config.resetCommands).toContain("新对话");
    expect(config.errorAlertEnabled).toBe(false);
    expect(config.errorAlertUseSuperAdmins).toBe(true);
    expect(config.errorAlertUserIds).toEqual([]);
    expect(config.errorAlertThrottleSeconds).toBe(300);
  });

  it("normalizes configured scope, mode, knowledge sets, and reply text", () => {
    const config = normalizeDingTalkBotConfig({
      robot: {
        enabled: true,
        replyMode: "ai_card_stream",
        agentModeId: " mode-1 ",
        knowledgeSetIds: ["ks-1", "ks-1", "", " ks-2 "],
        singleChatEnabled: false,
        groupChatEnabled: true,
        autoSyncUsers: false,
        streamingCardTemplateId: " template.schema ",
        streamingCardContentKey: " answer ",
        streamingCardUpdateIntervalMs: "500",
        streamingCardMinUpdateChars: "12",
        resetCommands: [" Restart ", "restart", "/new"],
        errorAlertEnabled: true,
        errorAlertUseSuperAdmins: false,
        errorAlertUserIds: [" user-1 ", "user-1", "", "user-2"],
        errorAlertThrottleSeconds: "60",
        errorMessage: "自定义错误"
      }
    });

    expect(config.enabled).toBe(true);
    expect(config.replyMode).toBe("ai_card_stream");
    expect(config.agentModeId).toBe("mode-1");
    expect(config.knowledgeSetIds).toEqual(["ks-1", "ks-2"]);
    expect(config.singleChatEnabled).toBe(false);
    expect(config.groupChatEnabled).toBe(true);
    expect(config.autoSyncUsers).toBe(false);
    expect(config.streamingCardTemplateId).toBe("template.schema");
    expect(config.streamingCardContentKey).toBe("answer");
    expect(config.streamingCardUpdateIntervalMs).toBe(500);
    expect(config.streamingCardMinUpdateChars).toBe(12);
    expect(config.resetCommands).toEqual(["Restart", "restart", "/new"]);
    expect(config.errorAlertEnabled).toBe(true);
    expect(config.errorAlertUseSuperAdmins).toBe(false);
    expect(config.errorAlertUserIds).toEqual(["user-1", "user-2"]);
    expect(config.errorAlertThrottleSeconds).toBe(60);
    expect(config.errorMessage).toBe("自定义错误");
  });
});

describe("isDingTalkResetCommand", () => {
  it("matches reset commands case-insensitively after trimming", () => {
    const config = normalizeDingTalkBotConfig({
      robot: {
        resetCommands: ["RESET", "/new"]
      }
    });

    expect(isDingTalkResetCommand(" reset ", config)).toBe(true);
    expect(isDingTalkResetCommand("/NEW", config)).toBe(true);
    expect(isDingTalkResetCommand("继续对话", config)).toBe(false);
  });
});
