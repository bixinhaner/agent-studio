import type { Request, Response } from "express";

export function initSSE(res: Response): void {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
}

export function sendSSE(res: Response, event: string, payload: unknown): boolean {
  if (res.writableEnded || (res as Response & { destroyed?: boolean }).destroyed) {
    return false;
  }
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  (res as Response & { flush?: () => void }).flush?.();
  return true;
}

export type SseAbortLifecycleSnapshot = {
  openedAt: string;
  closedAt?: string;
  settledAt?: string;
  disconnected: boolean;
  reason?: string;
  lastEventName?: string;
  lastEventAt?: string;
  durationMs: number;
};

export type SseAbortLifecycle = {
  signal: AbortSignal;
  readonly openedAt: Date;
  readonly closedAt: Date | undefined;
  readonly settledAt: Date | undefined;
  readonly disconnected: boolean;
  readonly reason: string | undefined;
  readonly lastEventName: string | undefined;
  readonly lastEventAt: Date | undefined;
  recordSentEvent(eventName: string): void;
  markSettled(): void;
  snapshot(): SseAbortLifecycleSnapshot;
  dispose(): void;
};

export function createSseAbortLifecycle(req: Request, res: Response): SseAbortLifecycle {
  const controller = new AbortController();
  const openedAt = new Date();
  let settled = false;
  let closedAt: Date | undefined;
  let settledAt: Date | undefined;
  let disconnected = false;
  let reason: string | undefined;
  let lastEventName: string | undefined;
  let lastEventAt: Date | undefined;

  const abortRuntimeTurn = (nextReason: string) => {
    if (settled || controller.signal.aborted) return;
    disconnected = true;
    reason = nextReason;
    closedAt = closedAt ?? new Date();
    controller.abort(new Error(nextReason));
  };
  const onRequestAborted = () => abortRuntimeTurn("client_aborted");
  const onResponseClosed = () => {
    closedAt = closedAt ?? new Date();
    if (!settled) abortRuntimeTurn("connection_closed");
  };

  req.once("aborted", onRequestAborted);
  res.once("close", onResponseClosed);

  return {
    signal: controller.signal,
    openedAt,
    get closedAt() {
      return closedAt;
    },
    get settledAt() {
      return settledAt;
    },
    get disconnected() {
      return disconnected;
    },
    get reason() {
      return reason;
    },
    get lastEventName() {
      return lastEventName;
    },
    get lastEventAt() {
      return lastEventAt;
    },
    recordSentEvent(eventName: string) {
      lastEventName = eventName;
      lastEventAt = new Date();
    },
    markSettled() {
      settledAt = settledAt ?? new Date();
      settled = true;
    },
    snapshot() {
      const endedAt = closedAt ?? new Date();
      return {
        openedAt: openedAt.toISOString(),
        ...(closedAt ? { closedAt: closedAt.toISOString() } : {}),
        ...(settledAt ? { settledAt: settledAt.toISOString() } : {}),
        disconnected,
        ...(reason ? { reason } : {}),
        ...(lastEventName ? { lastEventName } : {}),
        ...(lastEventAt ? { lastEventAt: lastEventAt.toISOString() } : {}),
        durationMs: Math.max(0, endedAt.getTime() - openedAt.getTime())
      };
    },
    dispose() {
      req.removeListener("aborted", onRequestAborted);
      res.removeListener("close", onResponseClosed);
    }
  };
}
