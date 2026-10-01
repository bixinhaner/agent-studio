import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { createHostHeaderFetch, readSseEvents } from "./loopback-executor.js";

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
