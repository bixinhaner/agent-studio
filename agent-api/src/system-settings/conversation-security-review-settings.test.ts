import { describe, expect, it } from "vitest";

import {
  createDefaultSystemSettingsPayload,
  systemSettingsConversationSecurityReviewPatchSchema,
  systemSettingsConversationSecurityReviewSchema
} from "./types.js";

describe("conversation security review settings", () => {
  it("默认关闭且以外部用户观察模式开始", () => {
    const value = createDefaultSystemSettingsPayload().conversationSecurityReview;
    expect(value.enabled).toBe(false);
    expect(value.observationMode).toBe(true);
    expect(value.audiences).toEqual({ externalUsers: true, internalUsers: false });
    expect(value.engine).toBe("codex_runtime");
  });

  it("拒绝倒置的风险阈值", () => {
    const value = createDefaultSystemSettingsPayload().conversationSecurityReview;
    const result = systemSettingsConversationSecurityReviewSchema.safeParse({
      ...value,
      thresholds: { record: 70, notify: 60, critical: 90 }
    });
    expect(result.success).toBe(false);
  });

  it("指定接收人模式至少需要一个用户", () => {
    const value = createDefaultSystemSettingsPayload().conversationSecurityReview;
    const result = systemSettingsConversationSecurityReviewSchema.safeParse({
      ...value,
      notification: {
        ...value.notification,
        recipientMode: "specified_users",
        recipientUserIds: []
      }
    });
    expect(result.success).toBe(false);
  });

  it("支持仅更新嵌套范围和上下文字段", () => {
    expect(systemSettingsConversationSecurityReviewPatchSchema.parse({
      audiences: { internalUsers: true },
      context: { currentThreadTurns: 12 },
      notification: { cooldownMinutes: 90 }
    })).toEqual({
      audiences: { internalUsers: true },
      context: { currentThreadTurns: 12 },
      notification: { cooldownMinutes: 90 }
    });
  });
});
