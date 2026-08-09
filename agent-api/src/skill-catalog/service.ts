import type { CodexManagedSkillRecord } from "../persistence/codex-skill-repository.js";
import type { NativeCodexSkillRecord } from "../codex-skills/native-codex-skill-service.js";
import type { InstalledPluginRecord } from "../codex-plugins/installed-plugin-service.js";
import { SkillCatalogRepository } from "./repository.js";
import type {
  ResolvedSkillCatalogPresentation,
  SkillCatalogActor,
  SkillCatalogAdminRecord,
  SkillCatalogAudience,
  SkillCatalogDraftContent,
  SkillCatalogEntryRecord,
  SkillCatalogLocalizedContent,
  SkillCatalogScope,
  SkillCatalogSourceSnapshot
} from "./types.js";

const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

export function normalizeLocale(value: string | undefined, fallback = "zh-CN"): string {
  const first = text(value)?.split(",")[0]?.split(";")[0]?.trim();
  if (!first) return fallback;
  const normalized = first.replace(/_/g, "-");
  const [language, region] = normalized.split("-");
  if (!language) return fallback;
  return region ? `${language.toLowerCase()}-${region.toUpperCase()}` : language.toLowerCase();
}

function localeCandidates(requestedLocale: string, defaultLocale: string, translations: Record<string, unknown>): string[] {
  const requested = normalizeLocale(requestedLocale, defaultLocale);
  const language = requested.split("-")[0];
  const languageMatch = Object.keys(translations).find((locale) => locale.toLowerCase().startsWith(`${language.toLowerCase()}-`));
  return Array.from(new Set([requested, language, languageMatch, defaultLocale, ...Object.keys(translations)].filter(Boolean) as string[]));
}

function scopeFromManaged(skill: CodexManagedSkillRecord): SkillCatalogScope {
  if (skill.scope === "private" || skill.scope === "agent_mode" || skill.scope === "team" || skill.scope === "org") {
    return skill.scope;
  }
  return "unknown";
}

type UserIdentity = {
  id: string;
  displayName?: string;
  email?: string;
};

type CatalogSkillPackage = {
  id: string;
  items: Array<{
    runtimeBindings: Array<{
      runtimeType: string;
      bindingType: string;
      bindingPayload: unknown;
    }>;
  }>;
};

type CatalogAgentMode = {
  id: string;
  organizationId?: string;
  name: string;
  slug: string;
  skillPackages: Array<{ skillPackageId: string }>;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function actorFromManagedSkill(input: {
  userId?: string;
  identity?: UserIdentity;
  fallbackUserId?: string;
  fallbackDisplayName?: string;
  fallbackEmail?: string;
}): SkillCatalogActor | undefined {
  const userId = text(input.userId);
  if (!userId) return undefined;
  const canUseFallback = userId === text(input.fallbackUserId);
  return {
    userId,
    displayName: text(input.identity?.displayName) ?? (canUseFallback ? text(input.fallbackDisplayName) : undefined),
    email: text(input.identity?.email) ?? (canUseFallback ? text(input.fallbackEmail) : undefined)
  };
}

function managedSkillPackageIds(skill: CodexManagedSkillRecord, packages: CatalogSkillPackage[]): Set<string> {
  const packageIds = new Set<string>();
  for (const skillPackage of packages) {
    const matches = skillPackage.items.some((item) => item.runtimeBindings.some((binding) => {
      if (binding.runtimeType !== "codex" || binding.bindingType !== "codex_skill") return false;
      const payload = asRecord(binding.bindingPayload);
      if (typeof payload?.managedSkillId === "string") return payload.managedSkillId === skill.id;
      return payload?.skillName === skill.skillName;
    }));
    if (matches) packageIds.add(skillPackage.id);
  }
  return packageIds;
}

function audiencesForManagedSkill(input: {
  skill: CodexManagedSkillRecord;
  scope: SkillCatalogScope;
  owner?: SkillCatalogActor;
  organizationName?: string;
  packages: CatalogSkillPackage[];
  agentModes: CatalogAgentMode[];
}): SkillCatalogAudience[] {
  if (input.scope === "private") {
    return input.owner ? [{
      type: "user",
      id: input.owner.userId,
      name: input.owner.displayName ?? input.owner.email ?? input.owner.userId,
      secondaryLabel: input.owner.displayName ? input.owner.email : undefined
    }] : [];
  }
  if (input.scope === "agent_mode") {
    const packageIds = managedSkillPackageIds(input.skill, input.packages);
    return input.agentModes
      .filter((mode) => (!input.skill.organizationId || mode.organizationId === input.skill.organizationId)
        && mode.skillPackages.some((binding) => packageIds.has(binding.skillPackageId)))
      .map((mode) => ({ type: "agent_mode" as const, id: mode.id, name: mode.name, secondaryLabel: mode.slug }));
  }
  if (input.scope === "team") {
    return [{
      type: "team",
      id: input.skill.organizationId,
      name: input.organizationName ?? "当前团队"
    }];
  }
  if (input.scope === "org") {
    return [{
      type: "organization",
      id: input.skill.organizationId,
      name: input.organizationName ?? "当前组织"
    }];
  }
  return [];
}

function nativeCatalogKey(name: string, organizationId?: string): string {
  return organizationId ? `org:${organizationId}:native:${name}` : `global:native:${name}`;
}

function managedCatalogKey(skill: CodexManagedSkillRecord): string {
  return `${skill.organizationId ? `org:${skill.organizationId}` : "global"}:managed:${skill.id}`;
}

function pluginCatalogKey(name: string): string {
  return `global:plugin:${name}`;
}

function sourceKey(sourceType: string, sourceRef: string): string {
  return `${sourceType}:${sourceRef}`;
}

export class SkillCatalogService {
  constructor(
    private readonly repository: SkillCatalogRepository,
    private readonly sources: {
      nativeSkills: { list(): Promise<NativeCodexSkillRecord[]> };
      managedSkills: {
        listManagedSkills(input?: { organizationId?: string }): Promise<CodexManagedSkillRecord[]>;
      };
      plugins?: { list(): Promise<InstalledPluginRecord[]> };
      users?: { getById(id: string): Promise<UserIdentity | undefined> };
      skillPackages?: { list(): Promise<CatalogSkillPackage[]> };
      agentModes?: { list(): Promise<CatalogAgentMode[]> };
    }
  ) {}

  async syncAndList(input: { organizationId?: string; organizationName?: string }): Promise<SkillCatalogAdminRecord[]> {
    const [nativeSkills, managedSkills, plugins, packages, agentModes] = await Promise.all([
      this.sources.nativeSkills.list(),
      this.sources.managedSkills.listManagedSkills({ organizationId: input.organizationId }),
      this.sources.plugins?.list() ?? Promise.resolve([]),
      this.sources.skillPackages?.list() ?? Promise.resolve([]),
      this.sources.agentModes?.list() ?? Promise.resolve([])
    ]);
    const userIds = Array.from(new Set(managedSkills.flatMap((skill) => [skill.ownerUserId, skill.createdByUserId]).map(text).filter(Boolean))) as string[];
    const userIdentities = new Map<string, UserIdentity>();
    await Promise.all(userIds.map(async (userId) => {
      const identity = await this.sources.users?.getById(userId);
      if (identity) userIdentities.set(userId, identity);
    }));
    const sourceMap = new Map<string, SkillCatalogSourceSnapshot>();

    for (const skill of nativeSkills) {
      sourceMap.set(sourceKey("native", skill.name), {
        sourceType: "native",
        sourceRef: skill.name,
        canonicalName: skill.name,
        description: text(skill.description),
        sourceLabel: "SKILL.md",
        scope: "platform",
        audiences: [{ type: "platform", name: "平台用户" }],
        system: skill.system
      });
      await this.repository.ensureEntry({
        catalogKey: nativeCatalogKey(skill.name),
        sourceType: "native",
        sourceRef: skill.name,
        canonicalName: skill.name
      });
    }

    for (const skill of managedSkills) {
      const scope = scopeFromManaged(skill);
      const owner = actorFromManagedSkill({
        userId: skill.ownerUserId,
        identity: skill.ownerUserId ? userIdentities.get(skill.ownerUserId) : undefined,
        fallbackUserId: skill.createdByUserId,
        fallbackDisplayName: skill.createdByDisplayName,
        fallbackEmail: skill.createdByEmail
      });
      const createdBy = actorFromManagedSkill({
        userId: skill.createdByUserId,
        identity: skill.createdByUserId ? userIdentities.get(skill.createdByUserId) : undefined,
        fallbackUserId: skill.createdByUserId,
        fallbackDisplayName: skill.createdByDisplayName,
        fallbackEmail: skill.createdByEmail
      });
      sourceMap.set(sourceKey("managed", skill.id), {
        sourceType: "managed",
        sourceRef: skill.id,
        canonicalName: skill.skillName,
        description: text(skill.description),
        sourceLabel: "托管",
        scope,
        rawScope: text(skill.scope),
        ownerUserId: text(skill.ownerUserId),
        owner,
        createdBy,
        organization: skill.organizationId ? { id: skill.organizationId, name: text(input.organizationName) } : undefined,
        audiences: audiencesForManagedSkill({
          skill,
          scope,
          owner,
          organizationName: text(input.organizationName),
          packages,
          agentModes
        }),
        system: false
      });
      await this.repository.ensureEntry({
        catalogKey: managedCatalogKey(skill),
        organizationId: skill.organizationId,
        sourceType: "managed",
        sourceRef: skill.id,
        canonicalName: skill.skillName,
        initialTranslation: {
          displayName: text(skill.displayName) ?? skill.skillName,
          summary: text(skill.description),
          useCases: [],
          usageSteps: [],
          examplePrompts: [],
          dataScope: undefined
        }
      });
    }

    for (const plugin of plugins) {
      sourceMap.set(sourceKey("plugin", plugin.name), {
        sourceType: "plugin",
        sourceRef: plugin.name,
        canonicalName: plugin.name,
        description: text(plugin.longDescription) ?? text(plugin.description),
        sourceLabel: "系统插件",
        scope: "platform",
        audiences: [{ type: "platform", name: "平台用户" }],
        system: true,
        plugin: {
          pluginRef: plugin.pluginRef,
          marketplace: plugin.marketplace,
          version: plugin.version,
          developerName: plugin.developerName,
          category: plugin.category,
          capabilities: plugin.capabilities,
          skillNames: plugin.skillNames,
          enabled: plugin.enabled,
          readiness: plugin.readiness,
          visibleToUsers: plugin.visibleToUsers,
          capabilityHealth: plugin.capabilityHealth
        }
      });
      await this.repository.ensureEntry({
        catalogKey: pluginCatalogKey(plugin.name),
        sourceType: "plugin",
        sourceRef: plugin.name,
        canonicalName: plugin.name,
        initialTranslation: {
          displayName: plugin.displayName,
          summary: text(plugin.shortDescription) ?? text(plugin.description),
          useCases: [],
          usageSteps: [],
          examplePrompts: plugin.defaultPrompts,
          dataScope: undefined
        }
      });
    }

    const entries = await this.repository.list({ organizationId: input.organizationId });
    return entries.flatMap((entry) => {
      const source = sourceMap.get(sourceKey(entry.sourceType, entry.sourceRef));
      if (!source) return [];
      return [{ ...entry, ...source, languageStatus: languageStatus(entry) }];
    });
  }

  async getAdminRecord(input: { id: string; organizationId?: string; organizationName?: string }): Promise<SkillCatalogAdminRecord | undefined> {
    const records = await this.syncAndList({ organizationId: input.organizationId, organizationName: input.organizationName });
    return records.find((item) => item.id === input.id);
  }

  async saveDraft(input: {
    id: string;
    organizationId?: string;
    organizationName?: string;
    actorUserId?: string;
    draft: SkillCatalogDraftContent;
  }): Promise<SkillCatalogAdminRecord> {
    const current = await this.getAdminRecord({ id: input.id, organizationId: input.organizationId, organizationName: input.organizationName });
    if (!current) throw new Error("Skill 展示配置不存在");
    await this.repository.saveDraft(input.id, input.draft, input.actorUserId);
    const updated = await this.getAdminRecord({ id: input.id, organizationId: input.organizationId, organizationName: input.organizationName });
    if (!updated) throw new Error("Skill 展示配置不存在");
    return updated;
  }

  async publish(input: {
    id: string;
    organizationId?: string;
    organizationName?: string;
  }): Promise<SkillCatalogAdminRecord> {
    const current = await this.getAdminRecord({ id: input.id, organizationId: input.organizationId, organizationName: input.organizationName });
    if (!current) throw new Error("Skill 展示配置不存在");
    await this.repository.publishDraft(input.id);
    const updated = await this.getAdminRecord({ id: input.id, organizationId: input.organizationId, organizationName: input.organizationName });
    if (!updated) throw new Error("Skill 展示配置不存在");
    return updated;
  }

  async listPublished(input: { organizationId?: string }): Promise<SkillCatalogEntryRecord[]> {
    return this.repository.list({ organizationId: input.organizationId });
  }
}

export function languageStatus(entry: SkillCatalogEntryRecord): SkillCatalogAdminRecord["languageStatus"] {
  const missingLocales: string[] = [];
  const fallbackLocales: string[] = [];
  for (const locale of SUPPORTED_LOCALES) {
    const content = entry.translations[locale];
    if (!content?.displayName || !content.summary) {
      missingLocales.push(locale);
      if (locale !== entry.defaultLocale && entry.translations[entry.defaultLocale]?.displayName) {
        fallbackLocales.push(locale);
      }
    }
  }
  return {
    configured: SUPPORTED_LOCALES.length - missingLocales.length,
    total: SUPPORTED_LOCALES.length,
    missingLocales,
    fallbackLocales
  };
}

export function selectCatalogEntry(input: {
  entries: SkillCatalogEntryRecord[];
  organizationId?: string;
  sourceType: "native" | "managed" | "plugin";
  sourceRef: string;
}): SkillCatalogEntryRecord | undefined {
  const matching = input.entries.filter(
    (entry) => entry.sourceType === input.sourceType && entry.sourceRef === input.sourceRef && entry.status === "active"
  );
  return matching.find((entry) => entry.organizationId === input.organizationId) ?? matching.find((entry) => !entry.organizationId);
}

export function resolveSkillCatalogPresentation(input: {
  entry?: SkillCatalogEntryRecord;
  requestedLocale?: string;
  canonicalName: string;
  sourceDescription?: string;
}): ResolvedSkillCatalogPresentation {
  const defaultLocale = input.entry?.defaultLocale ?? "zh-CN";
  const requestedLocale = normalizeLocale(input.requestedLocale, defaultLocale);
  const translations = input.entry?.translations ?? {};
  const candidates = localeCandidates(requestedLocale, defaultLocale, translations);
  let resolvedLocale = defaultLocale;
  let content: SkillCatalogLocalizedContent | undefined;
  for (const candidate of candidates) {
    const candidateContent = translations[candidate];
    if (!candidateContent) continue;
    content = candidateContent;
    resolvedLocale = candidate;
    if (candidateContent.displayName || candidateContent.summary) break;
  }
  const fallbackLocale = resolvedLocale !== requestedLocale ? resolvedLocale : undefined;
  return {
    displayName: text(content?.displayName) ?? input.canonicalName,
    summary: text(content?.summary) ?? text(input.sourceDescription) ?? input.canonicalName,
    useCases: content?.useCases ?? [],
    usageSteps: content?.usageSteps ?? [],
    examplePrompts: content?.examplePrompts ?? [],
    dataScope: text(content?.dataScope),
    iconKey: input.entry?.iconKey ?? "sparkles",
    sortOrder: input.entry?.sortOrder ?? 1000,
    shortcutKey: text(input.entry?.shortcutKey),
    requestedLocale,
    resolvedLocale,
    fallbackLocale
  };
}
