import type { ReasoningEffort } from "../../lib/model-config";

export type ZendeskResponseMode = "public_reply" | "internal_note";
export type ZendeskFallbackMode = "internal_note" | "skip";
export type ZendeskAutoStatus = "unchanged" | "open" | "pending" | "hold";
export type ZendeskSandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type ZendeskApprovalPolicy = "never" | "on-request" | "on-failure" | "untrusted";
export type ZendeskWebSearchMode = "disabled" | "cached" | "live";
export type ZendeskRunStatus = "received" | "skipped" | "processing" | "replied" | "noted" | "handoff" | "failed";

export type ZendeskPublicSettings = {
  enabled: boolean;
  publicBaseUrl: string;
  zendeskBaseUrl: string;
  zendeskEmail: string;
  responseMode: ZendeskResponseMode;
  fallbackMode: ZendeskFallbackMode;
  autoStatus: ZendeskAutoStatus;
  excludedTags: string[];
  workspace: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  sandboxMode: ZendeskSandboxMode;
  approvalPolicy: ZendeskApprovalPolicy;
  networkAccessEnabled: boolean;
  webSearchMode: ZendeskWebSearchMode;
  additionalDirectories: string[];
  maxCommentHistory: number;
  systemPrompt: string;
  lastValidatedAt?: string;
  lastValidatedUser?: {
    id: number;
    name: string;
    email?: string;
    role?: string;
  };
  hasZendeskApiToken: boolean;
  hasWebhookSigningSecret: boolean;
};

export type ZendeskRunRecord = {
  id: string;
  ticketId: string;
  source: "webhook" | "manual";
  status: ZendeskRunStatus;
  detail: string;
  createdAt: string;
  updatedAt: string;
  decision?: "public_reply" | "internal_note" | "handoff";
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

export type ZendeskSettingsUpdate = {
  enabled: boolean;
  public_base_url: string;
  zendesk_base_url: string;
  zendesk_email: string;
  zendesk_api_token?: string;
  webhook_signing_secret?: string;
  response_mode: ZendeskResponseMode;
  fallback_mode: ZendeskFallbackMode;
  auto_status: ZendeskAutoStatus;
  excluded_tags: string[];
  workspace: string;
  model: string;
  reasoning_effort: ReasoningEffort;
  sandbox_mode: ZendeskSandboxMode;
  approval_policy: ZendeskApprovalPolicy;
  network_access_enabled: boolean;
  web_search_mode: ZendeskWebSearchMode;
  additional_directories: string[];
  max_comment_history: number;
  system_prompt: string;
};
