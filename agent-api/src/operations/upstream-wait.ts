/**
 * Codex retries a rejected model request itself (e.g. "Selected model is at capacity", 429)
 * and honours the server's retry delay, which can be several minutes. The app-server
 * announces each retry as an `error` notification with `willRetry: true`. Agent Studio
 * turns those into a text-free internal event so that:
 *  - background callers (Action Connector assistants / proactive scenarios) can stop
 *    counting the wait against their own time budget instead of cancelling the run;
 *  - usage metadata records the wait for admin analytics and conversation records.
 * The event carries no `text`/`delta`, so it never reaches answer text, and channel
 * projections ignore the unknown type. The portal stream filters it explicitly.
 */

export const UPSTREAM_WAIT_EVENT_TYPE = "agent_studio.upstream_wait";

export type UpstreamWaitNotice = {
  at: string;
  attempt?: number;
  maxAttempts?: number;
  /** Delay announced by the upstream error text, when it states one. */
  delayMs?: number;
  /** codexErrorInfo when present (e.g. serverOverloaded), otherwise a text-derived kind. */
  kind: string;
  message: string;
};

type EventLike = { type?: string; delta?: string; text?: string; raw?: unknown };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function codexErrorInfoKind(value: unknown): string | undefined {
  const text = str(value);
  if (text) return text;
  const record = asRecord(value);
  const key = record ? Object.keys(record)[0] : undefined;
  return key || undefined;
}

export function parseAnnouncedDelayMs(text: string): number | undefined {
  const match =
    /\b(?:try again|retry(?:ing)?(?: after)?|in)\s+(?:in\s+)?(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec(?:onds?)?|m|min(?:utes?)?)\b/i.exec(text) ??
    /\bin\s+(\d+)m(\d+(?:\.\d+)?)s\b/i.exec(text);
  if (!match) return undefined;
  if (match[2] && /^\d/.test(match[2])) {
    return Math.round((Number(match[1]) * 60 + Number(match[2])) * 1000);
  }
  const value = Number(match[1]);
  const unit = (match[2] ?? "s").toLowerCase();
  if (!Number.isFinite(value) || value < 0) return undefined;
  if (unit.startsWith("ms") || unit.startsWith("milli")) return Math.round(value);
  if (unit.startsWith("m")) return Math.round(value * 60_000);
  return Math.round(value * 1000);
}

function kindFromText(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("at capacity") || lower.includes("overloaded")) return "serverOverloaded";
  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("too many requests")) return "rateLimited";
  if (/\b5\d\d\b/.test(lower)) return "serverError";
  if (lower.includes("disconnected") || lower.includes("reconnecting")) return "streamDisconnected";
  return "unknown";
}

/** Builds a notice from an app-server `error` notification payload with `willRetry: true`. */
export function upstreamWaitNoticeFromAppServerError(params: Record<string, unknown>, now = new Date()): UpstreamWaitNotice {
  const error = asRecord(params.error);
  const message = str(params.message) ?? str(error?.message) ?? "Upstream model request is being retried";
  const details = str(error?.additionalDetails) ?? str(params.additionalDetails);
  const combined = details && details !== message ? `${message} (${details})` : message;
  const attemptMatch = /(\d+)\s*\/\s*(\d+)/.exec(combined);
  const delayMs = parseAnnouncedDelayMs(combined);
  return {
    at: now.toISOString(),
    ...(attemptMatch ? { attempt: Number(attemptMatch[1]), maxAttempts: Number(attemptMatch[2]) } : {}),
    ...(delayMs !== undefined ? { delayMs } : {}),
    kind: codexErrorInfoKind(error?.codexErrorInfo) ?? kindFromText(combined),
    message: combined.slice(0, 500)
  };
}

export function upstreamWaitEvent(notice: UpstreamWaitNotice): { type: string; raw: Record<string, unknown> } {
  return { type: UPSTREAM_WAIT_EVENT_TYPE, raw: { type: UPSTREAM_WAIT_EVENT_TYPE, ...notice } };
}

export function upstreamWaitNoticeFromEvent(event: EventLike | undefined): UpstreamWaitNotice | undefined {
  if (!event || event.type !== UPSTREAM_WAIT_EVENT_TYPE) return undefined;
  const raw = asRecord(event.raw);
  if (!raw) return undefined;
  const { type: _type, ...rest } = raw;
  return rest as unknown as UpstreamWaitNotice;
}

export type UpstreamWaitEntry = UpstreamWaitNotice & {
  /** When the next runtime event after the notice arrived (the wait ended). */
  resumedAt?: string;
  waitedMs?: number;
};

export type UpstreamWaitSummary = {
  count: number;
  /** Measured wait from notices to the next runtime event (open waits count until summary time). */
  totalWaitMs: number;
  kinds: string[];
  entries: UpstreamWaitEntry[];
};

const MAX_ENTRIES = 20;

/** Accumulates upstream waits over one turn (including Agent Studio-level retries). */
export class UpstreamWaitTracker {
  private readonly entries: UpstreamWaitEntry[] = [];
  private open: UpstreamWaitEntry | undefined;

  constructor(private readonly now: () => number = Date.now) {}

  /** Returns the notice when the event is an upstream wait. */
  observe(event: EventLike): UpstreamWaitNotice | undefined {
    const notice = upstreamWaitNoticeFromEvent(event);
    if (notice) {
      this.close();
      const entry: UpstreamWaitEntry = { ...notice };
      if (this.entries.length < MAX_ENTRIES) this.entries.push(entry);
      this.open = entry;
      return notice;
    }
    this.close();
    return undefined;
  }

  private close(at = this.now()) {
    if (!this.open) return;
    const started = Date.parse(this.open.at);
    this.open.resumedAt = new Date(at).toISOString();
    this.open.waitedMs = Number.isFinite(started) ? Math.max(0, at - started) : undefined;
    this.open = undefined;
  }

  summary(): UpstreamWaitSummary | undefined {
    if (this.entries.length === 0) return undefined;
    const at = this.now();
    let totalWaitMs = 0;
    for (const entry of this.entries) {
      if (entry.waitedMs !== undefined) totalWaitMs += entry.waitedMs;
      else {
        const started = Date.parse(entry.at);
        if (Number.isFinite(started)) totalWaitMs += Math.max(0, at - started);
      }
    }
    return {
      count: this.entries.length,
      totalWaitMs,
      kinds: [...new Set(this.entries.map((entry) => entry.kind))],
      entries: this.entries.map((entry) => ({ ...entry }))
    };
  }
}

/** Codex retries with the server's delay (observed ~5-6 min); assume that when unstated. */
export const DEFAULT_UPSTREAM_WAIT_MS = 6 * 60_000;
const WAIT_GRACE_MS = 30_000;

/**
 * A run deadline that does not count announced upstream waits against the run's budget.
 * Each notice pushes the deadline out by the announced (or default) wait plus a grace,
 * bounded by `maxExtensionMs` in total so a stuck upstream still ends the run.
 */
export function createUpstreamWaitDeadline(input: {
  budgetMs: number;
  maxExtensionMs: number;
  onExtend?: (deadlineAtMs: number) => void;
  now?: () => number;
}) {
  const now = input.now ?? Date.now;
  const controller = new AbortController();
  const startedAt = now();
  const hardDeadline = startedAt + input.budgetMs + input.maxExtensionMs;
  let deadlineAt = startedAt + input.budgetMs;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = () => {
    if (timer) clearTimeout(timer);
    if (controller.signal.aborted) return;
    timer = setTimeout(() => {
      controller.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    }, Math.max(0, deadlineAt - now()));
    timer.unref?.();
  };
  schedule();

  return {
    signal: controller.signal,
    get deadlineAt() {
      return deadlineAt;
    },
    get extendedMs() {
      return deadlineAt - (startedAt + input.budgetMs);
    },
    onUpstreamWait(notice: Pick<UpstreamWaitNotice, "delayMs">) {
      if (controller.signal.aborted) return;
      const next = Math.min(hardDeadline, deadlineAt + (notice.delayMs ?? DEFAULT_UPSTREAM_WAIT_MS) + WAIT_GRACE_MS);
      if (next <= deadlineAt) return;
      deadlineAt = next;
      schedule();
      input.onExtend?.(deadlineAt);
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = undefined;
    }
  };
}

/** Usage metadata fragment (`upstreamWaits`) read by admin analytics and conversation records. */
export function upstreamWaitUsageMetadata(tracker: UpstreamWaitTracker): { upstreamWaits?: UpstreamWaitSummary } {
  const summary = tracker.summary();
  return summary ? { upstreamWaits: summary } : {};
}

/** Codex gives up after 5 retries; at ~6 min each that is ~30 min of waiting at most. */
export const UPSTREAM_WAIT_MAX_EXTENSION_MS = 35 * 60_000;
