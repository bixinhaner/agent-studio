import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

export type TrainingTranslationLocale = "en";

export type TrainingTranslationRunner = (input: {
  organizationId: string;
  requestedByUserId: string;
  texts: string[];
}) => Promise<string[]>;

type TranslationEntry<T> = {
  sourceType: string;
  sourceId: string;
  value: T;
};

type TextSlot = {
  value: string;
  apply(translated: string): void;
};

const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/u;
const SKIPPED_CONTENT_TYPES = new Set([
  "attachment",
  "file",
  "image",
  "image_file",
  "source",
  "tool-call",
  "tool-result"
]);

function sourceHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
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

  for (const [key, child] of Object.entries(record)) {
    if (
      typeof child === "string" &&
      (key === "text" || key === "title" || key === "description") &&
      CJK_RE.test(child)
    ) {
      slots.push({
        value: child,
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
    entries: Array<{ sourceId: string; value: string }>;
  }): Promise<Map<string, string>> {
    const localized = await this.localizeEntries({
      ...input,
      entries: input.entries.map((entry) => ({ ...entry, sourceType: input.sourceType })),
      prepare: (value) => {
        const holder = { value };
        const slots: TextSlot[] = CJK_RE.test(value)
          ? [{ value, apply: (translated) => { holder.value = translated; } }]
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
    const hashes = new Map(input.entries.map((entry) => [entry.sourceId, sourceHash(entry.value)]));
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
      if (prepared.slots.length === 0) {
        result.set(entry.sourceId, input.finish(prepared.localized));
        continue;
      }
      missing.push({ entry, ...prepared });
    }

    if (missing.length === 0) return result;
    const uniqueTexts = Array.from(new Set(missing.flatMap((item) => item.slots.map((slot) => slot.value))));
    const translatedBySource = new Map<string, string>();
    for (const chunk of chunkTexts(uniqueTexts)) {
      const translations = await this.runner({
        organizationId: input.organizationId,
        requestedByUserId: input.requestedByUserId,
        texts: chunk
      });
      if (translations.length !== chunk.length || translations.some((item) => !item.trim())) {
        throw new Error("培训案例英文翻译返回数量不匹配");
      }
      chunk.forEach((source, index) => translatedBySource.set(source, translations[index]));
    }

    await Promise.all(missing.map(async (item) => {
      for (const slot of item.slots) {
        slot.apply(translatedBySource.get(slot.value) ?? slot.value);
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
