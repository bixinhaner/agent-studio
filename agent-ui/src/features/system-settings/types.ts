export type SystemSettingsSection =
  | "branding"
  | "model-defaults"
  | "retention-upload"
  | "artifact-access"
  | "safety"
  | "organization-defaults"
  | "usage-governance"
  | "publish-history";

export type SystemSettingsBranding = {
  platformName: string;
  headerSubtitle: string;
  internalLoginCopy: string;
  externalLoginCopy: string;
  logoUrl: string;
  iconUrl: string;
  loginBackgroundUrl: string;
  portalWelcomeIllustrationUrl: string;
  assistantName: string;
  assistantAvatarUrl: string;
};

export type SystemSettingsPlatformDefaults = {
  provider: string;
  model: string;
  reasoningEffort: string;
  sessionWorkspaceRoot: string;
};

export type SystemSettingsRetention = {
  sessionDays: number;
  attachmentDays: number;
  alertDays: number;
};

export type SystemSettingsUploads = {
  maxSingleFileBytes: number;
  maxTotalUploadBytes: number;
};

export type SystemSettingsArtifactAccessRule = {
  id?: string;
  label?: string;
  subjectType: "user_type" | "organization" | "role" | "membership_type" | "department" | "user";
  subjectId: string;
  enabled?: boolean;
  previewEnabled?: boolean;
  downloadEnabled?: boolean;
  autoRegisterGeneratedFiles?: boolean;
  maxFileBytes?: number;
  retentionDays?: number;
  allowedExtensions?: string[];
};

export type SystemSettingsArtifactAccess = {
  enabled: boolean;
  previewEnabled: boolean;
  downloadEnabled: boolean;
  autoRegisterGeneratedFiles: boolean;
  maxFileBytes: number;
  retentionDays: number;
  allowedExtensions: string[];
  blockHiddenPaths: boolean;
  blockUserUploadDirectory: boolean;
  blockKnowledgeSetCopies: boolean;
  secretScanEnabled: boolean;
  rules: SystemSettingsArtifactAccessRule[];
};

export type SystemSettingsSafety = {
  allowDangerFullAccess: boolean;
  allowNetworkAccess: boolean;
  allowLiveWebSearch: boolean;
  allowCustomAdditionalDirectories: boolean;
  allowFilesystemMutations: boolean;
};

export type SystemSettingsOrganizationDefaults = {
  orgSyncIntervalMinutes: number;
};

export type SystemSettingsCodexMemory = {
  enabled: boolean;
  useMemories: boolean;
  generateMemories: boolean;
  generationEngine: "agent_studio" | "codex_native";
  llmProvider: "active_codex_provider" | "openai_responses" | "openai_compatible" | "azure_openai";
  llmApiMode: "auto" | "responses" | "chat_completions";
  llmModel: string;
  llmBaseUrl: string;
  llmApiKeyEnv: string;
  llmAzureApiVersion: string;
  disableOnExternalContext: boolean;
  minRateLimitRemainingPercent: number;
  minRolloutIdleHours: number;
  maxRolloutAgeDays: number;
  maxUnusedDays: number;
};

export type SystemSettingsEnterpriseContextChannels = {
  portal: boolean;
  dingtalk: boolean;
  crest: boolean;
  zendesk: boolean;
  openaiCompatibleApi: boolean;
};

export type SystemSettingsEnterpriseContextFields = {
  identity: boolean;
  organization: boolean;
  departmentPosition: boolean;
  employeeNo: boolean;
  workPlace: boolean;
  manager: boolean;
  contact: boolean;
};

export type SystemSettingsEnterpriseContextAgentOverride = {
  agentModeId: string;
  enabled: boolean | null;
};

export type SystemSettingsEnterpriseContext = {
  enabled: boolean;
  failOpen: boolean;
  maxPromptChars: number;
  channels: SystemSettingsEnterpriseContextChannels;
  fields: SystemSettingsEnterpriseContextFields;
  agentOverrides: SystemSettingsEnterpriseContextAgentOverride[];
};

export type SystemSettingsBehavior = {
  markdown: string;
  portalWelcomeMessageDesktop: string;
  portalWelcomeMessageMobile: string;
  portalWelcomeSuggestions: Array<{
    label: string;
    prompt: string;
  }>;
  answerFeedback: {
    enabledForExternalUsers: boolean;
    enabledForInternalUsers: boolean;
    prompt: string;
  };
};

export type SystemSettingsVersionRecord = {
  id: string;
  versionNumber: number;
  revision: number;
  status: "draft" | "published";
  payload: SystemSettingsPayload;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  publishedByUserId?: string;
};

export type SystemSettingsFieldErrors = Record<string, string>;

export type SystemSettingsPayload = {
  branding: SystemSettingsBranding;
  platformDefaults: SystemSettingsPlatformDefaults;
  retention: SystemSettingsRetention;
  uploads: SystemSettingsUploads;
  artifactAccess: SystemSettingsArtifactAccess;
  safety: SystemSettingsSafety;
  organizationDefaults: SystemSettingsOrganizationDefaults;
  codexMemory: SystemSettingsCodexMemory;
  enterpriseContext: SystemSettingsEnterpriseContext;
  behavior: SystemSettingsBehavior;
};

export type SystemSettingsVersionMeta = {
  id: string;
  versionNumber: number;
  revision: number;
  status: "draft" | "published";
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  publishedByUserId?: string;
};

export type SystemSettingsResponse = {
  draft: SystemSettingsVersionRecord;
  published: SystemSettingsVersionRecord | null;
  draftMeta: SystemSettingsVersionMeta;
  publishedMeta: SystemSettingsVersionMeta | null;
};
