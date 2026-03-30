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
  loginCopy: string;
  logoUrl: string;
  iconUrl: string;
};

export type SystemSettingsPlatformDefaults = {
  provider: string;
  model: string;
  reasoningEffort: string;
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
  welcomeSummary: string;
  usageSummary: string;
  markdown: string;
};

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
  status: "draft" | "published";
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  publishedByUserId: string | null;
};

export type SystemSettingsResponse = {
  draft: SystemSettingsPayload;
  published: SystemSettingsPayload;
  draftMeta: SystemSettingsVersionMeta;
  publishedMeta: SystemSettingsVersionMeta | null;
};
