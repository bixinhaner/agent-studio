import { describe, expect, it, vi } from "vitest";

import {
  CustomerExperienceIssueReporter,
  shouldCreateIssueForProductFeedback
} from "./customer-experience-issue-reporter.js";

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

function testReporter() {
  const recovery = testRecovery();
  const notifications = testNotifications();
  const sendWorkNotice = vi.fn(async () => undefined);
  const listSuperAdminDingTalkUserIds = vi.fn(async () => ["admin-1"]);
  const resolveUserIdentity = vi.fn(async () => ({
    displayName: "Example User",
    email: "example@baicells.com"
  }));
  return {
    recovery,
    notifications,
    sendWorkNotice,
    listSuperAdminDingTalkUserIds,
    resolveUserIdentity,
    reporter: new CustomerExperienceIssueReporter({
      recovery,
      notifications,
      sendWorkNotice,
      listSuperAdminDingTalkUserIds,
      resolveUserIdentity
    })
  };
}

describe("CustomerExperienceIssueReporter", () => {
  it("records negative answer feedback as a customer experience follow-up case", async () => {
    const { reporter, recovery, notifications, sendWorkNotice } = testReporter();

    const result = await reporter.reportNegativeConversationFeedback({
      organizationId: "org-1",
      userId: "user-1",
      threadId: "thread-1",
      messageId: "message-1",
      audience: "external",
      contentPreview: "answer preview",
      comment: "not accurate",
      occurredAt: new Date("2026-07-07T01:02:03.000Z")
    });

    expect(result.notification.status).toBe("sent");
    expect(recovery.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        recoveryKey: "customer_experience_issue:conversation_negative_feedback:portal:thread-1:message-1",
        source: "conversation_negative_feedback",
        channel: "portal",
        audience: "external",
        severity: "medium",
        reasonCode: "negative_feedback",
        title: "站内聊天体验反馈",
        questionPreview: "not accurate",
        failureDetail: "用户提交了负向回答反馈：not accurate",
        metadata: expect.objectContaining({
          customerExperienceIssue: true,
          issueType: "negative_feedback",
          feedbackType: "negative",
          assistantMessageId: "message-1"
        })
      })
    );
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "customer_experience.issue_detected",
        payload: expect.objectContaining({
          category: "customer_experience_issue",
          reasonCode: "negative_feedback",
          recoveryCaseId: "case-1"
        })
      })
    );
    expect(sendWorkNotice).toHaveBeenCalledWith({
      userIds: ["admin-1"],
      message: expect.stringContaining("用户：Example User <example@baicells.com>\n用户 ID：user-1")
    });
  });

  it("records only high severity product bugs as follow-up cases", async () => {
    const { reporter, recovery, notifications } = testReporter();

    await expect(
      reporter.reportProductFeedback({
        id: "feedback-1",
        organizationId: "org-1",
        userId: "user-1",
        threadId: "thread-1",
        type: "bug",
        severity: "blocking",
        description: "Cannot open the portal",
        createdAt: "2026-07-07T02:03:04.000Z",
        audience: "external"
      })
    ).resolves.toMatchObject({
      recoveryCaseId: "case-1",
      notification: { status: "sent", notificationId: "notification-1" }
    });

    expect(recovery.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        recoveryKey: "customer_experience_issue:product_feedback_blocking:portal:thread-1:feedback-1",
        source: "product_feedback_blocking",
        reasonCode: "product_feedback_blocking",
        severity: "blocking",
        title: "阻塞级系统反馈",
        questionPreview: "Cannot open the portal",
        failureDetail: "用户提交了阻塞级系统 Bug 反馈"
      })
    );
    expect(notifications.create).toHaveBeenCalledTimes(1);

    await expect(
      reporter.reportProductFeedback({
        id: "feedback-2",
        type: "feature_request",
        severity: "high",
        description: "Please add a shortcut"
      })
    ).resolves.toBeUndefined();
    expect(recovery.recordFailure).toHaveBeenCalledTimes(1);
  });
});

describe("shouldCreateIssueForProductFeedback", () => {
  it("keeps ordinary suggestions out of the follow-up case flow", () => {
    expect(shouldCreateIssueForProductFeedback({ type: "bug", severity: "high" })).toBe(true);
    expect(shouldCreateIssueForProductFeedback({ type: "bug", severity: "blocking" })).toBe(true);
    expect(shouldCreateIssueForProductFeedback({ type: "bug", severity: "medium" })).toBe(false);
    expect(shouldCreateIssueForProductFeedback({ type: "usability_issue", severity: "high" })).toBe(false);
    expect(shouldCreateIssueForProductFeedback({ type: "feature_request", severity: "blocking" })).toBe(false);
  });
});
