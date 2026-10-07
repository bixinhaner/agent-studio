import http from "node:http";
import type { NextFunction, Request, RequestHandler, Response } from "express";

import { FORWARDED_BY_HEADER, type ChatClusterView, type RunKey } from "./cluster.js";

// Hop-by-hop headers describe one connection and must not be relayed.
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

let inFlightForwards = 0;

/** Forwarded requests still streaming through this instance; a retiring instance waits for them. */
export function inFlightForwardCount(): number {
  return inFlightForwards;
}

function bodyAlreadyParsed(req: Request): boolean {
  // body-parser marks requests whose stream it consumed.
  return (req as Request & { _body?: boolean })._body === true;
}

function serializedBody(req: Request): Buffer | undefined {
  if (!bodyAlreadyParsed(req)) return undefined;
  const body: unknown = req.body;
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === "string") return Buffer.from(body);
  return Buffer.from(JSON.stringify(body ?? {}));
}

/**
 * Relays the original request to a peer instance and streams its response back,
 * keeping Host, cookies and forwarding headers so the peer authenticates the
 * caller and resolves the brand exactly as it would behind Caddy.
 */
export function forwardRequestToPeer(req: Request, res: Response, peerUrl: string, forwardedBy: string): Promise<void> {
  const target = new URL(req.originalUrl, peerUrl);
  const headers: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name)) continue;
    headers[name] = value;
  }
  headers[FORWARDED_BY_HEADER] = forwardedBy;
  const body = serializedBody(req);
  if (body) {
    headers["content-length"] = String(body.length);
  }

  inFlightForwards += 1;
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      inFlightForwards -= 1;
      resolve();
    };
    const upstream = http.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        method: req.method,
        path: `${target.pathname}${target.search}`,
        headers
      },
      (upstreamRes) => {
        const responseHeaders: http.OutgoingHttpHeaders = {};
        for (const [name, value] of Object.entries(upstreamRes.headers)) {
          if (value === undefined || HOP_BY_HOP_HEADERS.has(name)) continue;
          responseHeaders[name] = value;
        }
        res.writeHead(upstreamRes.statusCode ?? 502, responseHeaders);
        res.flushHeaders?.();
        upstreamRes.on("data", (chunk: Buffer) => {
          res.write(chunk);
          (res as Response & { flush?: () => void }).flush?.();
        });
        upstreamRes.on("end", () => {
          res.end();
          finish();
        });
        upstreamRes.on("error", () => {
          res.destroy();
          finish();
        });
      }
    );
    // The caller going away must reach the peer the same way a direct disconnect would.
    res.once("close", () => {
      if (!res.writableFinished) upstream.destroy();
      finish();
    });
    upstream.on("error", (error) => {
      if (!res.headersSent) {
        res.status(502).json({ detail: "Chat instance handover failed, please retry.", code: "CHAT_FORWARD_FAILED" });
      } else {
        res.destroy(error);
      }
      finish();
    });
    if (body) {
      upstream.end(body);
    } else {
      req.pipe(upstream);
    }
  });
}

/**
 * Routing for slot-aware chat instances:
 * 1. Requests for a run another instance owns go to that owner (cancel, steer, tool results).
 * 2. A retiring instance hands every other request to the ready peer, covering
 *    the second or so before Caddy's health check stops sending it traffic.
 * Forwarded requests are always handled where they land, so a request is relayed at most once.
 */
export function createChatClusterRoutingMiddleware(options: {
  cluster: ChatClusterView;
  instanceId: string;
  resolveRunKey(req: Request): RunKey | undefined;
  ownsLocally(key: RunKey): boolean;
  isRetiring(): boolean;
  logger?: Pick<Console, "info" | "warn">;
}): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!options.cluster.enabled || req.header(FORWARDED_BY_HEADER)) {
      next();
      return;
    }
    if (req.path.startsWith("/internal/") || req.path === "/healthz") {
      next();
      return;
    }
    void (async () => {
      const key = options.resolveRunKey(req);
      if (key && options.ownsLocally(key)) {
        next();
        return;
      }
      if (key) {
        const owner = await options.cluster.findOwner(key);
        if (owner) {
          options.logger?.info("chat cluster forwarding run request to owner", {
            kind: key.kind,
            run: key.id,
            path: req.path,
            peer: owner.url
          });
          await forwardRequestToPeer(req, res, owner.url, options.instanceId);
          return;
        }
      }
      if (options.isRetiring()) {
        const peer = await options.cluster.readyPeer();
        if (peer) {
          await forwardRequestToPeer(req, res, peer.url, options.instanceId);
          return;
        }
      }
      next();
    })().catch((error) => {
      options.logger?.warn("chat cluster routing failed; handling locally", {
        path: req.path,
        detail: error instanceof Error ? error.message : String(error)
      });
      if (!res.headersSent) next();
    });
  };
}

function bodyString(req: Request, field: string): string | undefined {
  const value = (req.body as Record<string, unknown> | undefined)?.[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Requests that act on an in-flight run, keyed by what identifies the run in each channel. */
export function resolveChatRunKey(req: Request): RunKey | undefined {
  if (req.method !== "POST") return undefined;
  const path = req.path;
  // A new stream on a session that is still running elsewhere goes to that
  // owner so it supersedes the old turn exactly as on a single instance.
  if (path === "/api/chat/cancel" || path === "/api/chat/steer" || path === "/api/chat/stream") {
    const id = bodyString(req, "session_id");
    return id ? { kind: "portal_session", id } : undefined;
  }
  if (path === "/api/integrations/crest/chat/cancel") {
    const id = bodyString(req, "clientRunId");
    return id ? { kind: "crest_run", id } : undefined;
  }
  const cancel =
    /^\/api\/integrations\/action-connectors\/[^/]+\/runs\/([^/]+)\/cancel$/.exec(path) ??
    /^\/api\/action-connectors\/[^/]+\/(?:assistant-runs|proactive\/runs)\/([^/]+)\/cancel$/.exec(path);
  if (cancel) return { kind: "action_connector_run", id: decodeURIComponent(cancel[1]) };
  if (/^\/api\/action-connectors\/[^/]+\/tool-results$/.test(path)) {
    const id = bodyString(req, "runId");
    return id ? { kind: "action_connector_run", id } : undefined;
  }
  return undefined;
}
