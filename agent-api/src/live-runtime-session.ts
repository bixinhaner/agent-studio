import type { ReasoningEffort } from "./model-config.js";

export type RuntimeUsageSnapshot = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

type RuntimeStreamEvent = {
  type?: string;
  delta?: string;
  text?: string;
  raw?: unknown;
  usage?: unknown;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeAdditionalDirectories(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function toTokenCount(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return undefined;
  return Math.round(numeric);
}

export function extractRuntimeUsageFromStreamEvent(value: unknown): RuntimeUsageSnapshot | undefined {
  const event = asRecord(value);
  if (!event) return undefined;
  const eventType = trimOrUndefined(typeof event.type === "string" ? event.type : undefined);
  if (eventType !== "turn.completed") return undefined;

  const raw = asRecord(event.raw);
  const usage = asRecord(raw?.usage ?? event.usage);
  if (!usage) return undefined;

  const inputTokens = toTokenCount(usage.input_tokens);
  const cachedInputTokens = toTokenCount(usage.cached_input_tokens);
  const outputTokens = toTokenCount(usage.output_tokens);
  if (inputTokens === undefined || cachedInputTokens === undefined || outputTokens === undefined) {
    return undefined;
  }

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens
  };
}

export async function streamRuntimeCompletionWithBestEffortUsage(input: {
  events: AsyncIterable<RuntimeStreamEvent>;
  onEvent(event: RuntimeStreamEvent): void;
  onDone(payload: { answer: string; usage?: RuntimeUsageSnapshot }): void | Promise<void>;
  recordUsage?(usage: RuntimeUsageSnapshot): Promise<void>;
  onTelemetryError?(error: unknown): void;
}): Promise<void> {
  let answer = "";
  let latestUsage: RuntimeUsageSnapshot | undefined;

  for await (const event of input.events) {
    const usage = extractRuntimeUsageFromStreamEvent(event);
    if (usage) {
      latestUsage = usage;
    }
    if (event.delta) answer += event.delta;
    else if (event.text) answer += event.text;
    input.onEvent(event);
  }

  await input.onDone({
    answer,
    usage: latestUsage
  });

  if (latestUsage && input.recordUsage) {
    void Promise.resolve()
      .then(() => input.recordUsage?.(latestUsage))
      .catch((error) => {
        input.onTelemetryError?.(error);
      });
  }
}

export function ensureThreadUploadInRunConfig(
  input: Record<string, unknown> | undefined,
  uploadDir: string
): Record<string, unknown> {
  const next: Record<string, unknown> = input ? { ...input } : {};
  const dirs = normalizeAdditionalDirectories(next.additionalDirectories);
  const resolved = new Set(dirs);
  const normalizedUploadDir = trimOrUndefined(uploadDir);
  if (normalizedUploadDir && !resolved.has(normalizedUploadDir)) {
    dirs.push(normalizedUploadDir);
  }
  next.additionalDirectories = dirs;
  return next;
}

export function stripInternalRunConfigMetadata(
  input: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!input) return input;
  const next = { ...input };
  delete next._agentStudioKnowledgeSets;
  return next;
}

export async function startLiveRuntimeSession<TThread>(input: {
  runtime: {
    startThreadWithOptions(options: {
      model: string;
      reasoningEffort: ReasoningEffort;
      workspace: string;
      codexRunConfig?: Record<string, unknown>;
    }): Promise<TThread>;
  };
  model: string;
  reasoningEffort: ReasoningEffort;
  workspace: string;
  codexRunConfig?: Record<string, unknown>;
  threadId?: string;
  getThreadUploadDir?: (threadId: string) => string;
}): Promise<{ liveThread: TThread; codexRunConfig?: Record<string, unknown> }> {
  const codexRunConfig =
    input.threadId && input.getThreadUploadDir
      ? ensureThreadUploadInRunConfig(input.codexRunConfig, input.getThreadUploadDir(input.threadId))
      : input.codexRunConfig;

  const liveThread = await input.runtime.startThreadWithOptions({
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    workspace: input.workspace,
    codexRunConfig: stripInternalRunConfigMetadata(codexRunConfig)
  });

  return {
    liveThread,
    codexRunConfig
  };
}

export async function replaceLiveRuntimeSession<TThread, TPersisted>(input: {
  runtime: {
    startThreadWithOptions(options: {
      model: string;
      reasoningEffort: ReasoningEffort;
      workspace: string;
      codexRunConfig?: Record<string, unknown>;
    }): Promise<TThread>;
  };
  liveRuntimeThreads: Map<string, TThread>;
  sessionId: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  workspace: string;
  codexRunConfig?: Record<string, unknown>;
  threadId?: string;
  getThreadUploadDir?: (threadId: string) => string;
  persist(payload: {
    model: string;
    reasoningEffort: ReasoningEffort;
    workspace: string;
    codexRunConfig?: Record<string, unknown>;
  }): Promise<TPersisted>;
}): Promise<TPersisted> {
  const started = await startLiveRuntimeSession({
    runtime: input.runtime,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    workspace: input.workspace,
    codexRunConfig: input.codexRunConfig,
    threadId: input.threadId,
    getThreadUploadDir: input.getThreadUploadDir
  });
  const persisted = await input.persist({
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    workspace: input.workspace,
    codexRunConfig: started.codexRunConfig
  });
  input.liveRuntimeThreads.set(input.sessionId, started.liveThread);
  return persisted;
}
