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
  workspace: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  sandboxMode: SandboxMode;
  approvalPolicy: ApprovalPolicy;
  networkAccessEnabled: boolean;
  webSearchMode: WebSearchMode;
  additionalDirectories: string[];
  maxCommentHistory: number;
  systemPrompt: string;
  lastValidatedAt?: string;
  lastValidatedUser?: ZendeskValidatedUser;
};

export type ZendeskPublicSettings = Omit<
  ZendeskIntegrationSettings,
  "zendeskApiToken" | "webhookSigningSecret"
> & {
  hasZendeskApiToken: boolean;
  hasWebhookSigningSecret: boolean;
};

export type ZendeskBindingRecord = {
  ticketId: string;
  lastProcessedRequesterCommentId?: number;
  lastAction?: ZendeskDecisionType | "skip" | "error";
  lastRunAt?: string;
  lastRunId?: string;
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

export type ZendeskTicketPayload = {
  id: number;
  subject: string;
  description?: string;
  status?: string;
  priority?: string | null;
  tags: string[];
  requesterId?: number;
  updatedAt?: string;
};

export type ZendeskCommentPayload = {
  id: number;
  authorId?: number;
  body: string;
  public: boolean;
  createdAt?: string;
};

export type ZendeskTicketContext = {
  ticket: ZendeskTicketPayload;
  comments: ZendeskCommentPayload[];
};

export type ZendeskAgentDecision = {
  decision: ZendeskDecisionType;
  body: string;
  internalNote?: string;
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
  workspace: optionalStringSchema,
  model: optionalStringSchema,
  reasoning_effort: z.enum(REASONING_EFFORT_VALUES).optional(),
  sandbox_mode: z.enum(SANDBOX_MODE_VALUES).optional(),
  approval_policy: z.enum(APPROVAL_POLICY_VALUES).optional(),
  network_access_enabled: z.boolean().optional(),
  web_search_mode: z.enum(WEB_SEARCH_MODE_VALUES).optional(),
  additional_directories: optionalStringArraySchema,
  max_comment_history: z.number().int().min(1).max(50).optional(),
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
