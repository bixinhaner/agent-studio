/**
 * Upstream model errors that clear up on their own. Codex already retries these internally, but its
 * retries are back-to-back (the 10-25 429s exhausted them in under a second), so Agent Studio adds a
 * slower second tier: wait, then run the turn again.
 *
 * Quota exhaustion is not transient here: retrying within seconds only burns attempts, and compaction
 * would not help either because the request size is not the cause.
 */
export type UpstreamTransientErrorKind = "rate_limited" | "overloaded" | "server_error";

/** Delays before each extra attempt; the turn runs at most 1 + this many times. */
export const UPSTREAM_RETRY_DELAYS_MS = [10_000, 30_000] as const;

const QUOTA_EXHAUSTED_PATTERN = /usage[ _-]?limit|usageLimitExceeded|insufficient[_ ]quota|quota (?:exceeded|exhausted)/i;
const RATE_LIMITED_PATTERN = /last status:\s*429\b|429 Too Many Requests|responseTooManyFailedAttempts[^]*?429|rate[ _-]?limit(?:ed)?\b/i;
const OVERLOADED_PATTERN = /serverOverloaded|model is at capacity|server(?: is)? overloaded/i;
const SERVER_ERROR_PATTERN = /last status:\s*5\d\d\b/i;

function errorTexts(error: unknown): string[] {
  const texts: string[] = [];
  const visited = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && !visited.has(current); depth += 1) {
    visited.add(current);
    if (current instanceof Error) {
      texts.push(current.message);
      current = current.cause;
      continue;
    }
    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      if (typeof record.message === "string") texts.push(record.message);
      current = record.cause;
      continue;
    }
    texts.push(String(current));
    break;
  }
  return texts;
}

export function classifyUpstreamTransientError(error: unknown): UpstreamTransientErrorKind | undefined {
  const text = errorTexts(error).join("\n");
  if (!text || QUOTA_EXHAUSTED_PATTERN.test(text)) return undefined;
  if (RATE_LIMITED_PATTERN.test(text)) return "rate_limited";
  if (OVERLOADED_PATTERN.test(text)) return "overloaded";
  if (SERVER_ERROR_PATTERN.test(text)) return "server_error";
  return undefined;
}

/** Resolves true after `ms`, or false as soon as any signal aborts. */
export function waitUnlessAborted(ms: number, signals: Array<AbortSignal | undefined>): Promise<boolean> {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (active.some((signal) => signal.aborted)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const finish = (completed: boolean) => {
      clearTimeout(timer);
      for (const signal of active) signal.removeEventListener("abort", onAbort);
      resolve(completed);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(true), ms);
    for (const signal of active) signal.addEventListener("abort", onAbort, { once: true });
  });
}
