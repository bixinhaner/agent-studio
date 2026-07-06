import { describe, expect, it, vi } from "vitest";

import { ConversationRecoveryService } from "./conversation-recovery-service.js";
import type { AuthEmailSender } from "../auth/email.js";
import type {
  CreateNotificationRecordInput,
  NotificationRecord,
  UpdateNotificationRecordInput
} from "../persistence/notification-record-repository.js";

const now = new Date("2026-07-06T02:30:00.000Z");

function recoveryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "case-1",
    recoveryKey: "dingtalk_bot_error:instance-1:thread-1:msg-1",
    organizationId: "org-1",
    userId: "user-1",
    threadId: "thread-1",
    source: "dingtalk_bot_error",
    channel: "dingtalk_bot",
    audience: "external",
    status: "open",
    severity: "high",
    reasonCode: "runtime_error",
    title: "钉钉机器人问答失败：Alice",
    questionPreview: "hello",
    failureDetail: "runtime failed",
    rootCause: null,
    resolutionSummary: null,
    recipientEmail: null,
    emailSubject: null,
    emailBodyText: null,
    emailNotificationId: null,
    compensationPlanId: null,
    compensationDays: null,
    compensationOrderId: null,
    compensationGrantId: null,
    failureCount: 1,
    metadata: null,
    occurredAt: now,
    lastOccurredAt: now,
    notifiedAt: null,
    compensatedAt: null,
    closedAt: null,
    createdByUserId: null,
    updatedByUserId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function createDb(row = recoveryRow()) {
  return {
    conversationRecoveryCase: {
      upsert: vi.fn(async (args) => ({ ...row, ...args.create })),
      findUnique: vi.fn(async () => row),
      findMany: vi.fn(async () => [row]),
      count: vi.fn(async () => 1),
      update: vi.fn(async (args) => ({ ...row, ...args.data, updatedAt: now }))
    },
    user: {
      findMany: vi.fn(async () => [
        {
          id: "user-1",
          userType: "external_user",
          displayName: "Alice",
          email: "Alice@Example.com",
          role: "employee",
          status: "active"
        }
      ])
    },
    organization: {
      findMany: vi.fn(async () => [
        {
          id: "org-1",
          slug: "acme",
          name: "Acme",
          type: "customer",
          status: "active"
        }
      ]),
      findUnique: vi.fn(async () => ({
        id: "org-1",
        slug: "acme",
        name: "Acme",
        type: "customer",
        status: "active"
      }))
    },
    billingCustomer: {
      findUnique: vi.fn(async () => ({ billingEmail: "billing@example.com", businessEmail: "business@example.com" }))
    },
    subscriptionPlan: {
      findMany: vi.fn(async () => [
        {
          id: "plan-1",
          slug: "pro",
          name: "Pro",
          status: "active",
          featureType: "chat"
        }
      ]),
      findUnique: vi.fn(async () => ({
        id: "plan-1",
        slug: "pro",
        name: "Pro",
        status: "active",
        featureType: "chat"
      }))
    },
    subscriptionGrant: {
      findUnique: vi.fn(async () => ({ planId: "plan-1" }))
    }
  };
}

function createNotifications() {
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
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    })),
    update: vi.fn(async (input: { id: string; changes: UpdateNotificationRecordInput }): Promise<NotificationRecord> => ({
      id: input.id,
      channelType: "email",
      targetRef: "conversation_recovery:case-1:email",
      eventType: "conversation_recovery.resolution_email",
      status: input.changes.status ?? "sent",
      payload: input.changes.payload,
      errorMessage: input.changes.errorMessage ?? undefined,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    }))
  };
}

describe("ConversationRecoveryService", () => {
  it("records a DingTalk failure as a recoverable case", async () => {
    const db = createDb();
    const service = new ConversationRecoveryService({
      db: db as never,
      emailSender: { send: vi.fn() } as never,
      notifications: createNotifications(),
      billing: { grantGiftDays: vi.fn() } as never,
      resolveBrandName: () => "AgentStudio"
    });

    const record = await service.recordFailure({
      recoveryKey: "dingtalk_bot_error:instance-1:thread-1:msg-1",
      organizationId: "org-1",
      userId: "user-1",
      threadId: "thread-1",
      source: "dingtalk_bot_error",
      channel: "dingtalk_bot",
      audience: "external",
      title: "钉钉机器人问答失败：Alice",
      questionPreview: "员工遇到系统报错",
      failureDetail: "runtime failed",
      occurredAt: now
    });

    expect(db.conversationRecoveryCase.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { recoveryKey: "dingtalk_bot_error:instance-1:thread-1:msg-1" },
        create: expect.objectContaining({
          organizationId: "org-1",
          userId: "user-1",
          source: "dingtalk_bot_error",
          channel: "dingtalk_bot"
        })
      })
    );
    expect(record.suggestedEmail.recipientEmail).toBe("alice@example.com");
    expect(record.suggestedEmail.templates.zh.subject).toContain("AgentStudio");
    expect(record.suggestedEmail.templates.en.subject).toContain("Follow-up");
    expect(record.suggestedEmail.templates.zh.bodyText).not.toContain("员工遇到系统报错");
    expect(record.suggestedEmail.templates.en.bodyText).not.toContain("员工遇到系统报错");
    expect(record.compensation.eligible).toBe(true);
  });

  it("sends a resolution email and records the notification result", async () => {
    const db = createDb();
    const notifications = createNotifications();
    const emailSender: AuthEmailSender = {
      send: vi.fn(async () => ({ delivered: true, mode: "smtp" as const }))
    };
    const service = new ConversationRecoveryService({
      db: db as never,
      emailSender,
      notifications,
      billing: { grantGiftDays: vi.fn() } as never,
      resolveBrandName: () => "AgentStudio"
    });

    const result = await service.sendResolutionEmail({
      caseId: "case-1",
      recipientEmail: "user@example.com",
      subject: "问题已修复",
      bodyText: "我们已经修复该问题。",
      templateLanguage: "en",
      rootCause: "runtime error",
      resolutionSummary: "已修复运行时配置",
      actorUserId: "admin-1"
    });

    expect(emailSender.send).toHaveBeenCalledWith(expect.objectContaining({
      to: "user@example.com",
      subject: "问题已修复",
      text: "我们已经修复该问题。",
      html: expect.stringContaining("<table role=\"presentation\"")
    }));
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({
      channelType: "email",
      eventType: "conversation_recovery.resolution_email",
      targetRef: "conversation_recovery:case-1:email",
      payload: expect.objectContaining({ templateLanguage: "en" })
    }));
    expect(notifications.update).toHaveBeenCalledWith(expect.objectContaining({
      id: "notification-1",
      changes: expect.objectContaining({ status: "sent", errorMessage: null })
    }));
    expect(result.case.status).toBe("notified");
  });

  it("grants compensation days through the billing service for external customers", async () => {
    const db = createDb();
    const grantGiftDays = vi.fn(async () => ({
      order: { id: "order-1" },
      grant: { id: "grant-1" }
    }));
    const service = new ConversationRecoveryService({
      db: db as never,
      emailSender: { send: vi.fn() } as never,
      notifications: createNotifications(),
      billing: { grantGiftDays } as never,
      resolveBrandName: () => "AgentStudio"
    });

    const result = await service.grantCompensationDays({
      caseId: "case-1",
      days: 5,
      reason: "service recovery",
      actorUserId: "admin-1"
    });

    expect(grantGiftDays).toHaveBeenCalledWith({
      organizationId: "org-1",
      planId: "plan-1",
      days: 5,
      reason: "service recovery",
      userId: "admin-1"
    });
    expect(result.case.compensationOrderId).toBe("order-1");
    expect(result.case.compensationGrantId).toBe("grant-1");
  });
});
