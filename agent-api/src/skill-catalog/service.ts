import type { CodexManagedSkillRecord } from "../persistence/codex-skill-repository.js";
import type { NativeCodexSkillRecord } from "../codex-skills/native-codex-skill-service.js";
import { SkillCatalogRepository } from "./repository.js";
import type {
  ResolvedSkillCatalogPresentation,
  SkillCatalogAdminRecord,
  SkillCatalogDraftContent,
  SkillCatalogEntryRecord,
  SkillCatalogLocalizedContent,
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

function scopeFromManaged(skill: CodexManagedSkillRecord): "private" | "team" {
  return skill.scope === "private" ? "private" : "team";
}

function nativeCatalogKey(name: string, organizationId?: string): string {
  return organizationId ? `org:${organizationId}:native:${name}` : `global:native:${name}`;
}

function managedCatalogKey(skill: CodexManagedSkillRecord): string {
  return `${skill.organizationId ? `org:${skill.organizationId}` : "global"}:managed:${skill.id}`;
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
    }
  ) {}

  async syncAndList(input: { organizationId?: string }): Promise<SkillCatalogAdminRecord[]> {
    const [nativeSkills, managedSkills] = await Promise.all([
      this.sources.nativeSkills.list(),
      this.sources.managedSkills.listManagedSkills({ organizationId: input.organizationId })
    ]);
    const sourceMap = new Map<string, SkillCatalogSourceSnapshot>();

    for (const skill of nativeSkills) {
      sourceMap.set(sourceKey("native", skill.name), {
        sourceType: "native",
        sourceRef: skill.name,
        canonicalName: skill.name,
        description: text(skill.description),
        sourceLabel: "SKILL.md",
        scope: "platform",
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
      sourceMap.set(sourceKey("managed", skill.id), {
        sourceType: "managed",
        sourceRef: skill.id,
        canonicalName: skill.skillName,
        description: text(skill.description),
        sourceLabel: "托管",
        scope: scopeFromManaged(skill),
        ownerUserId: text(skill.ownerUserId),
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

    const entries = await this.repository.list({ organizationId: input.organizationId });
    return entries.flatMap((entry) => {
      const source = sourceMap.get(sourceKey(entry.sourceType, entry.sourceRef));
      if (!source) return [];
      return [{ ...entry, ...source, languageStatus: languageStatus(entry) }];
    });
  }

  async getAdminRecord(input: { id: string; organizationId?: string }): Promise<SkillCatalogAdminRecord | undefined> {
    const records = await this.syncAndList({ organizationId: input.organizationId });
    return records.find((item) => item.id === input.id);
  }

  async saveDraft(input: {
    id: string;
    organizationId?: string;
    actorUserId?: string;
    draft: SkillCatalogDraftContent;
  }): Promise<SkillCatalogAdminRecord> {
    const current = await this.getAdminRecord({ id: input.id, organizationId: input.organizationId });
    if (!current) throw new Error("Skill 展示配置不存在");
    await this.repository.saveDraft(input.id, input.draft, input.actorUserId);
    const updated = await this.getAdminRecord({ id: input.id, organizationId: input.organizationId });
    if (!updated) throw new Error("Skill 展示配置不存在");
    return updated;
  }

  async publish(input: {
    id: string;
    organizationId?: string;
  }): Promise<SkillCatalogAdminRecord> {
    const current = await this.getAdminRecord({ id: input.id, organizationId: input.organizationId });
    if (!current) throw new Error("Skill 展示配置不存在");
    await this.repository.publishDraft(input.id);
    const updated = await this.getAdminRecord({ id: input.id, organizationId: input.organizationId });
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
  sourceType: "native" | "managed";
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
