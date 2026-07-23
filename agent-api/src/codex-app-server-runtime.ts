/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import os from "node:os";
import path from "node:path";

import {
  REASONING_EFFORT_VALUES,
  type CodexModelCapability,
  type ReasoningEffort
} from "./model-config.js";
import {
  CODEX_RUNTIME_ERROR_CODE,
  CodexRuntimeUserError
} from "./codex-runtime-user-error.js";
import type {
  CodexRunStreamOptions,
  CodexRuntimeOptions,
  CodexStreamEvent,
  CodexTurnSkill
} from "./codex-runtime.js";

type JsonRecord = Record<string, unknown>;
type JsonRpcId = string | number;

type AppServerThreadOptions = {
  model: string;
  reasoningEffort: ReasoningEffort;
  workspace: string;
  codexRunConfig?: Record<string, unknown>;
};

export type CodexAppServerThread = {
  id: string;
  driver: "app_server";
  scopeKey: string;
  scope: RuntimeScope;
  options: AppServerThreadOptions;
};

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

type NotificationSubscriber = (message: JsonRecord) => void;
type CodexAppServerFailureCategory =
  | "model_or_app_server_error"
  | "tool_or_sandbox_error"
  | "turn_timeout"
  | "client_aborted"
  | "process_exit"
  | "unknown";

type RuntimeEventSummary = {
  at: string;
  type: string;
  threadId?: string;
  turnId?: string;
  itemType?: string;
  toolName?: string;
  textPreview?: string;
};

type RuntimeScope = {
  key: string;
  binaryPath: string;
  env: Record<string, string>;
  config?: Record<string, unknown>;
  maxActiveTurns: number;
  turnIdleTimeoutMs: number;
  turnMaxMs: number;
};

const DEFAULT_MAX_PROCESSES = 30;
const DEFAULT_MAX_ACTIVE_TURNS_PER_PROCESS = 2;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_TURN_IDLE_TIMEOUT_MS = 20 * 60_000;
const DEFAULT_TURN_MAX_MS = 90 * 60_000;
const DEFAULT_TRANSIENT_OVERLOAD_RETRY_DELAYS_MS = [2_000, 5_000] as const;
const TRANSIENT_OVERLOAD_RETRY_DELAYS_ENV = "CODEX_APP_SERVER_OVERLOAD_RETRY_DELAYS_MS";
const TRANSIENT_OVERLOAD_RECOVERY_MESSAGE = "continue";
const MAX_TRANSIENT_OVERLOAD_RETRIES = 2;
const MAX_DIAGNOSTIC_EVENTS = 20;
const MAX_BUFFERED_PRE_START_EVENTS = 50;
const TOML_DRIVER_APP_SERVER = "app_server";
const UNSUPPORTED_INTERACTIVE_TOOL_MESSAGE =
  "This interactive tool is unavailable in the current channel. Do not retry it. Continue answering with the information already available and clearly state any data limitations.";

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function asReasoningEffort(value: unknown): ReasoningEffort | undefined {
  const normalized = trimOrUndefined(value);
  return REASONING_EFFORT_VALUES.find((effort) => effort === normalized);
}

function asPositiveInteger(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function modelCapabilityFromAppServer(value: unknown): CodexModelCapability | undefined {
  const model = asRecord(value);
  const id = trimOrUndefined(model?.model) ?? trimOrUndefined(model?.id);
  if (!id) return undefined;
  const reasoningOptions = Array.isArray(model?.supportedReasoningEfforts)
    ? model.supportedReasoningEfforts
    : [];
  const supportedReasoningEfforts = reasoningOptions
    .map((item) => asReasoningEffort(asRecord(item)?.reasoningEffort ?? item))
    .filter((item): item is ReasoningEffort => Boolean(item));
  const defaultReasoningEffort =
    asReasoningEffort(model?.defaultReasoningEffort) ?? supportedReasoningEfforts[0] ?? "high";
  const serviceTiers = Array.isArray(model?.serviceTiers)
    ? model.serviceTiers.flatMap((item) => {
        const tier = asRecord(item);
        const tierId = trimOrUndefined(tier?.id);
        if (!tierId) return [];
        return [{
          id: tierId,
          label: trimOrUndefined(tier?.name) ?? tierId,
          description: trimOrUndefined(tier?.description)
        }];
      })
    : [];
  return {
    id,
    label: trimOrUndefined(model?.displayName) ?? id,
    description: trimOrUndefined(model?.description),
    hidden: model?.hidden === true,
    isDefault: model?.isDefault === true,
    defaultReasoningEffort,
    supportedReasoningEfforts,
    inputModalities: asStringArray(model?.inputModalities),
    serviceTiers,
    contextLimit: asPositiveInteger(model?.contextWindow ?? model?.contextLimit)
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt((value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveDurationMs(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt((value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function transientOverloadRetryDelaysMs(): number[] {
  const configured = process.env[TRANSIENT_OVERLOAD_RETRY_DELAYS_ENV]?.trim();
  if (!configured) return [...DEFAULT_TRANSIENT_OVERLOAD_RETRY_DELAYS_MS];
  const delays = configured
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .slice(0, MAX_TRANSIENT_OVERLOAD_RETRIES);
  return delays.length > 0 ? delays : [...DEFAULT_TRANSIENT_OVERLOAD_RETRY_DELAYS_MS];
}

function previewText(value: unknown, maxLength = 240): string | undefined {
  if (typeof value !== "string") return undefined;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

function jsonPreview(value: unknown, maxLength = 2000): string {
  try {
    const text = JSON.stringify(value);
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  } catch {
    return String(value);
  }
}

function eventSummary(event: CodexStreamEvent): RuntimeEventSummary {
  const raw = asRecord(event.raw);
  const item = asRecord(raw?.item);
  const toolCall = asRecord((raw as Record<string, unknown> | undefined)?.toolCall);
  return {
    at: new Date().toISOString(),
    type: event.type,
    threadId: trimOrUndefined(raw?.thread_id),
    turnId: trimOrUndefined(raw?.turn_id),
    itemType: trimOrUndefined(item?.type),
    toolName: trimOrUndefined(toolCall?.name) ?? trimOrUndefined(item?.name),
    textPreview: previewText(event.text ?? event.delta ?? item?.text)
  };
}

function streamEventTurnId(event: CodexStreamEvent): string | undefined {
  return trimOrUndefined(asRecord(event.raw)?.turn_id);
}

function isRetryableRuntimeError(event: CodexStreamEvent): boolean {
  if (event.type !== "error") return false;
  const raw = asRecord(event.raw);
  return raw?.willRetry === true;
}

function classifyRuntimeFailure(message: string, raw?: unknown): CodexAppServerFailureCategory {
  const text = `${message}\n${jsonPreview(raw, 1000)}`.toLowerCase();
  if (text.includes("aborted") || text.includes("abort")) return "client_aborted";
  if (text.includes("timed out") || text.includes("timeout")) return "turn_timeout";
  if (text.includes("sandbox") || text.includes("permission denied") || text.includes("command failed") || text.includes("tool")) {
    return "tool_or_sandbox_error";
  }
  if (text.includes("exited code=") || text.includes("signal=")) return "process_exit";
  if (text.includes("app-server") || text.includes("model") || text.includes("response")) return "model_or_app_server_error";
  return "unknown";
}

class CodexAppServerTurnError extends Error {
  readonly category: CodexAppServerFailureCategory;
  readonly raw?: unknown;
  readonly diagnostics: {
    threadId: string;
    turnId?: string;
    scopeKey: string;
    durationMs: number;
    activeTurns: number;
    lastEvents: RuntimeEventSummary[];
    stderrTail?: string;
  };

  constructor(message: string, input: {
    category?: CodexAppServerFailureCategory;
    raw?: unknown;
    diagnostics: CodexAppServerTurnError["diagnostics"];
  }) {
    super(message);
    this.name = "CodexAppServerTurnError";
    this.category = input.category ?? classifyRuntimeFailure(message, input.raw);
    this.raw = input.raw;
    this.diagnostics = input.diagnostics;
  }
}

function isTransientModelOverloadPayload(message: string, raw?: unknown): boolean {
  const rawRecord = asRecord(raw);
  const nestedError = asRecord(rawRecord?.error);
  const codexErrorInfo = trimOrUndefined(nestedError?.codexErrorInfo)?.toLowerCase();
  if (codexErrorInfo === "serveroverloaded") return true;

  const text = `${message}\n${jsonPreview(raw, 4_000)}`.toLowerCase();
  return text.includes("selected model is at capacity");
}

function isTransientModelOverloadEvent(event: CodexStreamEvent): boolean {
  return event.type === "error"
    && isTransientModelOverloadPayload(event.text || "", event.raw);
}

function isTransientModelOverload(error: unknown): boolean {
  const raw = error instanceof CodexAppServerTurnError ? error.raw : undefined;
  return isTransientModelOverloadPayload(
    error instanceof Error ? error.message : String(error),
    raw
  );
}

async function waitForRetryDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    const error = new Error("Codex app-server retry aborted by client");
    error.name = "AbortError";
    throw error;
  }
  if (delayMs <= 0) return;

  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      const error = new Error("Codex app-server retry aborted by client");
      error.name = "AbortError";
      reject(error);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function mergeConfig(
  base: Record<string, unknown> | undefined,
  override: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!base && !override) return undefined;
  if (!base) return structuredClone(override);
  if (!override) return structuredClone(base);
  const next: Record<string, unknown> = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    const current = asRecord(next[key]);
    const child = asRecord(value);
    next[key] = current && child ? mergeConfig(current, child) : structuredClone(value);
  }
  return stripUndefined(next);
}

function stripUndefined<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)).filter((item) => item !== undefined) as T;
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === undefined) continue;
    out[key] = stripUndefined(item);
  }
  return out as T;
}

function effectiveEnv(options: CodexRuntimeOptions): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  for (const [key, value] of Object.entries(options.envOverrides ?? {})) {
    if (typeof value === "string") env[key] = value;
  }
  if (options.apiKey) {
    env.CODEX_API_KEY = options.apiKey;
  }
  return env;
}

export function resolveCodexAppServerBinaryPath(): string {
  const configured = trimOrUndefined(process.env.CODEX_APP_SERVER_BINARY);
  if (configured) return configured;

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const projectBinary = path.resolve(moduleDir, "../node_modules/.bin/codex");
  if (existsSync(projectBinary)) return projectBinary;

  const globalLinuxCandidates = [
    "/usr/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex",
    "/usr/local/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex"
  ];
  for (const candidate of globalLinuxCandidates) {
    if (os.platform() === "linux" && existsSync(candidate)) return candidate;
  }
  return "codex";
}

function runtimeBaseConfig(options: CodexRuntimeOptions): Record<string, unknown> | undefined {
  const fromOptions = options.config ? structuredClone(options.config) : undefined;
  const baseUrl = trimOrUndefined(options.baseUrl);
  if (!baseUrl) return fromOptions;
  return mergeConfig(fromOptions, { openai_base_url: baseUrl });
}

function runtimeScope(options: CodexRuntimeOptions): RuntimeScope {
  const env = effectiveEnv(options);
  const binaryPath = resolveCodexAppServerBinaryPath();
  const config = runtimeBaseConfig(options);
  const scopeIdentity = {
    binaryPath,
    codexHome: trimOrUndefined(env.CODEX_HOME) ?? path.join(os.homedir(), ".codex"),
    config,
    envOverrides: options.envOverrides ?? {},
    apiKey: options.apiKey ? sha256(options.apiKey) : undefined,
    baseUrl: options.baseUrl
  };
  return {
    key: sha256(scopeIdentity),
    binaryPath,
    env,
    config,
    maxActiveTurns: parsePositiveInt(process.env.CODEX_APP_SERVER_MAX_ACTIVE_TURNS, DEFAULT_MAX_ACTIVE_TURNS_PER_PROCESS),
    turnIdleTimeoutMs: parsePositiveDurationMs(process.env.CODEX_APP_SERVER_TURN_IDLE_TIMEOUT_MS, DEFAULT_TURN_IDLE_TIMEOUT_MS),
    turnMaxMs: parsePositiveDurationMs(process.env.CODEX_APP_SERVER_TURN_MAX_MS, DEFAULT_TURN_MAX_MS)
  };
}

function sandboxModeFromRunConfig(codexRunConfig?: Record<string, unknown>): string {
  const value = trimOrUndefined(codexRunConfig?.sandboxMode);
  if (value === "read-only" || value === "workspace-write" || value === "danger-full-access") return value;
  return "danger-full-access";
}

function approvalPolicyFromRunConfig(codexRunConfig?: Record<string, unknown>): string {
  const value = trimOrUndefined(codexRunConfig?.approvalPolicy);
  if (value === "never" || value === "on-request" || value === "on-failure" || value === "untrusted") return value;
  return "never";
}

function networkAccessFromRunConfig(codexRunConfig?: Record<string, unknown>): boolean {
  return codexRunConfig?.networkAccessEnabled === true;
}

function additionalDirectoriesFromRunConfig(codexRunConfig?: Record<string, unknown>): string[] {
  return asStringArray(codexRunConfig?.additionalDirectories);
}

function configFromRunConfig(input: AppServerThreadOptions): Record<string, unknown> | undefined {
  const runConfig = input.codexRunConfig ?? {};
  const config: Record<string, unknown> = { ...runConfig };
  delete config.sandboxMode;
  delete config.approvalPolicy;
  delete config.networkAccessEnabled;
  delete config.webSearchMode;
  delete config.webSearchEnabled;
  delete config.additionalDirectories;

  config.model_reasoning_effort = input.reasoningEffort;

  const webSearchMode = trimOrUndefined(runConfig.webSearchMode);
  if (webSearchMode) {
    config.web_search = webSearchMode;
  } else if (runConfig.webSearchEnabled === true) {
    config.web_search = "live";
  } else if (runConfig.webSearchEnabled === false) {
    config.web_search = "disabled";
  }

  const additionalDirectories = additionalDirectoriesFromRunConfig(runConfig);
  const writableRoots = [...new Set([input.workspace, ...additionalDirectories].filter(Boolean))];
  if (writableRoots.length || runConfig.networkAccessEnabled !== undefined) {
    config.sandbox_workspace_write = mergeConfig(asRecord(config.sandbox_workspace_write), {
      writable_roots: writableRoots,
      network_access: networkAccessFromRunConfig(runConfig)
    });
  }

  return stripUndefined(config);
}

function sandboxPolicy(input: AppServerThreadOptions): Record<string, unknown> {
  const mode = sandboxModeFromRunConfig(input.codexRunConfig);
  const networkAccess = networkAccessFromRunConfig(input.codexRunConfig);
  if (mode === "read-only") {
    return { type: "readOnly", networkAccess };
  }
  if (mode === "workspace-write") {
    const roots = [...new Set([input.workspace, ...additionalDirectoriesFromRunConfig(input.codexRunConfig)].filter(Boolean))];
    return {
      type: "workspaceWrite",
      writableRoots: roots,
      networkAccess,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false
    };
  }
  return { type: "dangerFullAccess" };
}

function threadStartParams(input: AppServerThreadOptions, scopeConfig: Record<string, unknown> | undefined): Record<string, unknown> {
  return stripUndefined({
    model: input.model,
    cwd: input.workspace,
    approvalPolicy: approvalPolicyFromRunConfig(input.codexRunConfig),
    sandbox: sandboxModeFromRunConfig(input.codexRunConfig),
    config: mergeConfig(scopeConfig, configFromRunConfig(input)),
    threadSource: "user"
  });
}

function threadResumeParams(
  threadId: string,
  input: AppServerThreadOptions,
  scopeConfig: Record<string, unknown> | undefined
): Record<string, unknown> {
  return stripUndefined({
    threadId,
    model: input.model,
    cwd: input.workspace,
    approvalPolicy: approvalPolicyFromRunConfig(input.codexRunConfig),
    sandbox: sandboxModeFromRunConfig(input.codexRunConfig),
    config: mergeConfig(scopeConfig, configFromRunConfig(input))
  });
}

function turnStartParams(
  threadId: string,
  message: string,
  input: AppServerThreadOptions,
  skills: CodexTurnSkill[]
): Record<string, unknown> {
  return stripUndefined({
    threadId,
    input: [
      { type: "text", text: message, text_elements: [] },
      ...skills.map((skill) => ({ type: "skill", name: skill.name, path: skill.path }))
    ],
    cwd: input.workspace,
    model: input.model,
    effort: input.reasoningEffort,
    approvalPolicy: approvalPolicyFromRunConfig(input.codexRunConfig),
    sandboxPolicy: sandboxPolicy(input)
  });
}

function threadIdFromResult(value: unknown): string | undefined {
  const result = asRecord(value);
  const thread = asRecord(result?.thread);
  return trimOrUndefined(thread?.id) ?? trimOrUndefined(result?.threadId) ?? trimOrUndefined(result?.id);
}

function turnIdFromResult(value: unknown): string | undefined {
  const result = asRecord(value);
  const turn = asRecord(result?.turn);
  return trimOrUndefined(turn?.id) ?? trimOrUndefined(result?.turnId);
}

function normalizeThreadItem(item: unknown): Record<string, unknown> | undefined {
  const row = asRecord(item);
  const type = trimOrUndefined(row?.type);
  if (!row || !type) return undefined;

  if (type === "agentMessage") {
    return { ...row, type: "agent_message", text: typeof row.text === "string" ? row.text : "" };
  }
  if (type === "commandExecution") {
    return {
      ...row,
      type: "command_execution",
      aggregated_output: row.aggregatedOutput,
      exit_code: row.exitCode,
      process_id: row.processId
    };
  }
  if (type === "fileChange") {
    return { ...row, type: "file_change" };
  }
  if (type === "mcpToolCall") {
    return { ...row, type: "mcp_tool_call" };
  }
  if (type === "dynamicToolCall") {
    return {
      ...row,
      type: "mcp_tool_call",
      server: trimOrUndefined(row.namespace) ?? "dynamic",
      tool: trimOrUndefined(row.tool) ?? "dynamic_tool_call",
      result: row.contentItems,
      error: row.success === false ? { message: "Dynamic tool call failed" } : row.error
    };
  }
  if (type === "webSearch") {
    return { ...row, type: "web_search" };
  }
  if (type === "imageGeneration") {
    return {
      ...row,
      type: "image_generation_call",
      revised_prompt: row.revisedPrompt,
      saved_path: row.savedPath,
      name: "image_generation"
    };
  }
  if (type === "imageView") {
    return { ...row, type: "image_view" };
  }
  if (type === "reasoning") {
    const summary = Array.isArray(row.summary) ? row.summary.filter((value): value is string => typeof value === "string") : [];
    const content = Array.isArray(row.content) ? row.content.filter((value): value is string => typeof value === "string") : [];
    return { ...row, type: "reasoning", text: [...summary, ...content].join("\n\n") };
  }
  if (type === "userMessage") {
    return { ...row, type: "user_message" };
  }
  return { ...row, type };
}

function normalizeRawResponseItem(item: unknown): Record<string, unknown> | undefined {
  const row = asRecord(item);
  const type = trimOrUndefined(row?.type);
  if (!row || !type) return undefined;
  if (type === "image_generation_call") {
    return {
      ...row,
      name: "image_generation"
    };
  }
  return row;
}

function tokenUsageEvent(message: JsonRecord): CodexStreamEvent | undefined {
  const params = asRecord(message.params);
  const usage = asRecord(params?.tokenUsage);
  const total = asRecord(usage?.total);
  const last = asRecord(usage?.last);
  if (!params || !usage || !total || !last) return undefined;
  const toSnake = (value: Record<string, unknown>) => ({
    input_tokens: value.inputTokens,
    cached_input_tokens: value.cachedInputTokens,
    ...(value.cacheWriteTokens !== undefined ? { cache_write_tokens: value.cacheWriteTokens } : {}),
    output_tokens: value.outputTokens
  });
  const raw = {
    type: "token_count",
    thread_id: params.threadId,
    turn_id: params.turnId,
    info: {
      total_token_usage: toSnake(total),
      last_token_usage: toSnake(last),
      ...(usage.modelContextWindow !== undefined
        ? { model_context_window: usage.modelContextWindow }
        : {})
    }
  };
  return { type: "token_count", raw };
}

function normalizeNotification(message: JsonRecord): CodexStreamEvent | undefined {
  const method = trimOrUndefined(message.method);
  const params = asRecord(message.params) ?? {};

  if (method === "thread/tokenUsage/updated") {
    return tokenUsageEvent(message);
  }

  if (method === "item/agentMessage/delta") {
    const itemId = trimOrUndefined(params.itemId);
    const delta = typeof params.delta === "string" ? params.delta : "";
    const raw = {
      type: "item.agent_message.delta",
      thread_id: params.threadId,
      turn_id: params.turnId,
      item: {
        type: "agent_message",
        id: itemId,
        phase: trimOrUndefined(params.phase)
      }
    };
    return {
      type: "item.agent_message.delta",
      delta,
      raw
    };
  }

  if (method === "item/started" || method === "item/completed") {
    const item = normalizeThreadItem(params.item);
    const type = method === "item/started" ? "item.started" : "item.completed";
    return {
      type,
      text: typeof item?.text === "string" ? item.text : undefined,
      raw: {
        type,
        thread_id: params.threadId,
        turn_id: params.turnId,
        started_at_ms: params.startedAtMs,
        completed_at_ms: params.completedAtMs,
        item
      }
    };
  }

  if (method === "rawResponseItem/completed") {
    const item = normalizeRawResponseItem(params.item);
    return {
      type: "raw_response_item.completed",
      raw: {
        type: "raw_response_item.completed",
        thread_id: params.threadId,
        turn_id: params.turnId,
        item
      }
    };
  }

  if (method === "turn/completed") {
    const turn = asRecord(params.turn);
    return {
      type: "turn.completed",
      raw: {
        type: "turn.completed",
        thread_id: params.threadId,
        turn_id: turn?.id ?? params.turnId,
        turn: params.turn,
        usage: params.usage ?? turn?.usage,
        last_agent_message: params.last_agent_message ?? params.lastAgentMessage ?? turn?.last_agent_message ?? turn?.lastAgentMessage
      }
    };
  }

  if (method === "turn/started") {
    return {
      type: "turn.started",
      raw: {
        type: "turn.started",
        thread_id: params.threadId,
        turn_id: asRecord(params.turn)?.id,
        turn: params.turn
      }
    };
  }

  if (method === "thread/started") {
    const thread = asRecord(params.thread);
    return {
      type: "thread.started",
      raw: {
        type: "thread.started",
        thread_id: thread?.id ?? params.threadId,
        thread
      }
    };
  }

  if (method === "error") {
    return {
      type: "error",
      text: trimOrUndefined(params.message),
      raw: {
        type: "error",
        ...params
      }
    };
  }

  return method
    ? {
        type: method.replace(/\//g, "."),
        raw: {
          type: method.replace(/\//g, "."),
          ...params
        }
      }
    : undefined;
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<{
    resolve(value: IteratorResult<T>): void;
    reject(error: unknown): void;
  }> = [];
  private closed = false;
  private failure: unknown;

  push(item: T): void {
    if (this.closed || this.failure) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ value: item, done: false });
      return;
    }
    this.items.push(item);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve({ value: undefined as T, done: true });
    }
  }

  error(error: unknown): void {
    if (this.failure) return;
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(error);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async () => {
        if (this.failure) throw this.failure;
        const item = this.items.shift();
        if (item !== undefined) return { value: item, done: false };
        if (this.closed) return { value: undefined as T, done: true };
        return await new Promise<IteratorResult<T>>((resolve, reject) => {
          this.waiters.push({ resolve, reject });
        });
      }
    };
  }
}

class CodexAppServerProcess {
  readonly scopeKey: string;
  lastUsedAt = Date.now();
  activeTurns = 0;
  readonly loadedThreads = new Set<string>();
  private nextRequestId = 1;
  private proc: ReturnType<typeof spawn> | undefined;
  private rl: readline.Interface | undefined;
  private readonly pending = new Map<JsonRpcId, PendingRequest & { timeout: NodeJS.Timeout }>();
  private readonly subscribers = new Set<NotificationSubscriber>();
  private readonly turnWaiters: Array<() => void> = [];
  private startPromise: Promise<void> | undefined;
  private closedError: Error | undefined;
  private stderrTail = "";

  constructor(private readonly scope: RuntimeScope) {
    this.scopeKey = scope.key;
  }

  get closed(): boolean {
    return Boolean(this.closedError);
  }

  async start(): Promise<void> {
    if (this.startPromise) return await this.startPromise;
    this.startPromise = this.startInner();
    return await this.startPromise;
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    await this.start();
    return await this.sendRequest(method, params);
  }

  private async sendRequest(method: string, params?: unknown): Promise<unknown> {
    if (!this.proc?.stdin || this.closedError) {
      throw this.closedError ?? new Error("Codex app-server is not running");
    }
    const id = this.nextRequestId++;
    const payload = params === undefined ? { method, id } : { method, id, params };
    const promise = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, DEFAULT_REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timeout });
    });
    this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
    return await promise;
  }

  notify(method: string, params: Record<string, unknown> = {}): void {
    this.proc?.stdin?.write(`${JSON.stringify({ method, params })}\n`);
  }

  private respond(id: JsonRpcId, result: unknown): void {
    this.proc?.stdin?.write(`${JSON.stringify({ id, result })}\n`);
  }

  private respondError(id: JsonRpcId, message: string): void {
    this.proc?.stdin?.write(`${JSON.stringify({ id, error: { code: -32004, message } })}\n`);
  }

  getStderrTail(): string | undefined {
    return trimOrUndefined(this.stderrTail);
  }

  subscribe(handler: NotificationSubscriber): () => void {
    this.subscribers.add(handler);
    return () => {
      this.subscribers.delete(handler);
    };
  }

  async acquireTurnSlot(): Promise<() => void> {
    if (this.activeTurns < this.scope.maxActiveTurns) {
      this.activeTurns += 1;
      return () => this.releaseTurnSlot();
    }
    await new Promise<void>((resolve) => {
      this.turnWaiters.push(resolve);
    });
    return () => this.releaseTurnSlot();
  }

  stop(reason = "stopped"): void {
    if (this.closedError) return;
    this.closedError = new Error(`Codex app-server ${reason}`);
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(this.closedError);
    }
    this.pending.clear();
    this.rl?.close();
    this.proc?.kill();
    this.subscribers.clear();
  }

  private releaseTurnSlot(): void {
    const next = this.turnWaiters.shift();
    if (next) {
      next();
      return;
    }
    this.activeTurns = Math.max(0, this.activeTurns - 1);
  }

  private async startInner(): Promise<void> {
    this.proc = spawn(this.scope.binaryPath, ["app-server", "--listen", "stdio://"], {
      env: this.scope.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.proc.stderr?.on("data", (chunk) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      this.stderrTail = `${this.stderrTail}${text}`.slice(-4000);
    });
    this.proc.once("error", (error) => this.handleExit(error));
    this.proc.once("exit", (code, signal) => {
      const stderr = this.getStderrTail();
      this.handleExit(new Error(`Codex app-server exited code=${code} signal=${signal}${stderr ? ` stderr=${stderr}` : ""}`));
    });

    if (!this.proc.stdout || !this.proc.stdin) {
      throw new Error("Codex app-server stdio was not available");
    }

    this.rl = readline.createInterface({ input: this.proc.stdout, crlfDelay: Infinity });
    this.rl.on("line", (line) => this.handleLine(line));

    await this.sendRequest("initialize", {
      clientInfo: {
        name: "agent-studio",
        title: "Agent Studio",
        version: "1.0.0"
      },
      capabilities: {
        experimentalApi: true
      }
    });
    this.notify("initialized");
  }

  private handleLine(line: string): void {
    let message: JsonRecord;
    try {
      message = JSON.parse(line) as JsonRecord;
    } catch {
      return;
    }

    const hasId = Object.prototype.hasOwnProperty.call(message, "id");
    const method = trimOrUndefined(message.method);
    if (hasId && method) {
      this.handleServerRequest(message, method);
      return;
    }

    if (hasId) {
      const id = message.id;
      if (typeof id !== "string" && typeof id !== "number") {
        console.warn("codex app-server response had an invalid id", { id });
        return;
      }
      const pending = this.pending.get(id);
      if (!pending) {
        console.warn("codex app-server response did not match a pending request", { id });
        return;
      }
      this.pending.delete(id);
      clearTimeout(pending.timeout);
      const error = asRecord(message.error);
      if (error) {
        pending.reject(new Error(trimOrUndefined(error.message) ?? JSON.stringify(error)));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    this.lastUsedAt = Date.now();
    for (const subscriber of [...this.subscribers]) {
      subscriber(message);
    }
  }

  private handleServerRequest(message: JsonRecord, method: string): void {
    const id = message.id;
    if (typeof id !== "string" && typeof id !== "number") {
      console.warn("codex app-server server request had an invalid id", { id, method });
      return;
    }

    const params = asRecord(message.params);
    const threadId = trimOrUndefined(params?.threadId) ?? trimOrUndefined(params?.conversationId);
    const turnId = trimOrUndefined(params?.turnId);
    console.warn("codex app-server interactive request rejected", {
      method,
      threadId,
      turnId,
      reason: "unsupported_channel_interaction"
    });

    if (method === "item/tool/call") {
      this.respond(id, {
        success: false,
        contentItems: [{ type: "inputText", text: UNSUPPORTED_INTERACTIVE_TOOL_MESSAGE }]
      });
      return;
    }

    if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
      this.respond(id, { decision: "cancel" });
      return;
    }

    if (method === "execCommandApproval" || method === "applyPatchApproval") {
      this.respond(id, { decision: "denied" });
      return;
    }

    if (method === "mcpServer/elicitation/request") {
      this.respond(id, { action: "cancel", content: null, _meta: null });
      return;
    }

    this.respondError(id, UNSUPPORTED_INTERACTIVE_TOOL_MESSAGE);
  }

  private handleExit(error: Error): void {
    if (this.closedError) return;
    this.closedError = error;
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    for (const subscriber of [...this.subscribers]) {
      subscriber({
        method: "error",
        params: {
          message: error.message
        }
      });
    }
    this.subscribers.clear();
  }
}

class CodexAppServerManager {
  private readonly processes = new Map<string, CodexAppServerProcess>();
  private readonly lockedThreads = new Set<string>();
  private readonly threadWaiters = new Map<string, Array<() => void>>();

  async listModels(options: CodexRuntimeOptions): Promise<CodexModelCapability[]> {
    const process = await this.getProcess(runtimeScope(options));
    const models: CodexModelCapability[] = [];
    let cursor: string | undefined;
    do {
      const result = asRecord(await process.request("model/list", {
        includeHidden: false,
        limit: 100,
        ...(cursor ? { cursor } : {})
      }));
      const page = Array.isArray(result?.data) ? result.data : [];
      models.push(
        ...page
          .map(modelCapabilityFromAppServer)
          .filter((model): model is CodexModelCapability => Boolean(model))
      );
      cursor = trimOrUndefined(result?.nextCursor);
    } while (cursor);
    return models;
  }

  async startThread(options: CodexRuntimeOptions, threadOptions: AppServerThreadOptions): Promise<CodexAppServerThread> {
    const scope = runtimeScope(options);
    const process = await this.getProcess(scope);
    const result = await process.request("thread/start", threadStartParams(threadOptions, scope.config));
    const threadId = threadIdFromResult(result);
    if (!threadId) throw new Error("Codex app-server did not return a thread id");
    process.loadedThreads.add(threadId);
    return {
      id: threadId,
      driver: TOML_DRIVER_APP_SERVER,
      scopeKey: scope.key,
      scope,
      options: threadOptions
    };
  }

  async resumeThread(
    options: CodexRuntimeOptions,
    threadId: string,
    threadOptions: AppServerThreadOptions
  ): Promise<CodexAppServerThread> {
    const scope = runtimeScope(options);
    const process = await this.getProcess(scope);
    if (!process.loadedThreads.has(threadId)) {
      const result = await process.request("thread/resume", threadResumeParams(threadId, threadOptions, scope.config));
      const resumedThreadId = threadIdFromResult(result) ?? threadId;
      process.loadedThreads.add(resumedThreadId);
    }
    return {
      id: threadId,
      driver: TOML_DRIVER_APP_SERVER,
      scopeKey: scope.key,
      scope,
      options: threadOptions
    };
  }

  async *runTurn(
    thread: CodexAppServerThread,
    message: string,
    options: CodexRunStreamOptions = {}
  ): AsyncGenerator<CodexStreamEvent> {
    const scope = thread.scope;
    const turnOptions: AppServerThreadOptions = {
      model: options.model ?? thread.options.model,
      reasoningEffort: options.reasoningEffort ?? thread.options.reasoningEffort,
      workspace: options.workspace ?? thread.options.workspace,
      codexRunConfig: options.codexRunConfig ?? thread.options.codexRunConfig
    };
    const process = await this.getProcess(scope);
    const releaseThread = await this.acquireThreadLock(thread.id);
    const releaseTurn = await process.acquireTurnSlot();
    const queue = new AsyncEventQueue<CodexStreamEvent>();
    let turnId: string | undefined;
    let completed = false;
    let unsubscribe = () => {};
    let idleTimer: NodeJS.Timeout | undefined;
    let maxTimer: NodeJS.Timeout | undefined;
    let abortReject: ((error: Error) => void) | undefined;
    let abortHandler: (() => void) | undefined;
    let failureLogged = false;
    let failureSettled = false;
    const startedAtMs = Date.now();
    const lastEvents: RuntimeEventSummary[] = [];
    const bufferedBeforeTurnId: CodexStreamEvent[] = [];

    const makeTurnError = (
      message: string,
      input: { category?: CodexAppServerFailureCategory; raw?: unknown } = {}
    ): CodexAppServerTurnError =>
      new CodexAppServerTurnError(message, {
        category: input.category,
        raw: input.raw,
        diagnostics: {
          threadId: thread.id,
          turnId,
          scopeKey: scope.key,
          durationMs: Math.max(0, Date.now() - startedAtMs),
          activeTurns: process.activeTurns,
          lastEvents: [...lastEvents],
          stderrTail: process.getStderrTail()
        }
      });

    const logFailure = (error: unknown) => {
      if (failureLogged) return;
      failureLogged = true;
      const turnError = error instanceof CodexAppServerTurnError ? error : makeTurnError(error instanceof Error ? error.message : String(error));
      console.warn("codex app-server turn failed", {
        category: turnError.category,
        message: turnError.message,
        raw: turnError.raw ? jsonPreview(turnError.raw) : undefined,
        diagnostics: turnError.diagnostics
      });
    };

    const bestEffortCancel = async () => {
      if (!turnId) return;
      await process.request("turn/interrupt", { threadId: thread.id, turnId }).catch((error) => {
        console.warn("codex app-server turn interrupt failed", {
          threadId: thread.id,
          turnId,
          detail: error instanceof Error ? error.message : String(error)
        });
      });
    };

    const failTurn = (error: CodexAppServerTurnError) => {
      logFailure(error);
      if (error.category === "turn_timeout" && process.activeTurns <= 1) {
        process.stop("turn timeout");
      }
      const settleFailure = () => {
        if (failureSettled) return;
        failureSettled = true;
        queue.error(error);
        abortReject?.(error);
      };
      if (error.category === "client_aborted" && turnId) {
        void bestEffortCancel().finally(settleFailure);
        return;
      }
      void bestEffortCancel();
      settleFailure();
    };

    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        failTurn(makeTurnError(`Codex app-server turn idle timed out after ${scope.turnIdleTimeoutMs}ms`, { category: "turn_timeout" }));
      }, scope.turnIdleTimeoutMs);
      idleTimer.unref();
    };

    const acceptEvent = (event: CodexStreamEvent) => {
      lastEvents.push(eventSummary(event));
      if (lastEvents.length > MAX_DIAGNOSTIC_EVENTS) lastEvents.shift();
      resetIdleTimer();
      if (isRetryableRuntimeError(event)) {
        return;
      }
      if (!isTransientModelOverloadEvent(event)) {
        queue.push(event);
      }
      if (event.type === "turn.completed") {
        completed = true;
        setTimeout(() => queue.close(), 150);
      }
      if (event.type === "error") {
        failTurn(makeTurnError(event.text || "Codex app-server runtime error", { raw: event.raw }));
      }
    };

    const acceptBufferedEventsForTurn = () => {
      const buffered = bufferedBeforeTurnId.splice(0);
      for (const event of buffered) {
        const bufferedTurnId = streamEventTurnId(event);
        if (bufferedTurnId && bufferedTurnId !== turnId) continue;
        acceptEvent(event);
      }
    };

    try {
      if (options.signal?.aborted) {
        throw makeTurnError("Codex app-server turn aborted by client before start", { category: "client_aborted" });
      }
      const abortPromise = new Promise<never>((_, reject) => {
        abortReject = reject;
      });
      if (options.signal) {
        abortHandler = () => {
          failTurn(makeTurnError("Codex app-server turn aborted by client", { category: "client_aborted" }));
        };
        options.signal.addEventListener("abort", abortHandler, { once: true });
      }
      maxTimer = setTimeout(() => {
        failTurn(makeTurnError(`Codex app-server turn max runtime exceeded ${scope.turnMaxMs}ms`, { category: "turn_timeout" }));
      }, scope.turnMaxMs);
      maxTimer.unref();
      resetIdleTimer();

      if (!process.loadedThreads.has(thread.id)) {
        await process.request("thread/resume", threadResumeParams(thread.id, thread.options, scope.config));
        process.loadedThreads.add(thread.id);
      }
      unsubscribe = process.subscribe((notification) => {
        const params = asRecord(notification.params) ?? {};
        const eventThreadId = trimOrUndefined(params.threadId) ?? trimOrUndefined(asRecord(params.thread)?.id);
        if (eventThreadId && eventThreadId !== thread.id) return;
        const eventTurnId = trimOrUndefined(params.turnId) ?? trimOrUndefined(asRecord(params.turn)?.id);
        if (turnId && eventTurnId && eventTurnId !== turnId) return;
        const event = normalizeNotification(notification);
        if (!event) return;
        const normalizedTurnId = streamEventTurnId(event) ?? eventTurnId;
        if (!turnId && normalizedTurnId) {
          if (bufferedBeforeTurnId.length < MAX_BUFFERED_PRE_START_EVENTS) {
            bufferedBeforeTurnId.push(event);
          }
          return;
        }
        if (turnId && normalizedTurnId && normalizedTurnId !== turnId) {
          return;
        }
        acceptEvent(event);
      });
      const result = await Promise.race([
        process.request("turn/start", turnStartParams(thread.id, message, turnOptions, options.skills ?? [])),
        abortPromise
      ]);
      turnId = turnIdFromResult(result);
      abortReject = undefined;
      acceptBufferedEventsForTurn();

      for await (const event of queue) {
        yield event;
      }

      if (!completed) {
        throw makeTurnError("Codex app-server turn ended before completion");
      }
    } catch (error) {
      logFailure(error);
      throw error;
    } finally {
      if (abortHandler && options.signal) options.signal.removeEventListener("abort", abortHandler);
      if (idleTimer) clearTimeout(idleTimer);
      if (maxTimer) clearTimeout(maxTimer);
      unsubscribe();
      releaseTurn();
      releaseThread();
    }
  }

  private async getProcess(scope: RuntimeScope): Promise<CodexAppServerProcess> {
    const existing = this.processes.get(scope.key);
    if (existing && !existing.closed) {
      existing.lastUsedAt = Date.now();
      await existing.start();
      return existing;
    }
    if (existing?.closed) {
      this.processes.delete(scope.key);
    }
    await this.ensureCapacity();
    const process = new CodexAppServerProcess(scope);
    this.processes.set(scope.key, process);
    await process.start();
    return process;
  }

  private async ensureCapacity(): Promise<void> {
    const maxProcesses = parsePositiveInt(process.env.CODEX_APP_SERVER_MAX_PROCESSES, DEFAULT_MAX_PROCESSES);
    if (this.processes.size < maxProcesses) return;
    const idle = [...this.processes.values()]
      .filter((process) => process.activeTurns === 0)
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt)[0];
    if (!idle) {
      throw new Error(`Codex app-server capacity reached (${maxProcesses}) and no idle process can be evicted`);
    }
    idle.stop("evicted by LRU capacity policy");
    this.processes.delete(idle.scopeKey);
  }

  stopAll(reason = "stopped"): void {
    for (const process of this.processes.values()) {
      process.stop(reason);
    }
    this.processes.clear();
  }

  private async acquireThreadLock(threadId: string): Promise<() => void> {
    if (!this.lockedThreads.has(threadId)) {
      this.lockedThreads.add(threadId);
      return () => this.releaseThreadLock(threadId);
    }
    await new Promise<void>((resolve) => {
      const waiters = this.threadWaiters.get(threadId) ?? [];
      waiters.push(resolve);
      this.threadWaiters.set(threadId, waiters);
    });
    return () => this.releaseThreadLock(threadId);
  }

  private releaseThreadLock(threadId: string): void {
    const waiters = this.threadWaiters.get(threadId) ?? [];
    const next = waiters.shift();
    if (next) {
      this.threadWaiters.set(threadId, waiters);
      next();
      return;
    }
    this.threadWaiters.delete(threadId);
    this.lockedThreads.delete(threadId);
  }
}

const appServerManager = new CodexAppServerManager();

export class CodexAppServerRuntime {
  constructor(private readonly options: CodexRuntimeOptions = {}) {}

  async startThreadWithOptions(options: AppServerThreadOptions): Promise<CodexAppServerThread> {
    return await appServerManager.startThread(this.options, options);
  }

  async listModels(): Promise<CodexModelCapability[]> {
    return await appServerManager.listModels(this.options);
  }

  async resumeThreadWithOptions(options: AppServerThreadOptions & { threadId: string }): Promise<CodexAppServerThread> {
    return await appServerManager.resumeThread(this.options, options.threadId, options);
  }

  async *runStreamed(
    thread: CodexAppServerThread,
    message: string,
    options: CodexRunStreamOptions = {}
  ): AsyncGenerator<CodexStreamEvent> {
    const retryDelays = transientOverloadRetryDelaysMs();
    let turnMessage = message;

    for (let attempt = 0; ; attempt += 1) {
      try {
        for await (const event of appServerManager.runTurn(thread, turnMessage, options)) {
          yield event;
        }
        return;
      } catch (error) {
        const transientOverload = isTransientModelOverload(error);
        const delayMs = retryDelays[attempt];
        if (options.signal?.aborted || !transientOverload) {
          throw error;
        }
        if (delayMs === undefined) {
          throw new CodexRuntimeUserError(CODEX_RUNTIME_ERROR_CODE.AI_SERVICE_BUSY, error);
        }
        console.warn("codex app-server retrying transient model overload", {
          threadId: thread.id,
          model: thread.options.model,
          retryAttempt: attempt + 1,
          maxAttempts: retryDelays.length + 1,
          delayMs
        });
        await waitForRetryDelay(delayMs, options.signal);
        turnMessage = TRANSIENT_OVERLOAD_RECOVERY_MESSAGE;
      }
    }
  }

  async validateProvider(options: { model: string; reasoningEffort: ReasoningEffort }): Promise<void> {
    const thread = await this.startThreadWithOptions({
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      workspace: process.cwd(),
      codexRunConfig: {
        sandboxMode: "danger-full-access",
        approvalPolicy: "never"
      }
    });
    const events = this.runStreamed(thread, "Reply with the single word OK.");
    for await (const event of events) {
      if (event.type === "turn.completed") return;
    }
  }
}

export function isAppServerRuntimeEnabled(): boolean {
  const value = (process.env.CODEX_RUNTIME_DRIVER || "").trim().toLowerCase();
  return value === TOML_DRIVER_APP_SERVER || value === "app-server" || value === "appserver";
}

export function shutdownCodexAppServerRuntime(reason = "shutdown"): void {
  appServerManager.stopAll(reason);
}
