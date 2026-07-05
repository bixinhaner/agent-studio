import { describe, expect, it, vi } from "vitest";

import { DingTalkBotErrorNotifier } from "./bot-error-notifier.js";
import type { DingTalkBotInstance } from "./bot-stream-service.js";
import type {
  CreateNotificationRecordInput,
  NotificationRecord,
  UpdateNotificationRecordInput
} from "../../persistence/notification-record-repository.js";

function testInstance(robot?: Partial<DingTalkBotInstance["robot"]>): DingTalkBotInstance {
  return {
    id: "instance-1",
    slug: "dingtalk-main",
    name: "DingTalk Main",
    status: "active",
    organizationId: "org-1",
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://example.com/auth/dingtalk/callback",
    scope: "openid",
    apiBaseUrl: "https://api.dingtalk.test",
    alertAgentId: "agent-1",
    alertUserIds: ["fallback-1"],
    robot: {
      enabled: true,
      receiveMode: "stream",
      replyMode: "markdown",
      agentModeId: "mode-1",
      knowledgeSetIds: [],
      singleChatEnabled: true,
      groupChatEnabled: true,
      groupReplyMode: "mention_only",
      autoSyncUsers: true,
      streamingCardContentKey: "content",
      streamingCardUpdateIntervalMs: 700,
      streamingCardMinUpdateChars: 24,
      resetCommands: ["新对话"],
      errorAlertEnabled: true,
      errorAlertUseSuperAdmins: true,
      errorAlertUserIds: [],
      errorAlertThrottleSeconds: 300,
      unauthorizedMessage: "无权限",
      busyMessage: "处理中",
      resetConfirmationMessage: "已开启新对话",
      unsupportedMessage: "暂时只支持文本消息。",
      errorMessage: "处理失败",
      ...robot
    }
  };
}

function testMessage() {
  return {
    msgId: "ding-message-1",
    conversationId: "conversation-1",
    conversationType: "1",
    senderNick: "Alice",
    senderStaffId: "staff-1"
  };
}

function testNotifications() {
  return {
    create: vi.fn(async (input: CreateNotificationRecordInput): Promise<NotificationRecord> => ({
      id: "notification-1",
      organizationId: input.organizationId,
      channelType: input.channelType,
      targetRef: input.targetRef,
      eventType: input.eventType,
      status: input.status ?? "pending",
      payload: input.payload,
      errorMessage: input.errorMessage ?? undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })),
    update: vi.fn(async (input: { id: string; changes: UpdateNotificationRecordInput }): Promise<NotificationRecord> => ({
      id: input.id,
      organizationId: "org-1",
      channelType: "dingtalk",
      targetRef: "target",
      eventType: "dingtalk_bot.error_reply",
      status: input.changes.status ?? "sent",
      payload: {},
      errorMessage: input.changes.errorMessage ?? undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }))
  };
}

describe("DingTalkBotErrorNotifier", () => {
  it("sends to configured DingTalk users and records notification status", async () => {
    const notifications = testNotifications();
    const sendWorkNotice = vi.fn(async () => undefined);
    const listSuperAdminDingTalkUserIds = vi.fn(async () => ["admin-1"]);
    const notifier = new DingTalkBotErrorNotifier({
      notifications,
      sendWorkNotice,
      listSuperAdminDingTalkUserIds
    });

    const result = await notifier.notify({
      instance: testInstance({ errorAlertUserIds: [" user-1 ", "user-1", "user-2"] }),
      robotMessage: testMessage(),
      text: "员工请半天假怎么打卡？",
      error: new Error("runtime failed"),
      actor: {
        id: "user-1",
        organizationId: "org-1",
        displayName: "Alice",
        dingtalkUserId: "staff-1"
      },
      threadId: "thread-1",
      sessionId: "session-1",
      occurredAt: new Date("2026-07-05T06:30:00.000Z")
    });

    expect(result).toMatchObject({ status: "sent", recipientUserIds: ["user-1", "user-2"] });
    expect(listSuperAdminDingTalkUserIds).not.toHaveBeenCalled();
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        channelType: "dingtalk",
        targetRef: "dingtalk_bot:instance-1:thread-1:ding-message-1",
        eventType: "dingtalk_bot.error_reply",
        status: "pending",
        payload: expect.objectContaining({
          recipientUserIds: ["user-1", "user-2"],
          errorMessage: "runtime failed",
          questionPreview: "员工请半天假怎么打卡？"
        })
      })
    );
    expect(sendWorkNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: ["user-1", "user-2"],
        message: expect.stringContaining("钉钉机器人问答失败")
      })
    );
    expect(notifications.update).toHaveBeenCalledWith({
      id: "notification-1",
      changes: {
        status: "sent",
        errorMessage: null
      }
    });
  });

  it("falls back to super admins and then general alert users", async () => {
    const superAdminNotifications = testNotifications();
    const superAdminSender = vi.fn(async () => undefined);
    const superAdminNotifier = new DingTalkBotErrorNotifier({
      notifications: superAdminNotifications,
      sendWorkNotice: superAdminSender,
      listSuperAdminDingTalkUserIds: vi.fn(async () => ["admin-1"])
    });

    await superAdminNotifier.notify({
      instance: testInstance(),
      robotMessage: testMessage(),
      text: "hello",
      error: new Error("runtime failed"),
      actor: { organizationId: "org-1" },
      occurredAt: new Date("2026-07-05T06:30:00.000Z")
    });
    expect(superAdminSender).toHaveBeenCalledWith(expect.objectContaining({ userIds: ["admin-1"] }));

    const fallbackNotifications = testNotifications();
    const fallbackSender = vi.fn(async () => undefined);
    const fallbackNotifier = new DingTalkBotErrorNotifier({
      notifications: fallbackNotifications,
      sendWorkNotice: fallbackSender,
      listSuperAdminDingTalkUserIds: vi.fn(async () => [])
    });

    await fallbackNotifier.notify({
      instance: testInstance(),
      robotMessage: testMessage(),
      text: "hello",
      error: new Error("another runtime failed"),
      actor: { organizationId: "org-1" },
      occurredAt: new Date("2026-07-05T06:30:00.000Z")
    });
    expect(fallbackSender).toHaveBeenCalledWith(expect.objectContaining({ userIds: ["fallback-1"] }));
  });

  it("marks notification failed when DingTalk delivery fails", async () => {
    const notifications = testNotifications();
    const notifier = new DingTalkBotErrorNotifier({
      notifications,
      sendWorkNotice: vi.fn(async () => {
        throw new Error("DingTalk alert agent is not configured");
      }),
      listSuperAdminDingTalkUserIds: vi.fn(async () => ["admin-1"]),
      logger: { warn: vi.fn() }
    });

    const result = await notifier.notify({
      instance: testInstance(),
      robotMessage: testMessage(),
      text: "hello",
      error: new Error("runtime failed"),
      occurredAt: new Date("2026-07-05T06:30:00.000Z")
    });

    expect(result).toMatchObject({ status: "failed", detail: "DingTalk alert agent is not configured" });
    expect(notifications.update).toHaveBeenCalledWith({
      id: "notification-1",
      changes: {
        status: "failed",
        errorMessage: "DingTalk alert agent is not configured"
      }
    });
  });

  it("throttles repeated errors for the same instance and error message", async () => {
    const notifications = testNotifications();
    const sendWorkNotice = vi.fn(async () => undefined);
    const notifier = new DingTalkBotErrorNotifier({
      notifications,
      sendWorkNotice,
      listSuperAdminDingTalkUserIds: vi.fn(async () => ["admin-1"])
    });
    const instance = testInstance({ errorAlertThrottleSeconds: 300 });

    await notifier.notify({
      instance,
      robotMessage: testMessage(),
      text: "first",
      error: new Error("runtime failed"),
      occurredAt: new Date("2026-07-05T06:30:00.000Z")
    });
    const second = await notifier.notify({
      instance,
      robotMessage: { ...testMessage(), msgId: "ding-message-2" },
      text: "second",
      error: new Error("runtime failed"),
      occurredAt: new Date("2026-07-05T06:31:00.000Z")
    });

    expect(second).toEqual({ status: "throttled", detail: "DingTalk bot error alert was throttled" });
    expect(sendWorkNotice).toHaveBeenCalledTimes(1);
    expect(notifications.create).toHaveBeenCalledTimes(1);
  });
});
