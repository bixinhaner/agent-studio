export type SkillCatalogSourceType = "native" | "managed" | "plugin";

export type SkillCatalogScope = "private" | "agent_mode" | "team" | "org" | "platform" | "unknown";

export type SkillCatalogActor = {
  userId: string;
  displayName?: string;
  email?: string;
};

export type SkillCatalogAudience = {
  type: "user" | "agent_mode" | "team" | "organization" | "platform";
  id?: string;
  name: string;
  secondaryLabel?: string;
};

export type SkillCatalogBaseConfig = {
  defaultLocale: string;
  iconKey: string;
  sortOrder: number;
  shortcutKey?: string;
  status: "active" | "disabled";
};

export type SkillCatalogLocalizedContent = {
  displayName?: string;
  summary?: string;
  useCases: string[];
  usageSteps: string[];
  examplePrompts: string[];
  dataScope?: string;
};

export type SkillCatalogDraftContent = {
  baseConfig: SkillCatalogBaseConfig;
  translations: Record<string, SkillCatalogLocalizedContent>;
};

export type SkillCatalogEntryRecord = {
  id: string;
  catalogKey: string;
  organizationId?: string;
  sourceType: SkillCatalogSourceType;
  sourceRef: string;
  canonicalName: string;
  defaultLocale: string;
  iconKey: string;
  sortOrder: number;
  shortcutKey?: string;
  status: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
  translations: Record<string, SkillCatalogLocalizedContent>;
  draft?: SkillCatalogDraftContent & { updatedAt: string; updatedByUserId?: string };
};

export type SkillCatalogSourceSnapshot = {
  sourceType: SkillCatalogSourceType;
  sourceRef: string;
  canonicalName: string;
  description?: string;
  sourceLabel: string;
  scope: SkillCatalogScope;
  rawScope?: string;
  ownerUserId?: string;
  owner?: SkillCatalogActor;
  createdBy?: SkillCatalogActor;
  organization?: {
    id: string;
    name?: string;
  };
  audiences: SkillCatalogAudience[];
  system: boolean;
  plugin?: {
    pluginRef: string;
    marketplace: string;
    version: string;
    developerName?: string;
    category?: string;
    capabilities: string[];
    skillNames: string[];
    enabled: boolean;
    readiness: "ready" | "degraded" | "unavailable";
    visibleToUsers: boolean;
    capabilityHealth: Array<{
      id: string;
      label: string;
      status: "ready" | "unavailable";
      detail?: string;
    }>;
  };
};

export type SkillCatalogAdminRecord = SkillCatalogEntryRecord & SkillCatalogSourceSnapshot & {
  languageStatus: {
    configured: number;
    total: number;
    missingLocales: string[];
    fallbackLocales: string[];
  };
};

export type ResolvedSkillCatalogPresentation = {
  displayName: string;
  summary: string;
  useCases: string[];
  usageSteps: string[];
  examplePrompts: string[];
  dataScope?: string;
  iconKey: string;
  sortOrder: number;
  shortcutKey?: string;
  requestedLocale: string;
  resolvedLocale: string;
  fallbackLocale?: string;
};
