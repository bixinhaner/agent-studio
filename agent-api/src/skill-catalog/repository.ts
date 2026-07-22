import type {
  SkillCatalogBaseConfig,
  SkillCatalogDraftContent,
  SkillCatalogEntryRecord,
  SkillCatalogLocalizedContent,
  SkillCatalogSourceType
} from "./types.js";

type EntryRow = {
  id: string;
  catalogKey: string;
  organizationId: string | null;
  sourceType: string;
  sourceRef: string;
  canonicalName: string;
  defaultLocale: string;
  iconKey: string;
  sortOrder: number;
  shortcutKey: string | null;
  status: string;
  publishedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type TranslationRow = {
  id: string;
  catalogEntryId: string;
  locale: string;
  displayName: string | null;
  summary: string | null;
  useCases: unknown;
  usageSteps: unknown;
  examplePrompts: unknown;
  dataScope: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type DraftRow = {
  id: string;
  catalogEntryId: string;
  baseConfig: unknown;
  translations: unknown;
  updatedByUserId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type EntryTable = {
  findUnique(args: { where: { id?: string; catalogKey?: string } }): Promise<EntryRow | null>;
  findMany(args?: { where?: Record<string, unknown>; orderBy?: Array<Record<string, "asc" | "desc">> }): Promise<EntryRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<EntryRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<EntryRow>;
};

type TranslationTable = {
  findMany(args: { where: { catalogEntryId: string }; orderBy?: { locale: "asc" | "desc" } }): Promise<TranslationRow[]>;
  deleteMany(args: { where: { catalogEntryId: string } }): Promise<{ count: number }>;
  create(args: { data: Record<string, unknown> }): Promise<TranslationRow>;
};

type DraftTable = {
  findUnique(args: { where: { catalogEntryId: string } }): Promise<DraftRow | null>;
  upsert(args: {
    where: { catalogEntryId: string };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<DraftRow>;
  delete(args: { where: { catalogEntryId: string } }): Promise<DraftRow>;
};

export type SkillCatalogRepositoryDb = {
  skillCatalogEntry: EntryTable;
  skillCatalogTranslation: TranslationTable;
  skillCatalogDraft: DraftTable;
  $transaction<T>(callback: (tx: SkillCatalogRepositoryDb) => Promise<T>): Promise<T>;
};

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter((item): item is string => Boolean(item));
}

function toIso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function normalizeLocalizedContent(value: unknown): SkillCatalogLocalizedContent {
  const record = asRecord(value) ?? {};
  return {
    displayName: text(record.displayName),
    summary: text(record.summary),
    useCases: stringList(record.useCases),
    usageSteps: stringList(record.usageSteps),
    examplePrompts: stringList(record.examplePrompts),
    dataScope: text(record.dataScope)
  };
}

export function normalizeBaseConfig(value: unknown, fallback?: Partial<SkillCatalogBaseConfig>): SkillCatalogBaseConfig {
  const record = asRecord(value) ?? {};
  const status = text(record.status) ?? fallback?.status ?? "active";
  return {
    defaultLocale: text(record.defaultLocale) ?? fallback?.defaultLocale ?? "zh-CN",
    iconKey: text(record.iconKey) ?? fallback?.iconKey ?? "sparkles",
    sortOrder:
      typeof record.sortOrder === "number" && Number.isFinite(record.sortOrder)
        ? Math.trunc(record.sortOrder)
        : fallback?.sortOrder ?? 100,
    shortcutKey: text(record.shortcutKey) ?? fallback?.shortcutKey,
    status: status === "disabled" ? "disabled" : "active"
  };
}

export function normalizeTranslations(value: unknown): Record<string, SkillCatalogLocalizedContent> {
  const record = asRecord(value) ?? {};
  const output: Record<string, SkillCatalogLocalizedContent> = {};
  for (const [locale, content] of Object.entries(record)) {
    const normalizedLocale = text(locale);
    if (!normalizedLocale) continue;
    output[normalizedLocale] = normalizeLocalizedContent(content);
  }
  return output;
}

function mapTranslation(row: TranslationRow): SkillCatalogLocalizedContent {
  return normalizeLocalizedContent({
    displayName: row.displayName,
    summary: row.summary,
    useCases: row.useCases,
    usageSteps: row.usageSteps,
    examplePrompts: row.examplePrompts,
    dataScope: row.dataScope
  });
}

export class SkillCatalogRepository {
  constructor(private readonly db: SkillCatalogRepositoryDb) {}

  async list(input: { organizationId?: string } = {}): Promise<SkillCatalogEntryRecord[]> {
    const rows = await this.db.skillCatalogEntry.findMany({
      where: input.organizationId
        ? { OR: [{ organizationId: null }, { organizationId: input.organizationId }] }
        : { organizationId: null },
      orderBy: [{ sortOrder: "asc" }, { canonicalName: "asc" }]
    });
    return Promise.all(rows.map((row) => this.load(this.db, row)));
  }

  async get(id: string): Promise<SkillCatalogEntryRecord | undefined> {
    const normalizedId = text(id);
    if (!normalizedId) return undefined;
    const row = await this.db.skillCatalogEntry.findUnique({ where: { id: normalizedId } });
    return row ? this.load(this.db, row) : undefined;
  }

  async getByCatalogKey(catalogKey: string): Promise<SkillCatalogEntryRecord | undefined> {
    const row = await this.db.skillCatalogEntry.findUnique({ where: { catalogKey } });
    return row ? this.load(this.db, row) : undefined;
  }

  async ensureEntry(input: {
    catalogKey: string;
    organizationId?: string;
    sourceType: SkillCatalogSourceType;
    sourceRef: string;
    canonicalName: string;
    defaultLocale?: string;
    initialTranslation?: SkillCatalogLocalizedContent;
  }): Promise<SkillCatalogEntryRecord> {
    const existing = await this.db.skillCatalogEntry.findUnique({ where: { catalogKey: input.catalogKey } });
    if (existing) {
      if (existing.canonicalName !== input.canonicalName) {
        const updated = await this.db.skillCatalogEntry.update({
          where: { id: existing.id },
          data: { canonicalName: input.canonicalName, updatedAt: new Date() }
        });
        return this.load(this.db, updated);
      }
      return this.load(this.db, existing);
    }

    return this.db.$transaction(async (tx) => {
      const created = await tx.skillCatalogEntry.create({
        data: {
          catalogKey: input.catalogKey,
          organizationId: text(input.organizationId) ?? null,
          sourceType: input.sourceType,
          sourceRef: input.sourceRef,
          canonicalName: input.canonicalName,
          defaultLocale: text(input.defaultLocale) ?? "zh-CN",
          iconKey: "sparkles",
          sortOrder: 1000,
          status: "active"
        }
      });
      if (input.initialTranslation) {
        await tx.skillCatalogTranslation.create({
          data: {
            catalogEntryId: created.id,
            locale: text(input.defaultLocale) ?? "zh-CN",
            displayName: text(input.initialTranslation.displayName) ?? null,
            summary: text(input.initialTranslation.summary) ?? null,
            useCases: input.initialTranslation.useCases,
            usageSteps: input.initialTranslation.usageSteps,
            examplePrompts: input.initialTranslation.examplePrompts,
            dataScope: text(input.initialTranslation.dataScope) ?? null
          }
        });
      }
      return this.load(tx, created);
    });
  }

  async saveDraft(id: string, draft: SkillCatalogDraftContent, updatedByUserId?: string): Promise<SkillCatalogEntryRecord> {
    const existing = await this.requireEntry(this.db, id);
    await this.db.skillCatalogDraft.upsert({
      where: { catalogEntryId: existing.id },
      create: {
        catalogEntryId: existing.id,
        baseConfig: normalizeBaseConfig(draft.baseConfig),
        translations: normalizeTranslations(draft.translations),
        updatedByUserId: text(updatedByUserId) ?? null
      },
      update: {
        baseConfig: normalizeBaseConfig(draft.baseConfig),
        translations: normalizeTranslations(draft.translations),
        updatedByUserId: text(updatedByUserId) ?? null,
        updatedAt: new Date()
      }
    });
    return this.load(this.db, existing);
  }

  async publishDraft(id: string): Promise<SkillCatalogEntryRecord> {
    return this.db.$transaction(async (tx) => {
      const existing = await this.requireEntry(tx, id);
      const draftRow = await tx.skillCatalogDraft.findUnique({ where: { catalogEntryId: existing.id } });
      if (!draftRow) throw new Error("没有可发布的草稿");
      const baseConfig = normalizeBaseConfig(draftRow.baseConfig, {
        defaultLocale: existing.defaultLocale,
        iconKey: existing.iconKey,
        sortOrder: existing.sortOrder,
        shortcutKey: text(existing.shortcutKey),
        status: existing.status === "disabled" ? "disabled" : "active"
      });
      const translations = normalizeTranslations(draftRow.translations);
      const defaultTranslation = translations[baseConfig.defaultLocale];
      if (!defaultTranslation?.displayName || !defaultTranslation.summary) {
        throw new Error("默认语言必须配置用途名和一句话释义");
      }

      const updated = await tx.skillCatalogEntry.update({
        where: { id: existing.id },
        data: {
          defaultLocale: baseConfig.defaultLocale,
          iconKey: baseConfig.iconKey,
          sortOrder: baseConfig.sortOrder,
          shortcutKey: baseConfig.shortcutKey ?? null,
          status: baseConfig.status,
          publishedAt: new Date(),
          updatedAt: new Date()
        }
      });

      await tx.skillCatalogTranslation.deleteMany({ where: { catalogEntryId: existing.id } });
      for (const [locale, content] of Object.entries(translations)) {
        await tx.skillCatalogTranslation.create({
          data: {
            catalogEntryId: existing.id,
            locale,
            displayName: text(content.displayName) ?? null,
            summary: text(content.summary) ?? null,
            useCases: stringList(content.useCases),
            usageSteps: stringList(content.usageSteps),
            examplePrompts: stringList(content.examplePrompts),
            dataScope: text(content.dataScope) ?? null
          }
        });
      }

      await tx.skillCatalogDraft.delete({ where: { catalogEntryId: existing.id } });
      return this.load(tx, updated);
    });
  }

  private async requireEntry(db: SkillCatalogRepositoryDb, id: string): Promise<EntryRow> {
    const normalized = text(id);
    if (!normalized) throw new Error("Skill 展示配置不存在");
    const row = await db.skillCatalogEntry.findUnique({ where: { id: normalized } });
    if (!row) throw new Error("Skill 展示配置不存在");
    return row;
  }

  private async load(db: SkillCatalogRepositoryDb, row: EntryRow): Promise<SkillCatalogEntryRecord> {
    const [translationRows, draftRow] = await Promise.all([
      db.skillCatalogTranslation.findMany({ where: { catalogEntryId: row.id }, orderBy: { locale: "asc" } }),
      db.skillCatalogDraft.findUnique({ where: { catalogEntryId: row.id } })
    ]);
    const translations = Object.fromEntries(translationRows.map((item) => [item.locale, mapTranslation(item)]));
    const fallbackBase: SkillCatalogBaseConfig = {
      defaultLocale: row.defaultLocale,
      iconKey: row.iconKey,
      sortOrder: row.sortOrder,
      shortcutKey: text(row.shortcutKey),
      status: row.status === "disabled" ? "disabled" : "active"
    };
    const draftBase = draftRow ? normalizeBaseConfig(draftRow.baseConfig, fallbackBase) : undefined;
    return {
      id: row.id,
      catalogKey: row.catalogKey,
      organizationId: text(row.organizationId),
      sourceType: row.sourceType === "managed" ? "managed" : "native",
      sourceRef: row.sourceRef,
      canonicalName: row.canonicalName,
      defaultLocale: row.defaultLocale,
      iconKey: row.iconKey,
      sortOrder: row.sortOrder,
      shortcutKey: text(row.shortcutKey),
      status: row.status,
      publishedAt: toIso(row.publishedAt),
      createdAt: toIso(row.createdAt) ?? new Date(0).toISOString(),
      updatedAt: toIso(row.updatedAt) ?? new Date(0).toISOString(),
      translations,
      draft: draftRow && draftBase
        ? {
            baseConfig: draftBase,
            translations: normalizeTranslations(draftRow.translations),
            updatedAt: toIso(draftRow.updatedAt) ?? new Date(0).toISOString(),
            updatedByUserId: text(draftRow.updatedByUserId)
          }
        : undefined
    };
  }
}
