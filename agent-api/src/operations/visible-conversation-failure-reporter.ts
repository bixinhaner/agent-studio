import { createHash } from "node:crypto";

type RecoveryStore = {
  recordFailure(input: {
    recoveryKey: string;
    organizationId?: string | null;
    userId?: string | null;
    threadId?: string | null;
    source: string;
    channel: string;
    audience?: "internal" | "external" | "unknown";
    severity?: string;
    reasonCode?: string;
    title: string;
    questionPreview?: string | null;
    failureDetail?: string | null;
    recipientEmail?: string | null;
    metadata?: unknown;
    occurredAt?: Date;
  }): Promise<{ id: string }>;
};

type NotificationStore = {
  create(input: {
    organizationId?: string;
    channelType: "dingtalk";
    targetRef: string;
    eventType: string;
    status: "pending";
    payload: Record<string, unknown>;
  }): Promise<{ id: string }>;
  update(input: {
    id: string;
    changes: {
      status: "sent" | "failed";
      payload?: Record<string, unknown>;
      errorMessage?: string | null;
    };
  }): Promise<unknown>;
};

type Logger = Pick<Console, "warn">;

export type VisibleConversationFailureInput = {
  source: string;
  channel: string;
  organizationId?: string | null;
  userId?: string | null;
  threadId?: string | null;
  sessionId?: string | null;
  userMessageId?: string | null;
  externalMessageId?: string | null;
  externalConversationId?: string | null;
  audience?: "internal" | "external" | "unknown";
  severity?: string;
  reasonCode?: string;
  title?: string;
  questionPreview?: string | null;
  failureDetail?: string | null;
  metadata?: unknown;
  occurredAt?: Date;
  recoveryKey?: string;
  notificationTargetRef?: string;
  notifyAdmins?: boolean;
  recipientUserIds?: string[];
};

export type VisibleConversationFailureReportResult = {
  recoveryCaseId: string;
  notification:
    | { status: "disabled"; detail: string }
    | { status: "sent" | "failed"; notificationId: string; detail?: string };
};

type NormalizedVisibleConversationFailure = {
  source: string;
  channel: string;
  organizationId?: string;
  userId?: string;
  threadId?: string;
  sessionId?: string;
  userMessageId?: string;
  externalMessageId?: string;
  externalConversationId?: string;
  audience: "internal" | "external" | "unknown";
  severity: string;
  reasonCode: string;
  title: string;
  questionPreview?: string;
  failureDetail: string;
  metadata?: unknown;
  occurredAt: Date;
  recoveryKey: string;
  notificationTargetRef: string;
  notifyAdmins: boolean;
  recipientUserIds?: string[];
};

export class VisibleConversationFailureReporter {
  constructor(
    private readonly deps: {
      recovery: RecoveryStore;
      notifications: NotificationStore;
      sendWorkNotice(input: { userIds?: string[]; message: string }): Promise<void>;
      listSuperAdminDingTalkUserIds(input: { organizationId?: string }): Promise<string[]>;
      logger?: Logger;
    }
  ) {}

  async report(input: VisibleConversationFailureInput): Promise<VisibleConversationFailureReportResult> {
    const normalized = normalizeFailure(input);
    const recoveryCase = await this.deps.recovery.recordFailure({
      recoveryKey: normalized.recoveryKey,
      organizationId: normalized.organizationId,
      userId: normalized.userId,
      threadId: normalized.threadId,
      source: normalized.source,
      channel: normalized.channel,
      audience: normalized.audience,
      severity: normalized.severity,
      reasonCode: normalized.reasonCode,
      title: normalized.title,
      questionPreview: normalized.questionPreview,
      failureDetail: normalized.failureDetail,
      metadata: failureMetadata(normalized),
      occurredAt: normalized.occurredAt
    });

    if (!normalized.notifyAdmins) {
      return {
        recoveryCaseId: recoveryCase.id,
        notification: { status: "disabled", detail: "admin notification disabled for this failure" }
      };
    }

    const recipientUserIds = uniqueStrings([
      ...(normalized.recipientUserIds ?? []),
      ...(await this.deps.listSuperAdminDingTalkUserIds({
        organizationId: normalized.organizationId
      }))
    ]);
    const payload = buildNotificationPayload(normalized, recoveryCase.id, recipientUserIds);
    const notification = await this.deps.notifications.create({
      organizationId: normalized.organizationId,
      channelType: "dingtalk",
      targetRef: normalized.notificationTargetRef,
      eventType: "conversation.visible_failure",
      status: "pending",
      payload
    });

    try {
      await this.deps.sendWorkNotice({
        userIds: recipientUserIds.length ? recipientUserIds : undefined,
        message: buildDingTalkMessage(payload)
      });
      await this.deps.notifications.update({
        id: notification.id,
        changes: {
          status: "sent",
          errorMessage: null,
          payload
        }
      });
      return {
        recoveryCaseId: recoveryCase.id,
        notification: { status: "sent", notificationId: notification.id }
      };
    } catch (error) {
      const detail = errorDetail(error, "visible conversation failure notification failed");
      await this.deps.notifications.update({
        id: notification.id,
        changes: {
          status: "failed",
          errorMessage: detail,
          payload
        }
      });
      this.deps.logger?.warn("visible conversation failure notification failed", {
        notificationId: notification.id,
        recoveryCaseId: recoveryCase.id,
        detail
      });
      return {
        recoveryCaseId: recoveryCase.id,
        notification: { status: "failed", notificationId: notification.id, detail }
      };
    }
  }
}

function normalizeFailure(input: VisibleConversationFailureInput): NormalizedVisibleConversationFailure {
  const source = trimOrUndefined(input.source);
  const channel = trimOrUndefined(input.channel);
  if (!source || !channel) {
    throw new Error("source and channel are required");
  }
  const failureDetail = summarize(trimOrUndefined(input.failureDetail) ?? "Conversation response failed", 1000);
  const recoveryKey = trimOrUndefined(input.recoveryKey) ?? buildRecoveryKey(input, failureDetail);
  return {
    source,
    channel,
    organizationId: trimOrUndefined(input.organizationId),
    userId: trimOrUndefined(input.userId),
    threadId: trimOrUndefined(input.threadId),
    sessionId: trimOrUndefined(input.sessionId),
    userMessageId: trimOrUndefined(input.userMessageId),
    externalMessageId: trimOrUndefined(input.externalMessageId),
    externalConversationId: trimOrUndefined(input.externalConversationId),
    audience: input.audience ?? "unknown",
    severity: trimOrUndefined(input.severity) ?? "high",
    reasonCode: trimOrUndefined(input.reasonCode) ?? "runtime_error",
    title: summarize(trimOrUndefined(input.title) ?? `${channelLabel(channel)}回答失败`, 200),
    questionPreview: summarizeOrUndefined(input.questionPreview, 500),
    failureDetail,
    metadata: input.metadata,
    occurredAt: input.occurredAt ?? new Date(),
    recoveryKey,
    notificationTargetRef:
      trimOrUndefined(input.notificationTargetRef) ?? `conversation_visible_failure:${recoveryKey}`,
    notifyAdmins: input.notifyAdmins !== false,
    recipientUserIds: input.recipientUserIds
  };
}

function buildRecoveryKey(input: VisibleConversationFailureInput, failureDetail: string): string {
  const stableMessageKey =
    trimOrUndefined(input.userMessageId) ??
    trimOrUndefined(input.externalMessageId) ??
    trimOrUndefined(input.sessionId) ??
    trimOrUndefined(input.externalConversationId) ??
    hashText(failureDetail);
  return [
    "visible_failure",
    trimOrUndefined(input.source),
    trimOrUndefined(input.channel),
    trimOrUndefined(input.threadId),
    stableMessageKey
  ]
    .filter(Boolean)
    .join(":");
}

function failureMetadata(input: NormalizedVisibleConversationFailure): Record<string, unknown> {
  return compactRecord({
    ...(asRecord(input.metadata) ?? {}),
    visibleFailure: true,
    sessionId: input.sessionId,
    userMessageId: input.userMessageId,
    externalMessageId: input.externalMessageId,
    externalConversationId: input.externalConversationId
  });
}

function buildNotificationPayload(
  input: NormalizedVisibleConversationFailure,
  recoveryCaseId: string,
  recipientUserIds: string[]
): Record<string, unknown> {
  return compactRecord({
    category: "conversation_visible_failure",
    recoveryCaseId,
    source: input.source,
    channel: input.channel,
    channelLabel: channelLabel(input.channel),
    organizationId: input.organizationId,
    userId: input.userId,
    threadId: input.threadId,
    sessionId: input.sessionId,
    userMessageId: input.userMessageId,
    externalMessageId: input.externalMessageId,
    externalConversationId: input.externalConversationId,
    questionPreview: summarizeOrUndefined(input.questionPreview, 180),
    errorMessage: summarize(input.failureDetail, 300),
    recipientUserIds,
    usesConfiguredDefaultRecipients: recipientUserIds.length === 0,
    occurredAt: input.occurredAt.toISOString()
  });
}

function buildDingTalkMessage(payload: Record<string, unknown>): string {
  return [
    "[AgentStudio] 用户侧回答失败",
    "",
    `渠道：${asText(payload.channelLabel) || asText(payload.channel) || "-"}`,
    `组织：${asText(payload.organizationId) || "-"}`,
    `用户：${asText(payload.userId) || "-"}`,
    `Thread：${asText(payload.threadId) || "-"}`,
    `Session：${asText(payload.sessionId) || "-"}`,
    `消息 ID：${asText(payload.userMessageId) || asText(payload.externalMessageId) || "-"}`,
    `错误：${asText(payload.errorMessage) || "-"}`,
    `问题预览：${asText(payload.questionPreview) || "-"}`,
    `补救单：${asText(payload.recoveryCaseId) || "-"}`,
    `时间：${asText(payload.occurredAt) || "-"}`
  ].join("\n");
}

function channelLabel(channel: string): string {
  if (channel === "portal") return "站内聊天";
  if (channel === "crest") return "CREST";
  if (channel === "dingtalk_bot") return "钉钉机器人";
  if (channel === "dingtalk") return "钉钉";
  return channel;
}

function errorDetail(error: unknown, fallback: string): string {
  if (error instanceof Error) return summarize(error.message || fallback, 500);
  if (typeof error === "string") return summarize(error || fallback, 500);
  return fallback;
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function summarizeOrUndefined(value: string | null | undefined, limit: number): string | undefined {
  const normalized = trimOrUndefined(value);
  return normalized ? summarize(normalized, limit) : undefined;
}

function summarize(text: string, limit: number): string {
  const value = text.trim().replace(/\s+/g, " ");
  if (!value) return "";
  if (value.length <= limit) return value;
  if (limit <= 3) return value.slice(0, limit);
  return `${value.slice(0, limit - 3)}...`;
}

function uniqueStrings(values: Iterable<unknown>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = trimOrUndefined(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}
