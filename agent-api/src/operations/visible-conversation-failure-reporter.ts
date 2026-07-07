import { createHash } from "node:crypto";

import type {
  CustomerExperienceIssueReporter,
  CustomerExperienceIssueReportResult
} from "./customer-experience-issue-reporter.js";

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

export type VisibleConversationFailureReportResult = CustomerExperienceIssueReportResult;

export class VisibleConversationFailureReporter {
  constructor(
    private readonly deps: {
      issues: Pick<CustomerExperienceIssueReporter, "report">;
    }
  ) {}

  async report(input: VisibleConversationFailureInput): Promise<VisibleConversationFailureReportResult> {
    const failureDetail = summarize(trimOrUndefined(input.failureDetail) ?? "Conversation response failed", 1000);
    const recoveryKey = trimOrUndefined(input.recoveryKey) ?? buildRecoveryKey(input, failureDetail);
    return this.deps.issues.report({
      source: input.source,
      channel: input.channel,
      issueType: "response_failure",
      organizationId: input.organizationId,
      userId: input.userId,
      threadId: input.threadId,
      sessionId: input.sessionId,
      userMessageId: input.userMessageId,
      externalMessageId: input.externalMessageId,
      externalConversationId: input.externalConversationId,
      audience: input.audience,
      severity: input.severity,
      reasonCode: input.reasonCode ?? "runtime_error",
      title: input.title,
      contentPreview: input.questionPreview,
      issueDetail: failureDetail,
      metadata: {
        ...(asRecord(input.metadata) ?? {}),
        visibleFailure: true
      },
      occurredAt: input.occurredAt,
      recoveryKey,
      notificationTargetRef: trimOrUndefined(input.notificationTargetRef) ?? `conversation_visible_failure:${recoveryKey}`,
      notificationEventType: "conversation.visible_failure",
      notificationCategory: "conversation_visible_failure",
      notificationHeadline: "[AgentStudio] 用户侧回答失败",
      notificationDetailLabel: "错误",
      notificationPreviewLabel: "问题预览",
      notifyAdmins: input.notifyAdmins,
      recipientUserIds: input.recipientUserIds
    });
  }
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

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function summarize(text: string, limit: number): string {
  const value = text.trim().replace(/\s+/g, " ");
  if (!value) return "";
  if (value.length <= limit) return value;
  if (limit <= 3) return value.slice(0, limit);
  return `${value.slice(0, limit - 3)}...`;
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
