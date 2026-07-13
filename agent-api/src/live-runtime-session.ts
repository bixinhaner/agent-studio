import type { ReasoningEffort } from "./model-config.js";

export type RuntimeUsageSnapshot = {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens?: number;
  outputTokens: number;
  kind?: "turn_delta" | "cumulative_snapshot";
  cumulativeInputTokens?: number;
  cumulativeCachedInputTokens?: number;
  cumulativeCacheWriteTokens?: number;
  cumulativeOutputTokens?: number;
  codexThreadId?: string;
  modelContextWindow?: number;
  modelInvocations?: RuntimeModelInvocationUsage[];
};

export type RuntimeModelInvocationUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens?: number;
  outputTokens: number;
  modelContextWindow?: number;
};

export type RuntimeStreamEvent = {
  type?: string;
  delta?: string;
  text?: string;
  raw?: unknown;
  usage?: unknown;
};

export type RuntimeCompletionTextMode = "append" | "first";

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

function abortError(): Error {
  const error = new Error("Codex runtime request aborted");
  error.name = "AbortError";
  return error;
}

const RUNTIME_ITERATOR_RETURN_TIMEOUT_MS = 250;

function timeout(ms: number): Promise<"timeout"> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), ms);
    timer.unref?.();
  });
}

async function returnRuntimeIteratorBestEffort<T>(iterator: AsyncIterator<T>): Promise<void> {
  if (!iterator.return) return;
  const returned = Promise.resolve(iterator.return())
    .then(() => "returned" as const)
    .catch(() => "failed" as const);
  await Promise.race([returned, timeout(RUNTIME_ITERATOR_RETURN_TIMEOUT_MS)]);
}

async function nextRuntimeEvent<T>(iterator: AsyncIterator<T>, signal?: AbortSignal): Promise<IteratorResult<T>> {
  if (!signal) return await iterator.next();
  if (signal.aborted) throw abortError();
  return await new Promise<IteratorResult<T>>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    iterator.next().then(
      (result) => {
        cleanup();
        resolve(result);
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
  });
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
  const cacheWriteTokens = toTokenCount(usage.cache_write_tokens ?? usage.cacheWriteTokens);
  const outputTokens = toTokenCount(usage.output_tokens);
  if (inputTokens === undefined || cachedInputTokens === undefined || outputTokens === undefined) {
    return undefined;
  }

  return {
    inputTokens,
    cachedInputTokens,
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    outputTokens,
    kind,
    cumulativeInputTokens: options.cumulative?.inputTokens,
    cumulativeCachedInputTokens: options.cumulative?.cachedInputTokens,
    ...(options.cumulative?.cacheWriteTokens !== undefined
      ? { cumulativeCacheWriteTokens: options.cumulative.cacheWriteTokens }
      : {}),
    cumulativeOutputTokens: options.cumulative?.outputTokens,
    codexThreadId: options.codexThreadId
  };
}

function parseTokenCountUsage(event: Record<string, unknown>, raw: Record<string, unknown> | undefined): RuntimeUsageSnapshot | undefined {
  const source = raw?.type === "token_count" ? raw : event;
  const info = asRecord(source.info);
  const codexThreadId = trimOrUndefined(typeof source.thread_id === "string" ? source.thread_id : undefined);
  const cumulative = parseUsageRecord(info?.total_token_usage, "cumulative_snapshot", { codexThreadId });
  const last = parseUsageRecord(info?.last_token_usage, "turn_delta", { codexThreadId });
  const modelContextWindow = toTokenCount(info?.model_context_window);
  const modelInvocation = last
    ? {
        inputTokens: last.inputTokens,
        cachedInputTokens: last.cachedInputTokens,
        ...(last.cacheWriteTokens !== undefined ? { cacheWriteTokens: last.cacheWriteTokens } : {}),
        outputTokens: last.outputTokens,
        ...(modelContextWindow !== undefined ? { modelContextWindow } : {})
      }
    : undefined;
  const selected = cumulative ?? last;
  if (!selected) return undefined;
  return {
    ...selected,
    ...(modelContextWindow !== undefined ? { modelContextWindow } : {}),
    ...(modelInvocation ? { modelInvocations: [modelInvocation] } : {})
  };
}

function cumulativeUsageKey(usage: RuntimeUsageSnapshot): string | undefined {
  if (usage.kind !== "cumulative_snapshot") return undefined;
  return [
    usage.codexThreadId ?? "",
    usage.inputTokens,
    usage.cachedInputTokens,
    usage.cacheWriteTokens ?? "",
    usage.outputTokens
  ].join(":");
}

function completedAgentMessageText(event: RuntimeStreamEvent): string | undefined {
  const raw = asRecord(event.raw);
  if (raw?.type !== "item.completed") return undefined;
  const item = asRecord(raw.item);
  if (item?.type !== "agent_message") return undefined;
  return typeof item.text === "string" ? item.text : "";
}

function textFromMessageLike(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  if (!record) return undefined;
  if (typeof record.text === "string") return record.text;
  if (typeof record.message === "string") return record.message;
  if (typeof record.content === "string") return record.content;
  if (Array.isArray(record.content)) {
    const text = record.content
      .map((item) => {
        if (typeof item === "string") return item;
        const part = asRecord(item);
        return typeof part?.text === "string" ? part.text : "";
      })
      .join("");
    return text || undefined;
  }
  return undefined;
}

function completedTurnFinalAnswerText(event: RuntimeStreamEvent): string | undefined {
  if (event.type !== "turn.completed") return undefined;
  const raw = asRecord(event.raw);
  const turn = asRecord(raw?.turn);
  const candidates = [
    raw?.last_agent_message,
    raw?.lastAgentMessage,
    raw?.lastAgentMessageText,
    raw?.final_answer,
    raw?.finalAnswer,
    turn?.last_agent_message,
    turn?.lastAgentMessage,
    turn?.lastAgentMessageText,
    turn?.final_answer,
    turn?.finalAnswer
  ];
  for (const candidate of candidates) {
    const text = textFromMessageLike(candidate);
    if (text !== undefined) return text;
  }
  return undefined;
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

  const usage = asRecord(raw?.usage ?? event.usage ?? asRecord(raw?.turn)?.usage);
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

export async function collectRuntimeCompletion(input: {
  events: AsyncIterable<RuntimeStreamEvent>;
  textMode?: RuntimeCompletionTextMode;
  signal?: AbortSignal;
  onEvent?(event: RuntimeStreamEvent): void | Promise<void>;
  onUsage?(usage: RuntimeUsageSnapshot, event: RuntimeStreamEvent): void | Promise<void>;
  onTextDelta?(delta: string, event: RuntimeStreamEvent): void | Promise<void>;
}): Promise<{ answer: string; usage?: RuntimeUsageSnapshot }> {
  let fallbackAnswer = "";
  let finalAgentAnswer: string | undefined;
  let latestUsage: RuntimeUsageSnapshot | undefined;
  const modelInvocations: RuntimeModelInvocationUsage[] = [];
  const seenCumulativeUsage = new Set<string>();
  const textMode = input.textMode ?? "append";
  const iterator = input.events[Symbol.asyncIterator]();

  try {
    while (true) {
      const next = await nextRuntimeEvent(iterator, input.signal);
      if (next.done) break;
      const event = next.value;
      const extractedUsage = extractRuntimeUsageFromStreamEvent(event);
      if (extractedUsage) {
        const usageKey = cumulativeUsageKey(extractedUsage);
        const shouldCaptureInvocations = !usageKey || !seenCumulativeUsage.has(usageKey);
        if (usageKey) seenCumulativeUsage.add(usageKey);
        if (shouldCaptureInvocations && extractedUsage.modelInvocations) {
          modelInvocations.push(...extractedUsage.modelInvocations);
        }
        const usage = {
          ...extractedUsage,
          ...(modelInvocations.length > 0 ? { modelInvocations: [...modelInvocations] } : {})
        };
        latestUsage = usage;
        await input.onUsage?.(usage, event);
      }
      const completedAgentText = completedAgentMessageText(event);
      const completedTurnText = completedTurnFinalAnswerText(event);
      if (completedAgentText !== undefined) {
        finalAgentAnswer = completedAgentText;
      } else if (completedTurnText !== undefined) {
        finalAgentAnswer = completedTurnText;
      } else if (event.delta) {
        fallbackAnswer += event.delta;
        await input.onTextDelta?.(event.delta, event);
      } else if (event.text) {
        if (textMode === "append" || !fallbackAnswer) {
          fallbackAnswer += event.text;
          await input.onTextDelta?.(event.text, event);
        }
      }
      await input.onEvent?.(event);
    }
  } catch (error) {
    await returnRuntimeIteratorBestEffort(iterator);
    throw error;
  }

  return {
    answer: finalAgentAnswer ?? fallbackAnswer,
    usage: latestUsage
  };
}

export async function streamRuntimeCompletionWithBestEffortUsage(input: {
  events: AsyncIterable<RuntimeStreamEvent>;
  signal?: AbortSignal;
  onEvent(event: RuntimeStreamEvent): void;
  onDone(payload: { answer: string; usage?: RuntimeUsageSnapshot }): void | Promise<void>;
  recordUsage?(usage: RuntimeUsageSnapshot, resultStatus?: "success" | "failed"): Promise<void>;
  onTelemetryError?(error: unknown): void;
}): Promise<void> {
  let latestUsage: RuntimeUsageSnapshot | undefined;
  let completion: { answer: string; usage?: RuntimeUsageSnapshot };

  try {
    completion = await collectRuntimeCompletion({
      events: input.events,
      signal: input.signal,
      onEvent: input.onEvent,
      onUsage(usage) {
        latestUsage = usage;
      }
    });
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

  await input.onDone(completion);

  if (completion.usage && input.recordUsage) {
    void Promise.resolve()
      .then(() => input.recordUsage?.(completion.usage!, "success"))
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
  delete next._agentStudioRuntimeHints;
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
