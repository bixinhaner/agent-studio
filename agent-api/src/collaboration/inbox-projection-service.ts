import type { AlertEventRecord } from "../persistence/alert-event-repository.js";
import type { InboxItemRepository } from "../persistence/inbox-item-repository.js";

export type CollaborationInboxProjectionInput = {
  eventType: string;
  actorUserId?: string;
  recipientUserIds: string[];
  threadId?: string;
  title: string;
  body: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  payload?: unknown;
  category?: "collaboration" | "broadcast";
};

export type AlertInboxProjectionInput = {
  event: AlertEventRecord;
  recipientUserIds?: string[];
};

type AlertRecipientDirectory = {
  listAllUserIds?: () => Promise<string[]>;
  listUserIdsForDepartment?: (departmentId: string) => Promise<string[]>;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function uniqueUserIds(userIds: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const userId of userIds) {
    const value = trimOrUndefined(userId);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export class InboxProjectionService {
  constructor(
    private readonly deps: {
      inbox: Pick<InboxItemRepository, "create">;
      alerts?: AlertRecipientDirectory;
    }
  ) {}

  async projectCollaborationEvent(input: CollaborationInboxProjectionInput): Promise<void> {
    const eventType = trimOrUndefined(input.eventType);
    const title = typeof input.title === "string" ? input.title.trim() : "";
    const body = typeof input.body === "string" ? input.body.trim() : "";
    if (!eventType || !title || !body) {
      throw new Error("eventType, title, and body are required");
    }

    const recipients = uniqueUserIds(input.recipientUserIds).filter((userId) => userId !== input.actorUserId);
    for (const userId of recipients) {
      await this.deps.inbox.create({
        userId,
        eventType,
        category: input.category ?? "collaboration",
        title,
        body,
        threadId: trimOrUndefined(input.threadId) ?? null,
        relatedEntityType: trimOrUndefined(input.relatedEntityType) ?? null,
        relatedEntityId: trimOrUndefined(input.relatedEntityId) ?? null,
        sourceActorUserId: trimOrUndefined(input.actorUserId) ?? null,
        payload: input.payload ?? null
      });
    }
  }

  async projectAlertEvent(input: AlertInboxProjectionInput): Promise<void> {
    const recipients = input.recipientUserIds ? uniqueUserIds(input.recipientUserIds) : await this.resolveAlertRecipients(input.event);
    for (const userId of recipients) {
      await this.deps.inbox.create({
        userId,
        eventType: "alert.opened",
        category: "alert",
        title: input.event.title,
        body: input.event.detail,
        threadId: trimOrUndefined(asRecord(input.event.payload)?.threadId as string | undefined) ?? null,
        relatedEntityType: "alert_event",
        relatedEntityId: input.event.id,
        payload: {
          alertEventId: input.event.id,
          severity: input.event.severity,
          status: input.event.status,
          scopeType: input.event.scopeType,
          scopeId: input.event.scopeId,
          payload: input.event.payload ?? null
        }
      });
    }
  }

  private async resolveAlertRecipients(event: AlertEventRecord): Promise<string[]> {
    const payload = asRecord(event.payload);
    if (event.scopeType === "department" && this.deps.alerts?.listUserIdsForDepartment) {
      return uniqueUserIds(await this.deps.alerts.listUserIdsForDepartment(event.scopeId));
    }
    if (event.scopeType === "platform" && this.deps.alerts?.listAllUserIds) {
      return uniqueUserIds(await this.deps.alerts.listAllUserIds());
    }
    const explicitUserId = trimOrUndefined(typeof payload?.userId === "string" ? payload.userId : undefined);
    if (explicitUserId) {
      return [explicitUserId];
    }
    return [];
  }
}
