import type { AuthEmailSender } from "../../auth/email.js";
import {
  AiResponseReviewRepository,
  type AiResponseReviewRecord
} from "../../persistence/ai-response-review-repository.js";
import { NotificationRecordRepository } from "../../persistence/notification-record-repository.js";
import type { ZendeskIntegrationSettings } from "./types.js";

export type ZendeskAiReviewEmailReminderInstance = {
  id: string;
  slug?: string | null;
  name?: string | null;
  organizationId?: string | null;
};

type ZendeskAiReviewEmailReminderServiceOptions = {
  reviews: AiResponseReviewRepository;
  notifications: NotificationRecordRepository;
  emailSender: AuthEmailSender;
  listInstances: () => Promise<ZendeskAiReviewEmailReminderInstance[]>;
  resolveSettings: (instanceId: string) => Promise<ZendeskIntegrationSettings>;
};

type ReviewerTaskGroup = {
  email: string;
  displayName: string;
  tasks: AiResponseReviewRecord[];
};

type LocalClock = {
  dateKey: string;
  minuteOfDay: number;
};

export type ZendeskAiReviewEmailReminderRunResult = {
  checkedInstances: number;
  sentEmails: number;
  skippedInstances: number;
  failedInstances: number;
};

export type ZendeskAiReviewEmailReminderManualMode = "test" | "live";

export type ZendeskAiReviewEmailReminderSendResult = {
  sent: boolean;
  mode: ZendeskAiReviewEmailReminderManualMode | "scheduled";
  detail: string;
  to: string[];
  cc: string[];
  pendingCount: number;
  reviewerCount: number;
  skippedNoEmailCount: number;
  reviewIds: string[];
  notificationId?: string;
};

type ReminderSchedulerTimer = ReturnType<typeof setInterval>;

const EVENT_TYPE = "zendesk.ai_review.daily_email_reminder";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeEmail(value: unknown): string | undefined {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

function uniqueEmails(values: unknown[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const email = normalizeEmail(value);
    if (email && !result.includes(email)) result.push(email);
  }
  return result;
}

function localClock(now: Date, timezone: string): LocalClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(now);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const hour = Number(byType.get("hour") || "0");
  const minute = Number(byType.get("minute") || "0");
  return {
    dateKey: `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`,
    minuteOfDay: (hour === 24 ? 0 : hour) * 60 + minute
  };
}

function reminderMinuteOfDay(value: string): number {
  const [hour, minute] = value.split(":").map((item) => Number(item));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 9 * 60;
  return Math.max(0, Math.min(23, Math.floor(hour))) * 60 + Math.max(0, Math.min(59, Math.floor(minute)));
}

function isReminderDue(settings: ZendeskIntegrationSettings, now: Date): { due: boolean; dateKey: string } {
  const clock = localClock(now, settings.aiReviewEmailReminderTimezone);
  return {
    due: clock.minuteOfDay >= reminderMinuteOfDay(settings.aiReviewEmailReminderTime),
    dateKey: clock.dateKey
  };
}

function reviewerDisplayName(review: AiResponseReviewRecord): string {
  return (
    trimOrUndefined(review.reviewerDisplayName) ||
    trimOrUndefined(review.reviewer?.displayName) ||
    trimOrUndefined(review.reviewerEmail) ||
    trimOrUndefined(review.reviewer?.email) ||
    "Unassigned reviewer"
  );
}

function reviewerEmail(review: AiResponseReviewRecord): string | undefined {
  return normalizeEmail(review.reviewerEmail) || normalizeEmail(review.reviewer?.email);
}

function groupByReviewer(reviews: AiResponseReviewRecord[]): ReviewerTaskGroup[] {
  const groups = new Map<string, ReviewerTaskGroup>();
  for (const review of reviews) {
    const email = reviewerEmail(review);
    if (!email) continue;
    const existing = groups.get(email);
    if (existing) {
      existing.tasks.push(review);
      continue;
    }
    groups.set(email, {
      email,
      displayName: reviewerDisplayName(review),
      tasks: [review]
    });
  }
  return Array.from(groups.values()).sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function timestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? undefined : parsed;
}

function isPastDue(review: AiResponseReviewRecord, now: Date): boolean {
  const dueAt = timestamp(review.dueAt);
  return dueAt !== undefined && dueAt < now.getTime();
}

function dueDescription(review: AiResponseReviewRecord, now: Date): string {
  const dueAt = timestamp(review.dueAt);
  if (dueAt === undefined) return "No due date";
  const diff = dueAt - now.getTime();
  if (diff < 0) {
    const days = Math.max(1, Math.ceil(Math.abs(diff) / MS_PER_DAY));
    return `Past due by ${days} ${days === 1 ? "day" : "days"}`;
  }
  const days = Math.ceil(diff / MS_PER_DAY);
  if (days <= 1) return "Due today";
  return `Due in ${days} days`;
}

function groupAttentionDescription(group: ReviewerTaskGroup, now: Date): string {
  const pastDueTasks = group.tasks
    .filter((review) => isPastDue(review, now))
    .sort((left, right) => (timestamp(left.dueAt) ?? now.getTime()) - (timestamp(right.dueAt) ?? now.getTime()));
  if (pastDueTasks[0]) return dueDescription(pastDueTasks[0], now);
  return "No task past due";
}

function formatDate(value: string | undefined, timezone: string): string {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function taskTitle(review: AiResponseReviewRecord): string {
  const ticket = trimOrUndefined(review.ticketId) ? `Zendesk #${review.ticketId}` : "Zendesk ticket";
  const subject = trimOrUndefined(review.ticketSubject);
  return subject ? `${ticket} - ${subject}` : ticket;
}

function taskLinksText(review: AiResponseReviewRecord): string {
  return [
    trimOrUndefined(review.reviewUrl) ? `Review: ${review.reviewUrl}` : "",
    trimOrUndefined(review.ticketUrl) ? `Zendesk: ${review.ticketUrl}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function buildTextEmail(input: {
  instanceName: string;
  groups: ReviewerTaskGroup[];
  timezone: string;
  now: Date;
}): string {
  const totalPending = input.groups.reduce((sum, group) => sum + group.tasks.length, 0);
  const lines = [
    "Zendesk AI Review Reminder",
    "",
    `Integration: ${input.instanceName}`,
    `Pending tasks: ${totalPending} (includes past-due tasks)`,
    `Reviewers: ${input.groups.length}`,
    "",
    "Reviewer summary:"
  ];
  for (const group of input.groups) {
    lines.push(
      `- ${group.displayName} <${group.email}>: ${group.tasks.length} pending; ${groupAttentionDescription(group, input.now)}`
    );
  }
  lines.push("", "Tasks by reviewer:");
  for (const group of input.groups) {
    lines.push("", `${group.displayName} <${group.email}>`);
    for (const review of group.tasks) {
      lines.push(
        `- ${taskTitle(review)}`,
        `  Status: ${dueDescription(review, input.now)}`,
        `  Due: ${formatDate(review.dueAt, input.timezone)}`
      );
      const links = taskLinksText(review);
      if (links) lines.push(...links.split("\n").map((line) => `  ${line}`));
    }
  }
  lines.push("", "Please submit the required 1-5 rating and improvement suggestion if applicable.");
  return lines.join("\n");
}

function buildHtmlEmail(input: {
  instanceName: string;
  groups: ReviewerTaskGroup[];
  timezone: string;
  now: Date;
}): string {
  const totalPending = input.groups.reduce((sum, group) => sum + group.tasks.length, 0);
  const summaryRows = input.groups
    .map((group) => {
      return `<tr><td>${escapeHtml(group.displayName)}</td><td>${escapeHtml(group.email)}</td><td>${group.tasks.length}</td><td>${escapeHtml(groupAttentionDescription(group, input.now))}</td></tr>`;
    })
    .join("");
  const taskSections = input.groups
    .map((group) => {
      const rows = group.tasks
        .map((review) => {
          const reviewUrl = trimOrUndefined(review.reviewUrl);
          const ticketUrl = trimOrUndefined(review.ticketUrl);
          const reviewLink = reviewUrl ? `<a href="${escapeHtml(reviewUrl)}">Open rating page</a>` : "";
          const ticketLink = ticketUrl ? `<a href="${escapeHtml(ticketUrl)}">Open Zendesk ticket</a>` : "";
          const links = [reviewLink, ticketLink].filter(Boolean).join(" · ");
          return [
            "<tr>",
            `<td><strong>${escapeHtml(taskTitle(review))}</strong><br>${links}</td>`,
            `<td>${escapeHtml(dueDescription(review, input.now))}</td>`,
            `<td>${escapeHtml(formatDate(review.dueAt, input.timezone))}</td>`,
            "</tr>"
          ].join("");
        })
        .join("");
      return [
        `<h3>${escapeHtml(group.displayName)} &lt;${escapeHtml(group.email)}&gt;</h3>`,
        '<table class="task-table">',
        "<thead><tr><th>Task</th><th>Status</th><th>Due</th></tr></thead>",
        `<tbody>${rows}</tbody>`,
        "</table>"
      ].join("");
    })
    .join("");

  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    '<meta charset="utf-8">',
    "<style>",
    "body{font-family:Arial,sans-serif;color:#172033;background:#f6f7f9;margin:0;padding:24px;}",
    ".container{max-width:960px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:24px;}",
    "h1{font-size:24px;margin:0 0 8px;} h2{font-size:18px;margin:24px 0 10px;} h3{font-size:15px;margin:20px 0 8px;}",
    ".muted{color:#5f6b7a;} .stats{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0;}",
    ".stat{border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;min-width:150px;background:#fbfcfd;}",
    ".stat strong{display:block;font-size:22px;margin-bottom:4px;}",
    "table{width:100%;border-collapse:collapse;} th,td{border-bottom:1px solid #eef0f3;text-align:left;padding:10px;vertical-align:top;} th{font-size:12px;text-transform:uppercase;color:#657083;background:#fafbfc;}",
    ".task-table td:nth-child(2),.task-table td:nth-child(3){white-space:nowrap;}",
    "a{color:#155eef;text-decoration:none;}",
    "</style>",
    "</head>",
    "<body>",
    '<div class="container">',
    "<h1>Zendesk AI Review Reminder</h1>",
    `<div class="muted">Integration: ${escapeHtml(input.instanceName)}</div>`,
    '<div class="stats">',
    `<div class="stat"><strong>${totalPending}</strong>Pending tasks<br><span class="muted">Includes past-due tasks</span></div>`,
    `<div class="stat"><strong>${input.groups.length}</strong>Reviewers</div>`,
    "</div>",
    "<h2>Reviewer Summary</h2>",
    "<table><thead><tr><th>Reviewer</th><th>Email</th><th>Pending</th><th>Attention</th></tr></thead>",
    `<tbody>${summaryRows}</tbody></table>`,
    "<h2>Tasks By Reviewer</h2>",
    taskSections,
    '<p class="muted">Please submit the required 1-5 rating and improvement suggestion if applicable.</p>',
    "</div>",
    "</body>",
    "</html>"
  ].join("");
}

export class ZendeskAiReviewEmailReminderService {
  constructor(private readonly options: ZendeskAiReviewEmailReminderServiceOptions) {}

  async runDueReminders(now = new Date()): Promise<ZendeskAiReviewEmailReminderRunResult> {
    const instances = await this.options.listInstances();
    const result: ZendeskAiReviewEmailReminderRunResult = {
      checkedInstances: instances.length,
      sentEmails: 0,
      skippedInstances: 0,
      failedInstances: 0
    };

    for (const instance of instances) {
      try {
        const sent = await this.runForInstance(instance, now);
        if (sent) result.sentEmails += 1;
        else result.skippedInstances += 1;
      } catch (error) {
        result.failedInstances += 1;
        console.warn(
          "failed to send Zendesk AI review email reminder",
          instance.id,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    return result;
  }

  private async runForInstance(instance: ZendeskAiReviewEmailReminderInstance, now: Date): Promise<boolean> {
    const settings = await this.options.resolveSettings(instance.id);
    if (!settings.aiReviewEmailReminderEnabled) return false;

    const due = isReminderDue(settings, now);
    if (!due.due) return false;

    const targetRef = `zendesk-ai-review-email:${instance.id}:${due.dateKey}`;
    const existing = await this.options.notifications.list({
      channelType: "email",
      targetRef,
      eventType: EVENT_TYPE,
      take: 1
    });
    if (existing.length > 0) return false;

    const reviews = await this.options.reviews.listPendingReminderCandidates({
      integrationInstanceId: instance.id
    });
    const groups = groupByReviewer(reviews);
    if (groups.length === 0) return false;

    const to = groups.map((group) => group.email);
    const cc = uniqueEmails(settings.aiReviewEmailReminderCcEmails);
    const totalPending = groups.reduce((sum, group) => sum + group.tasks.length, 0);
    const pastDueCount = groups.reduce(
      (sum, group) => sum + group.tasks.filter((review) => isPastDue(review, now)).length,
      0
    );
    const instanceName = trimOrUndefined(instance.name) || trimOrUndefined(instance.slug) || instance.id;
    const notification = await this.options.notifications.create({
      organizationId: trimOrUndefined(instance.organizationId),
      channelType: "email",
      targetRef,
      eventType: EVENT_TYPE,
      status: "pending",
      payload: {
        integrationInstanceId: instance.id,
        dateKey: due.dateKey,
        to,
        cc,
        pendingCount: totalPending,
        pastDueCount,
        reviewIds: groups.flatMap((group) => group.tasks.map((task) => task.id))
      }
    });

    try {
      await this.sendEmail({
        to,
        cc,
        groups,
        settings,
        instanceName,
        now,
        subjectPrefix: ""
      });
      const reviewIds = groups.flatMap((group) => group.tasks.map((task) => task.id));
      await this.options.reviews.markReminderSent(reviewIds, now);
      await this.options.notifications.update({
        id: notification.id,
        changes: {
          status: "sent",
          payload: {
            ...(typeof notification.payload === "object" && notification.payload !== null ? notification.payload : {}),
            deliveredAt: now.toISOString()
          },
          errorMessage: null
        }
      });
      return true;
    } catch (error) {
      await this.options.notifications.update({
        id: notification.id,
        changes: {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error)
        }
      });
      throw error;
    }
  }

  async sendManualReminder(input: {
    instance: ZendeskAiReviewEmailReminderInstance;
    mode: ZendeskAiReviewEmailReminderManualMode;
    testEmail?: string;
    now?: Date;
  }): Promise<ZendeskAiReviewEmailReminderSendResult> {
    const now = input.now ?? new Date();
    const settings = await this.options.resolveSettings(input.instance.id);
    if (!settings.aiReviewEmailReminderEnabled) {
      throw new Error("Zendesk AI review email reminders are disabled for this integration");
    }

    const reviews = await this.options.reviews.listPendingReminderCandidates({
      integrationInstanceId: input.instance.id
    });
    const groups = groupByReviewer(reviews);
    const skippedNoEmailCount = reviews.length - groups.reduce((sum, group) => sum + group.tasks.length, 0);
    const reviewIds = groups.flatMap((group) => group.tasks.map((task) => task.id));
    const instanceName = trimOrUndefined(input.instance.name) || trimOrUndefined(input.instance.slug) || input.instance.id;
    const due = isReminderDue(settings, now);

    if (input.mode === "live" && groups.length === 0) {
      return {
        sent: false,
        mode: input.mode,
        detail: reviews.length > 0
          ? "No pending review task has a reviewer email address"
          : "No pending review tasks were found",
        to: [],
        cc: [],
        pendingCount: 0,
        reviewerCount: 0,
        skippedNoEmailCount,
        reviewIds: []
      };
    }

    const to =
      input.mode === "test"
        ? uniqueEmails([input.testEmail])
        : groups.map((group) => group.email);
    if (to.length === 0) {
      throw new Error(input.mode === "test" ? "A test recipient email is required" : "No reminder recipient email is available");
    }

    const cc = input.mode === "test" ? [] : uniqueEmails(settings.aiReviewEmailReminderCcEmails);
    const targetRef =
      input.mode === "live"
        ? `zendesk-ai-review-email:${input.instance.id}:${due.dateKey}`
        : `zendesk-ai-review-email-test:${input.instance.id}:${due.dateKey}:${now.getTime()}`;
    const notification = await this.options.notifications.create({
      organizationId: trimOrUndefined(input.instance.organizationId),
      channelType: "email",
      targetRef,
      eventType: input.mode === "test" ? `${EVENT_TYPE}.test` : EVENT_TYPE,
      status: "pending",
      payload: {
        integrationInstanceId: input.instance.id,
        dateKey: due.dateKey,
        mode: input.mode,
        to,
        cc,
        pendingCount: reviewIds.length,
        reviewerCount: groups.length,
        skippedNoEmailCount,
        reviewIds
      }
    });

    try {
      await this.sendEmail({
        to,
        cc,
        groups,
        settings,
        instanceName,
        now,
        subjectPrefix: input.mode === "test" ? "[Test] " : ""
      });
      if (input.mode === "live" && reviewIds.length > 0) {
        await this.options.reviews.markReminderSent(reviewIds, now);
      }
      await this.options.notifications.update({
        id: notification.id,
        changes: {
          status: "sent",
          payload: {
            ...(typeof notification.payload === "object" && notification.payload !== null ? notification.payload : {}),
            deliveredAt: now.toISOString()
          },
          errorMessage: null
        }
      });
      return {
        sent: true,
        mode: input.mode,
        detail: input.mode === "test" ? "Test email sent" : "Reminder email sent",
        to,
        cc,
        pendingCount: reviewIds.length,
        reviewerCount: groups.length,
        skippedNoEmailCount,
        reviewIds,
        notificationId: notification.id
      };
    } catch (error) {
      await this.options.notifications.update({
        id: notification.id,
        changes: {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error)
        }
      });
      throw error;
    }
  }

  private async sendEmail(input: {
    to: string[];
    cc: string[];
    groups: ReviewerTaskGroup[];
    settings: ZendeskIntegrationSettings;
    instanceName: string;
    now: Date;
    subjectPrefix?: string;
  }): Promise<void> {
    const totalPending = input.groups.reduce((sum, group) => sum + group.tasks.length, 0);
    const email = {
      instanceName: input.instanceName,
      groups: input.groups,
      timezone: input.settings.aiReviewEmailReminderTimezone,
      now: input.now
    };
    const delivery = await this.options.emailSender.send({
      to: input.to,
      cc: input.cc,
      subject: `${input.subjectPrefix ?? ""}Zendesk AI Review Reminder - ${totalPending} pending`,
      text: buildTextEmail(email),
      html: buildHtmlEmail(email),
      debugLabel: "zendesk-ai-review-email-reminder"
    });
    if (!delivery.delivered && delivery.mode === "debug") {
      throw new Error("SMTP is not configured; reminder email was only logged in debug mode");
    }
  }
}

export class ZendeskAiReviewEmailReminderScheduler {
  private timer: ReminderSchedulerTimer | null = null;
  private inFlight = false;

  constructor(
    private readonly service: Pick<ZendeskAiReviewEmailReminderService, "runDueReminders">,
    private readonly options: { intervalMs?: number; setIntervalFn?: typeof setInterval; clearIntervalFn?: typeof clearInterval } = {}
  ) {}

  start(): void {
    if (this.timer) return;
    const intervalMs = Math.max(30_000, Math.floor(this.options.intervalMs ?? 60_000));
    void this.tick().catch(() => undefined);
    this.timer = (this.options.setIntervalFn ?? setInterval)(() => {
      void this.tick().catch(() => undefined);
    }, intervalMs);
    this.timer?.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    (this.options.clearIntervalFn ?? clearInterval)(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      await this.service.runDueReminders();
    } finally {
      this.inFlight = false;
    }
  }
}
