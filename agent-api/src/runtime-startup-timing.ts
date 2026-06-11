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

type TimingMetadata = Record<string, unknown>;

type RuntimeStartupTimingStep = {
  name: string;
  atMs: number;
  durationMs?: number;
  metadata?: TimingMetadata;
};

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

export class RuntimeStartupTimer {
  private readonly startedAt = performance.now();
  private readonly steps: RuntimeStartupTimingStep[] = [];
  private context: RuntimeStartupTimingContext;

  constructor(context: RuntimeStartupTimingContext) {
    this.context = context;
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
    const payload = {
      event: "agent_studio_runtime_startup_timing",
      trace_id: this.context.traceId,
      source: this.context.source,
      operation: this.context.operation,
      route: trimOrUndefined(this.context.route),
      status,
      total_ms: roundMs(performance.now() - this.startedAt),
      thread_id: trimOrUndefined(this.context.threadId),
      session_id: trimOrUndefined(this.context.sessionId),
      organization_type: trimOrUndefined(this.context.organizationType),
      model: trimOrUndefined(this.context.model),
      metadata: sanitizeMetadata(metadata),
      steps: this.steps
    };
    console.info(JSON.stringify(payload));
  }
}

export function createRuntimeStartupTimer(context: RuntimeStartupTimingContext): RuntimeStartupTimer {
  return new RuntimeStartupTimer(context);
}
