import { isPortalTransportDisconnect } from "./background-run-recovery";

/**
 * One send is one request. Until the server answers with `accepted` the message may not have
 * arrived, so a dropped connection is retried with the same run id (the server ignores a run id
 * it already accepted). After `accepted`, a dropped connection is followed by background
 * recovery instead, because the answer is already being produced.
 */

export type PortalStreamEvent = { event: string; data: unknown };

export const PORTAL_SEND_RETRY_DELAYS_MS = [1000, 2000, 4000];

export class PortalSendNotDeliveredError extends Error {
  readonly attempts: number;
  readonly lastError: unknown;

  constructor(attempts: number, lastError: unknown) {
    super("portal_send_not_delivered");
    this.name = "PortalSendNotDeliveredError";
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

/** Errors that mean the request may never have reached the server (never a server's own answer). */
export function isRetryablePortalSendError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  const status = /SSE request failed \((\d+)\)/.exec(message);
  if (status) {
    const code = Number(status[1]);
    return code === 0 || code === 408 || code === 429 || code >= 500;
  }
  return isPortalTransportDisconnect(error);
}

function waitWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

export type PortalSendAttemptResult = {
  /** Requests made, including the one that got through. */
  attempts: number;
  /** The transport error of the last failed attempt, when a retry was needed. */
  lastError?: unknown;
};

export async function* streamPortalSendWithRetry(options: {
  open: () => AsyncIterable<PortalStreamEvent>;
  signal: AbortSignal;
  delaysMs?: number[];
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  onRetry?: (nextAttempt: number, error: unknown) => void;
  /** Called once the server has the message (or the stream already carries its answer). */
  onDelivered?: (result: PortalSendAttemptResult) => void;
}): AsyncGenerator<PortalStreamEvent, PortalSendAttemptResult> {
  const delays = options.delaysMs ?? PORTAL_SEND_RETRY_DELAYS_MS;
  const wait = options.wait ?? waitWithSignal;
  let lastError: unknown;
  for (let attempt = 1; ; attempt += 1) {
    let delivered = false;
    let failure: unknown;
    try {
      for await (const item of options.open()) {
        // The first event (normally `accepted`) proves the request arrived.
        if (!delivered && item.event !== "ping") {
          delivered = true;
          options.onDelivered?.({ attempts: attempt, lastError });
        }
        yield item;
      }
      if (delivered || options.signal.aborted) return { attempts: attempt, lastError };
      failure = new Error("connection closed before the send was accepted");
    } catch (error) {
      if (delivered || options.signal.aborted || !isRetryablePortalSendError(error)) throw error;
      failure = error;
    }
    lastError = failure;
    if (attempt > delays.length) throw new PortalSendNotDeliveredError(attempt, failure);
    options.onRetry?.(attempt + 1, failure);
    await wait(delays[attempt - 1], options.signal);
    if (options.signal.aborted) return { attempts: attempt, lastError };
  }
}
