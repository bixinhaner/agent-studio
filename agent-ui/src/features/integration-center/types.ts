import type { ZendeskRunRecord, ZendeskSetupGuide } from "../zendesk/types";

export type IntegrationType = 'dingtalk' | 'zendesk' | 'openai_codex' | 'openai_compatible_api';
export type IntegrationCenterTab = IntegrationType;
export type IntegrationStatus = 'draft' | 'active' | 'disabled' | 'error' | string;
export type IntegrationSectionTab = 'basic' | 'config' | 'bot' | 'history' | 'bindings' | 'policies';

export type IntegrationListItem = {
  id: string;
  organizationId?: string;
  type: IntegrationType;
  slug: string;
  name: string;
  description?: string;
  status: IntegrationStatus;
  isSystemSingleton: boolean;
  createdAt: string;
  updatedAt: string;
  config?: Record<string, unknown>;
  secretState: {
    hasSecrets: boolean;
    rotatedAt?: string;
    rotatedByUserId?: string;
  };
};

export type IntegrationValidationItem = {
  id: string;
  triggerType: string;
  status: string;
  summary?: unknown;
  detail?: unknown;
  triggeredByUserId?: string;
  createdAt: string;
};

export type IntegrationBindingRecord = {
  id: string;
  targetType: string;
  targetId: string;
  bindingType: string;
  bindingPayload: unknown;
  createdAt: string;
  updatedAt: string;
};

export type IntegrationPolicyInput = {
  subjectType: 'role' | 'department' | 'user';
  subjectId: string;
  effect: 'allow' | 'deny';
};

export type IntegrationPolicySummary = {
  allow: {
    roles: string[];
    departments: string[];
    users: string[];
  };
  deny: {
    roles: string[];
    departments: string[];
    users: string[];
  };
};

export type IntegrationDetail = {
  instance: IntegrationListItem;
  config: Record<string, unknown>;
  secretState: IntegrationListItem['secretState'];
  validationHistory: { items: IntegrationValidationItem[] };
  bindings: { items: IntegrationBindingRecord[] };
  policies: { items: IntegrationPolicyInput[]; summary: IntegrationPolicySummary };
  zendesk?: {
    ready: boolean;
    missing: string[];
    setup: ZendeskSetupGuide;
    runs: ZendeskRunRecord[];
  };
};

export type IntegrationListResponse = { items: IntegrationListItem[] };
export type IntegrationValidationHistoryResponse = { items: IntegrationValidationItem[] };
export type IntegrationBindingsResponse = { items: IntegrationBindingRecord[] };
export type IntegrationPoliciesResponse = { items: IntegrationPolicyInput[]; summary: IntegrationPolicySummary };
export type IntegrationValidationResult = {
  validation: IntegrationValidationItem;
  detail: IntegrationDetail;
};
export type IntegrationZendeskRunResult = {
  result: {
    status: string;
    detail: string;
    runId: string;
    commentId?: number;
    requesterCommentId?: number;
    decision?: string;
  };
  detail: IntegrationDetail;
};

export type CreateIntegrationInstanceInput = {
  type: IntegrationType;
  slug: string;
  name: string;
  description?: string | null;
  status?: IntegrationStatus;
  config?: Record<string, unknown>;
  secretState?: Record<string, unknown> | null;
};

export type UpdateIntegrationInstanceInput = {
  name?: string;
  slug?: string;
  description?: string | null;
  status?: IntegrationStatus;
  config?: Record<string, unknown>;
  secretState?: Record<string, unknown> | null;
};

export type IntegrationBindingInput = {
  targetType: string;
  targetId: string;
  bindingType: string;
  bindingPayload?: unknown;
};

export type IntegrationTypeFilter = IntegrationType;

export type DingTalkConfigInput = {
  clientId?: string;
  redirectUri?: string;
  scope?: string;
  apiBaseUrl?: string;
  alertAgentId?: string;
  alertUserIds?: string[];
  robot?: DingTalkBotConfigInput;
};

export type DingTalkSecretInput = {
  clientSecret?: string;
};

export type DingTalkBotConfigInput = {
  enabled?: boolean;
  receiveMode?: 'stream';
  replyMode?: 'markdown' | 'ai_card_stream';
  agentModeId?: string;
  knowledgeSetIds?: string[];
  singleChatEnabled?: boolean;
  groupChatEnabled?: boolean;
  groupReplyMode?: 'mention_only';
  autoSyncUsers?: boolean;
  streamingCardTemplateId?: string;
  streamingCardContentKey?: string;
  streamingCardUpdateIntervalMs?: number;
  streamingCardMinUpdateChars?: number;
  resetCommands?: string[];
  unauthorizedMessage?: string;
  busyMessage?: string;
  resetConfirmationMessage?: string;
  unsupportedMessage?: string;
  errorMessage?: string;
};

export type DingTalkBotStatusRecord = {
  instanceId: string;
  slug: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  registered: boolean;
  startedAt?: string;
  lastEventAt?: string;
  lastReplyAt?: string;
  lastError?: string;
  processedCount: number;
  ignoredCount: number;
};

export type DingTalkBotStatusResponse = {
  statuses: DingTalkBotStatusRecord[];
};

export type DingTalkBotConversationRecord = {
  id: string;
  organizationId?: string;
  integrationInstanceId: string;
  threadId: string;
  userId?: string;
  channel: string;
  externalConversationKey: string;
  externalConversationId: string;
  conversationType: string;
  agentModeId?: string;
  externalUserId?: string;
  externalUnionId?: string;
  externalUserName?: string;
  externalGroupId?: string;
  externalGroupName?: string;
  botId?: string;
  botName?: string;
  lastExternalMessageId?: string;
  lastMessageAt?: string;
  metadata?: unknown;
  createdAt: string;
  updatedAt: string;
};

export type DingTalkBotConversationsResponse = {
  items: DingTalkBotConversationRecord[];
};

export type ZendeskConfigInput = {
  enabled?: boolean;
  publicBaseUrl?: string;
  zendeskBaseUrl?: string;
  zendeskEmail?: string;
  responseMode?: string;
  fallbackMode?: string;
  autoStatus?: string;
  excludedTags?: string[];
  agentModeId?: string;
  knowledgeSetIds?: string[];
  workspace?: string;
  model?: string;
  reasoningEffort?: string;
  sandboxMode?: string;
  approvalPolicy?: string;
  networkAccessEnabled?: boolean;
  webSearchMode?: string;
  additionalDirectories?: string[];
  maxCommentHistory?: number;
  attachmentReadingEnabled?: boolean;
  maxAttachmentCount?: number;
  maxAttachmentBytes?: number;
  allowedAttachmentMimeTypes?: string[];
  systemPrompt?: string;
};

export type ZendeskSecretInput = {
  zendeskApiToken?: string;
  webhookSigningSecret?: string;
};

export type OpenAICodexConfigInput = {
  providerKind?: 'chatgpt' | 'openai_api' | 'azure_openai';
  baseUrl?: string;
  azureApiVersion?: string;
  defaultModel?: string;
  defaultReasoningEffort?: string;
};

export type OpenAICodexSecretInput = {
  apiKey?: string;
};

export type OpenAICodexConfigDraft = {
  providerKind: 'chatgpt' | 'openai_api' | 'azure_openai';
  baseUrl: string;
  azureApiVersion: string;
  defaultModel: string;
  defaultReasoningEffort: string;
  apiKeyDraft: string;
};

export type OpenAICompatibleApiConfigDraft = {
  agentModeId: string;
  knowledgeSetIds: string[];
  apiKeyDraft: string;
};

export type ExternalApiUsageSummary = {
  windowDays: number;
  totalRequests: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  deliverySuccessCount: number;
  deliveryFailureCount: number;
  deliverySuccessRate: number;
  generatedUndeliveredCount: number;
  streamCount: number;
  streamRate: number;
  totalInputTokens: number;
  totalCachedInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  averageTokensPerRequest: number;
  averageReadyMs: number;
  p95ReadyMs: number;
  averageResponseMs: number;
  p95ResponseMs: number;
  totalEstimatedCost: string;
  totalInternalCost: string;
  lastRequestedAt?: string;
  lastDeliveredAt?: string;
};

export type ExternalApiUsageTrendPoint = {
  date: string;
  requestCount: number;
  successCount: number;
  failureCount: number;
  deliverySuccessCount: number;
  deliveryFailureCount: number;
  totalTokens: number;
  estimatedCost: string;
  internalCost: string;
};

export type ExternalApiUsageBreakdownRow = {
  key: string;
  label: string;
  requestCount: number;
  successCount: number;
  failureCount: number;
  totalTokens: number;
  estimatedCost: string;
  internalCost: string;
};

export type ExternalApiUsageRecord = {
  id: string;
  sessionId?: string;
  model: string;
  requestedModel?: string;
  requestedReasoningEffort?: string;
  stream: boolean;
  messageCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: string;
  internalCost: string;
  resultStatus: string;
  deliveryStatus: string;
  responseMode: string;
  errorMessage?: string;
  agentModeId?: string;
  knowledgeSetIds: string[];
  requestAborted: boolean;
  responseFinished: boolean;
  responseClosedBeforeFinish: boolean;
  responseStatusCode?: number;
  responseStartedAt?: string;
  responseReadyAt?: string;
  responseCompletedAt?: string;
  responseStartedMs?: number;
  responseReadyMs?: number;
  responseCompletedMs?: number;
  outputChars: number;
  createdAt: string;
};

export type ExternalApiUsageResponse = {
  summary: ExternalApiUsageSummary;
  trends: ExternalApiUsageTrendPoint[];
  breakdowns: {
    byModel: ExternalApiUsageBreakdownRow[];
    byStatus: ExternalApiUsageBreakdownRow[];
    byDelivery: ExternalApiUsageBreakdownRow[];
    byTransport: ExternalApiUsageBreakdownRow[];
  };
  records: ExternalApiUsageRecord[];
};

export type ZendeskConfigDraft = {
  enabled: boolean;
  publicBaseUrl: string;
  zendeskBaseUrl: string;
  zendeskEmail: string;
  responseMode: string;
  fallbackMode: string;
  autoStatus: string;
  agentModeId: string;
  knowledgeSetIds: string[];
  maxCommentHistory: number;
  attachmentReadingEnabled: boolean;
  maxAttachmentCount: number;
  maxAttachmentSizeMb: number;
  allowedAttachmentMimeTypesRaw: string;
  zendeskApiTokenDraft: string;
  webhookSigningSecretDraft: string;
  excludedTagsRaw: string;
};
