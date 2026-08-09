import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

export type TrainingTranslationLocale = "en";
export type TrainingTranslationPurpose = "content" | "filename";

export type TrainingTranslationRunner = (input: {
  organizationId: string;
  requestedByUserId: string;
  texts: string[];
  purpose: TrainingTranslationPurpose;
}) => Promise<string[]>;

type TranslationEntry<T> = {
  sourceType: string;
  sourceId: string;
  value: T;
};

type TextSlot = {
  value: string;
  purpose: TrainingTranslationPurpose;
  apply(translated: string): void;
};

const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/u;
const TRAINING_TRANSLATION_VERSION = "v2";
const MESSAGE_TRANSLATION_VERSION = "v3";
const FILE_CONTENT_TYPES = new Set(["attachment", "file", "image", "image_file"]);
const SKIPPED_CONTENT_TYPES = new Set(["source", "tool-call", "tool-result"]);
const FILE_NAME_KEYS = new Set(["name", "filename", "fileName", "displayName", "title"]);

function sourceHash(value: unknown, sourceType: string): string {
  const version = sourceType === "message_content"
    ? MESSAGE_TRANSLATION_VERSION
    : TRAINING_TRANSLATION_VERSION;
  return createHash("sha256")
    .update(version)
    .update("\0")
    .update(JSON.stringify(value))
    .digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function cachedValue<T>(value: unknown): T | undefined {
  const record = asRecord(value);
  return record && Object.prototype.hasOwnProperty.call(record, "value")
    ? record.value as T
    : undefined;
}

function cloneJson<T>(value: T): T {
  return structuredClone(value);
}

function collectMessageTextSlots(value: unknown, slots: TextSlot[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectMessageTextSlots(item, slots));
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  const contentType = typeof record.type === "string" ? record.type : "";
  if (SKIPPED_CONTENT_TYPES.has(contentType)) return;
  if (contentType === "data" && record.name === "codex_commentary") {
    const data = asRecord(record.data);
    if (!data) return;
    collectCommentaryTextSlots(data, slots);
    return;
  }
  if (contentType === "data" && record.name === "codex_file_change") {
    const data = asRecord(record.data);
    const changes = Array.isArray(data?.changes) ? data.changes : [];
    for (const change of changes) {
      const changeRecord = asRecord(change);
      const path = typeof changeRecord?.path === "string" ? changeRecord.path : "";
      if (!changeRecord || !CJK_RE.test(path)) continue;
      slots.push({
        value: path,
        purpose: "filename",
        apply: (translated) => {
          changeRecord.display_path = translated;
        }
      });
    }
    return;
  }
  if (FILE_CONTENT_TYPES.has(contentType)) {
    for (const [key, child] of Object.entries(record)) {
      if (typeof child === "string" && FILE_NAME_KEYS.has(key) && CJK_RE.test(child)) {
        slots.push({
          value: child,
          purpose: "filename",
          apply: (translated) => {
            record[key] = translated;
          }
        });
      }
    }
    return;
  }

  for (const [key, child] of Object.entries(record)) {
    if (
      typeof child === "string" &&
      (key === "text" || key === "title" || key === "description") &&
      CJK_RE.test(child)
    ) {
      slots.push({
        value: child,
        purpose: "content",
        apply: (translated) => {
          record[key] = translated;
        }
      });
      continue;
    }
    if (key !== "args" && key !== "argsText" && key !== "result") {
      collectMessageTextSlots(child, slots);
    }
  }
}

function collectCommentaryTextSlots(value: unknown, slots: TextSlot[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (typeof item === "string" && CJK_RE.test(item)) {
        slots.push({
          value: item,
          purpose: "content",
          apply: (translated) => {
            value[index] = translated;
          }
        });
        return;
      }
      collectCommentaryTextSlots(item, slots);
    });
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const [key, child] of Object.entries(record)) {
    if (
      typeof child === "string" &&
      (key === "text" || key === "title" || key === "description") &&
      CJK_RE.test(child)
    ) {
      slots.push({
        value: child,
        purpose: "content",
        apply: (translated) => {
          record[key] = translated;
        }
      });
      continue;
    }
    if (key === "lines" || key === "entries") {
      collectCommentaryTextSlots(child, slots);
    }
  }
}

function chunkTexts(texts: string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentChars = 0;
  for (const text of texts) {
    if (current.length > 0 && (current.length >= 40 || currentChars + text.length > 18_000)) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(text);
    currentChars += text.length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export class TrainingTranslationService {
  constructor(
    private readonly db: PrismaClient,
    private readonly runner: TrainingTranslationRunner
  ) {}

  async localizeStrings(input: {
    organizationId: string;
    requestedByUserId: string;
    sourceType: string;
    purpose?: TrainingTranslationPurpose;
    entries: Array<{ sourceId: string; value: string }>;
  }): Promise<Map<string, string>> {
    const localized = await this.localizeEntries({
      ...input,
      entries: input.entries.map((entry) => ({ ...entry, sourceType: input.sourceType })),
      prepare: (value) => {
        const holder = { value };
        const slots: TextSlot[] = CJK_RE.test(value)
          ? [{ value, purpose: input.purpose ?? "content", apply: (translated) => { holder.value = translated; } }]
          : [];
        return { localized: holder, slots };
      },
      finish: (holder) => holder.value
    });
    return localized;
  }

  async localizeMessages(input: {
    organizationId: string;
    requestedByUserId: string;
    entries: Array<{ sourceId: string; value: unknown }>;
  }): Promise<Map<string, unknown>> {
    return this.localizeEntries({
      ...input,
      entries: input.entries.map((entry) => ({ ...entry, sourceType: "message_content" })),
      prepare: (value) => {
        const localized = cloneJson(value);
        const slots: TextSlot[] = [];
        collectMessageTextSlots(localized, slots);
        return { localized, slots };
      },
      finish: (value) => value
    });
  }

  private async localizeEntries<TSource, TPrepared, TResult>(input: {
    organizationId: string;
    requestedByUserId: string;
    entries: Array<TranslationEntry<TSource>>;
    prepare(value: TSource): { localized: TPrepared; slots: TextSlot[] };
    finish(value: TPrepared): TResult;
  }): Promise<Map<string, TResult>> {
    if (input.entries.length === 0) return new Map();
    const hashes = new Map(input.entries.map((entry) => [entry.sourceId, sourceHash(entry.value, entry.sourceType)]));
    const cached = await this.db.portalTrainingTranslation.findMany({
      where: {
        organizationId: input.organizationId,
        locale: "en",
        OR: input.entries.map((entry) => ({ sourceType: entry.sourceType, sourceId: entry.sourceId }))
      },
      select: { sourceType: true, sourceId: true, sourceHash: true, translatedJson: true }
    });
    const cacheByKey = new Map(cached.map((item) => [`${item.sourceType}:${item.sourceId}`, item]));
    const result = new Map<string, TResult>();
    const missing: Array<{
      entry: TranslationEntry<TSource>;
      localized: TPrepared;
      slots: TextSlot[];
    }> = [];

    for (const entry of input.entries) {
      const cache = cacheByKey.get(`${entry.sourceType}:${entry.sourceId}`);
      if (cache && cache.sourceHash === hashes.get(entry.sourceId)) {
        const value = cachedValue<TResult>(cache.translatedJson);
        if (value !== undefined) {
          result.set(entry.sourceId, value);
          continue;
        }
      }
      const prepared = input.prepare(entry.value);
      missing.push({ entry, ...prepared });
    }

    if (missing.length === 0) return result;
    const translatedBySource = new Map<string, string>();
    for (const purpose of ["content", "filename"] as const) {
      const uniqueTexts = Array.from(new Set(missing.flatMap((item) =>
        item.slots.filter((slot) => slot.purpose === purpose).map((slot) => slot.value)
      )));
      const translateChunk = async (chunk: string[]): Promise<void> => {
        try {
          const translations = await this.runner({
            organizationId: input.organizationId,
            requestedByUserId: input.requestedByUserId,
            texts: chunk,
            purpose
          });
          if (translations.length !== chunk.length || translations.some((item) => !item.trim())) {
            throw new Error("培训案例英文翻译返回数量不匹配");
          }
          chunk.forEach((source, index) => translatedBySource.set(`${purpose}:${source}`, translations[index]));
        } catch (error) {
          if (chunk.length === 1) {
            const retry = await this.runner({
              organizationId: input.organizationId,
              requestedByUserId: input.requestedByUserId,
              texts: chunk,
              purpose
            });
            if (retry.length !== 1 || !retry[0]?.trim()) throw error;
            translatedBySource.set(`${purpose}:${chunk[0]}`, retry[0]);
            return;
          }
          const midpoint = Math.ceil(chunk.length / 2);
          await translateChunk(chunk.slice(0, midpoint));
          await translateChunk(chunk.slice(midpoint));
        }
      };
      for (const chunk of chunkTexts(uniqueTexts)) {
        await translateChunk(chunk);
      }
    }

    await Promise.all(missing.map(async (item) => {
      for (const slot of item.slots) {
        slot.apply(translatedBySource.get(`${slot.purpose}:${slot.value}`) ?? slot.value);
      }
      const localized = input.finish(item.localized);
      result.set(item.entry.sourceId, localized);
      await this.db.portalTrainingTranslation.upsert({
        where: {
          organizationId_sourceType_sourceId_locale: {
            organizationId: input.organizationId,
            sourceType: item.entry.sourceType,
            sourceId: item.entry.sourceId,
            locale: "en"
          }
        },
        create: {
          organizationId: input.organizationId,
          sourceType: item.entry.sourceType,
          sourceId: item.entry.sourceId,
          locale: "en",
          sourceHash: hashes.get(item.entry.sourceId)!,
          translatedJson: { value: localized } as Prisma.InputJsonValue
        },
        update: {
          sourceHash: hashes.get(item.entry.sourceId)!,
          translatedJson: { value: localized } as Prisma.InputJsonValue
        }
      });
    }));
    return result;
  }
}
