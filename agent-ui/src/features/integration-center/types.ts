export type IntegrationType = 'dingtalk' | 'zendesk' | 'openai_codex';
export type IntegrationCenterTab = IntegrationType;
export type IntegrationStatus = 'draft' | 'active' | 'disabled' | 'error' | string;
export type IntegrationSectionTab = 'basic' | 'config' | 'history' | 'bindings' | 'policies';

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
};

export type IntegrationListResponse = { items: IntegrationListItem[] };
export type IntegrationValidationHistoryResponse = { items: IntegrationValidationItem[] };
export type IntegrationBindingsResponse = { items: IntegrationBindingRecord[] };
export type IntegrationPoliciesResponse = { items: IntegrationPolicyInput[]; summary: IntegrationPolicySummary };
export type IntegrationValidationResult = {
  validation: IntegrationValidationItem;
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
};

export type DingTalkSecretInput = {
  clientSecret?: string;
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
  workspace?: string;
  model?: string;
  reasoningEffort?: string;
  sandboxMode?: string;
  approvalPolicy?: string;
  networkAccessEnabled?: boolean;
  webSearchMode?: string;
  additionalDirectories?: string[];
  maxCommentHistory?: number;
  systemPrompt?: string;
};

export type ZendeskSecretInput = {
  zendeskApiToken?: string;
  webhookSigningSecret?: string;
};

export type OpenAICodexConfigInput = {
  baseUrl?: string;
  defaultModel?: string;
  defaultReasoningEffort?: string;
};

export type OpenAICodexSecretInput = {
  apiKey?: string;
};

export type OpenAICodexConfigDraft = {
  baseUrl: string;
  defaultModel: string;
  defaultReasoningEffort: string;
  apiKeyDraft: string;
};

export type ZendeskConfigDraft = {
  enabled: boolean;
  publicBaseUrl: string;
  zendeskBaseUrl: string;
  zendeskEmail: string;
  responseMode: string;
  fallbackMode: string;
  autoStatus: string;
  workspace: string;
  model: string;
  reasoningEffort: string;
  sandboxMode: string;
  approvalPolicy: string;
  networkAccessEnabled: boolean;
  webSearchMode: string;
  maxCommentHistory: number;
  systemPrompt: string;
  zendeskApiTokenDraft: string;
  webhookSigningSecretDraft: string;
  excludedTagsRaw: string;
  additionalDirectoriesRaw: string;
};
