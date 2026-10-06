import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { RecordDirectUsageInput } from "../operations/usage-recorder.js";
import { callMemoryLlm, type LlmCallResult, type LlmClientConfig } from "./engine.js";
import type { MemoryLanguage, MemoryPoint, NativeMemoryContent, NativeMemoryView } from "./native-memory-view.js";

/**
 * Display translation of Codex native memory. Codex writes memory summaries mostly in English;
 * a Chinese-speaking user should read them in Chinese, but Codex itself keeps reading the
 * original. Translations are cached per content hash + language in the assistant's memory store.
 */

const TRANSLATIONS_DIR_NAME = "translations";
const MAX_TRANSLATION_INPUT_CHARS = 24000;

export class MemoryTranslationError extends Error {
  constructor(message: string, readonly code: "translation_unavailable" | "translation_failed" | "translation_too_large") {
    super(message);
  }
}

export type MemoryTranslationActor = { userId: string; organizationId?: string };

type TranslationDeps = {
  resolveLlmConfig(): Promise<LlmClientConfig | undefined>;
  /** Agent Studio usage pipeline; translation is billed like any other LLM call. */
  recordDirectUsage(input: RecordDirectUsageInput): Promise<unknown>;
  callLlm?: (config: LlmClientConfig, prompt: string, options: { json?: boolean }) => Promise<LlmCallResult>;
  logger?: Pick<typeof console, "warn">;
};

function cachePath(storeDir: string, contentHash: string, language: MemoryLanguage): string {
  return path.join(storeDir, TRANSLATIONS_DIR_NAME, `${contentHash}.${language}.json`);
}

function languageName(language: MemoryLanguage): string {
  return language === "zh" ? "Simplified Chinese" : "English";
}

function toPoints(value: unknown, fallback: MemoryPoint[]): MemoryPoint[] {
  if (!Array.isArray(value) || value.length !== fallback.length) return fallback;
  return value.map((entry, index) => {
    const record = entry as { text?: unknown; details?: unknown };
    const text = typeof record?.text === "string" && record.text.trim() ? record.text.trim() : fallback[index].text;
    const details = Array.isArray(record?.details) && record.details.length === fallback[index].details.length
      ? record.details.map((detail, detailIndex) =>
          typeof detail === "string" && detail.trim() ? detail.trim() : fallback[index].details[detailIndex]
        )
      : fallback[index].details;
    return { text, details };
  });
}

/** Translated content in the same shape as the source; items the model dropped keep their original text. */
export function parseTranslation(text: string, source: NativeMemoryContent): NativeMemoryContent {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new MemoryTranslationError("Translation returned no JSON", "translation_failed");
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new MemoryTranslationError("Translation returned invalid JSON", "translation_failed");
  }
  const profile = Array.isArray(value.profile) && value.profile.length === source.profile.length
    ? value.profile.map((line, index) => (typeof line === "string" && line.trim() ? line.trim() : source.profile[index]))
    : source.profile;
  return { profile, preferences: toPoints(value.preferences, source.preferences), tips: toPoints(value.tips, source.tips) };
}

export function buildTranslationPrompt(content: NativeMemoryContent, target: MemoryLanguage): string {
  return [
    `Translate this memory summary into ${languageName(target)} for the user it describes.`,
    "It is shown in a settings page, so write naturally and concisely, addressing nobody in particular (keep third-person descriptions as they are).",
    "Keep product names, code, commands, model names, file names, URLs, acronyms, and people's names unchanged.",
    "Do not add, merge, drop, or reorder entries. Return JSON with exactly the same keys and array lengths:",
    '{"profile": string[], "preferences": [{"text": string, "details": string[]}], "tips": [{"text": string, "details": string[]}]}',
    "",
    JSON.stringify(content)
  ].join("\n");
}

export class MemoryTranslationService {
  private readonly inflight = new Map<string, Promise<NativeMemoryContent>>();

  constructor(private readonly deps: TranslationDeps) {}

  async cached(storeDir: string, view: NativeMemoryView, target: MemoryLanguage): Promise<NativeMemoryContent | undefined> {
    try {
      const parsed = JSON.parse(await fs.readFile(cachePath(storeDir, view.contentHash, target), "utf8")) as { content?: unknown };
      return parsed.content ? parseTranslation(JSON.stringify(parsed.content), view) : undefined;
    } catch {
      return undefined;
    }
  }

  async translate(input: {
    storeDir: string;
    view: NativeMemoryView;
    target: MemoryLanguage;
    actor: MemoryTranslationActor;
    scopeId: string;
  }): Promise<NativeMemoryContent> {
    if (input.view.language === input.target) return input.view;
    const hit = await this.cached(input.storeDir, input.view, input.target);
    if (hit) return hit;
    const key = cachePath(input.storeDir, input.view.contentHash, input.target);
    const running = this.inflight.get(key);
    if (running) return running;
    const task = this.translateUncached(input).finally(() => this.inflight.delete(key));
    this.inflight.set(key, task);
    return task;
  }

  private async translateUncached(input: {
    storeDir: string;
    view: NativeMemoryView;
    target: MemoryLanguage;
    actor: MemoryTranslationActor;
    scopeId: string;
  }): Promise<NativeMemoryContent> {
    const config = await this.deps.resolveLlmConfig();
    if (!config) throw new MemoryTranslationError("No memory LLM is configured", "translation_unavailable");
    const source: NativeMemoryContent = { profile: input.view.profile, preferences: input.view.preferences, tips: input.view.tips };
    const prompt = buildTranslationPrompt(source, input.target);
    if (prompt.length > MAX_TRANSLATION_INPUT_CHARS) {
      throw new MemoryTranslationError("Memory summary is too large to translate", "translation_too_large");
    }
    const call = this.deps.callLlm ?? callMemoryLlm;
    let result: LlmCallResult;
    try {
      result = await call(config, prompt, { json: true });
    } catch (error) {
      await this.record(input, config, undefined, "failed");
      throw new MemoryTranslationError(error instanceof Error ? error.message : String(error), "translation_failed");
    }
    let content: NativeMemoryContent;
    try {
      content = parseTranslation(result.text, source);
    } catch (error) {
      await this.record(input, config, result, "failed");
      throw error;
    }
    await this.record(input, config, result, "success");
    await this.writeCache(input.storeDir, input.view, input.target, content, config.model);
    return content;
  }

  /**
   * Translation is a one-shot chat completion against the memory LLM, not a Codex runtime turn,
   * so there is no RuntimeUsageSnapshot to hand to recordCodexUsage; the reply's own token usage
   * is recorded directly.
   */
  private async record(
    input: { actor: MemoryTranslationActor; scopeId: string; target: MemoryLanguage; view: NativeMemoryView },
    config: LlmClientConfig,
    result: LlmCallResult | undefined,
    resultStatus: "success" | "failed"
  ): Promise<void> {
    try {
      await this.deps.recordDirectUsage({
        organizationId: input.actor.organizationId,
        userId: input.actor.userId,
        model: config.model,
        featureType: "memory_translation",
        inputTokens: result?.usage.inputTokens ?? 0,
        cachedInputTokens: result?.usage.cachedInputTokens ?? 0,
        outputTokens: result?.usage.outputTokens ?? 0,
        resultStatus,
        metadata: {
          source: "portal_memory_translation",
          scopeId: input.scopeId,
          targetLanguage: input.target,
          sourceLanguage: input.view.language,
          contentHash: input.view.contentHash,
          provider: config.provider
        }
      });
    } catch (error) {
      this.deps.logger?.warn?.("memory translation usage record failed", {
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async writeCache(
    storeDir: string,
    view: NativeMemoryView,
    target: MemoryLanguage,
    content: NativeMemoryContent,
    model: string
  ): Promise<void> {
    const filePath = cachePath(storeDir, view.contentHash, target);
    const dir = path.dirname(filePath);
    try {
      await fs.mkdir(dir, { recursive: true });
      // Translations of older summaries are never shown again.
      for (const name of await fs.readdir(dir)) {
        if (name.endsWith(`.${target}.json`) && name !== path.basename(filePath)) await fs.rm(path.join(dir, name), { force: true });
      }
      const tempPath = `${filePath}.tmp-${randomUUID().slice(0, 8)}`;
      await fs.writeFile(tempPath, `${JSON.stringify({ version: 1, model, translatedAt: new Date().toISOString(), content }, null, 2)}\n`, "utf8");
      await fs.rename(tempPath, filePath);
    } catch (error) {
      this.deps.logger?.warn?.("memory translation cache write failed", {
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
