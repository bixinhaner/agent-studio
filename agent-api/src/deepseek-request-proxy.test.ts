import { randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  DEEPSEEK_PROXY_PATH,
  type ImageShrinkOptions,
  createDeepSeekProxyHandler,
  deepSeekProxyBaseUrl,
  shrinkResponsesRequestImages
} from "./deepseek-request-proxy.js";

const options: ImageShrinkOptions = {
  triggerBytes: 1024 * 1024,
  targetBytes: 800 * 1024,
  keepRecentImages: 2,
  minImageBytes: 16 * 1024,
  maxSide: 256,
  webpQuality: 70
};

// Noise does not compress, so each PNG is a few hundred KB like the renders agents look at.
const noisyPngs: string[] = [];
beforeAll(async () => {
  for (let index = 0; index < 4; index += 1) {
    const png = await sharp(randomBytes(400 * 300 * 3), { raw: { width: 400, height: 300, channels: 3 } }).png().toBuffer();
    noisyPngs.push(`data:image/png;base64,${png.toString("base64")}`);
  }
});
const noisyPng = () => noisyPngs[0];

function requestWithImages(count: number): Buffer {
  const input: unknown[] = [{ role: "user", content: [{ type: "input_text", text: "render the ads" }] }];
  for (let index = 0; index < count; index += 1) {
    input.push({ type: "function_call", call_id: `call_${index}`, name: "view_image", arguments: "{}" });
    input.push({
      type: "function_call_output",
      call_id: `call_${index}`,
      output: [{ type: "input_image", image_url: noisyPngs[index], detail: "high" }]
    });
  }
  return Buffer.from(JSON.stringify({ model: "deepseek-flash", stream: true, input }));
}

function imagesOf(body: Buffer): Array<Record<string, unknown>> {
  const payload = JSON.parse(body.toString("utf8")) as { input: Array<Record<string, unknown>> };
  return payload.input
    .filter((item) => item.type === "function_call_output")
    .map((item) => (item.output as Array<Record<string, unknown>>)[0]);
}

describe("shrinkResponsesRequestImages", () => {
  it("forwards bodies under the trigger byte for byte", async () => {
    const body = Buffer.from(JSON.stringify({ input: [{ type: "input_image", image_url: noisyPng() }] }));
    const result = await shrinkResponsesRequestImages(body, { ...options, triggerBytes: body.length });
    expect(result.changed).toBe(false);
    expect(result.body).toBe(body);
  });

  it("re-encodes older images, keeps the newest ones untouched and is deterministic", async () => {
    const body = requestWithImages(4);
    const before = imagesOf(body);
    const result = await shrinkResponsesRequestImages(body, { ...options, targetBytes: body.length });
    expect(result).toMatchObject({ changed: true, images: 4, reencoded: 2, omitted: 0 });
    expect(result.afterBytes).toBeLessThan(result.beforeBytes);
    const after = imagesOf(result.body);
    expect(after.slice(0, 2).map((image) => String(image.image_url).slice(0, 23))).toEqual(["data:image/webp;base64,", "data:image/webp;base64,"]);
    expect(after.slice(2)).toEqual(before.slice(2));
    expect(after[0].detail).toBe("high");
    const again = await shrinkResponsesRequestImages(body, { ...options, targetBytes: body.length });
    expect(again.body.equals(result.body)).toBe(true);
  });

  it("replaces the oldest images with a note only when re-encoding is not enough", async () => {
    const body = requestWithImages(4);
    const result = await shrinkResponsesRequestImages(body, { ...options, minImageBytes: Number.MAX_SAFE_INTEGER, targetBytes: body.length - 1 });
    expect(result).toMatchObject({ changed: true, reencoded: 0, omitted: 1 });
    const after = imagesOf(result.body);
    expect(after[0]).toEqual({ type: "input_text", text: expect.stringMatching(/^\[Image 1 of 4 \(image\/png, \d+ KB\) omitted/) });
    expect(after[1].type).toBe("input_image");
  });
});

describe("deepSeekProxyBaseUrl", () => {
  it("routes only DeepSeek HTTPS endpoints through the local proxy", () => {
    expect(deepSeekProxyBaseUrl("https://api.deepseek.com", 8791)).toBe(`http://127.0.0.1:8791${DEEPSEEK_PROXY_PATH}/api.deepseek.com`);
    expect(deepSeekProxyBaseUrl("https://api.deepseek.com/v1/", 8792)).toBe(`http://127.0.0.1:8792${DEEPSEEK_PROXY_PATH}/api.deepseek.com/v1`);
    expect(deepSeekProxyBaseUrl("https://example.com/v1", 8791)).toBeUndefined();
    expect(deepSeekProxyBaseUrl("https://deepseek.com.evil.example", 8791)).toBeUndefined();
    expect(deepSeekProxyBaseUrl("http://api.deepseek.com", 8791)).toBeUndefined();
  });
});

describe("createDeepSeekProxyHandler", () => {
  const servers: http.Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    })));
  });
  const listen = async (handler: http.RequestListener) => {
    const server = http.createServer(handler);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };

  async function setup(isLocal = true) {
    const seen: Array<{ method?: string; url?: string; authorization?: string; body: Buffer }> = [];
    const upstream = await listen((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body: Buffer.concat(chunks) });
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("event: response.created\ndata: {}\n\n");
        setTimeout(() => res.end("event: response.completed\ndata: {}\n\n"), 20);
      });
    });
    const logs: Array<Record<string, unknown>> = [];
    const app = express();
    const handler = createDeepSeekProxyHandler({
      isLocalRequest: () => isLocal,
      shrinkOptions: { ...options, targetBytes: 1 },
      upstreamBase: () => upstream,
      log: (entry) => logs.push(entry)
    });
    app.all(`${DEEPSEEK_PROXY_PATH}/:host`, express.raw({ type: () => true, limit: "64mb" }), handler);
    app.all(`${DEEPSEEK_PROXY_PATH}/:host/*`, express.raw({ type: () => true, limit: "64mb" }), handler);
    const proxy = await listen(app);
    return { proxy, seen, logs };
  }

  it("streams the upstream response and forwards the caller's key with a shrunk body", async () => {
    const { proxy, seen, logs } = await setup();
    const body = requestWithImages(4);
    const response = await fetch(`${proxy}${DEEPSEEK_PROXY_PATH}/api.deepseek.com/responses?x=1`, {
      method: "POST",
      headers: { authorization: "Bearer test-key", "content-type": "application/json" },
      body: new Uint8Array(body)
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(await response.text()).toBe("event: response.created\ndata: {}\n\nevent: response.completed\ndata: {}\n\n");
    expect(seen[0]).toMatchObject({ method: "POST", url: "/responses?x=1", authorization: "Bearer test-key" });
    expect(seen[0].body.length).toBeLessThan(body.length);
    expect(logs[0]).toMatchObject({ event: "deepseek_request_images_shrunk", images: 4 });

    const models = await fetch(`${proxy}${DEEPSEEK_PROXY_PATH}/api.deepseek.com/models`, { headers: { authorization: "Bearer test-key" } });
    expect(models.status).toBe(200);
    expect(seen[1]).toMatchObject({ method: "GET", url: "/models" });
  });

  it("refuses non-DeepSeek hosts and non-local callers", async () => {
    const local = await setup();
    expect((await fetch(`${local.proxy}${DEEPSEEK_PROXY_PATH}/example.com/responses`, { method: "POST", body: "{}" })).status).toBe(404);
    const remote = await setup(false);
    expect((await fetch(`${remote.proxy}${DEEPSEEK_PROXY_PATH}/api.deepseek.com/responses`, { method: "POST", body: "{}" })).status).toBe(404);
    expect(local.seen).toHaveLength(0);
    expect(remote.seen).toHaveLength(0);
  });
});
