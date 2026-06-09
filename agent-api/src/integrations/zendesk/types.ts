import { z } from "zod";

import { REASONING_EFFORT_VALUES, type ReasoningEffort } from "../../model-config.js";

export const ZENDESK_RESPONSE_MODES = ["public_reply", "internal_note"] as const;
export const ZENDESK_FALLBACK_MODES = ["internal_note", "skip"] as const;
export const ZENDESK_AUTO_STATUS_VALUES = ["unchanged", "open", "pending", "hold"] as const;
export const SANDBOX_MODE_VALUES = ["read-only", "workspace-write", "danger-full-access"] as const;
export const APPROVAL_POLICY_VALUES = ["never", "on-request", "on-failure", "untrusted"] as const;
export const WEB_SEARCH_MODE_VALUES = ["disabled", "cached", "live"] as const;
export const ZENDESK_RUN_STATUS_VALUES = [
  "received",
  "deferred",
  "skipped",
  "processing",
  "replied",
  "noted",
  "handoff",
  "failed"
] as const;
export const ZENDESK_DECISION_VALUES = ["public_reply", "internal_note", "handoff"] as const;

export type ZendeskResponseMode = (typeof ZENDESK_RESPONSE_MODES)[number];
export type ZendeskFallbackMode = (typeof ZENDESK_FALLBACK_MODES)[number];
export type ZendeskAutoStatus = (typeof ZENDESK_AUTO_STATUS_VALUES)[number];
export type SandboxMode = (typeof SANDBOX_MODE_VALUES)[number];
export type ApprovalPolicy = (typeof APPROVAL_POLICY_VALUES)[number];
export type WebSearchMode = (typeof WEB_SEARCH_MODE_VALUES)[number];
export type ZendeskRunStatus = (typeof ZENDESK_RUN_STATUS_VALUES)[number];
export type ZendeskDecisionType = (typeof ZENDESK_DECISION_VALUES)[number];

export type ZendeskValidatedUser = {
  id: number;
  name: string;
  email?: string;
  role?: string;
};

export type ZendeskIntegrationSettings = {
  enabled: boolean;
  publicBaseUrl: string;
  zendeskBaseUrl: string;
  zendeskEmail: string;
  zendeskApiToken: string;
  webhookSigningSecret: string;
  responseMode: ZendeskResponseMode;
  fallbackMode: ZendeskFallbackMode;
  autoStatus: ZendeskAutoStatus;
  excludedTags: string[];
  agentModeId: string;
  knowledgeSetIds: string[];
  workspace: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  sandboxMode: SandboxMode;
  approvalPolicy: ApprovalPolicy;
  networkAccessEnabled: boolean;
  webSearchMode: WebSearchMode;
  additionalDirectories: string[];
  maxCommentHistory: number;
  attachmentReadingEnabled: boolean;
  attachmentTypeRestrictionEnabled: boolean;
  maxAttachmentCount: number;
  maxAttachmentBytes: number;
  allowedAttachmentMimeTypes: string[];
  dingtalkNotificationEnabled: boolean;
  dingtalkNotificationManualRunsEnabled: boolean;
  dingtalkNotificationWebhookUrl: string;
  dingtalkNotificationRobotSecret: string;
  dingtalkNotificationFallbackUserIds: string[];
  dingtalkNotificationTemplate: string;
  dingtalkReviewRequiredEnabled: boolean;
  dingtalkReviewDueHours: number;
  aiReviewEmailReminderEnabled: boolean;
  aiReviewEmailReminderTime: string;
  aiReviewEmailReminderTimezone: string;
  aiReviewEmailReminderCcEmails: string[];
  systemPrompt: string;
  lastValidatedAt?: string;
  lastValidatedUser?: ZendeskValidatedUser;
};

export type ZendeskPublicSettings = Omit<
  ZendeskIntegrationSettings,
  "zendeskApiToken" | "webhookSigningSecret" | "dingtalkNotificationWebhookUrl" | "dingtalkNotificationRobotSecret"
> & {
  hasZendeskApiToken: boolean;
  hasWebhookSigningSecret: boolean;
  hasDingTalkNotificationWebhookUrl: boolean;
  hasDingTalkNotificationRobotSecret: boolean;
};

export type ZendeskBindingRecord = {
  ticketId: string;
  instanceId?: string;
  lastProcessedRequesterCommentId?: number;
  lastAction?: ZendeskDecisionType | "skip" | "error";
  lastRunAt?: string;
  lastRunId?: string;
  codexThreadId?: string;
  workspacePath?: string;
  updatedAt: string;
  createdAt: string;
};

export type ZendeskRunRecord = {
  id: string;
  instanceId?: string;
  ticketId: string;
  source: "webhook" | "manual";
  status: ZendeskRunStatus;
  detail: string;
  createdAt: string;
  updatedAt: string;
  decision?: ZendeskDecisionType;
  commentId?: number;
  requesterCommentId?: number;
  ticketSubject?: string;
  error?: string;
};

export type ZendeskSetupGuide = {
  webhookUrl: string;
  legacyWebhookUrl?: string;
  payloadExample: string;
  triggers: Array<{
    name: string;
    description: string;
    conditions: string[];
  }>;
};

export type ZendeskOverview = {
  settings: ZendeskPublicSettings;
  ready: boolean;
  missing: string[];
  setup: ZendeskSetupGuide;
  runs: ZendeskRunRecord[];
};

export type ZendeskCacheCleanupItem = {
  directoryName: string;
  directoryPath: string;
  instanceId: string;
  ticketId: string;
  sizeBytes: number;
  modifiedAt: string;
  ticketStatus?: string;
  ticketUpdatedAt?: string;
  eligible: boolean;
  reason: string;
  deleted?: boolean;
  error?: string;
};

export type ZendeskCacheCleanupResult = {
  retentionDays: number;
  scannedCount: number;
  matchedCount: number;
  eligibleCount: number;
  deletedCount: number;
  totalBytes: number;
  reclaimableBytes: number;
  deletedBytes: number;
  generatedAt: string;
  items: ZendeskCacheCleanupItem[];
};

export type ZendeskTicketPayload = {
  id: number;
  subject: string;
  description?: string;
  status?: string;
  priority?: string | null;
  tags: string[];
  requesterId?: number;
  requester?: ZendeskRequesterPayload;
  assigneeId?: number;
  assignee?: ZendeskRequesterPayload;
  updatedAt?: string;
};

export type ZendeskRequesterPayload = {
  id: number;
  name?: string;
  email?: string;
  role?: string;
  organizationId?: number;
  organizationName?: string;
  countryRegion?: string;
};

export type ZendeskCommentPayload = {
  id: number;
  authorId?: number;
  author?: ZendeskRequesterPayload;
  body: string;
  public: boolean;
  createdAt?: string;
  attachments: ZendeskAttachmentPayload[];
};

export type ZendeskAttachmentPayload = {
  id?: number;
  fileName: string;
  contentType?: string;
  size?: number;
  contentUrl?: string;
  mappedContentUrl?: string;
  inline?: boolean;
  localPath?: string;
  relativePath?: string;
  downloadStatus?: "downloaded" | "skipped" | "failed";
  downloadReason?: string;
};

export type ZendeskTicketContext = {
  ticket: ZendeskTicketPayload;
  comments: ZendeskCommentPayload[];
};

export type ZendeskAgentDecision = {
  decision: ZendeskDecisionType;
  body: string;
  publicReplyPreview?: string;
  internalNote?: string;
  processSummary?: string;
  confidence?: number;
  reasons?: string[];
};

const optionalStringSchema = z.string().optional();
const optionalStringArraySchema = z.array(z.string()).optional();

export const zendeskSettingsUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  public_base_url: optionalStringSchema,
  zendesk_base_url: optionalStringSchema,
  zendesk_email: optionalStringSchema,
  zendesk_api_token: optionalStringSchema,
  webhook_signing_secret: optionalStringSchema,
  response_mode: z.enum(ZENDESK_RESPONSE_MODES).optional(),
  fallback_mode: z.enum(ZENDESK_FALLBACK_MODES).optional(),
  auto_status: z.enum(ZENDESK_AUTO_STATUS_VALUES).optional(),
  excluded_tags: optionalStringArraySchema,
  agent_mode_id: optionalStringSchema,
  knowledge_set_ids: optionalStringArraySchema,
  workspace: optionalStringSchema,
  model: optionalStringSchema,
  reasoning_effort: z.enum(REASONING_EFFORT_VALUES).optional(),
  sandbox_mode: z.enum(SANDBOX_MODE_VALUES).optional(),
  approval_policy: z.enum(APPROVAL_POLICY_VALUES).optional(),
  network_access_enabled: z.boolean().optional(),
  web_search_mode: z.enum(WEB_SEARCH_MODE_VALUES).optional(),
  additional_directories: optionalStringArraySchema,
  max_comment_history: z.number().int().min(1).max(50).optional(),
  attachment_reading_enabled: z.boolean().optional(),
  attachment_type_restriction_enabled: z.boolean().optional(),
  max_attachment_count: z.number().int().min(1).max(100).optional(),
  max_attachment_bytes: z.number().int().min(1024).max(50 * 1024 * 1024).optional(),
  allowed_attachment_mime_types: optionalStringArraySchema,
  dingtalk_notification_enabled: z.boolean().optional(),
  dingtalk_notification_manual_runs_enabled: z.boolean().optional(),
  dingtalk_notification_webhook_url: optionalStringSchema,
  dingtalk_notification_robot_secret: optionalStringSchema,
  dingtalk_notification_fallback_user_ids: optionalStringArraySchema,
  dingtalk_notification_template: optionalStringSchema,
  dingtalk_review_required_enabled: z.boolean().optional(),
  dingtalk_review_due_hours: z.number().int().min(1).max(168).optional(),
  ai_review_email_reminder_enabled: z.boolean().optional(),
  ai_review_email_reminder_time: optionalStringSchema,
  ai_review_email_reminder_timezone: optionalStringSchema,
  ai_review_email_reminder_cc_emails: optionalStringArraySchema,
  system_prompt: optionalStringSchema
});

export const zendeskManualRunSchema = z.object({
  ticket_id: z.union([z.number().int().positive(), z.string().trim().min(1)])
});

export const zendeskWebhookPayloadSchema = z.object({
  ticket_id: z.union([z.number().int().positive(), z.string().trim().min(1)]),
  event: z.string().optional(),
  trigger_name: z.string().optional()
});
