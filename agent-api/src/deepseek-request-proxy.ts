import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";
import sharp from "sharp";
import type { Request, Response } from "express";

/**
 * Codex keeps every `view_image` result in the thread history as an inline base64 data URL and
 * resends the whole history on each request. Images cost few tokens but many bytes, so token-based
 * compaction never notices, and an image-heavy thread eventually exceeds DeepSeek's request body
 * limit (about 48 MiB). From then on every turn fails with 413 and the thread cannot recover
 * (openai/codex#41338, #30441). Codex app-servers therefore reach DeepSeek through this local proxy.
 * It forwards requests unchanged until the body nears the limit, then re-encodes older images and,
 * only if that is not enough, replaces the oldest ones with a short note. The thread history on disk
 * is never touched; only the copy sent upstream shrinks.
 */
export const DEEPSEEK_PROXY_PATH = "/internal/deepseek-proxy";

export type ImageShrinkOptions = {
  /** Bodies at or below this size are forwarded untouched. */
  triggerBytes: number;
  /** Size the shrunk body aims for, leaving room for the turn to grow. */
  targetBytes: number;
  /** The newest images are what the model is working on; they are sent as they are. */
  keepRecentImages: number;
  /** Older images smaller than this are not worth re-encoding. */
  minImageBytes: number;
  maxSide: number;
  webpQuality: number;
};

export const DEFAULT_IMAGE_SHRINK_OPTIONS: ImageShrinkOptions = {
  triggerBytes: 32 * 1024 * 1024,
  targetBytes: 24 * 1024 * 1024,
  keepRecentImages: 4,
  minImageBytes: 256 * 1024,
  maxSide: 1280,
  webpQuality: 80
};

export type ImageShrinkResult = {
  body: Buffer;
  changed: boolean;
  beforeBytes: number;
  afterBytes: number;
  images: number;
  reencoded: number;
  omitted: number;
};

type ImageRef = { holder: Record<string, unknown>; url: string };

const DATA_URL_PATTERN = /^data:(image\/[\w.+-]+);base64,/i;

function collectImages(value: unknown, out: ImageRef[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectImages(item, out);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (record.type === "input_image" && typeof record.image_url === "string" && DATA_URL_PATTERN.test(record.image_url)) {
    out.push({ holder: record, url: record.image_url });
    return;
  }
  for (const child of Object.values(record)) collectImages(child, out);
}

// Same image, same bytes: re-encoding is deterministic per image, so repeated requests keep an
// identical prefix (DeepSeek prompt cache) and only pay the encode once.
const reencodeCache = new Map<string, string>();
const REENCODE_CACHE_LIMIT = 500;

async function reencode(url: string, options: ImageShrinkOptions): Promise<string | undefined> {
  const key = createHash("sha256").update(url).update(`${options.maxSide}:${options.webpQuality}`).digest("hex");
  const cached = reencodeCache.get(key);
  if (cached) return cached;
  try {
    const input = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    const output = await sharp(input, { failOn: "none" })
      .rotate()
      .resize({ width: options.maxSide, height: options.maxSide, fit: "inside", withoutEnlargement: true })
      .webp({ quality: options.webpQuality })
      .toBuffer();
    const next = `data:image/webp;base64,${output.toString("base64")}`;
    if (next.length >= url.length) return undefined;
    if (reencodeCache.size >= REENCODE_CACHE_LIMIT) reencodeCache.delete(reencodeCache.keys().next().value as string);
    reencodeCache.set(key, next);
    return next;
  } catch {
    return undefined;
  }
}

function omittedImageNote(index: number, total: number, url: string): string {
  const mediaType = DATA_URL_PATTERN.exec(url)?.[1] ?? "image";
  const sizeKb = Math.round((url.length * 3) / 4 / 1024);
  return `[Image ${index + 1} of ${total} (${mediaType}, ${sizeKb} KB) omitted from this request to stay under the provider's request size limit. View the file again if it is still needed.]`;
}

export async function shrinkResponsesRequestImages(
  body: Buffer,
  options: ImageShrinkOptions = DEFAULT_IMAGE_SHRINK_OPTIONS
): Promise<ImageShrinkResult> {
  const unchanged = (images = 0): ImageShrinkResult => ({
    body, changed: false, beforeBytes: body.length, afterBytes: body.length, images, reencoded: 0, omitted: 0
  });
  if (body.length <= options.triggerBytes) return unchanged();
  let payload: unknown;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    return unchanged();
  }
  const images: ImageRef[] = [];
  collectImages(payload, images);
  const older = images.slice(0, Math.max(0, images.length - options.keepRecentImages));
  if (older.length === 0) return unchanged(images.length);

  let size = body.length;
  let reencoded = 0;
  for (const image of older) {
    if (image.url.length < options.minImageBytes) continue;
    const next = await reencode(image.url, options);
    if (!next) continue;
    image.holder.image_url = next;
    size -= image.url.length - next.length;
    reencoded += 1;
  }

  let omitted = 0;
  for (const [index, image] of older.entries()) {
    if (size <= options.targetBytes) break;
    const current = image.holder.image_url as string;
    const note = omittedImageNote(index, images.length, image.url);
    for (const key of Object.keys(image.holder)) delete image.holder[key];
    image.holder.type = "input_text";
    image.holder.text = note;
    size -= current.length - note.length;
    omitted += 1;
  }

  if (reencoded === 0 && omitted === 0) return unchanged(images.length);
  const next = Buffer.from(JSON.stringify(payload), "utf8");
  return {
    body: next, changed: true, beforeBytes: body.length, afterBytes: next.length, images: images.length, reencoded, omitted
  };
}

export function isDeepSeekHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "deepseek.com" || normalized.endsWith(".deepseek.com");
}

/** Base URL that routes a DeepSeek provider through this process's proxy; undefined for other providers. */
export function deepSeekProxyBaseUrl(baseUrl: string, port: number): string | undefined {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.port || !isDeepSeekHost(url.hostname)) return undefined;
  const pathname = url.pathname.replace(/\/+$/, "");
  return `http://127.0.0.1:${port}${DEEPSEEK_PROXY_PATH}/${url.hostname.toLowerCase()}${pathname}`;
}

const HOP_BY_HOP_HEADERS = new Set([
  "connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer", "host", "content-length"
]);

export type DeepSeekProxyDeps = {
  isLocalRequest(req: Request): boolean;
  shrinkOptions?: ImageShrinkOptions;
  /** Tests point the proxy at a local server; production always calls https://<deepseek host>. */
  upstreamBase?(host: string): string;
  log?(entry: Record<string, unknown>): void;
};

/**
 * Express handler for `${DEEPSEEK_PROXY_PATH}/:host/*` mounted with a raw body parser. Only local
 * callers and DeepSeek hosts are served, and the caller's own Authorization header is forwarded, so
 * the proxy grants nothing a local process could not already do directly.
 */
export function createDeepSeekProxyHandler(deps: DeepSeekProxyDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const host = String(req.params.host ?? "");
    if (!deps.isLocalRequest(req) || !isDeepSeekHost(host)) {
      res.status(404).json({ detail: "Not found" });
      return;
    }
    const prefix = `${DEEPSEEK_PROXY_PATH}/${host}`;
    const rest = req.originalUrl.slice(req.originalUrl.indexOf(prefix) + prefix.length) || "/";
    const target = new URL(`${(deps.upstreamBase?.(host) ?? `https://${host}`).replace(/\/+$/, "")}${rest}`);

    let body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const encoding = String(req.header("content-encoding") ?? "").trim().toLowerCase();
    if (body.length > 0 && (!encoding || encoding === "identity")) {
      const startedAt = Date.now();
      const result = await shrinkResponsesRequestImages(body, deps.shrinkOptions ?? DEFAULT_IMAGE_SHRINK_OPTIONS);
      if (result.changed) {
        body = result.body;
        deps.log?.({
          event: "deepseek_request_images_shrunk",
          path: target.pathname,
          beforeBytes: result.beforeBytes,
          afterBytes: result.afterBytes,
          images: result.images,
          reencoded: result.reencoded,
          omitted: result.omitted,
          ms: Date.now() - startedAt
        });
      }
    }

    const headers: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined || HOP_BY_HOP_HEADERS.has(name)) continue;
      headers[name] = value;
    }
    if (body.length > 0) headers["content-length"] = String(body.length);

    const transport = target.protocol === "https:" ? https : http;
    const upstream = transport.request(target, { method: req.method, headers }, (upstreamRes) => {
      const responseHeaders: Record<string, string | string[]> = {};
      for (const [name, value] of Object.entries(upstreamRes.headers)) {
        if (value === undefined || (HOP_BY_HOP_HEADERS.has(name) && name !== "content-length")) continue;
        responseHeaders[name] = value;
      }
      res.writeHead(upstreamRes.statusCode ?? 502, responseHeaders);
      upstreamRes.pipe(res);
    });
    // The caller going away (turn interrupted) must not leave the upstream stream running.
    res.on("close", () => {
      if (!res.writableFinished) upstream.destroy();
    });
    upstream.on("error", (error) => {
      deps.log?.({ event: "deepseek_proxy_upstream_error", path: target.pathname, error: error.message });
      if (!res.headersSent) {
        res.status(502).json({ error: { message: `DeepSeek proxy upstream error: ${error.message}`, type: "proxy_error" } });
      } else {
        res.destroy(error);
      }
    });
    upstream.end(body.length > 0 ? body : undefined);
  };
}
