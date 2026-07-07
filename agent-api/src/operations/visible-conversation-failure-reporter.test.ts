import { describe, expect, it, vi } from "vitest";

import { CustomerExperienceIssueReporter } from "./customer-experience-issue-reporter.js";
import { VisibleConversationFailureReporter } from "./visible-conversation-failure-reporter.js";

function testRecovery() {
  return {
    recordFailure: vi.fn(async () => ({ id: "case-1" }))
  };
}

function testNotifications() {
  return {
    create: vi.fn(async (input: Record<string, unknown>) => ({
      id: "notification-1",
      ...input
    })),
    update: vi.fn(async (_input: unknown) => undefined)
  };
}

function testIssues(input: {
  recovery: ReturnType<typeof testRecovery>;
  notifications: ReturnType<typeof testNotifications>;
  sendWorkNotice: ReturnType<typeof vi.fn>;
  listSuperAdminDingTalkUserIds: ReturnType<typeof vi.fn>;
}) {
  return new CustomerExperienceIssueReporter({
    recovery: input.recovery,
    notifications: input.notifications,
    sendWorkNotice: input.sendWorkNotice,
    listSuperAdminDingTalkUserIds: input.listSuperAdminDingTalkUserIds
  });
}

describe("VisibleConversationFailureReporter", () => {
  it("records a recovery case and sends a DingTalk admin notice", async () => {
    const recovery = testRecovery();
    const notifications = testNotifications();
    const sendWorkNotice = vi.fn(async () => undefined);
    const listSuperAdminDingTalkUserIds = vi.fn(async () => ["admin-1"]);
    const reporter = new VisibleConversationFailureReporter({
      issues: testIssues({ recovery, notifications, sendWorkNotice, listSuperAdminDingTalkUserIds })
    });

    const result = await reporter.report({
      source: "portal_chat_stream",
      channel: "portal",
      organizationId: "org-1",
      userId: "user-1",
      threadId: "thread-1",
      sessionId: "session-1",
      userMessageId: "message-1",
      audience: "external",
      title: "站内聊天回答失败",
      questionPreview: "hello",
      failureDetail: "runtime crashed",
      metadata: {
        traceId: "trace-1"
      },
      occurredAt: new Date("2026-07-06T01:02:03.000Z")
    });

    expect(result).toEqual({
      recoveryCaseId: "case-1",
      notification: { status: "sent", notificationId: "notification-1" }
    });
    expect(recovery.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        recoveryKey: "visible_failure:portal_chat_stream:portal:thread-1:message-1",
        organizationId: "org-1",
        userId: "user-1",
        threadId: "thread-1",
        source: "portal_chat_stream",
        channel: "portal",
        audience: "external",
        title: "站内聊天回答失败",
        questionPreview: "hello",
        failureDetail: "runtime crashed",
        metadata: expect.objectContaining({
          traceId: "trace-1",
          visibleFailure: true,
          sessionId: "session-1",
          userMessageId: "message-1"
        })
      })
    );
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        channelType: "dingtalk",
        targetRef: "conversation_visible_failure:visible_failure:portal_chat_stream:portal:thread-1:message-1",
        eventType: "conversation.visible_failure",
        status: "pending",
        payload: expect.objectContaining({
          category: "conversation_visible_failure",
          channelLabel: "站内聊天",
          recoveryCaseId: "case-1",
          recipientUserIds: ["admin-1"]
        })
      })
    );
    expect(sendWorkNotice).toHaveBeenCalledWith({
      userIds: ["admin-1"],
      message: expect.stringContaining("[AgentStudio] 用户侧回答失败")
    });
    expect(notifications.update).toHaveBeenCalledWith({
      id: "notification-1",
      changes: expect.objectContaining({
        status: "sent",
        errorMessage: null
      })
    });
  });

  it("can record the case without sending an admin notice", async () => {
    const recovery = testRecovery();
    const notifications = testNotifications();
    const sendWorkNotice = vi.fn(async () => undefined);
    const listSuperAdminDingTalkUserIds = vi.fn(async () => ["admin-1"]);
    const reporter = new VisibleConversationFailureReporter({
      issues: testIssues({ recovery, notifications, sendWorkNotice, listSuperAdminDingTalkUserIds })
    });

    const result = await reporter.report({
      source: "dingtalk_bot_error",
      channel: "dingtalk_bot",
      threadId: "thread-1",
      userMessageId: "message-1",
      failureDetail: "runtime crashed",
      notifyAdmins: false
    });

    expect(result).toEqual({
      recoveryCaseId: "case-1",
      notification: {
        status: "disabled",
        detail: "admin notification disabled for this issue"
      }
    });
    expect(recovery.recordFailure).toHaveBeenCalledTimes(1);
    expect(notifications.create).not.toHaveBeenCalled();
    expect(sendWorkNotice).not.toHaveBeenCalled();
    expect(listSuperAdminDingTalkUserIds).not.toHaveBeenCalled();
  });

  it("falls back to configured DingTalk recipients when no super admin user id is available", async () => {
    const recovery = testRecovery();
    const notifications = testNotifications();
    const sendWorkNotice = vi.fn(async () => undefined);
    const reporter = new VisibleConversationFailureReporter({
      issues: testIssues({
        recovery,
        notifications,
        sendWorkNotice,
        listSuperAdminDingTalkUserIds: vi.fn(async () => [])
      })
    });

    await reporter.report({
      source: "crest_chat_stream",
      channel: "crest",
      organizationId: "org-1",
      userId: "user-1",
      threadId: "thread-1",
      sessionId: "session-1",
      failureDetail: "runtime crashed"
    });

    expect(sendWorkNotice).toHaveBeenCalledWith({
      userIds: undefined,
      message: expect.stringContaining("渠道：CREST")
    });
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          usesConfiguredDefaultRecipients: true
        })
      })
    );
  });
});
