import { AlertEventRecord } from "../persistence/alert-event-repository.js";
import { NotificationChannelType, NotificationRecordRepository, type NotificationRecord } from "../persistence/notification-record-repository.js";
import type { BroadcastRecord } from "../persistence/broadcast-repository.js";

type DingtalkNotificationSender = (input: {
  alertEvent: AlertEventRecord;
  notification: NotificationRecord;
  message: string;
}) => Promise<void>;

type BroadcastDingtalkSender = (input: {
  broadcast: BroadcastRecord;
  recipientUserIds: string[];
  notification: NotificationRecord;
  message: string;
}) => Promise<void>;

export class NotificationDispatchService {
  constructor(
    private readonly deps: {
      notifications: NotificationRecordRepository;
      dingtalk?: DingtalkNotificationSender;
      broadcastDingtalk?: BroadcastDingtalkSender;
    }
  ) {}

  async dispatchAlert(event: AlertEventRecord): Promise<void> {
    const channels = resolveChannels(event);
    for (const channel of channels) {
      if (channel === "in_app") {
        await this.deps.notifications.create({
          organizationId: event.organizationId,
          channelType: "in_app",
          targetRef: event.id,
          eventType: "alert_event",
          status: "sent",
          payload: buildNotificationPayload(event, channel)
        });
        continue;
      }

      const record = await this.deps.notifications.create({
        organizationId: event.organizationId,
        channelType: "dingtalk",
        targetRef: event.id,
        eventType: "alert_event",
        status: "pending",
        payload: buildNotificationPayload(event, channel)
      });

      try {
        if (!this.deps.dingtalk) {
          throw new Error("DingTalk sender is not configured");
        }
        await this.deps.dingtalk({
          alertEvent: event,
          notification: record,
          message: buildDingtalkMessage(event)
        });
        await this.deps.notifications.update({
          id: record.id,
          changes: {
            status: "sent",
            errorMessage: null
          }
        });
      } catch (error) {
        await this.deps.notifications.update({
          id: record.id,
          changes: {
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "DingTalk notification failed"
          }
        });
      }
    }
  }

  async dispatchBroadcast(input: { broadcast: BroadcastRecord; recipientUserIds: string[] }): Promise<void> {
    const record = await this.deps.notifications.create({
      organizationId: undefined,
      channelType: "dingtalk",
      targetRef: input.broadcast.id,
      eventType: "broadcast.published",
      status: "pending",
      payload: {
        broadcastId: input.broadcast.id,
        title: input.broadcast.title,
        recipientUserIds: input.recipientUserIds
      }
    });

    try {
      if (!this.deps.broadcastDingtalk) {
        throw new Error("DingTalk sender is not configured");
      }
      await this.deps.broadcastDingtalk({
        broadcast: input.broadcast,
        recipientUserIds: input.recipientUserIds,
        notification: record,
        message: [input.broadcast.title, input.broadcast.bodyMarkdown].filter(Boolean).join("\n")
      });
      await this.deps.notifications.update({
        id: record.id,
        changes: {
          status: "sent",
          errorMessage: null
        }
      });
    } catch (error) {
      await this.deps.notifications.update({
        id: record.id,
        changes: {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "DingTalk notification failed"
        }
      });
    }
  }
}

function resolveChannels(event: AlertEventRecord): NotificationChannelType[] {
  const payload = asRecord(event.payload);
  const channels = Array.isArray(payload?.channels) ? payload.channels.filter((channel): channel is NotificationChannelType => channel === "in_app" || channel === "dingtalk") : [];
  if (channels.length > 0) {
    return channels;
  }
  return ["in_app", "dingtalk"];
}

function buildNotificationPayload(event: AlertEventRecord, channel: NotificationChannelType): Record<string, unknown> {
  return {
    alertEventId: event.id,
    channel,
    title: event.title,
    detail: event.detail,
    severity: event.severity,
    status: event.status,
    scopeType: event.scopeType,
    scopeId: event.scopeId,
    payload: event.payload ?? null
  };
}

function buildDingtalkMessage(event: AlertEventRecord): string {
  return [event.title, event.detail].filter(Boolean).join("\n");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
