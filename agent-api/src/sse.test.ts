import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";

import { createSseAbortLifecycle } from "./sse.js";

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
