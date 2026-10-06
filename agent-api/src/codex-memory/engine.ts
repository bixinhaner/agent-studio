import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { DEFAULT_MODEL } from "../model-config.js";
import type { ManagedCodexProviderSnapshot } from "../managed-codex-provider.js";
import type { SystemSettingsCodexMemory } from "../system-settings/types.js";

export type CodexMemoryRunInput = {
  channel: string;
  prompt: string;
  answerText: string;
  codexHome?: string;
  codexThreadId?: string;
  sessionId?: string;
  threadId?: string;
  organizationId?: string;
  userId?: string;
  model?: string;
  hasExternalContext?: boolean;
  metadata?: Record<string, unknown>;
  completedAt?: Date;
};

export type CodexMemoryRunRecorder = {
  enqueueRun(input: CodexMemoryRunInput): void | Promise<void>;
};

export type LlmClientConfig = {
  provider: "openai" | "openai_compatible" | "azure_openai";
  apiMode: "auto" | "responses" | "chat_completions";
  baseUrl: string;
  apiKey: string;
  model: string;
  azureApiVersion?: string;
};

export type CodexMemoryRunStatus = "written" | "skipped_no_durable_memory" | "skipped_missing_input" | "failed";

export type CodexMemoryRunLogEntry = {
  id: string;
  status: CodexMemoryRunStatus;
  reason: string;
  channel: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  promptChars: number;
  answerChars: number;
  codexHome?: string;
  relativeHome?: string;
  codexThreadId?: string;
  sessionId?: string;
  threadId?: string;
  organizationId?: string;
  userId?: string;
  model?: string;
  hasExternalContext?: boolean;
  llmProvider?: string;
  llmApiMode?: string;
  llmModel?: string;
  category?: string;
  confidence?: number;
  memoryChars?: number;
  error?: string;
};

type CodexMemoryRunOutcome = {
  status: CodexMemoryRunStatus;
  reason: string;
  llmProvider?: string;
  llmApiMode?: string;
  llmModel?: string;
  category?: string;
  confidence?: number;
  memoryChars?: number;
  error?: string;
};

export type CodexMemoryRunResult = CodexMemoryRunLogEntry;

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const MAX_RUN_LOG_ENTRIES = 1000;
const RUN_LOG_RELATIVE_PATH = path.join(".agent-studio", "memory-runs.jsonl");
const CODEX_MEMORY_DIR_NAME = "memories";
/** In-home source of the retired Agent Studio MemoryEngine; read only to migrate hand-written memories. */
export const AGENT_STUDIO_MEMORY_SOURCE_RELATIVE_PATH = path.join(".agent-studio", "memory-source");
export const AGENT_STUDIO_MEMORY_ROOT_FILE_NAMES = new Set(["MEMORY.md", "raw_memories.md", "memory_summary.md"]);
export const AGENT_STUDIO_MEMORY_CONTENT_ROOTS = new Set(["rollout_summaries", "skills", "extensions"]);

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function codexHomeFromRunConfig(codexRunConfig?: Record<string, unknown>): string | undefined {
  return trimOrUndefined(codexRunConfig?._agentStudioCodexHome);
}

export function codexRunConfigHasExternalContext(codexRunConfig?: Record<string, unknown>): boolean {
  if (!codexRunConfig) return false;
  const additionalDirectories = Array.isArray(codexRunConfig.additionalDirectories)
    ? codexRunConfig.additionalDirectories
    : [];
  const knowledgeSets = Array.isArray(codexRunConfig._agentStudioKnowledgeSets)
    ? codexRunConfig._agentStudioKnowledgeSets
    : [];
  return additionalDirectories.length > 0 || knowledgeSets.length > 0 || Boolean(codexRunConfig.outputSchemaFile);
}

function safeFileSegment(value: string, fallback: string): string {
  const normalized = value
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function responseTextFromJson(value: unknown): string | undefined {
  const record = asRecord(value);
  const outputText = trimOrUndefined(record?.output_text);
  if (outputText) return outputText;
  const output = Array.isArray(record?.output) ? record.output : [];
  const parts: string[] = [];
  for (const item of output) {
    const content = Array.isArray(asRecord(item)?.content) ? asRecord(item)?.content as unknown[] : [];
    for (const part of content) {
      const partRecord = asRecord(part);
      const text = trimOrUndefined(partRecord?.text) ?? trimOrUndefined(partRecord?.content);
      if (text) parts.push(text);
    }
  }
  const choices = Array.isArray(record?.choices) ? record.choices : [];
  const firstChoice = asRecord(choices[0]);
  const chatText = trimOrUndefined(asRecord(firstChoice?.message)?.content);
  if (chatText) parts.push(chatText);
  return trimOrUndefined(parts.join("\n"));
}

async function postJson(url: string, headers: Record<string, string>, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`LLM API returned ${response.status}: ${truncate(detail, 500)}`);
  }
  return await response.json();
}

type LlmChatOptions = { json?: boolean; temperature?: number };

function chatCompletionBody(config: LlmClientConfig, prompt: string, options: LlmChatOptions): Record<string, unknown> {
  return {
    model: config.model,
    messages: [{ role: "user", content: prompt }],
    temperature: options.temperature ?? 0,
    ...(options.json && config.provider !== "azure_openai" ? { response_format: { type: "json_object" } } : {})
  };
}

export type LlmTokenUsage = { inputTokens: number; cachedInputTokens: number; outputTokens: number };

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Token usage of a Responses or Chat Completions reply. Cached input comes from OpenAI's
 * `*_tokens_details.cached_tokens` or DeepSeek's `prompt_cache_hit_tokens`, capped at input.
 */
export function llmUsageFromResponse(value: unknown): LlmTokenUsage {
  const usage = asRecord(asRecord(value)?.usage);
  const inputTokens = tokenCount(usage?.input_tokens ?? usage?.prompt_tokens);
  const details = asRecord(usage?.input_tokens_details ?? usage?.prompt_tokens_details);
  const cached = tokenCount(details?.cached_tokens ?? usage?.prompt_cache_hit_tokens);
  return {
    inputTokens,
    cachedInputTokens: Math.min(inputTokens, cached),
    outputTokens: tokenCount(usage?.output_tokens ?? usage?.completion_tokens)
  };
}

export type LlmCallResult = { text: string; usage: LlmTokenUsage };

function llmResult(json: unknown): LlmCallResult {
  const text = responseTextFromJson(json);
  if (!text) throw new Error("LLM API returned no text");
  return { text, usage: llmUsageFromResponse(json) };
}

/** One-shot call to the memory LLM (the provider configured under Codex memory settings). */
export async function callMemoryLlm(config: LlmClientConfig, prompt: string, options: LlmChatOptions = {}): Promise<LlmCallResult> {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  if (config.provider === "azure_openai") {
    const apiVersion = config.azureApiVersion || "2025-04-01-preview";
    const url = `${baseUrl}/deployments/${encodeURIComponent(config.model)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
    return llmResult(await postJson(url, { "api-key": config.apiKey }, chatCompletionBody(config, prompt, options)));
  }

  const headers = { authorization: `Bearer ${config.apiKey}` };
  const responsesBody = { model: config.model, input: prompt, temperature: options.temperature ?? 0 };
  if (config.apiMode === "responses") {
    return llmResult(await postJson(`${baseUrl}/responses`, headers, responsesBody));
  }

  if (config.apiMode === "auto") {
    try {
      const json = await postJson(`${baseUrl}/responses`, headers, responsesBody);
      if (responseTextFromJson(json)) return llmResult(json);
    } catch (error) {
      if (config.provider === "openai") throw error;
    }
  }

  return llmResult(await postJson(`${baseUrl}/chat/completions`, headers, chatCompletionBody(config, prompt, options)));
}

function resolveApiKeyFromEnv(envName: string | undefined): string | undefined {
  const normalized = trimOrUndefined(envName);
  if (!normalized) return undefined;
  return trimOrUndefined(process.env[normalized]);
}

export function resolveLlmConfig(
  settings: SystemSettingsCodexMemory,
  snapshot: ManagedCodexProviderSnapshot,
  secretState?: { apiKey?: string }
): LlmClientConfig | undefined {
  const provider = settings.llmProvider || "active_codex_provider";
  const envApiKey = resolveApiKeyFromEnv(settings.llmApiKeyEnv || "CODEX_API_KEY");
  const uiApiKey = trimOrUndefined(secretState?.apiKey);
  const apiMode = settings.llmApiMode || "auto";
  const model = trimOrUndefined(settings.llmModel) || snapshot.config.defaultModel || DEFAULT_MODEL;

  if (provider === "active_codex_provider") {
    if (snapshot.kind === "azure_openai") {
      const baseUrl = trimOrUndefined(settings.llmBaseUrl) || snapshot.config.baseUrl;
      const apiKey = snapshot.secrets.apiKey || uiApiKey || envApiKey;
      if (!baseUrl || !apiKey) return undefined;
      return {
        provider: "azure_openai",
        apiMode,
        baseUrl,
        apiKey,
        model,
        azureApiVersion: trimOrUndefined(settings.llmAzureApiVersion) || snapshot.config.azureApiVersion
      };
    }
    const apiKey = snapshot.secrets.apiKey || uiApiKey || envApiKey;
    if (!apiKey) return undefined;
    return {
      provider: snapshot.kind === "openai_api" && snapshot.config.baseUrl ? "openai_compatible" : "openai",
      apiMode,
      baseUrl: trimOrUndefined(settings.llmBaseUrl) || snapshot.config.baseUrl || DEFAULT_OPENAI_BASE_URL,
      apiKey,
      model
    };
  }

  const apiKey = uiApiKey || envApiKey;
  if (!apiKey) return undefined;
  if (provider === "azure_openai") {
    const baseUrl = trimOrUndefined(settings.llmBaseUrl);
    if (!baseUrl) return undefined;
    return {
      provider: "azure_openai",
      apiMode,
      baseUrl,
      apiKey,
      model,
      azureApiVersion: trimOrUndefined(settings.llmAzureApiVersion)
    };
  }
  return {
    provider: provider === "openai_compatible" ? "openai_compatible" : "openai",
    apiMode,
    baseUrl: trimOrUndefined(settings.llmBaseUrl) || DEFAULT_OPENAI_BASE_URL,
    apiKey,
    model
  };
}

function tokenizeForSimilarity(value: string): Set<string> {
  const normalized = value.toLowerCase();
  const tokens = new Set<string>();
  for (const match of normalized.match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? []) {
    tokens.add(match);
  }
  const cjk = (normalized.match(/[\u3400-\u9fff]/g) ?? []).join("");
  if (cjk.length > 0) {
    if (cjk.length <= 2) {
      tokens.add(cjk);
    } else {
      for (let index = 0; index < cjk.length - 1; index += 1) {
        tokens.add(cjk.slice(index, index + 2));
      }
    }
  }
  return tokens;
}

export function similarityScore(left: string, right: string): number {
  const leftTokens = tokenizeForSimilarity(left);
  const rightTokens = tokenizeForSimilarity(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

export function normalizedMemoryKey(value: string): string {
  const tokens = [...tokenizeForSimilarity(value)].sort();
  if (tokens.length > 0) return tokens.slice(0, 18).join("-");
  return safeFileSegment(value.toLowerCase(), "memory");
}

const AGENT_HOME_SEGMENT_PATTERN = /^(agent-.+)-[0-9a-f]{6,}$/;
/** Sibling directory (next to the per-capability homes) that holds one memory store per assistant. */
export const AGENT_STUDIO_MEMORY_STORE_DIR_NAME = ".agent-studio-memory";

/**
 * Stable memory store for a user/integration + assistant. Codex homes are keyed by
 * `agent-<mode>-<capabilityHash>` and get a new hash whenever the assistant's MCP
 * servers change; memory must survive that, so it lives beside the homes, keyed by
 * mode only. Returns undefined for homes that do not follow that layout.
 */
export function agentStudioMemoryStore(codexHome: string): { storeDir: string; parentDir: string; segmentBase: string } | undefined {
  const resolved = path.resolve(codexHome);
  const segmentBase = path.basename(resolved).match(AGENT_HOME_SEGMENT_PATTERN)?.[1];
  if (!segmentBase) return undefined;
  const parentDir = path.dirname(resolved);
  return { storeDir: path.join(parentDir, AGENT_STUDIO_MEMORY_STORE_DIR_NAME, segmentBase), parentDir, segmentBase };
}

/** Per-capability homes of the same assistant (`<segmentBase>-<hash>`) under `parentDir`, newest memory first. */
export async function listSiblingCodexHomes(parentDir: string, segmentBase: string): Promise<string[]> {
  let names: string[] = [];
  try {
    names = await fs.readdir(parentDir);
  } catch {
    return [];
  }
  const homes = names
    .filter((name) => name.match(AGENT_HOME_SEGMENT_PATTERN)?.[1] === segmentBase)
    .map((name) => path.join(parentDir, name));
  const stamped = await Promise.all(homes.map(async (home) => ({ home, mtime: await latestLegacyMemoryMtime(home) })));
  return stamped
    .filter((item) => item.mtime !== undefined)
    .sort((left, right) => right.mtime! - left.mtime!)
    .map((item) => item.home);
}

async function latestLegacyMemoryMtime(codexHome: string): Promise<number | undefined> {
  let latest: number | undefined;
  for (const dir of [path.join(codexHome, AGENT_STUDIO_MEMORY_SOURCE_RELATIVE_PATH), path.join(codexHome, CODEX_MEMORY_DIR_NAME)]) {
    for (const name of ["raw_memories.md", "MEMORY.md", "memory_summary.md"]) {
      const stat = await fs.stat(path.join(dir, name)).catch(() => undefined);
      if (stat && (latest === undefined || stat.mtimeMs > latest)) latest = stat.mtimeMs;
    }
  }
  return latest;
}

export function codexMemoryProjectionPath(codexHome: string): string {
  return path.join(codexHome, CODEX_MEMORY_DIR_NAME);
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

function relativeHomeFromRoot(sessionHomeRoot: string | undefined, codexHome: string | undefined): string | undefined {
  const root = trimOrUndefined(sessionHomeRoot);
  const home = trimOrUndefined(codexHome);
  if (!root || !home) return undefined;
  const relative = path.relative(path.resolve(root), path.resolve(home));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return relative.split(path.sep).join("/");
}

export class CodexMemoryEngine implements CodexMemoryRunRecorder {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: {
    getSettings(): Promise<SystemSettingsCodexMemory | undefined>;
    sessionHomeRoot?: string;
    logger?: Pick<typeof console, "warn" | "info">;
  }) {}

  enqueueRun(input: CodexMemoryRunInput): void {
    this.queue = this.queue
      .then(() => this.processRunWithLog(input))
      .catch((error) => {
        this.dependencies.logger?.warn?.("codex memory generation failed", {
          channel: input.channel,
          sessionId: input.sessionId,
          threadId: input.threadId,
          detail: error instanceof Error ? error.message : String(error)
        });
      });
  }

  async processRunAndLog(input: CodexMemoryRunInput): Promise<CodexMemoryRunResult> {
    const startedAt = new Date();
    try {
      const outcome = await this.processRun(input);
      return await this.recordRunLog(input, startedAt, outcome);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const entry = await this.recordRunLog(input, startedAt, {
        status: "failed",
        reason: "exception",
        error: detail
      }).catch((logError) => {
        this.dependencies.logger?.warn?.("codex memory run log write failed", {
          detail: logError instanceof Error ? logError.message : String(logError)
        });
        const completedAt = new Date();
        return {
          id: randomUUID(),
          status: "failed" as const,
          reason: "exception",
          channel: input.channel,
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
          promptChars: trimOrUndefined(input.prompt)?.length ?? 0,
          answerChars: trimOrUndefined(input.answerText)?.length ?? 0,
          codexHome: trimOrUndefined(input.codexHome),
          codexThreadId: trimOrUndefined(input.codexThreadId),
          sessionId: trimOrUndefined(input.sessionId),
          threadId: trimOrUndefined(input.threadId),
          organizationId: trimOrUndefined(input.organizationId),
          userId: trimOrUndefined(input.userId),
          model: trimOrUndefined(input.model),
          hasExternalContext: Boolean(input.hasExternalContext),
          error: detail
        };
      });
      this.dependencies.logger?.warn?.("codex memory generation failed", {
        channel: input.channel,
        sessionId: input.sessionId,
        threadId: input.threadId,
        detail
      });
      return entry;
    }
  }

  private async processRunWithLog(input: CodexMemoryRunInput): Promise<void> {
    await this.processRunAndLog(input);
  }

  private async recordRunLog(input: CodexMemoryRunInput, startedAt: Date, outcome: CodexMemoryRunOutcome): Promise<CodexMemoryRunLogEntry> {
    const sessionHomeRoot = trimOrUndefined(this.dependencies.sessionHomeRoot);
    const completedAt = new Date();
    const entry: CodexMemoryRunLogEntry = {
      id: randomUUID(),
      status: outcome.status,
      reason: outcome.reason,
      channel: input.channel,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
      promptChars: trimOrUndefined(input.prompt)?.length ?? 0,
      answerChars: trimOrUndefined(input.answerText)?.length ?? 0,
      codexHome: trimOrUndefined(input.codexHome),
      relativeHome: relativeHomeFromRoot(sessionHomeRoot, input.codexHome),
      codexThreadId: trimOrUndefined(input.codexThreadId),
      sessionId: trimOrUndefined(input.sessionId),
      threadId: trimOrUndefined(input.threadId),
      organizationId: trimOrUndefined(input.organizationId),
      userId: trimOrUndefined(input.userId),
      model: trimOrUndefined(input.model),
      hasExternalContext: Boolean(input.hasExternalContext),
      llmProvider: outcome.llmProvider,
      llmApiMode: outcome.llmApiMode,
      llmModel: outcome.llmModel,
      category: outcome.category,
      confidence: outcome.confidence,
      memoryChars: outcome.memoryChars,
      error: outcome.error
    };
    if (!sessionHomeRoot) return entry;
    const logPath = path.join(sessionHomeRoot, RUN_LOG_RELATIVE_PATH);
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    const existing = await readTextIfExists(logPath);
    const lines = existing.split(/\n/).filter(Boolean).slice(-MAX_RUN_LOG_ENTRIES + 1);
    lines.push(JSON.stringify(entry));
    await fs.writeFile(logPath, `${lines.join("\n")}\n`, "utf8");
    return entry;
  }

  /**
   * Agent Studio no longer extracts memories from conversations: Codex native memory does that
   * with full rollout context, and the old engine overwrote Codex's summary. Runs are still
   * logged so the admin run history explains why nothing was written.
   */
  private async processRun(input: CodexMemoryRunInput): Promise<CodexMemoryRunOutcome> {
    const prompt = trimOrUndefined(input.prompt);
    const answer = trimOrUndefined(input.answerText);
    const codexHome = trimOrUndefined(input.codexHome);
    if (!prompt || !answer || !codexHome) {
      return {
        status: "skipped_missing_input",
        reason: !prompt ? "missing_prompt" : !answer ? "missing_answer" : "missing_codex_home"
      };
    }
    const settings = await this.dependencies.getSettings();
    if (!settings?.enabled) return { status: "skipped_no_durable_memory", reason: "memory_disabled" };
    if (!settings.generateMemories) return { status: "skipped_no_durable_memory", reason: "generation_disabled" };
    return { status: "skipped_no_durable_memory", reason: "codex_native_generation" };
  }
}
