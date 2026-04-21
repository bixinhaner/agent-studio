export type SystemSettingsSection =
  | "branding"
  | "model-defaults"
  | "retention-upload"
  | "safety"
  | "organization-defaults"
  | "publish-history";

export type SystemSettingsBranding = {
  platformName: string;
  headerSubtitle: string;
  internalLoginCopy: string;
  externalLoginCopy: string;
  logoUrl: string;
  iconUrl: string;
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

export type SystemSettingsBehavior = {
  markdown: string;
  portalWelcomeMessageDesktop: string;
  portalWelcomeMessageMobile: string;
  portalWelcomeSuggestions: Array<{
    label: string;
    prompt: string;
  }>;
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
  safety: SystemSettingsSafety;
  organizationDefaults: SystemSettingsOrganizationDefaults;
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
