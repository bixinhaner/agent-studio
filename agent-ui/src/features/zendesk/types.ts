export type ZendeskResponseMode = "public_reply" | "internal_note";
export type ZendeskFallbackMode = "internal_note" | "skip";
export type ZendeskAutoStatus = "unchanged" | "open" | "pending" | "hold";
export type ZendeskRunStatus = "received" | "deferred" | "skipped" | "processing" | "replied" | "noted" | "handoff" | "failed";

export type ZendeskPublicSettings = {
  enabled: boolean;
  publicBaseUrl: string;
  zendeskBaseUrl: string;
  zendeskEmail: string;
  responseMode: ZendeskResponseMode;
  fallbackMode: ZendeskFallbackMode;
  autoStatus: ZendeskAutoStatus;
  excludedTags: string[];
  agentModeId: string;
  knowledgeSetIds: string[];
  maxCommentHistory: number;
  attachmentReadingEnabled: boolean;
  attachmentTypeRestrictionEnabled: boolean;
  maxAttachmentCount: number;
  maxAttachmentBytes: number;
  allowedAttachmentMimeTypes: string[];
  dingtalkReviewRequiredEnabled?: boolean;
  dingtalkReviewDueHours?: number;
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
  instanceId?: string;
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
  agent_mode_id: string;
  knowledge_set_ids: string[];
  max_comment_history: number;
  attachment_reading_enabled: boolean;
  attachment_type_restriction_enabled: boolean;
  max_attachment_count: number;
  max_attachment_bytes: number;
  allowed_attachment_mime_types: string[];
};
