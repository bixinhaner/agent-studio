import { describe, expect, it, vi } from "vitest";

import type { AuthEmailSender } from "../../auth/email.js";
import type { AiResponseReviewRecord } from "../../persistence/ai-response-review-repository.js";
import type { NotificationRecord } from "../../persistence/notification-record-repository.js";
import { ZendeskAiReviewEmailReminderService } from "./ai-review-email-reminder-service.js";
import type { ZendeskIntegrationSettings } from "./types.js";

const settings: ZendeskIntegrationSettings = {
  enabled: true,
  publicBaseUrl: "https://agent.example.com",
  zendeskBaseUrl: "https://example.zendesk.com",
  zendeskEmail: "agent@example.com",
  zendeskApiToken: "token",
  webhookSigningSecret: "secret",
  responseMode: "internal_note",
  fallbackMode: "internal_note",
  autoStatus: "pending",
  excludedTags: [],
  agentModeId: "mode-1",
  knowledgeSetIds: [],
  workspace: "/tmp",
  model: "gpt-5.5",
  reasoningEffort: "high",
  sandboxMode: "read-only",
  approvalPolicy: "never",
  networkAccessEnabled: false,
  webSearchMode: "disabled",
  additionalDirectories: [],
  maxCommentHistory: 12,
  attachmentReadingEnabled: true,
  attachmentTypeRestrictionEnabled: true,
  maxAttachmentCount: 5,
  maxAttachmentBytes: 10 * 1024 * 1024,
  allowedAttachmentMimeTypes: ["image/*", "application/pdf", "text/*"],
  dingtalkNotificationEnabled: true,
  dingtalkNotificationManualRunsEnabled: false,
  dingtalkNotificationWebhookUrl: "",
  dingtalkNotificationRobotSecret: "",
  dingtalkNotificationFallbackUserIds: [],
  dingtalkNotificationTemplate: "",
  dingtalkReviewRequiredEnabled: true,
  dingtalkReviewDueHours: 24,
  aiReviewEmailReminderEnabled: true,
  aiReviewEmailReminderTime: "09:00",
  aiReviewEmailReminderTimezone: "Asia/Shanghai",
  aiReviewEmailReminderCcEmails: ["manager@example.com"],
  systemPrompt: "Return JSON."
};

function review(overrides: Partial<AiResponseReviewRecord>): AiResponseReviewRecord {
  return {
    id: "review-1",
    source: "zendesk",
    status: "pending",
    effectiveStatus: "pending",
    required: true,
    reviewer: null,
    reminderCount: 0,
    createdAt: "2026-06-09T00:00:00.000Z",
    updatedAt: "2026-06-09T00:00:00.000Z",
    ...overrides
  };
}

function notification(overrides: Partial<NotificationRecord>): NotificationRecord {
  return {
    id: "notification-1",
    channelType: "email",
    targetRef: "target",
    eventType: "zendesk.ai_review.daily_email_reminder",
    status: "pending",
    createdAt: "2026-06-09T00:00:00.000Z",
    updatedAt: "2026-06-09T00:00:00.000Z",
    ...overrides
  };
}

function createService(input: {
  reviews: AiResponseReviewRecord[];
  existingNotifications?: NotificationRecord[];
  resolvedSettings?: ZendeskIntegrationSettings;
}) {
  const records = [...(input.existingNotifications ?? [])];
  const sentEmails: Array<Parameters<AuthEmailSender["send"]>[0]> = [];
  const listPendingReminderCandidates = vi.fn(async () => input.reviews);
  const markReminderSent = vi.fn(async (reviewIds: string[]) => reviewIds.length);
  const notifications = {
    list: vi.fn(async (query: { targetRef?: string; eventType?: string; channelType?: string }) =>
      records.filter(
        (item) =>
          (!query.targetRef || item.targetRef === query.targetRef) &&
          (!query.eventType || item.eventType === query.eventType) &&
          (!query.channelType || item.channelType === query.channelType)
      )
    ),
    create: vi.fn(async (recordInput: Partial<NotificationRecord>) => {
      const created = notification({
        id: `notification-${records.length + 1}`,
        targetRef: recordInput.targetRef,
        eventType: recordInput.eventType,
        status: recordInput.status ?? "pending",
        payload: recordInput.payload
      });
      records.push(created);
      return created;
    }),
    update: vi.fn(async ({ id, changes }: { id: string; changes: Partial<NotificationRecord> }) => {
      const current = records.find((item) => item.id === id);
      if (!current) throw new Error("notification not found");
      Object.assign(current, changes, { updatedAt: "2026-06-09T03:00:00.000Z" });
      return current;
    })
  };
  const emailSender: AuthEmailSender = {
    send: vi.fn(async (email) => {
      sentEmails.push(email);
      return { delivered: true, mode: "smtp" as const };
    })
  };
  const service = new ZendeskAiReviewEmailReminderService({
    reviews: {
      listPendingReminderCandidates,
      markReminderSent
    } as never,
    notifications: notifications as never,
    emailSender,
    listInstances: async () => [
      {
        id: "zendesk-1",
        slug: "zendesk-main",
        name: "Zendesk Main",
        organizationId: "org-1"
      }
    ],
    resolveSettings: async () => input.resolvedSettings ?? settings
  });
  return {
    service,
    sentEmails,
    listPendingReminderCandidates,
    markReminderSent,
    notifications
  };
}

describe("ZendeskAiReviewEmailReminderService", () => {
  it("sends one English group email with pending count including past-due tasks", async () => {
    const now = new Date("2026-06-09T03:00:00.000Z");
    const { service, sentEmails, markReminderSent } = createService({
      reviews: [
        review({
          id: "r1",
          ticketId: "45175",
          ticketSubject: "Latest firmware for Baicell Nova 249 Band 28",
          ticketUrl: "https://example.zendesk.com/agent/tickets/45175",
          reviewUrl: "https://agent.example.com/reviews/r1",
          reviewerDisplayName: "Alice",
          reviewerEmail: "alice@example.com",
          dueAt: "2026-06-07T03:00:00.000Z"
        }),
        review({
          id: "r2",
          ticketId: "45257",
          ticketSubject: "Counters and KPIs",
          reviewerDisplayName: "Bob",
          reviewerEmail: "bob@example.com",
          dueAt: "2026-06-10T03:00:00.000Z"
        }),
        review({
          id: "r3",
          ticketId: "45268",
          ticketSubject: "MME Pool configuration issue",
          reviewerDisplayName: "Alice",
          reviewerEmail: "alice@example.com",
          dueAt: "2026-06-09T04:00:00.000Z"
        })
      ]
    });

    const result = await service.runDueReminders(now);

    expect(result).toMatchObject({ checkedInstances: 1, sentEmails: 1, failedInstances: 0 });
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toEqual(["alice@example.com", "bob@example.com"]);
    expect(sentEmails[0].cc).toEqual(["manager@example.com"]);
    expect(sentEmails[0].subject).toBe("Zendesk AI Review Reminder - 3 pending");
    expect(sentEmails[0].text).toContain("Pending tasks: 3 (includes past-due tasks)");
    expect(sentEmails[0].text).toContain("Past due by 2 days");
    expect(sentEmails[0].text).toContain("Alice <alice@example.com>: 2 pending; Past due by 2 days");
    expect(markReminderSent).toHaveBeenCalledWith(expect.arrayContaining(["r1", "r2", "r3"]), now);
  });

  it("does not send a duplicate reminder for the same local date", async () => {
    const now = new Date("2026-06-09T03:00:00.000Z");
    const { service, sentEmails, listPendingReminderCandidates } = createService({
      reviews: [
        review({
          id: "r1",
          reviewerDisplayName: "Alice",
          reviewerEmail: "alice@example.com",
          dueAt: "2026-06-07T03:00:00.000Z"
        })
      ],
      existingNotifications: [
        notification({
          targetRef: "zendesk-ai-review-email:zendesk-1:2026-06-09",
          eventType: "zendesk.ai_review.daily_email_reminder",
          status: "sent"
        })
      ]
    });

    const result = await service.runDueReminders(now);

    expect(result).toMatchObject({ checkedInstances: 1, sentEmails: 0, skippedInstances: 1 });
    expect(sentEmails).toHaveLength(0);
    expect(listPendingReminderCandidates).not.toHaveBeenCalled();
  });

  it("sends a manual test digest without marking review reminders", async () => {
    const now = new Date("2026-06-09T03:00:00.000Z");
    const { service, sentEmails, markReminderSent } = createService({
      reviews: [
        review({
          id: "r1",
          ticketId: "45175",
          ticketSubject: "Latest firmware for Baicell Nova 249 Band 28",
          reviewerDisplayName: "Alice",
          reviewerEmail: "alice@example.com",
          dueAt: "2026-06-07T03:00:00.000Z"
        })
      ]
    });

    const result = await service.sendManualReminder({
      instance: {
        id: "zendesk-1",
        slug: "zendesk-main",
        name: "Zendesk Main",
        organizationId: "org-1"
      },
      mode: "test",
      testEmail: "admin@example.com",
      now
    });

    expect(result).toMatchObject({
      sent: true,
      mode: "test",
      to: ["admin@example.com"],
      cc: [],
      pendingCount: 1,
      reviewerCount: 1
    });
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].subject).toBe("[Test] Zendesk AI Review Reminder - 1 pending");
    expect(sentEmails[0].text).toContain("Past due by 2 days");
    expect(markReminderSent).not.toHaveBeenCalled();
  });
});
