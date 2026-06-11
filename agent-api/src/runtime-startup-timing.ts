import { performance } from "node:perf_hooks";

export type RuntimeStartupTimingContext = {
  traceId: string;
  source: string;
  operation: string;
  route?: string;
  threadId?: string;
  sessionId?: string;
  organizationType?: string;
  model?: string;
};

export type RuntimeStartupTimingOptions = {
  successEnabled: boolean;
  slowMs: number;
  sampleRate: number;
  logErrors: boolean;
  random: () => number;
};

type RuntimeStartupTimingEnv = Partial<
  Record<
    | "RUNTIME_STARTUP_TIMING_ENABLED"
    | "RUNTIME_STARTUP_TIMING_SLOW_MS"
    | "RUNTIME_STARTUP_TIMING_SAMPLE_RATE"
    | "RUNTIME_STARTUP_TIMING_LOG_ERRORS",
    string | undefined
  >
>;

type TimingMetadata = Record<string, unknown>;

type RuntimeStartupTimingStep = {
  name: string;
  atMs: number;
  durationMs?: number;
  metadata?: TimingMetadata;
};

const DEFAULT_SLOW_MS = 1000;
const CHAT_STARTUP_STEP_NAME = "chat_stream.first_codex_event";

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function parseSampleRate(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  if (parsed >= 1) return 1;
  return parsed;
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function sanitizeMetadataValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > 240 ? `${value.slice(0, 240)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    if (depth > 1) return `[array:${value.length}]`;
    return value.slice(0, 12).map((item) => sanitizeMetadataValue(item, depth + 1));
  }
  if (typeof value === "object") {
    if (depth > 1) return "[object]";
    const output: TimingMetadata = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 16)) {
      output[key] = sanitizeMetadataValue(item, depth + 1);
    }
    return output;
  }
  return String(value);
}

function sanitizeMetadata(metadata: TimingMetadata | undefined): TimingMetadata | undefined {
  if (!metadata) return undefined;
  const output: TimingMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    output[key] = sanitizeMetadataValue(value);
  }
  return output;
}

export function resolveRuntimeStartupTimingOptions(
  env: RuntimeStartupTimingEnv = process.env
): RuntimeStartupTimingOptions {
  return {
    successEnabled: parseBoolean(env.RUNTIME_STARTUP_TIMING_ENABLED, true),
    slowMs: parsePositiveNumber(env.RUNTIME_STARTUP_TIMING_SLOW_MS, DEFAULT_SLOW_MS),
    sampleRate: parseSampleRate(env.RUNTIME_STARTUP_TIMING_SAMPLE_RATE),
    logErrors: parseBoolean(env.RUNTIME_STARTUP_TIMING_LOG_ERRORS, true),
    random: Math.random
  };
}

export class RuntimeStartupTimer {
  private readonly startedAt = performance.now();
  private readonly steps: RuntimeStartupTimingStep[] = [];
  private context: RuntimeStartupTimingContext;
  private readonly options: RuntimeStartupTimingOptions;

  constructor(context: RuntimeStartupTimingContext, options: RuntimeStartupTimingOptions = resolveRuntimeStartupTimingOptions()) {
    this.context = context;
    this.options = options;
  }

  updateContext(context: Partial<RuntimeStartupTimingContext>): void {
    this.context = {
      ...this.context,
      ...Object.fromEntries(
        Object.entries(context).filter(([, value]) => {
          if (typeof value === "string") return Boolean(value.trim());
          return value !== undefined && value !== null;
        })
      )
    };
  }

  mark(name: string, metadata?: TimingMetadata): void {
    this.steps.push({
      name,
      atMs: roundMs(performance.now() - this.startedAt),
      metadata: sanitizeMetadata(metadata)
    });
  }

  async time<T>(name: string, action: () => Promise<T>, metadata?: TimingMetadata): Promise<T> {
    const startedAt = performance.now();
    try {
      const result = await action();
      this.steps.push({
        name,
        atMs: roundMs(startedAt - this.startedAt),
        durationMs: roundMs(performance.now() - startedAt),
        metadata: sanitizeMetadata(metadata)
      });
      return result;
    } catch (error) {
      this.steps.push({
        name,
        atMs: roundMs(startedAt - this.startedAt),
        durationMs: roundMs(performance.now() - startedAt),
        metadata: sanitizeMetadata({
          ...(metadata ?? {}),
          failed: true,
          error: error instanceof Error ? error.message : String(error)
        })
      });
      throw error;
    }
  }

  finish(status: "success" | "error", metadata?: TimingMetadata): void {
    const totalMs = roundMs(performance.now() - this.startedAt);
    const startupMs = this.startupMs(totalMs);
    const logReason = this.resolveLogReason(status, startupMs);
    if (!logReason) return;
    const payload = {
      event: "agent_studio_runtime_startup_timing",
      trace_id: this.context.traceId,
      source: this.context.source,
      operation: this.context.operation,
      route: trimOrUndefined(this.context.route),
      status,
      total_ms: totalMs,
      startup_ms: startupMs,
      log_reason: logReason,
      thread_id: trimOrUndefined(this.context.threadId),
      session_id: trimOrUndefined(this.context.sessionId),
      organization_type: trimOrUndefined(this.context.organizationType),
      model: trimOrUndefined(this.context.model),
      metadata: sanitizeMetadata(metadata),
      steps: this.steps
    };
    console.info(JSON.stringify(payload));
  }

  private startupMs(totalMs: number): number {
    const firstCodexEvent = this.steps.find((step) => step.name === CHAT_STARTUP_STEP_NAME);
    return firstCodexEvent?.atMs ?? totalMs;
  }

  private resolveLogReason(status: "success" | "error", startupMs: number): "error" | "sampled" | "slow_startup" | undefined {
    if (status === "error") {
      return this.options.logErrors ? "error" : undefined;
    }
    if (!this.options.successEnabled) return undefined;
    if (this.options.sampleRate > 0 && this.options.random() < this.options.sampleRate) {
      return "sampled";
    }
    if (startupMs >= this.options.slowMs) {
      return "slow_startup";
    }
    return undefined;
  }
}

export function createRuntimeStartupTimer(
  context: RuntimeStartupTimingContext,
  options?: RuntimeStartupTimingOptions
): RuntimeStartupTimer {
  return new RuntimeStartupTimer(context, options);
}
