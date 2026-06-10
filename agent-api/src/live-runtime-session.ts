import type { ReasoningEffort } from "./model-config.js";

export type RuntimeUsageSnapshot = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  kind?: "turn_delta" | "cumulative_snapshot";
  cumulativeInputTokens?: number;
  cumulativeCachedInputTokens?: number;
  cumulativeOutputTokens?: number;
  codexThreadId?: string;
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

function parseUsageRecord(
  value: unknown,
  kind: RuntimeUsageSnapshot["kind"],
  options: {
    cumulative?: RuntimeUsageSnapshot;
    codexThreadId?: string;
  } = {}
): RuntimeUsageSnapshot | undefined {
  const usage = asRecord(value);
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
    outputTokens,
    kind,
    cumulativeInputTokens: options.cumulative?.inputTokens,
    cumulativeCachedInputTokens: options.cumulative?.cachedInputTokens,
    cumulativeOutputTokens: options.cumulative?.outputTokens,
    codexThreadId: options.codexThreadId
  };
}

function parseTokenCountUsage(event: Record<string, unknown>, raw: Record<string, unknown> | undefined): RuntimeUsageSnapshot | undefined {
  const source = raw?.type === "token_count" ? raw : event;
  const info = asRecord(source.info);
  const codexThreadId = trimOrUndefined(typeof source.thread_id === "string" ? source.thread_id : undefined);
  const cumulative = parseUsageRecord(info?.total_token_usage, "cumulative_snapshot", { codexThreadId });
  return parseUsageRecord(info?.last_token_usage, "turn_delta", {
    cumulative,
    codexThreadId
  });
}

function completedAgentMessageText(event: RuntimeStreamEvent): string | undefined {
  const raw = asRecord(event.raw);
  if (raw?.type !== "item.completed") return undefined;
  const item = asRecord(raw.item);
  if (item?.type !== "agent_message") return undefined;
  return typeof item.text === "string" ? item.text : "";
}

export function extractRuntimeUsageFromStreamEvent(value: unknown): RuntimeUsageSnapshot | undefined {
  const event = asRecord(value);
  if (!event) return undefined;
  const eventType = trimOrUndefined(typeof event.type === "string" ? event.type : undefined);

  const raw = asRecord(event.raw);
  if (eventType === "token_count" || raw?.type === "token_count") {
    return parseTokenCountUsage(event, raw);
  }
  if (eventType !== "turn.completed") return undefined;

  const usage = asRecord(raw?.usage ?? event.usage);
  if (!usage) return undefined;
  const codexThreadId = trimOrUndefined(
    typeof raw?.thread_id === "string" ? raw.thread_id : typeof event.thread_id === "string" ? event.thread_id : undefined
  );
  const cumulative = parseUsageRecord(usage.total_token_usage, "cumulative_snapshot", { codexThreadId });
  const turn = parseUsageRecord(usage.last_token_usage, "turn_delta", {
    cumulative,
    codexThreadId
  });
  return turn ?? parseUsageRecord(usage, "cumulative_snapshot", { codexThreadId });
}

export async function streamRuntimeCompletionWithBestEffortUsage(input: {
  events: AsyncIterable<RuntimeStreamEvent>;
  onEvent(event: RuntimeStreamEvent): void;
  onDone(payload: { answer: string; usage?: RuntimeUsageSnapshot }): void | Promise<void>;
  recordUsage?(usage: RuntimeUsageSnapshot, resultStatus?: "success" | "failed"): Promise<void>;
  onTelemetryError?(error: unknown): void;
}): Promise<void> {
  let fallbackAnswer = "";
  let finalAgentAnswer: string | undefined;
  let latestUsage: RuntimeUsageSnapshot | undefined;

  try {
    for await (const event of input.events) {
      const usage = extractRuntimeUsageFromStreamEvent(event);
      if (usage) {
        latestUsage = usage;
      }
      const completedAgentText = completedAgentMessageText(event);
      if (completedAgentText !== undefined) {
        finalAgentAnswer = completedAgentText;
      } else if (event.delta) {
        fallbackAnswer += event.delta;
      } else if (event.text) {
        fallbackAnswer += event.text;
      }
      input.onEvent(event);
    }
  } catch (error) {
    const failedUsage = latestUsage;
    if (failedUsage && input.recordUsage) {
      await Promise.resolve()
        .then(() => input.recordUsage?.(failedUsage, "failed"))
        .catch((telemetryError) => {
          input.onTelemetryError?.(telemetryError);
        });
    }
    throw error;
  }

  await input.onDone({
    answer: finalAgentAnswer ?? fallbackAnswer,
    usage: latestUsage
  });

  if (latestUsage && input.recordUsage) {
    void Promise.resolve()
      .then(() => input.recordUsage?.(latestUsage, "success"))
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
  delete next._agentStudioCodexHome;
  delete next._agentStudioSkillActivationPrompts;
  delete next._agentStudioRuntimeCapabilities;
  delete next.enabledSkills;
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
}): Promise<{ liveThread: TThread; codexRunConfig?: Record<string, unknown>; codexThreadId?: string }> {
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

  const codexThreadId =
    typeof (liveThread as { id?: unknown })?.id === "string"
      ? trimOrUndefined((liveThread as { id?: string }).id)
      : undefined;

  return {
    liveThread,
    codexRunConfig,
    codexThreadId
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
    codexThreadId?: string;
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
    codexRunConfig: started.codexRunConfig,
    codexThreadId: started.codexThreadId
  });
  input.liveRuntimeThreads.set(input.sessionId, started.liveThread);
  return persisted;
}
