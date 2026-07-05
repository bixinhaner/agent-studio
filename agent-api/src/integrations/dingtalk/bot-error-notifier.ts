import type { NotificationRecordRepository } from "../../persistence/notification-record-repository.js";
import type { DingTalkBotInstance } from "./bot-stream-service.js";

type NotificationStore = Pick<NotificationRecordRepository, "create" | "update">;

type Logger = Pick<Console, "warn">;

export type DingTalkBotErrorActor = {
  id?: string;
  organizationId?: string;
  displayName?: string;
  dingtalkUserId?: string;
};

export type DingTalkBotErrorMessage = {
  msgId?: string;
  conversationId?: string;
  conversationType?: string;
  senderNick?: string;
  senderStaffId?: string;
};

export type DingTalkBotErrorNotifyInput = {
  instance: DingTalkBotInstance;
  robotMessage: DingTalkBotErrorMessage;
  text: string;
  error: unknown;
  actor?: DingTalkBotErrorActor;
  threadId?: string;
  sessionId?: string;
  occurredAt?: Date;
};

export type DingTalkBotErrorNotifyResult =
  | { status: "disabled" | "throttled" | "skipped"; detail: string }
  | { status: "sent" | "failed"; notificationId: string; recipientUserIds: string[]; detail?: string };

export class DingTalkBotErrorNotifier {
  private readonly recentAttemptAtByKey = new Map<string, number>();

  constructor(
    private readonly deps: {
      notifications: NotificationStore;
      sendWorkNotice(input: { instance: DingTalkBotInstance; userIds: string[]; message: string }): Promise<void>;
      listSuperAdminDingTalkUserIds(input: { organizationId?: string }): Promise<string[]>;
      logger?: Logger;
    }
  ) {}

  async notify(input: DingTalkBotErrorNotifyInput): Promise<DingTalkBotErrorNotifyResult> {
    const robot = input.instance.robot;
    if (!robot.errorAlertEnabled) {
      return { status: "disabled", detail: "DingTalk bot error alert is disabled" };
    }

    const now = input.occurredAt ?? new Date();
    const errorMessage = errorDetail(input.error);
    const throttleKey = `${input.instance.id}:${errorMessage}`;
    const throttleMs = Math.max(0, robot.errorAlertThrottleSeconds) * 1000;
    const previousAttemptAt = this.recentAttemptAtByKey.get(throttleKey);
    if (throttleMs > 0 && previousAttemptAt && now.getTime() - previousAttemptAt < throttleMs) {
      return { status: "throttled", detail: "DingTalk bot error alert was throttled" };
    }

    const recipientUserIds = await this.resolveRecipientUserIds(input);
    if (!recipientUserIds.length) {
      return { status: "skipped", detail: "DingTalk bot error alert recipients are not configured" };
    }
    this.recentAttemptAtByKey.set(throttleKey, now.getTime());

    const payload = buildPayload(input, errorMessage, recipientUserIds, now);
    const notification = await this.deps.notifications.create({
      organizationId: input.actor?.organizationId ?? input.instance.organizationId ?? undefined,
      channelType: "dingtalk",
      targetRef: notificationTargetRef(input),
      eventType: "dingtalk_bot.error_reply",
      status: "pending",
      payload
    });

    try {
      await this.deps.sendWorkNotice({
        instance: input.instance,
        userIds: recipientUserIds,
        message: buildDingTalkMessage(payload)
      });
      await this.deps.notifications.update({
        id: notification.id,
        changes: {
          status: "sent",
          errorMessage: null
        }
      });
      return { status: "sent", notificationId: notification.id, recipientUserIds };
    } catch (error) {
      const detail = errorDetail(error, "DingTalk work notice failed");
      await this.deps.notifications.update({
        id: notification.id,
        changes: {
          status: "failed",
          errorMessage: detail
        }
      });
      this.deps.logger?.warn("DingTalk bot error alert failed", {
        notificationId: notification.id,
        instanceId: input.instance.id,
        detail
      });
      return { status: "failed", notificationId: notification.id, recipientUserIds, detail };
    }
  }

  private async resolveRecipientUserIds(input: DingTalkBotErrorNotifyInput): Promise<string[]> {
    const configured = uniqueStrings(input.instance.robot.errorAlertUserIds);
    if (configured.length) {
      return configured;
    }

    if (input.instance.robot.errorAlertUseSuperAdmins) {
      const superAdmins = uniqueStrings(
        await this.deps.listSuperAdminDingTalkUserIds({
          organizationId: input.actor?.organizationId ?? input.instance.organizationId ?? undefined
        })
      );
      if (superAdmins.length) {
        return superAdmins;
      }
    }

    return uniqueStrings(input.instance.alertUserIds ?? []);
  }
}

function notificationTargetRef(input: DingTalkBotErrorNotifyInput): string {
  return [
    "dingtalk_bot",
    input.instance.id,
    trimOrUndefined(input.threadId),
    trimOrUndefined(input.robotMessage.msgId) ?? trimOrUndefined(input.robotMessage.conversationId)
  ]
    .filter(Boolean)
    .join(":");
}

function buildPayload(
  input: DingTalkBotErrorNotifyInput,
  errorMessage: string,
  recipientUserIds: string[],
  occurredAt: Date
): Record<string, unknown> {
  return {
    category: "dingtalk_bot_error",
    integrationInstanceId: input.instance.id,
    integrationSlug: input.instance.slug,
    botName: input.instance.name,
    threadId: trimOrUndefined(input.threadId),
    sessionId: trimOrUndefined(input.sessionId),
    externalMessageId: trimOrUndefined(input.robotMessage.msgId),
    externalConversationId: trimOrUndefined(input.robotMessage.conversationId),
    conversationType: conversationTypeLabel(input.robotMessage.conversationType),
    senderName: trimOrUndefined(input.actor?.displayName) ?? trimOrUndefined(input.robotMessage.senderNick),
    senderStaffId: trimOrUndefined(input.robotMessage.senderStaffId) ?? trimOrUndefined(input.actor?.dingtalkUserId),
    actorUserId: trimOrUndefined(input.actor?.id),
    questionPreview: summarize(input.text, 180),
    errorMessage: summarize(errorMessage, 300),
    recipientUserIds,
    occurredAt: occurredAt.toISOString()
  };
}

function buildDingTalkMessage(payload: Record<string, unknown>): string {
  return [
    "[AgentStudio] 钉钉机器人问答失败",
    "",
    `实例：${asText(payload.botName)} (${asText(payload.integrationSlug)})`,
    `用户：${asText(payload.senderName) || "-"}${asText(payload.senderStaffId) ? ` / ${asText(payload.senderStaffId)}` : ""}`,
    `会话：${asText(payload.conversationType) || "-"} / ${asText(payload.externalConversationId) || "-"}`,
    `Thread：${asText(payload.threadId) || "-"}`,
    `消息 ID：${asText(payload.externalMessageId) || "-"}`,
    `错误：${asText(payload.errorMessage) || "-"}`,
    `问题预览：${asText(payload.questionPreview) || "-"}`,
    `时间：${asText(payload.occurredAt) || "-"}`
  ].join("\n");
}

function conversationTypeLabel(value: string | undefined): string {
  return value === "1" ? "单聊" : "群聊";
}

function errorDetail(error: unknown, fallback = "DingTalk bot message failed"): string {
  if (error instanceof Error) return summarize(error.message || fallback, 500);
  if (typeof error === "string") return summarize(error || fallback, 500);
  return fallback;
}

function summarize(text: string, limit: number): string {
  const value = text.trim().replace(/\s+/g, " ");
  if (!value) return "";
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 3))}...`;
}

function uniqueStrings(values: Iterable<unknown>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || undefined;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}
