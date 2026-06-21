import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";

import { createSseAbortLifecycle, initSSE, sendSSE } from "./sse.js";

function fakeHttpPair() {
  const req = new EventEmitter() as Request;
  const res = new EventEmitter() as Response;
  return { req, res };
}

describe("createSseAbortLifecycle", () => {
  it("aborts the runtime signal when the client aborts the request", () => {
    const { req, res } = fakeHttpPair();
    const lifecycle = createSseAbortLifecycle(req, res);

    req.emit("aborted");

    expect(lifecycle.signal.aborted).toBe(true);
    expect(lifecycle.disconnected).toBe(true);
    expect(lifecycle.reason).toBe("client_aborted");
  });

  it("does not abort after the stream is marked settled", () => {
    const { req, res } = fakeHttpPair();
    const lifecycle = createSseAbortLifecycle(req, res);

    lifecycle.markSettled();
    res.emit("close");

    expect(lifecycle.signal.aborted).toBe(false);
    expect(lifecycle.disconnected).toBe(false);
  });

  it("removes listeners when disposed", () => {
    const { req, res } = fakeHttpPair();
    const lifecycle = createSseAbortLifecycle(req, res);

    lifecycle.dispose();

    expect(req.listenerCount("aborted")).toBe(0);
    expect(res.listenerCount("close")).toBe(0);
  });
});

describe("SSE response helpers", () => {
  it("disables proxy buffering when initializing a stream", () => {
    const headers = new Map<string, string>();
    let statusCode = 0;
    let flushHeadersCalled = false;
    const res = {
      status(code: number) {
        statusCode = code;
      },
      setHeader(name: string, value: string) {
        headers.set(name, value);
      },
      flushHeaders() {
        flushHeadersCalled = true;
      }
    } as unknown as Response;

    initSSE(res);

    expect(statusCode).toBe(200);
    expect(headers.get("X-Accel-Buffering")).toBe("no");
    expect(flushHeadersCalled).toBe(true);
  });

  it("flushes each event frame when possible", () => {
    const writes: string[] = [];
    let flushCount = 0;
    const res = {
      write(chunk: string) {
        writes.push(chunk);
      },
      flush() {
        flushCount += 1;
      }
    } as unknown as Response & { flush: () => void };

    sendSSE(res, "delta", { text: "hello" });

    expect(writes.join("")).toBe('event: delta\ndata: {"text":"hello"}\n\n');
    expect(flushCount).toBe(1);
  });
});
