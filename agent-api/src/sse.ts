import type { Request, Response } from "express";

export function initSSE(res: Response): void {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}

export function sendSSE(res: Response, event: string, payload: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export type SseAbortLifecycle = {
  signal: AbortSignal;
  readonly disconnected: boolean;
  readonly reason: string | undefined;
  markSettled(): void;
  dispose(): void;
};

export function createSseAbortLifecycle(req: Request, res: Response): SseAbortLifecycle {
  const controller = new AbortController();
  let settled = false;
  let disconnected = false;
  let reason: string | undefined;

  const abortRuntimeTurn = (nextReason: string) => {
    if (settled || controller.signal.aborted) return;
    disconnected = true;
    reason = nextReason;
    controller.abort(new Error(nextReason));
  };
  const onRequestAborted = () => abortRuntimeTurn("client_aborted");
  const onResponseClosed = () => {
    if (!settled) abortRuntimeTurn("connection_closed");
  };

  req.once("aborted", onRequestAborted);
  res.once("close", onResponseClosed);

  return {
    signal: controller.signal,
    get disconnected() {
      return disconnected;
    },
    get reason() {
      return reason;
    },
    markSettled() {
      settled = true;
    },
    dispose() {
      req.removeListener("aborted", onRequestAborted);
      res.removeListener("close", onResponseClosed);
    }
  };
}
