import { describe, expect, it, vi } from "vitest";

import {
  isRetryablePortalSendError,
  PortalSendNotDeliveredError,
  streamPortalSendWithRetry,
  type PortalStreamEvent
} from "./portal-send-transport";

async function* events(items: PortalStreamEvent[], failWith?: unknown): AsyncGenerator<PortalStreamEvent> {
  for (const item of items) yield item;
  if (failWith) throw failWith;
}

async function collect(stream: AsyncGenerator<PortalStreamEvent, unknown>) {
  const seen: string[] = [];
  let result: unknown;
  while (true) {
    const next = await stream.next();
    if (next.done) {
      result = next.value;
      break;
    }
    seen.push(next.value.event);
  }
  return { seen, result };
}

const noWait = vi.fn(async () => undefined);

describe("streamPortalSendWithRetry", () => {
  it("retries a send that never reached the server and reports the attempts once delivered", async () => {
    const attempts = [
      () => events([], new TypeError("Failed to fetch")),
      () => events([], new Error("SSE request failed (502)")),
      () => events([{ event: "accepted", data: {} }, { event: "done", data: {} }])
    ];
    let call = 0;
    const onRetry = vi.fn();
    const onDelivered = vi.fn();
    const { seen, result } = await collect(
      streamPortalSendWithRetry({
        open: () => attempts[call++](),
        signal: new AbortController().signal,
        wait: noWait,
        onRetry,
        onDelivered
      })
    );
    expect(seen).toEqual(["accepted", "done"]);
    expect(call).toBe(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onDelivered).toHaveBeenCalledWith(expect.objectContaining({ attempts: 3 }));
    expect(result).toMatchObject({ attempts: 3 });
  });

  it("treats a connection closed before acceptance as not delivered", async () => {
    let call = 0;
    const { seen } = await collect(
      streamPortalSendWithRetry({
        open: () => (call++ === 0 ? events([{ event: "ping", data: {} }]) : events([{ event: "accepted", data: {} }])),
        signal: new AbortController().signal,
        wait: noWait
      })
    );
    expect(call).toBe(2);
    expect(seen).toEqual(["ping", "accepted"]);
  });

  it("never retries once the server accepted the message", async () => {
    const open = vi.fn(() => events([{ event: "accepted", data: {} }], new TypeError("network error")));
    await expect(
      collect(streamPortalSendWithRetry({ open, signal: new AbortController().signal, wait: noWait }))
    ).rejects.toThrow("network error");
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("does not retry the server's own answer, such as an error event", async () => {
    const open = vi.fn(() => events([{ event: "error", data: { code: "QUOTA_LIMIT_REACHED" } }]));
    const { seen } = await collect(streamPortalSendWithRetry({ open, signal: new AbortController().signal, wait: noWait }));
    expect(seen).toEqual(["error"]);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("does not retry an authentication failure", async () => {
    const open = vi.fn(() => events([], new Error("SSE request failed (401)")));
    await expect(
      collect(streamPortalSendWithRetry({ open, signal: new AbortController().signal, wait: noWait }))
    ).rejects.toThrow("SSE request failed (401)");
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("gives up after the configured retries with a not-delivered error", async () => {
    const open = vi.fn(() => events([], new TypeError("Failed to fetch")));
    const failure = await collect(
      streamPortalSendWithRetry({ open, signal: new AbortController().signal, wait: noWait, delaysMs: [1, 2, 4] })
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PortalSendNotDeliveredError);
    expect((failure as PortalSendNotDeliveredError).attempts).toBe(4);
    expect(open).toHaveBeenCalledTimes(4);
  });

  it("stops retrying when the user stops the send", async () => {
    const controller = new AbortController();
    const open = vi.fn(() => events([], new TypeError("Failed to fetch")));
    const { result } = await collect(
      streamPortalSendWithRetry({
        open,
        signal: controller.signal,
        wait: async () => controller.abort()
      })
    );
    expect(open).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ attempts: 1 });
  });
});

describe("isRetryablePortalSendError", () => {
  it("retries transport and gateway failures only", () => {
    expect(isRetryablePortalSendError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isRetryablePortalSendError(new TypeError("Load failed"))).toBe(true);
    expect(isRetryablePortalSendError(new Error("SSE request failed (504)"))).toBe(true);
    expect(isRetryablePortalSendError(new Error("SSE request failed (429)"))).toBe(true);
    expect(isRetryablePortalSendError(new Error("SSE request failed (403)"))).toBe(false);
    expect(isRetryablePortalSendError(new Error("SSE request failed (413)"))).toBe(false);
  });
});
