import type { ReasoningEffort } from "./model-config.js";

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
