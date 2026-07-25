import { api } from "../../lib/api";

export type SkillCatalogLocalizedContent = {
  displayName?: string;
  summary?: string;
  useCases: string[];
  usageSteps: string[];
  examplePrompts: string[];
  dataScope?: string;
};

export type SkillCatalogBaseConfig = {
  defaultLocale: string;
  iconKey: string;
  sortOrder: number;
  shortcutKey?: string;
  status: "active" | "disabled";
};

export type SkillCatalogDraft = {
  baseConfig: SkillCatalogBaseConfig;
  translations: Record<string, SkillCatalogLocalizedContent>;
};

export type SkillCatalogEntry = {
  id: string;
  catalogKey: string;
  organizationId?: string;
  sourceType: "native" | "managed" | "plugin";
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
  draft?: SkillCatalogDraft & { updatedAt: string; updatedByUserId?: string };
  description?: string;
  sourceLabel: string;
  scope: "private" | "team" | "platform";
  ownerUserId?: string;
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
  languageStatus: {
    configured: number;
    total: number;
    missingLocales: string[];
    fallbackLocales: string[];
  };
};

export async function fetchSkillCatalog(): Promise<{ entries: SkillCatalogEntry[] }> {
  return api<{ entries: SkillCatalogEntry[] }>("/api/admin/skill-catalog");
}

export async function saveSkillCatalogDraft(
  id: string,
  draft: SkillCatalogDraft
): Promise<{ entry: SkillCatalogEntry }> {
  return api<{ entry: SkillCatalogEntry }>(`/api/admin/skill-catalog/${encodeURIComponent(id)}/draft`, {
    method: "PUT",
    json: draft
  });
}

export async function publishSkillCatalogDraft(id: string): Promise<{ entry: SkillCatalogEntry }> {
  return api<{ entry: SkillCatalogEntry }>(`/api/admin/skill-catalog/${encodeURIComponent(id)}/publish`, {
    method: "POST",
    json: {}
  });
}
