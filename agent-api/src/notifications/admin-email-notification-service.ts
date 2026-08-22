import type { AuthEmailSender } from "../auth/email.js";
import type {
  NotificationRecord,
  NotificationRecordRepository
} from "../persistence/notification-record-repository.js";
import type { SystemSettingsRepository } from "../system-settings/repository.js";
import {
  createDefaultSystemSettingsPayload,
  type AdminEmailNotificationEventKey
} from "../system-settings/types.js";

export type AdminNotificationDirectoryUser = {
  id: string;
  email: string;
  role: string;
};

export type AdminEmailNotificationInput = {
  event: AdminEmailNotificationEventKey;
  accessRequestId: string;
  organizationId?: string;
  ownerEmail?: string;
  salesContactEmail?: string;
  variables: Record<string, string | null | undefined>;
  envelope?: {
    publicBrandId?: string;
    from?: string;
    replyTo?: string;
  };
  dedupeKey?: string;
};

type AdminEmailNotificationServiceOptions = {
  settings: Pick<SystemSettingsRepository, "getCurrentPublished">;
  notifications: Pick<NotificationRecordRepository, "create" | "update" | "list">;
  emailSender: AuthEmailSender;
  findInternalUsers(): Promise<AdminNotificationDirectoryUser[]>;
};

const PENDING_DEDUPE_WINDOW_MS = 10 * 60 * 1000;

function normalizedEmail(value: string | null | undefined): string | undefined {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized || undefined;
}

function dedupeEmails(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(normalizedEmail).filter((value): value is string => Boolean(value)))];
}

function renderTemplate(template: string, variables: Record<string, string | null | undefined>): string {
  return template
    .replace(/{{\s*([a-z0-9_]+)\s*}}/gi, (_match, key: string) => variables[key] ?? "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => line.length > 0 || (index > 0 && lines[index - 1]?.length > 0))
    .join("\n")
    .trim();
}

function eventLabel(event: AdminEmailNotificationEventKey): string {
  return event.replaceAll(".", "-");
}

export class AdminEmailNotificationService {
  constructor(private readonly options: AdminEmailNotificationServiceOptions) {}

  async notify(input: AdminEmailNotificationInput): Promise<NotificationRecord | null> {
    const published = await this.options.settings.getCurrentPublished();
    const policy = published?.payload.adminEmailNotifications ?? createDefaultSystemSettingsPayload().adminEmailNotifications;
    const eventPolicy = policy.events[input.event];
    if (!policy.enabled || !eventPolicy?.enabled) return null;

    const directory = await this.options.findInternalUsers();
    const roleRecipients = policy.recipientMode === "all_super_admins"
      ? directory.filter((user) => user.role === "super_admin").map((user) => user.email)
      : policy.recipientMode === "all_admins"
        ? directory.filter((user) => user.role === "admin" || user.role === "super_admin").map((user) => user.email)
        : policy.recipientEmails;
    const recipients = dedupeEmails([
      ...roleRecipients,
      policy.includeOwner ? input.ownerEmail : undefined,
      policy.includeSalesContact ? input.salesContactEmail : undefined
    ]);
    if (!recipients.length) return null;

    const subject = renderTemplate(eventPolicy.subject, input.variables);
    const text = renderTemplate(eventPolicy.bodyText, input.variables);
    const targetRef = [
      "access_request",
      input.accessRequestId,
      input.event,
      input.dedupeKey ?? "current"
    ].join(":");

    if (policy.recordDelivery) {
      const existing = await this.options.notifications.list({
        channelType: "email",
        targetRef,
        eventType: input.event,
        take: 1,
        order: "desc"
      });
      const now = Date.now();
      if (existing.some((record) => {
        if (record.status === "sent") return true;
        if (record.status !== "pending") return false;
        const createdAt = new Date(record.createdAt).getTime();
        return Number.isFinite(createdAt) && now - createdAt < PENDING_DEDUPE_WINDOW_MS;
      })) {
        return existing[0] ?? null;
      }
    }

    const payload = {
      category: "system_admin",
      accessRequestId: input.accessRequestId,
      recipients,
      subject,
      text,
      attempts: 0,
      maxAttempts: policy.maxAttempts
    };
    const record = policy.recordDelivery
      ? await this.options.notifications.create({
          organizationId: input.organizationId,
          channelType: "email",
          targetRef,
          eventType: input.event,
          status: "pending",
          payload
        })
      : null;

    let lastError: unknown;
    for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
      try {
        const delivery = await this.options.emailSender.send({
          to: recipients,
          ...input.envelope,
          subject,
          text,
          debugLabel: `admin-notification-${eventLabel(input.event)}`
        });
        if (!record) return null;
        return await this.options.notifications.update({
          id: record.id,
          changes: {
            status: "sent",
            errorMessage: null,
            payload: { ...payload, attempts: attempt, delivery }
          }
        });
      } catch (error) {
        lastError = error;
      }
    }

    if (!record) {
      console.error("[admin-email-notification] delivery failed", {
        event: input.event,
        accessRequestId: input.accessRequestId,
        error: lastError instanceof Error ? lastError.message : String(lastError)
      });
      return null;
    }
    return this.options.notifications.update({
      id: record.id,
      changes: {
        status: "failed",
        errorMessage: lastError instanceof Error ? lastError.message : String(lastError),
        payload: { ...payload, attempts: policy.maxAttempts }
      }
    });
  }
}
