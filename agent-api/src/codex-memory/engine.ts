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

type LlmClientConfig = {
  provider: "openai" | "openai_compatible" | "azure_openai";
  apiMode: "auto" | "responses" | "chat_completions";
  baseUrl: string;
  apiKey: string;
  model: string;
  azureApiVersion?: string;
};

type MemoryExtraction = {
  shouldRemember: boolean;
  confidence?: number;
  category?: string;
  memory?: string;
  summary?: string;
  slug?: string;
};

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const MAX_PROMPT_CHARS = 8000;
const MAX_ANSWER_CHARS = 12000;

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

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced || text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function normalizeExtraction(value: unknown): MemoryExtraction | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const memory = trimOrUndefined(record.memory);
  const summary = trimOrUndefined(record.summary);
  return {
    shouldRemember: record.shouldRemember === true || record.should_remember === true,
    confidence: typeof record.confidence === "number" ? record.confidence : undefined,
    category: trimOrUndefined(record.category),
    memory,
    summary,
    slug: trimOrUndefined(record.slug)
  };
}

function buildExtractionPrompt(input: CodexMemoryRunInput): string {
  const metadata = {
    channel: input.channel,
    sessionId: input.sessionId,
    threadId: input.threadId,
    organizationId: input.organizationId,
    userId: input.userId,
    model: input.model,
    hasExternalContext: input.hasExternalContext,
    metadata: input.metadata ?? {}
  };
  return [
    "You are Agent Studio's memory extraction worker. Extract only durable, reusable memory for future Codex runs.",
    "Remember stable user preferences, recurring workflow conventions, reusable project facts, or long-lived integration behavior.",
    "Do not remember one-off ticket facts, uploaded document contents, secrets, credentials, private personal data, or transient troubleshooting details.",
    "When external context is present, be conservative: only remember explicit stable user preference or workspace convention.",
    "Return strict JSON only with this shape: {\"shouldRemember\": boolean, \"confidence\": number, \"category\": string, \"memory\": string, \"summary\": string, \"slug\": string}.",
    "If nothing should be remembered, set shouldRemember=false and keep memory empty.",
    `Metadata:\n${JSON.stringify(metadata)}`,
    `User/request text:\n${truncate(input.prompt, MAX_PROMPT_CHARS)}`,
    `Assistant answer:\n${truncate(input.answerText, MAX_ANSWER_CHARS)}`
  ].join("\n\n");
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

function chatCompletionBody(config: LlmClientConfig, prompt: string): Record<string, unknown> {
  return {
    model: config.model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    ...(config.provider === "azure_openai" ? {} : { response_format: { type: "json_object" } })
  };
}

async function callLlm(config: LlmClientConfig, prompt: string): Promise<string> {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  if (config.provider === "azure_openai") {
    const apiVersion = config.azureApiVersion || "2025-04-01-preview";
    const url = `${baseUrl}/deployments/${encodeURIComponent(config.model)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
    const json = await postJson(url, { "api-key": config.apiKey }, chatCompletionBody(config, prompt));
    const text = responseTextFromJson(json);
    if (!text) throw new Error("LLM API returned no text");
    return text;
  }

  const headers = { authorization: `Bearer ${config.apiKey}` };
  if (config.apiMode === "responses") {
    const json = await postJson(`${baseUrl}/responses`, headers, {
      model: config.model,
      input: prompt,
      temperature: 0
    });
    const text = responseTextFromJson(json);
    if (!text) throw new Error("LLM API returned no text");
    return text;
  }

  if (config.apiMode === "auto") {
    try {
      const json = await postJson(`${baseUrl}/responses`, headers, {
        model: config.model,
        input: prompt,
        temperature: 0
      });
      const text = responseTextFromJson(json);
      if (text) return text;
    } catch (error) {
      if (config.provider === "openai") throw error;
    }
  }

  const json = await postJson(`${baseUrl}/chat/completions`, headers, chatCompletionBody(config, prompt));
  const text = responseTextFromJson(json);
  if (!text) throw new Error("LLM API returned no text");
  return text;
}

function resolveApiKeyFromEnv(envName: string | undefined): string | undefined {
  const normalized = trimOrUndefined(envName);
  if (!normalized) return undefined;
  return trimOrUndefined(process.env[normalized]);
}

function resolveLlmConfig(
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

function rawMemoriesFromContent(content: string): string[] {
  return content
    .split(/\n/)
    .map((line) => line.match(/^- memory:\s*(.+)$/)?.[1]?.trim())
    .filter((value): value is string => Boolean(value));
}

async function readTextIfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

export class CodexMemoryEngine implements CodexMemoryRunRecorder {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: {
    getSettings(): Promise<SystemSettingsCodexMemory | undefined>;
    resolveProviderSnapshot(): Promise<ManagedCodexProviderSnapshot>;
    getLlmSecretState?(): Promise<{ apiKey?: string } | undefined>;
    logger?: Pick<typeof console, "warn" | "info">;
  }) {}

  enqueueRun(input: CodexMemoryRunInput): void {
    this.queue = this.queue
      .then(() => this.processRun(input))
      .catch((error) => {
        this.dependencies.logger?.warn?.("codex memory generation failed", {
          channel: input.channel,
          sessionId: input.sessionId,
          threadId: input.threadId,
          detail: error instanceof Error ? error.message : String(error)
        });
      });
  }

  private async processRun(input: CodexMemoryRunInput): Promise<void> {
    const prompt = trimOrUndefined(input.prompt);
    const answer = trimOrUndefined(input.answerText);
    const codexHome = trimOrUndefined(input.codexHome);
    if (!prompt || !answer || !codexHome) return;

    const settings = await this.dependencies.getSettings();
    if (!settings?.enabled || !settings.generateMemories || settings.generationEngine !== "agent_studio") return;
    if (settings.disableOnExternalContext && input.hasExternalContext) return;

    const snapshot = await this.dependencies.resolveProviderSnapshot();
    const secretState = await this.dependencies.getLlmSecretState?.();
    const llmConfig = resolveLlmConfig(settings, snapshot, secretState);
    if (!llmConfig) {
      this.dependencies.logger?.warn?.("codex memory generation skipped: no LLM API configuration", {
        provider: settings.llmProvider,
        apiMode: settings.llmApiMode,
        apiKeyEnv: settings.llmApiKeyEnv
      });
      return;
    }

    const llmText = await callLlm(llmConfig, buildExtractionPrompt(input));
    const extraction = normalizeExtraction(parseJsonObject(llmText));
    const memory = trimOrUndefined(extraction?.memory);
    if (!extraction?.shouldRemember || !memory) return;

    await this.writeMemoryFiles(codexHome, input, {
      ...extraction,
      memory
    });
  }

  private async writeMemoryFiles(codexHome: string, input: CodexMemoryRunInput, extraction: MemoryExtraction & { memory: string }): Promise<void> {
    const memoriesDir = path.join(codexHome, "memories");
    const rolloutDir = path.join(memoriesDir, "rollout_summaries");
    await fs.mkdir(rolloutDir, { recursive: true });

    const completedAt = input.completedAt ?? new Date();
    const iso = completedAt.toISOString();
    const slug = safeFileSegment(extraction.slug || extraction.category || input.channel || "memory", "memory");
    const rolloutFile = path.join(rolloutDir, `${iso.replace(/[:.]/g, "-")}-${slug}-${randomUUID().slice(0, 8)}.md`);
    const summary = trimOrUndefined(extraction.summary) || extraction.memory;
    await fs.writeFile(rolloutFile, [
      `# Memory rollout ${iso}`,
      "",
      `- channel: ${input.channel}`,
      input.sessionId ? `- session_id: ${input.sessionId}` : "",
      input.threadId ? `- thread_id: ${input.threadId}` : "",
      input.codexThreadId ? `- codex_thread_id: ${input.codexThreadId}` : "",
      extraction.category ? `- category: ${extraction.category}` : "",
      typeof extraction.confidence === "number" ? `- confidence: ${extraction.confidence}` : "",
      "",
      "## Summary",
      summary,
      "",
      "## Memory",
      extraction.memory,
      ""
    ].filter((line) => line !== "").join("\n"), "utf8");

    const rawPath = path.join(memoriesDir, "raw_memories.md");
    const existingRaw = await readTextIfExists(rawPath);
    const shouldResetRaw = !existingRaw.trim() || /^No raw memories yet\.\s*$/i.test(existingRaw.trim());
    const rawPrefix = shouldResetRaw ? "# Raw Memories\n" : existingRaw.trimEnd();
    const nextRaw = [
      rawPrefix,
      "",
      `## ${iso}`,
      `- source: ${input.channel}`,
      extraction.category ? `- category: ${extraction.category}` : "",
      typeof extraction.confidence === "number" ? `- confidence: ${extraction.confidence}` : "",
      `- memory: ${extraction.memory}`,
      input.threadId ? `- thread_id: ${input.threadId}` : "",
      input.codexThreadId ? `- codex_thread_id: ${input.codexThreadId}` : "",
      ""
    ].filter((line) => line !== "").join("\n");
    await fs.writeFile(rawPath, `${nextRaw}\n`, "utf8");

    const memories = rawMemoriesFromContent(nextRaw).slice(-50);
    const memorySummary = [
      "# Memory Summary",
      "",
      "Generated by Agent Studio MemoryEngine. Codex reads this alongside native memory files.",
      "",
      ...memories.map((item) => `- ${item}`),
      ""
    ].join("\n");
    await fs.writeFile(path.join(memoriesDir, "memory_summary.md"), memorySummary, "utf8");
    await fs.writeFile(path.join(memoriesDir, "MEMORY.md"), memorySummary, "utf8");
  }
}
