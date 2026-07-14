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

type ExperienceUserIdentity = {
  displayName?: string;
  email?: string;
};

type ExperienceAudience = "internal" | "external" | "unknown";

export type CustomerExperienceIssueInput = {
  source: string;
  channel: string;
  issueType?: "response_failure" | "negative_feedback" | "product_feedback";
  organizationId?: string | null;
  userId?: string | null;
  threadId?: string | null;
  sessionId?: string | null;
  userMessageId?: string | null;
  externalMessageId?: string | null;
  externalConversationId?: string | null;
  stableIssueKey?: string | null;
  audience?: ExperienceAudience;
  severity?: string;
  reasonCode?: string;
  title?: string;
  contentPreview?: string | null;
  issueDetail?: string | null;
  metadata?: unknown;
  occurredAt?: Date;
  recoveryKey?: string;
  notificationTargetRef?: string;
  notificationEventType?: string;
  notificationCategory?: string;
  notificationHeadline?: string;
  notificationDetailLabel?: string;
  notificationPreviewLabel?: string;
  notifyAdmins?: boolean;
  recipientUserIds?: string[];
};

export type CustomerExperienceIssueReportResult = {
  recoveryCaseId: string;
  notification:
    | { status: "disabled"; detail: string }
    | { status: "sent" | "failed"; notificationId: string; detail?: string };
};

type NormalizedCustomerExperienceIssue = {
  source: string;
  channel: string;
  issueType: "response_failure" | "negative_feedback" | "product_feedback";
  organizationId?: string;
  userId?: string;
  threadId?: string;
  sessionId?: string;
  userMessageId?: string;
  externalMessageId?: string;
  externalConversationId?: string;
  stableIssueKey?: string;
  audience: ExperienceAudience;
  severity: string;
  reasonCode: string;
  title: string;
  contentPreview?: string;
  issueDetail: string;
  metadata?: unknown;
  occurredAt: Date;
  recoveryKey: string;
  notificationTargetRef: string;
  notificationEventType: string;
  notificationCategory: string;
  notificationHeadline: string;
  notificationDetailLabel: string;
  notificationPreviewLabel: string;
  notifyAdmins: boolean;
  recipientUserIds?: string[];
};

export type NegativeConversationFeedbackIssueInput = {
  organizationId?: string | null;
  userId?: string | null;
  threadId: string;
  messageId: string;
  audience?: ExperienceAudience;
  contentPreview?: string | null;
  comment?: string | null;
  occurredAt?: Date;
};

export type ProductFeedbackIssueInput = {
  id: string;
  organizationId?: string | null;
  userId?: string | null;
  threadId?: string | null;
  type: string;
  severity?: string | null;
  description: string;
  context?: unknown;
  createdAt?: string | Date;
  audience?: ExperienceAudience;
};

export class CustomerExperienceIssueReporter {
  constructor(
    private readonly deps: {
      recovery: RecoveryStore;
      notifications: NotificationStore;
      sendWorkNotice(input: { userIds?: string[]; message: string }): Promise<void>;
      listSuperAdminDingTalkUserIds(input: { organizationId?: string }): Promise<string[]>;
      resolveUserIdentity(userId: string): Promise<ExperienceUserIdentity | undefined>;
      logger?: Logger;
    }
  ) {}

  async report(input: CustomerExperienceIssueInput): Promise<CustomerExperienceIssueReportResult> {
    const normalized = normalizeIssue(input);
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
      questionPreview: normalized.contentPreview,
      failureDetail: normalized.issueDetail,
      metadata: issueMetadata(normalized),
      occurredAt: normalized.occurredAt
    });

    if (!normalized.notifyAdmins) {
      return {
        recoveryCaseId: recoveryCase.id,
        notification: { status: "disabled", detail: "admin notification disabled for this issue" }
      };
    }

    const [adminRecipientUserIds, userIdentity] = await Promise.all([
      this.deps.listSuperAdminDingTalkUserIds({
        organizationId: normalized.organizationId
      }),
      this.resolveUserIdentity(normalized.userId)
    ]);
    const recipientUserIds = uniqueStrings([
      ...(normalized.recipientUserIds ?? []),
      ...adminRecipientUserIds
    ]);
    const payload = buildNotificationPayload(normalized, recoveryCase.id, recipientUserIds, userIdentity);
    const notification = await this.deps.notifications.create({
      organizationId: normalized.organizationId,
      channelType: "dingtalk",
      targetRef: normalized.notificationTargetRef,
      eventType: normalized.notificationEventType,
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
      const detail = errorDetail(error, "customer experience issue notification failed");
      await this.deps.notifications.update({
        id: notification.id,
        changes: {
          status: "failed",
          errorMessage: detail,
          payload
        }
      });
      this.deps.logger?.warn("customer experience issue notification failed", {
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

  private async resolveUserIdentity(userId?: string): Promise<ExperienceUserIdentity | undefined> {
    if (!userId) return undefined;
    try {
      return await this.deps.resolveUserIdentity(userId);
    } catch (error) {
      this.deps.logger?.warn("customer experience issue user identity lookup failed", {
        userId,
        detail: errorDetail(error, "user identity lookup failed")
      });
      return undefined;
    }
  }

  async reportNegativeConversationFeedback(input: NegativeConversationFeedbackIssueInput): Promise<CustomerExperienceIssueReportResult> {
    const comment = trimOrUndefined(input.comment ?? undefined);
    const contentPreview = trimOrUndefined(input.contentPreview ?? undefined);
    return this.report({
      source: "conversation_negative_feedback",
      channel: "portal",
      issueType: "negative_feedback",
      organizationId: input.organizationId,
      userId: input.userId,
      threadId: input.threadId,
      userMessageId: input.messageId,
      stableIssueKey: input.messageId,
      audience: input.audience,
      severity: "medium",
      reasonCode: "negative_feedback",
      title: "站内聊天体验反馈",
      contentPreview: comment ?? contentPreview,
      issueDetail: comment ? `用户提交了负向回答反馈：${comment}` : "用户提交了负向回答反馈",
      metadata: {
        feedbackType: "negative",
        assistantMessageId: input.messageId,
        contentPreview,
        comment
      },
      occurredAt: input.occurredAt,
      notificationHeadline: "[AgentStudio] 用户体验反馈待跟进",
      notificationDetailLabel: "反馈",
      notificationPreviewLabel: "内容预览"
    });
  }

  async reportProductFeedback(input: ProductFeedbackIssueInput): Promise<CustomerExperienceIssueReportResult | undefined> {
    if (!shouldCreateIssueForProductFeedback(input)) return undefined;
    const severity = normalizeProductFeedbackSeverity(input.severity);
    const occurredAt = normalizeDate(input.createdAt);
    return this.report({
      source: severity === "blocking" ? "product_feedback_blocking" : "product_feedback_bug",
      channel: "portal",
      issueType: "product_feedback",
      organizationId: input.organizationId,
      userId: input.userId,
      threadId: input.threadId,
      stableIssueKey: input.id,
      audience: input.audience,
      severity,
      reasonCode: severity === "blocking" ? "product_feedback_blocking" : "product_feedback_high_severity",
      title: severity === "blocking" ? "阻塞级系统反馈" : "高严重度系统反馈",
      contentPreview: input.description,
      issueDetail: `用户提交了${productFeedbackSeverityLabel(severity)}系统 Bug 反馈`,
      metadata: {
        productFeedbackId: input.id,
        productFeedbackType: input.type,
        productFeedbackSeverity: severity
      },
      occurredAt,
      notificationHeadline: "[AgentStudio] 系统体验反馈待跟进",
      notificationDetailLabel: "反馈",
      notificationPreviewLabel: "反馈预览"
    });
  }
}

export function shouldCreateIssueForProductFeedback(input: { type: string; severity?: string | null }): boolean {
  return input.type === "bug" && (input.severity === "blocking" || input.severity === "high");
}

function normalizeIssue(input: CustomerExperienceIssueInput): NormalizedCustomerExperienceIssue {
  const source = trimOrUndefined(input.source);
  const channel = trimOrUndefined(input.channel);
  if (!source || !channel) {
    throw new Error("source and channel are required");
  }
  const issueType = input.issueType ?? "response_failure";
  const issueDetail = summarize(trimOrUndefined(input.issueDetail) ?? "Customer experience issue detected", 1000);
  const recoveryKey = trimOrUndefined(input.recoveryKey) ?? buildRecoveryKey(input, issueDetail);
  const notificationTargetRef = trimOrUndefined(input.notificationTargetRef) ?? `customer_experience_issue:${recoveryKey}`;
  return {
    source,
    channel,
    issueType,
    organizationId: trimOrUndefined(input.organizationId),
    userId: trimOrUndefined(input.userId),
    threadId: trimOrUndefined(input.threadId),
    sessionId: trimOrUndefined(input.sessionId),
    userMessageId: trimOrUndefined(input.userMessageId),
    externalMessageId: trimOrUndefined(input.externalMessageId),
    externalConversationId: trimOrUndefined(input.externalConversationId),
    stableIssueKey: trimOrUndefined(input.stableIssueKey),
    audience: input.audience ?? "unknown",
    severity: trimOrUndefined(input.severity) ?? "high",
    reasonCode: trimOrUndefined(input.reasonCode) ?? "customer_experience_issue",
    title: summarize(trimOrUndefined(input.title) ?? `${channelLabel(channel)}体验事件`, 200),
    contentPreview: summarizeOrUndefined(input.contentPreview, 500),
    issueDetail,
    metadata: input.metadata,
    occurredAt: input.occurredAt ?? new Date(),
    recoveryKey,
    notificationTargetRef,
    notificationEventType: trimOrUndefined(input.notificationEventType) ?? "customer_experience.issue_detected",
    notificationCategory: trimOrUndefined(input.notificationCategory) ?? "customer_experience_issue",
    notificationHeadline: trimOrUndefined(input.notificationHeadline) ?? "[AgentStudio] 用户体验事件待跟进",
    notificationDetailLabel: trimOrUndefined(input.notificationDetailLabel) ?? "说明",
    notificationPreviewLabel: trimOrUndefined(input.notificationPreviewLabel) ?? "内容预览",
    notifyAdmins: input.notifyAdmins !== false,
    recipientUserIds: input.recipientUserIds
  };
}

function buildRecoveryKey(input: CustomerExperienceIssueInput, issueDetail: string): string {
  const stableMessageKey =
    trimOrUndefined(input.stableIssueKey) ??
    trimOrUndefined(input.userMessageId) ??
    trimOrUndefined(input.externalMessageId) ??
    trimOrUndefined(input.sessionId) ??
    trimOrUndefined(input.externalConversationId) ??
    hashText(issueDetail);
  return [
    "customer_experience_issue",
    trimOrUndefined(input.source),
    trimOrUndefined(input.channel),
    trimOrUndefined(input.threadId),
    stableMessageKey
  ]
    .filter(Boolean)
    .join(":");
}

function issueMetadata(input: NormalizedCustomerExperienceIssue): Record<string, unknown> {
  return compactRecord({
    ...(asRecord(input.metadata) ?? {}),
    customerExperienceIssue: true,
    issueType: input.issueType,
    sessionId: input.sessionId,
    userMessageId: input.userMessageId,
    externalMessageId: input.externalMessageId,
    externalConversationId: input.externalConversationId
  });
}

function buildNotificationPayload(
  input: NormalizedCustomerExperienceIssue,
  recoveryCaseId: string,
  recipientUserIds: string[],
  userIdentity?: ExperienceUserIdentity
): Record<string, unknown> {
  return compactRecord({
    category: input.notificationCategory,
    recoveryCaseId,
    source: input.source,
    channel: input.channel,
    channelLabel: channelLabel(input.channel),
    issueType: input.issueType,
    reasonCode: input.reasonCode,
    severity: input.severity,
    organizationId: input.organizationId,
    userId: input.userId,
    userDisplayName: trimOrUndefined(userIdentity?.displayName),
    userEmail: trimOrUndefined(userIdentity?.email),
    threadId: input.threadId,
    sessionId: input.sessionId,
    userMessageId: input.userMessageId,
    externalMessageId: input.externalMessageId,
    externalConversationId: input.externalConversationId,
    questionPreview: summarizeOrUndefined(input.contentPreview, 180),
    errorMessage: summarize(input.issueDetail, 300),
    recipientUserIds,
    usesConfiguredDefaultRecipients: recipientUserIds.length === 0,
    occurredAt: input.occurredAt.toISOString(),
    headline: input.notificationHeadline,
    detailLabel: input.notificationDetailLabel,
    previewLabel: input.notificationPreviewLabel
  });
}

function buildDingTalkMessage(payload: Record<string, unknown>): string {
  const detailLabel = asText(payload.detailLabel) || "说明";
  const previewLabel = asText(payload.previewLabel) || "内容预览";
  const userId = asText(payload.userId);
  const userDisplayName = asText(payload.userDisplayName);
  const userEmail = asText(payload.userEmail);
  const userLabel = userDisplayName && userEmail
    ? `${userDisplayName} <${userEmail}>`
    : userDisplayName || userEmail || userId || "-";
  const userLines = [`用户：${userLabel}`];
  if ((userDisplayName || userEmail) && userId) {
    userLines.push(`用户 ID：${userId}`);
  }
  return [
    asText(payload.headline) || "[AgentStudio] 用户体验事件待跟进",
    "",
    `渠道：${asText(payload.channelLabel) || asText(payload.channel) || "-"}`,
    `组织：${asText(payload.organizationId) || "-"}`,
    ...userLines,
    `Thread：${asText(payload.threadId) || "-"}`,
    `Session：${asText(payload.sessionId) || "-"}`,
    `消息 ID：${asText(payload.userMessageId) || asText(payload.externalMessageId) || "-"}`,
    `${detailLabel}：${asText(payload.errorMessage) || "-"}`,
    `${previewLabel}：${asText(payload.questionPreview) || "-"}`,
    `跟进单：${asText(payload.recoveryCaseId) || "-"}`,
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

function normalizeProductFeedbackSeverity(value: unknown): "blocking" | "high" {
  return value === "blocking" ? "blocking" : "high";
}

function productFeedbackSeverityLabel(severity: "blocking" | "high"): string {
  return severity === "blocking" ? "阻塞级" : "高严重度";
}

function normalizeDate(value: string | Date | undefined): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
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
