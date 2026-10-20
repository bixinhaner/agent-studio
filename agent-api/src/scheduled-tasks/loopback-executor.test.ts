import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { createHostHeaderFetch, createLoopbackScheduledTurnExecutor, readSseEvents } from "./loopback-executor.js";

let server: http.Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

async function listen(handler: http.RequestListener): Promise<string> {
  server = http.createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

describe("createHostHeaderFetch", () => {
  it("sends the brand Host header and exposes JSON bodies", async () => {
    const base = await listen((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ host: req.headers.host, cookie: req.headers.cookie, body: JSON.parse(body) }));
      });
    });
    const response = await createHostHeaderFetch("brand.example.com")(`${base}/api/x`, {
      method: "POST",
      headers: { cookie: "s=1", "content-type": "application/json" },
      body: JSON.stringify({ ok: true })
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ host: "brand.example.com", cookie: "s=1", body: { ok: true } });
  });

  it("streams server-sent events", async () => {
    const base = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('event: delta\ndata: {"t":"a"}\n\n');
      setTimeout(() => res.end('event: done\ndata: {"answer":"ok"}\n\n'), 10);
    });
    const response = await createHostHeaderFetch("brand.example.com")(`${base}/stream`, { method: "GET", headers: {} });
    const events = [];
    for await (const event of readSseEvents(response.body!)) events.push(event);
    expect(events).toEqual([
      { event: "delta", data: { t: "a" } },
      { event: "done", data: { answer: "ok" } }
    ]);
  });
});

function sseResponse(events: Array<[string, unknown]>): Response {
  const text = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function scheduledInput() {
  return {
    userId: "user-1",
    organizationId: "org-1",
    title: "Daily report",
    prompt: "Summarize today",
    folderId: "folder-1",
    modeId: "mode-1",
    locale: "zh-CN" as const
  };
}

describe("createLoopbackScheduledTurnExecutor", () => {
  it("creates the task, saves the message and runs it with one stream request", async () => {
    const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
    const fetchImpl = (async (url: string, init: { method: string; body?: string }) => {
      calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
      if (url.endsWith("/api/chat/stream")) {
        return sseResponse([
          ["accepted", { thread_id: "server-thread", duplicate: false }],
          ["session", { session_id: "s-1" }],
          ["done", { answer: "ok" }]
        ]);
      }
      if (url.endsWith("/messages")) {
        return Response.json({ messages: [{ message: { role: "assistant", content: [{ type: "text", text: "Report ready" }] } }] });
      }
      return Response.json({ artifacts: [{ id: "a-1" }] });
    }) as unknown as typeof fetch;

    const result = await createLoopbackScheduledTurnExecutor({
      baseUrl: "http://api",
      createSessionCookie: () => "s=1",
      fetchImpl
    })(scheduledInput());

    expect(result).toEqual({ threadId: "server-thread", status: "succeeded", answerText: "Report ready", artifactCount: 1 });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "POST http://api/api/chat/stream",
      "GET http://api/api/threads/server-thread/messages",
      "GET http://api/api/threads/server-thread/artifacts"
    ]);
    const body = calls[0]!.body!;
    expect(body.session_id).toBeUndefined();
    expect(body.thread_id).toBeUndefined();
    expect(body.new_thread).toMatchObject({
      title: "Daily report",
      folder_id: "folder-1",
      codex_run_config: { mode: "mode-1" }
    });
    expect((body.new_thread as { id: string }).id).toMatch(/^[a-f0-9]{32}$/);
    expect(body.message).toBe("Summarize today");
    expect(body.user_message_id).toBe(body.client_user_message_id);
  });

  it("fails without a task when the send is not accepted", async () => {
    const fetchImpl = (async () => sseResponse([["error", { detail: "No agent mode available" }]])) as unknown as typeof fetch;
    const result = await createLoopbackScheduledTurnExecutor({
      baseUrl: "http://api",
      createSessionCookie: () => "s=1",
      fetchImpl
    })(scheduledInput());
    expect(result).toEqual({ threadId: undefined, status: "failed", artifactCount: 0, error: "No agent mode available" });
  });
});
