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
  action: "create" | "update" | "merge" | "skip";
  confidence?: number;
  category?: string;
  memory?: string;
  summary?: string;
  slug?: string;
  target?: string;
  reason?: string;
  candidateMemory?: string;
  candidateSummary?: string;
};

type MemoryCandidateStatus = "pending" | "promoted" | "rejected";

type MemoryCandidate = {
  id: string;
  key: string;
  status: MemoryCandidateStatus;
  memory: string;
  summary?: string;
  category?: string;
  confidence?: number;
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
  lastDecision?: string;
  lastReason?: string;
  promotedAt?: string;
  sources: Array<{
    channel: string;
    observedAt: string;
    sessionId?: string;
    threadId?: string;
    codexThreadId?: string;
    promptExcerpt?: string;
    answerExcerpt?: string;
  }>;
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

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const MAX_PROMPT_CHARS = 8000;
const MAX_ANSWER_CHARS = 12000;
const MAX_MEMORY_CONTEXT_CHARS = 6000;
const MAX_CANDIDATE_CONTEXT_ITEMS = 6;
const MAX_MEMORY_CANDIDATES = 200;
const MAX_CANDIDATE_SOURCE_ITEMS = 10;
const MAX_CANDIDATE_EXCERPT_CHARS = 240;
const MAX_RUN_LOG_ENTRIES = 1000;
const RUN_LOG_RELATIVE_PATH = path.join(".agent-studio", "memory-runs.jsonl");
const CODEX_MEMORY_DIR_NAME = "memories";
const MEMORY_CANDIDATES_FILE_NAME = "memory_candidates.json";
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
  const rawAction = trimOrUndefined(record.action)?.toLowerCase();
  const action = rawAction === "create" || rawAction === "update" || rawAction === "merge" || rawAction === "skip"
    ? rawAction
    : undefined;
  const shouldRemember =
    record.shouldRemember === true ||
    record.should_remember === true ||
    action === "create" ||
    action === "update" ||
    action === "merge";
  return {
    shouldRemember,
    action: action ?? (shouldRemember ? "create" : "skip"),
    confidence: typeof record.confidence === "number" ? record.confidence : undefined,
    category: trimOrUndefined(record.category),
    memory,
    summary,
    slug: trimOrUndefined(record.slug),
    target: trimOrUndefined(record.target),
    reason: trimOrUndefined(record.reason),
    candidateMemory:
      trimOrUndefined(record.candidateMemory) ??
      trimOrUndefined(record.candidate_memory) ??
      trimOrUndefined(record.candidate),
    candidateSummary:
      trimOrUndefined(record.candidateSummary) ??
      trimOrUndefined(record.candidate_summary)
  };
}

function buildExtractionPrompt(input: CodexMemoryRunInput, context?: {
  existingMemories?: string[];
  relatedCandidates?: MemoryCandidate[];
}): string {
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
  const existingMemoryContext = buildExistingMemoryContext(context?.existingMemories ?? []);
  const candidateContext = buildCandidateContext(context?.relatedCandidates ?? []);
  return [
    "You are Agent Studio's memory extraction worker. Extract only durable, reusable memory for future Codex runs.",
    "Remember stable user preferences, recurring workflow conventions, reusable project facts, or long-lived integration behavior.",
    "Do not remember one-off ticket facts, uploaded document contents, secrets, credentials, private personal data, or transient troubleshooting details.",
    "When external context is present, be conservative: only remember explicit stable user preference or workspace convention.",
    "Compare the current run against the existing memory list. If the information is already represented, skip or update/merge instead of creating a duplicate.",
    "Related candidates are not official memories. Use their seen_count and prior reasons only as evidence that a pattern may be recurring.",
    "Use action=create only for new durable memory, update when replacing one existing memory, merge when combining overlapping memories or candidates, and skip when nothing should become official memory now.",
    "For update or merge, set target to the closest existing memory id such as M1, or to a candidate id when promoting a candidate.",
    "If there is a useful but not-yet-durable candidate, return action=skip with candidateMemory so Agent Studio can count it for a future run.",
    "Return strict JSON only with this shape: {\"action\": \"create|update|merge|skip\", \"shouldRemember\": boolean, \"confidence\": number, \"category\": string, \"memory\": string, \"summary\": string, \"slug\": string, \"target\": string, \"reason\": string, \"candidateMemory\": string, \"candidateSummary\": string}.",
    "Set shouldRemember=true only when action is create, update, or merge. For action=skip, keep memory empty unless you need candidateMemory for future recurrence tracking.",
    `Metadata:\n${JSON.stringify(metadata)}`,
    `Existing Agent Studio memories:\n${existingMemoryContext}`,
    `Related non-authoritative candidate history:\n${candidateContext}`,
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

function memorySummaryItemsFromContent(content: string): string[] {
  if (!content.includes("Generated by Agent Studio MemoryEngine")) return [];
  return content
    .split(/\n/)
    .map((line) => line.match(/^- (.+)$/)?.[1]?.trim())
    .filter((value): value is string =>
      typeof value === "string" && value.length > 0 && !/^No consolidated memories yet\.\s*$/i.test(value)
    );
}

function rawMemoryContentIsEmpty(content: string): boolean {
  const withoutHeading = content
    .replace(/^# Raw Memories\s*/i, "")
    .trim();
  return !withoutHeading || /^No raw memories yet\.\s*$/i.test(withoutHeading);
}

function buildRawMemoriesFromItems(items: string[], completedAt: Date): string {
  const iso = completedAt.toISOString();
  const lines = ["# Raw Memories", ""];
  for (const item of items) {
    lines.push(`## ${iso}`, "- source: migrated", `- memory: ${item}`, "");
  }
  if (items.length === 0) {
    lines.push("No raw memories yet.", "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function buildMemorySummary(memories: string[]): string {
  return [
    "# Memory Summary",
    "",
    "Generated by Agent Studio MemoryEngine. Codex reads this alongside native memory files.",
    "",
    ...(memories.length > 0 ? memories.map((item) => `- ${item}`) : ["No consolidated memories yet."]),
    ""
  ].join("\n");
}

function uniqueMemoryItems(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const normalized = trimOrUndefined(item);
    if (!normalized) continue;
    const key = normalizedMemoryKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
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

function similarityScore(left: string, right: string): number {
  const leftTokens = tokenizeForSimilarity(left);
  const rightTokens = tokenizeForSimilarity(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

function normalizedMemoryKey(value: string): string {
  const tokens = [...tokenizeForSimilarity(value)].sort();
  if (tokens.length > 0) return tokens.slice(0, 18).join("-");
  return safeFileSegment(value.toLowerCase(), "memory");
}

function candidateKeyFor(value: { slug?: string; category?: string; memory?: string; summary?: string }): string {
  const basis = trimOrUndefined(value.slug) ?? trimOrUndefined(value.memory) ?? trimOrUndefined(value.summary) ?? "memory";
  return [
    safeFileSegment(trimOrUndefined(value.category) ?? "general", "general"),
    normalizedMemoryKey(basis)
  ].join(":");
}

function buildExistingMemoryContext(memories: string[]): string {
  const items = uniqueMemoryItems(memories).map((memory, index) => ({
    id: `M${index + 1}`,
    memory
  }));
  if (items.length === 0) return "[]";
  return truncate(JSON.stringify(items, null, 2), MAX_MEMORY_CONTEXT_CHARS);
}

function buildCandidateContext(candidates: MemoryCandidate[]): string {
  const items = candidates.map((candidate) => ({
    id: candidate.id,
    status: candidate.status,
    seen_count: candidate.seenCount,
    first_seen_at: candidate.firstSeenAt,
    last_seen_at: candidate.lastSeenAt,
    last_decision: candidate.lastDecision,
    last_reason: candidate.lastReason,
    category: candidate.category,
    confidence: candidate.confidence,
    memory: candidate.memory,
    summary: candidate.summary
  }));
  if (items.length === 0) return "[]";
  return truncate(JSON.stringify(items, null, 2), MAX_MEMORY_CONTEXT_CHARS);
}

function normalizeMemoryCandidate(value: unknown): MemoryCandidate | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const id = trimOrUndefined(record.id);
  const key = trimOrUndefined(record.key);
  const memory = trimOrUndefined(record.memory);
  const status = trimOrUndefined(record.status);
  const firstSeenAt = trimOrUndefined(record.firstSeenAt);
  const lastSeenAt = trimOrUndefined(record.lastSeenAt);
  const seenCount = typeof record.seenCount === "number" && Number.isFinite(record.seenCount)
    ? Math.max(1, Math.floor(record.seenCount))
    : 1;
  if (!id || !key || !memory || !firstSeenAt || !lastSeenAt) return undefined;
  const sources = Array.isArray(record.sources)
    ? record.sources
      .map((source): MemoryCandidate["sources"][number] | undefined => {
        const sourceRecord = asRecord(source);
        const channel = trimOrUndefined(sourceRecord?.channel);
        const observedAt = trimOrUndefined(sourceRecord?.observedAt);
        if (!channel || !observedAt) return undefined;
        return {
          channel,
          observedAt,
          sessionId: trimOrUndefined(sourceRecord?.sessionId),
          threadId: trimOrUndefined(sourceRecord?.threadId),
          codexThreadId: trimOrUndefined(sourceRecord?.codexThreadId),
          promptExcerpt: trimOrUndefined(sourceRecord?.promptExcerpt),
          answerExcerpt: trimOrUndefined(sourceRecord?.answerExcerpt)
        };
      })
      .filter((source): source is MemoryCandidate["sources"][number] => Boolean(source))
    : [];
  return {
    id,
    key,
    status: status === "promoted" || status === "rejected" ? status : "pending",
    memory,
    summary: trimOrUndefined(record.summary),
    category: trimOrUndefined(record.category),
    confidence: typeof record.confidence === "number" && Number.isFinite(record.confidence) ? record.confidence : undefined,
    firstSeenAt,
    lastSeenAt,
    seenCount,
    lastDecision: trimOrUndefined(record.lastDecision),
    lastReason: trimOrUndefined(record.lastReason),
    promotedAt: trimOrUndefined(record.promotedAt),
    sources
  };
}

async function readMemoryCandidates(sourceDir: string): Promise<MemoryCandidate[]> {
  const content = await readTextIfExists(path.join(sourceDir, MEMORY_CANDIDATES_FILE_NAME));
  if (!trimOrUndefined(content)) return [];
  try {
    const parsed = JSON.parse(content) as unknown;
    const items = Array.isArray(parsed) ? parsed : [];
    return items
      .map(normalizeMemoryCandidate)
      .filter((candidate): candidate is MemoryCandidate => Boolean(candidate));
  } catch {
    return [];
  }
}

async function writeMemoryCandidates(sourceDir: string, candidates: MemoryCandidate[]): Promise<void> {
  const sorted = candidates
    .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
    .slice(0, MAX_MEMORY_CANDIDATES);
  await fs.writeFile(path.join(sourceDir, MEMORY_CANDIDATES_FILE_NAME), `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
}

function selectRelatedMemoryCandidates(input: CodexMemoryRunInput, candidates: MemoryCandidate[]): MemoryCandidate[] {
  const query = [input.prompt, input.answerText].join("\n");
  return candidates
    .filter((candidate) => candidate.status === "pending")
    .map((candidate) => ({
      candidate,
      score: Math.max(
        similarityScore(query, candidate.memory),
        candidate.summary ? similarityScore(query, candidate.summary) : 0
      )
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) =>
      right.score - left.score ||
      right.candidate.seenCount - left.candidate.seenCount ||
      right.candidate.lastSeenAt.localeCompare(left.candidate.lastSeenAt)
    )
    .slice(0, MAX_CANDIDATE_CONTEXT_ITEMS)
    .map(({ candidate }) => candidate);
}

async function readCanonicalMemoryItems(sourceDir: string): Promise<string[]> {
  const memoryContent =
    await readTextIfExists(path.join(sourceDir, "MEMORY.md")) ||
    await readTextIfExists(path.join(sourceDir, "memory_summary.md"));
  const summaryItems = memorySummaryItemsFromContent(memoryContent);
  if (summaryItems.length > 0) return uniqueMemoryItems(summaryItems);
  const rawItems = rawMemoriesFromContent(await readTextIfExists(path.join(sourceDir, "raw_memories.md")));
  if (rawItems.length > 0) return uniqueMemoryItems(rawItems);
  const plainMemory = trimOrUndefined(memoryContent);
  if (plainMemory && !/^# Memory Summary\s+No consolidated memories yet\.\s*$/is.test(plainMemory)) {
    return [plainMemory];
  }
  return [];
}

function findMemoryIndex(memories: string[], extraction: MemoryExtraction & { memory: string }): number {
  const target = trimOrUndefined(extraction.target);
  if (target) {
    const match = target.match(/^M(\d+)$/i);
    if (match) {
      const index = Number.parseInt(match[1], 10) - 1;
      if (index >= 0 && index < memories.length) return index;
    }
    const normalizedTarget = target.toLowerCase();
    const exactIndex = memories.findIndex((memory) => memory.toLowerCase() === normalizedTarget);
    if (exactIndex >= 0) return exactIndex;
    const containsIndex = memories.findIndex((memory) =>
      memory.toLowerCase().includes(normalizedTarget) || normalizedTarget.includes(memory.toLowerCase())
    );
    if (containsIndex >= 0) return containsIndex;
  }

  let bestIndex = -1;
  let bestScore = 0;
  memories.forEach((memory, index) => {
    const score = similarityScore(memory, extraction.memory);
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });
  if (extraction.action === "update" || extraction.action === "merge") {
    return bestScore >= 0.35 ? bestIndex : -1;
  }
  return bestScore >= 0.75 ? bestIndex : -1;
}

function mergeCanonicalMemoryItems(memories: string[], extraction: MemoryExtraction & { memory: string }): string[] {
  const current = uniqueMemoryItems(memories);
  const index = findMemoryIndex(current, extraction);
  if (index >= 0) {
    current[index] = extraction.memory;
    return uniqueMemoryItems(current);
  }
  return uniqueMemoryItems([...current, extraction.memory]);
}

function candidateSourceFromInput(input: CodexMemoryRunInput, observedAt: string): MemoryCandidate["sources"][number] {
  return {
    channel: input.channel,
    observedAt,
    sessionId: trimOrUndefined(input.sessionId),
    threadId: trimOrUndefined(input.threadId),
    codexThreadId: trimOrUndefined(input.codexThreadId),
    promptExcerpt: truncate(trimOrUndefined(input.prompt) ?? "", MAX_CANDIDATE_EXCERPT_CHARS),
    answerExcerpt: truncate(trimOrUndefined(input.answerText) ?? "", MAX_CANDIDATE_EXCERPT_CHARS)
  };
}

function findCandidateIndex(candidates: MemoryCandidate[], key: string, memory: string): number {
  const exact = candidates.findIndex((candidate) => candidate.key === key);
  if (exact >= 0) return exact;
  let bestIndex = -1;
  let bestScore = 0;
  candidates.forEach((candidate, index) => {
    if (candidate.status !== "pending") return;
    const score = similarityScore(candidate.memory, memory);
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });
  return bestScore >= 0.65 ? bestIndex : -1;
}

async function recordSkippedMemoryCandidate(
  sourceDir: string,
  input: CodexMemoryRunInput,
  extraction: MemoryExtraction
): Promise<boolean> {
  const memory = trimOrUndefined(extraction.candidateMemory) ?? trimOrUndefined(extraction.memory);
  if (!memory) return false;
  const candidates = await readMemoryCandidates(sourceDir);
  const observedAt = (input.completedAt ?? new Date()).toISOString();
  const key = candidateKeyFor({
    slug: extraction.slug,
    category: extraction.category,
    memory,
    summary: extraction.candidateSummary ?? extraction.summary
  });
  const index = findCandidateIndex(candidates, key, memory);
  const source = candidateSourceFromInput(input, observedAt);
  if (index >= 0) {
    const existing = candidates[index];
    candidates[index] = {
      ...existing,
      memory,
      summary: trimOrUndefined(extraction.candidateSummary) ?? trimOrUndefined(extraction.summary) ?? existing.summary,
      category: trimOrUndefined(extraction.category) ?? existing.category,
      confidence: extraction.confidence ?? existing.confidence,
      status: "pending",
      seenCount: existing.seenCount + 1,
      lastSeenAt: observedAt,
      lastDecision: extraction.action,
      lastReason: extraction.reason,
      sources: [...existing.sources, source].slice(-MAX_CANDIDATE_SOURCE_ITEMS)
    };
  } else {
    candidates.push({
      id: `candidate-${randomUUID().slice(0, 12)}`,
      key,
      status: "pending",
      memory,
      summary: trimOrUndefined(extraction.candidateSummary) ?? trimOrUndefined(extraction.summary),
      category: trimOrUndefined(extraction.category),
      confidence: extraction.confidence,
      firstSeenAt: observedAt,
      lastSeenAt: observedAt,
      seenCount: 1,
      lastDecision: extraction.action,
      lastReason: extraction.reason,
      sources: [source]
    });
  }
  await writeMemoryCandidates(sourceDir, candidates);
  return true;
}

async function markPromotedMemoryCandidates(
  sourceDir: string,
  extraction: MemoryExtraction & { memory: string }
): Promise<void> {
  const candidates = await readMemoryCandidates(sourceDir);
  if (candidates.length === 0) return;
  let changed = false;
  const target = trimOrUndefined(extraction.target);
  const promotedAt = new Date().toISOString();
  for (const candidate of candidates) {
    if (candidate.status !== "pending") continue;
    const isTarget = Boolean(target && target === candidate.id);
    const isSimilar = similarityScore(candidate.memory, extraction.memory) >= 0.65;
    if (!isTarget && !isSimilar) continue;
    candidate.status = "promoted";
    candidate.promotedAt = promotedAt;
    candidate.lastDecision = extraction.action;
    candidate.lastReason = extraction.reason ?? "promoted_to_memory";
    changed = true;
  }
  if (changed) await writeMemoryCandidates(sourceDir, candidates);
}

export function agentStudioMemorySourcePath(codexHome: string): string {
  return path.join(codexHome, AGENT_STUDIO_MEMORY_SOURCE_RELATIVE_PATH);
}

export function agentStudioMemoryCandidatesPath(codexHome: string): string {
  return path.join(agentStudioMemorySourcePath(codexHome), MEMORY_CANDIDATES_FILE_NAME);
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

async function copyDirectoryIfExists(source: string, target: string): Promise<void> {
  if (!(await pathExists(source))) return;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(source, target, { recursive: true, force: false, errorOnExist: false });
}

export async function ensureAgentStudioMemorySource(codexHome: string): Promise<string> {
  const sourceDir = agentStudioMemorySourcePath(codexHome);
  const sourceRawPath = path.join(sourceDir, "raw_memories.md");
  const sourceSummaryPath = path.join(sourceDir, "MEMORY.md");
  if ((await pathExists(sourceRawPath)) || (await pathExists(sourceSummaryPath))) {
    return sourceDir;
  }

  const projectionDir = codexMemoryProjectionPath(codexHome);
  const legacyRaw = await readTextIfExists(path.join(projectionDir, "raw_memories.md"));
  const legacySummary =
    await readTextIfExists(path.join(projectionDir, "MEMORY.md")) ||
    await readTextIfExists(path.join(projectionDir, "memory_summary.md"));
  const migratedItems = rawMemoriesFromContent(legacyRaw);
  const summaryItems = migratedItems.length > 0 ? migratedItems : memorySummaryItemsFromContent(legacySummary);
  const memorySummary = buildMemorySummary(summaryItems.slice(-50));

  await fs.mkdir(sourceDir, { recursive: true });
  await fs.writeFile(sourceRawPath, legacyRaw && !rawMemoryContentIsEmpty(legacyRaw)
    ? legacyRaw
    : buildRawMemoriesFromItems(summaryItems, new Date()), "utf8");
  await fs.writeFile(path.join(sourceDir, "MEMORY.md"), memorySummary, "utf8");
  await fs.writeFile(path.join(sourceDir, "memory_summary.md"), memorySummary, "utf8");
  await copyDirectoryIfExists(path.join(projectionDir, "rollout_summaries"), path.join(sourceDir, "rollout_summaries"));
  await copyDirectoryIfExists(path.join(projectionDir, "skills"), path.join(sourceDir, "skills"));
  await copyDirectoryIfExists(path.join(projectionDir, "extensions", "ad_hoc"), path.join(sourceDir, "extensions", "ad_hoc"));
  return sourceDir;
}

export async function syncAgentStudioMemoryProjection(codexHome: string): Promise<void> {
  let sourceDir = agentStudioMemorySourcePath(codexHome);
  if (!(await pathExists(sourceDir))) {
    const projectionDir = codexMemoryProjectionPath(codexHome);
    const legacyRaw = await readTextIfExists(path.join(projectionDir, "raw_memories.md"));
    const legacySummary =
      await readTextIfExists(path.join(projectionDir, "MEMORY.md")) ||
      await readTextIfExists(path.join(projectionDir, "memory_summary.md"));
    if (rawMemoryContentIsEmpty(legacyRaw) && memorySummaryItemsFromContent(legacySummary).length === 0) {
      return;
    }
    sourceDir = await ensureAgentStudioMemorySource(codexHome);
  }
  const projectionDir = codexMemoryProjectionPath(codexHome);
  await fs.mkdir(projectionDir, { recursive: true });
  const sourceMemory = await readTextIfExists(path.join(sourceDir, "MEMORY.md"));
  const sourceSummary = await readTextIfExists(path.join(sourceDir, "memory_summary.md"));
  const memoryContent = trimOrUndefined(sourceMemory) ?? trimOrUndefined(sourceSummary);
  const summaryContent = trimOrUndefined(sourceSummary) ?? trimOrUndefined(sourceMemory);
  if (memoryContent) {
    await fs.writeFile(path.join(projectionDir, "MEMORY.md"), `${memoryContent.trimEnd()}\n`, "utf8");
  }
  if (summaryContent) {
    await fs.writeFile(path.join(projectionDir, "memory_summary.md"), `${summaryContent.trimEnd()}\n`, "utf8");
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
    resolveProviderSnapshot(): Promise<ManagedCodexProviderSnapshot>;
    getLlmSecretState?(): Promise<{ apiKey?: string } | undefined>;
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

  private async processRunWithLog(input: CodexMemoryRunInput): Promise<void> {
    const startedAt = new Date();
    try {
      const outcome = await this.processRun(input);
      await this.recordRunLog(input, startedAt, outcome);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.recordRunLog(input, startedAt, {
        status: "failed",
        reason: "exception",
        error: detail
      }).catch((logError) => {
        this.dependencies.logger?.warn?.("codex memory run log write failed", {
          detail: logError instanceof Error ? logError.message : String(logError)
        });
      });
      this.dependencies.logger?.warn?.("codex memory generation failed", {
        channel: input.channel,
        sessionId: input.sessionId,
        threadId: input.threadId,
        detail
      });
    }
  }

  private async recordRunLog(input: CodexMemoryRunInput, startedAt: Date, outcome: CodexMemoryRunOutcome): Promise<void> {
    const sessionHomeRoot = trimOrUndefined(this.dependencies.sessionHomeRoot);
    if (!sessionHomeRoot) return;
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
    const logPath = path.join(sessionHomeRoot, RUN_LOG_RELATIVE_PATH);
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    const existing = await readTextIfExists(logPath);
    const lines = existing.split(/\n/).filter(Boolean).slice(-MAX_RUN_LOG_ENTRIES + 1);
    lines.push(JSON.stringify(entry));
    await fs.writeFile(logPath, `${lines.join("\n")}\n`, "utf8");
  }

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
    if (settings.generationEngine !== "agent_studio") return { status: "skipped_no_durable_memory", reason: "codex_native_generation" };
    if (settings.disableOnExternalContext && input.hasExternalContext) {
      return { status: "skipped_no_durable_memory", reason: "external_context_disabled" };
    }

    const snapshot = await this.dependencies.resolveProviderSnapshot();
    const secretState = await this.dependencies.getLlmSecretState?.();
    const llmConfig = resolveLlmConfig(settings, snapshot, secretState);
    if (!llmConfig) {
      this.dependencies.logger?.warn?.("codex memory generation skipped: no LLM API configuration", {
        provider: settings.llmProvider,
        apiMode: settings.llmApiMode,
        apiKeyEnv: settings.llmApiKeyEnv
      });
      return {
        status: "failed",
        reason: "missing_llm_config",
        llmProvider: settings.llmProvider,
        llmApiMode: settings.llmApiMode,
        llmModel: trimOrUndefined(settings.llmModel) || snapshot.config.defaultModel || DEFAULT_MODEL
      };
    }

    const memoriesDir = await ensureAgentStudioMemorySource(codexHome);
    const existingMemories = await readCanonicalMemoryItems(memoriesDir);
    const relatedCandidates = selectRelatedMemoryCandidates(input, await readMemoryCandidates(memoriesDir));

    const llmText = await callLlm(llmConfig, buildExtractionPrompt(input, {
      existingMemories,
      relatedCandidates
    }));
    const extraction = normalizeExtraction(parseJsonObject(llmText));
    const memory = trimOrUndefined(extraction?.memory);
    if (!extraction) {
      return {
        status: "failed",
        reason: "invalid_llm_response",
        llmProvider: llmConfig.provider,
        llmApiMode: llmConfig.apiMode,
        llmModel: llmConfig.model
      };
    }
    if (!extraction.shouldRemember || extraction.action === "skip" || !memory) {
      const candidateRecorded = extraction
        ? await recordSkippedMemoryCandidate(memoriesDir, input, extraction)
        : false;
      return {
        status: "skipped_no_durable_memory",
        reason: candidateRecorded
          ? "candidate_recorded"
          : !extraction.shouldRemember || extraction.action === "skip"
            ? "model_declined"
            : "empty_memory",
        llmProvider: llmConfig.provider,
        llmApiMode: llmConfig.apiMode,
        llmModel: llmConfig.model,
        category: extraction.category,
        confidence: extraction.confidence
      };
    }

    await this.writeMemoryFiles(codexHome, input, {
      ...extraction,
      memory
    });
    await markPromotedMemoryCandidates(memoriesDir, {
      ...extraction,
      memory
    });
    return {
      status: "written",
      reason: `memory_${extraction.action}`,
      llmProvider: llmConfig.provider,
      llmApiMode: llmConfig.apiMode,
      llmModel: llmConfig.model,
      category: extraction.category,
      confidence: extraction.confidence,
      memoryChars: memory.length
    };
  }

  private async writeMemoryFiles(codexHome: string, input: CodexMemoryRunInput, extraction: MemoryExtraction & { memory: string }): Promise<void> {
    const memoriesDir = await ensureAgentStudioMemorySource(codexHome);
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
      `- action: ${extraction.action}`,
      input.sessionId ? `- session_id: ${input.sessionId}` : "",
      input.threadId ? `- thread_id: ${input.threadId}` : "",
      input.codexThreadId ? `- codex_thread_id: ${input.codexThreadId}` : "",
      extraction.category ? `- category: ${extraction.category}` : "",
      typeof extraction.confidence === "number" ? `- confidence: ${extraction.confidence}` : "",
      extraction.target ? `- target: ${extraction.target}` : "",
      extraction.reason ? `- reason: ${extraction.reason}` : "",
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
    const shouldResetRaw = rawMemoryContentIsEmpty(existingRaw);
    const rawPrefix = shouldResetRaw ? "# Raw Memories\n" : existingRaw.trimEnd();
    const nextRaw = [
      rawPrefix,
      "",
      `## ${iso}`,
      `- source: ${input.channel}`,
      `- action: ${extraction.action}`,
      extraction.category ? `- category: ${extraction.category}` : "",
      typeof extraction.confidence === "number" ? `- confidence: ${extraction.confidence}` : "",
      extraction.target ? `- target: ${extraction.target}` : "",
      extraction.reason ? `- reason: ${extraction.reason}` : "",
      `- memory: ${extraction.memory}`,
      input.threadId ? `- thread_id: ${input.threadId}` : "",
      input.codexThreadId ? `- codex_thread_id: ${input.codexThreadId}` : "",
      ""
    ].filter((line) => line !== "").join("\n");
    await fs.writeFile(rawPath, `${nextRaw}\n`, "utf8");

    const memories = mergeCanonicalMemoryItems(await readCanonicalMemoryItems(memoriesDir), extraction).slice(-50);
    const memorySummary = buildMemorySummary(memories);
    await fs.writeFile(path.join(memoriesDir, "memory_summary.md"), memorySummary, "utf8");
    await fs.writeFile(path.join(memoriesDir, "MEMORY.md"), memorySummary, "utf8");
    await syncAgentStudioMemoryProjection(codexHome);
  }
}
