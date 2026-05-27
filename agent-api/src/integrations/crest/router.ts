import express, { type Request, type Response, type Router } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import type { CrestSsoConfig } from "../../auth/router.js";
import type { AuthIdentityRepository } from "../../persistence/auth-identity-repository.js";

const rpcSchema = z.object({
  rpc: z.object({
    jsonrpc: z.string().optional(),
    method: z.string().trim().min(1),
    params: z.unknown().optional(),
    id: z.unknown().optional()
  })
});

type CrestRouterOptions = {
  config: CrestSsoConfig;
  configResolver?: () => Promise<CrestSsoConfig | undefined>;
  identities: AuthIdentityRepository;
};

type ProxyTokenEntry = {
  userId: string;
  expiresAt: number;
};

const proxyTokens = new Map<string, ProxyTokenEntry>();

export function issueCrestProxyToken(userId: string, ttlMs = 8 * 60 * 60_000): string {
  gcProxyTokens();
  const token = randomBytes(32).toString("base64url");
  proxyTokens.set(token, { userId, expiresAt: Date.now() + ttlMs });
  return token;
}

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function readDelegation(profileJson: unknown): { token?: string; expiresAt?: string } {
  const profile = asRecord(profileJson);
  return {
    token: trimOrUndefined(profile?.delegationToken),
    expiresAt: trimOrUndefined(profile?.delegationExpiresAt)
  };
}

function resolvedConfig(config: CrestSsoConfig): Required<CrestSsoConfig> | undefined {
  const baseUrl = trimOrUndefined(config.baseUrl);
  const clientId = trimOrUndefined(config.clientId);
  const clientSecret = trimOrUndefined(config.clientSecret);
  if (!baseUrl || !clientId || !clientSecret) return undefined;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    clientId,
    clientSecret
  };
}

async function resolveConfiguredCrest(options: CrestRouterOptions): Promise<Required<CrestSsoConfig> | undefined> {
  return resolvedConfig(options.config) ?? resolvedConfig((await options.configResolver?.()) ?? {});
}

export function createCrestRouter(options: CrestRouterOptions): Router {
  const router = express.Router();

  router.get("/status", async (req: Request, res: Response) => {
    const userId = resolveRequestUserId(req);
    if (!userId) {
      res.status(401).json({ detail: "Authentication required" });
      return;
    }
    const identity = (await options.identities.listForUser(userId)).find((item) => item.provider === "crest");
    const delegation = readDelegation(identity?.profileJson);
    res.json({
      connected: Boolean(identity && delegation.token),
      delegation_expires_at: delegation.expiresAt ?? null
    });
  });

  router.post("/mcp/rpc", async (req: Request, res: Response) => {
    try {
      const config = await resolveConfiguredCrest(options);
      if (!config) {
        res.status(503).json({ detail: "Crest integration is not configured" });
        return;
      }
      const userId = resolveRequestUserId(req);
      if (!userId) {
        res.status(401).json({ detail: "Authentication required" });
        return;
      }
      const identity = (await options.identities.listForUser(userId)).find((item) => item.provider === "crest");
      const delegation = readDelegation(identity?.profileJson);
      if (!delegation.token) {
        res.status(401).json({ detail: "Crest delegation is not available; sign in from Crest again" });
        return;
      }
      if (delegation.expiresAt && new Date(delegation.expiresAt).getTime() <= Date.now()) {
        res.status(401).json({ detail: "Crest delegation has expired; sign in from Crest again" });
        return;
      }
      const input = rpcSchema.parse(req.body ?? {});
      const response = await fetch(`${config.baseUrl}/v1/agent-studio/mcp/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          delegationToken: delegation.token,
          rpc: input.rpc
        })
      });
      const data = (await response.json().catch(() => ({}))) as unknown;
      res.status(response.ok ? 200 : response.status).json(data);
    } catch (error) {
      res.status(400).json({ detail: error instanceof Error ? error.message : "Crest request failed" });
    }
  });

  return router;
}

function resolveRequestUserId(req: Request): string | undefined {
  const currentUserId = trimOrUndefined(req.currentUser?.id);
  if (currentUserId) return currentUserId;
  const token = readBearerToken(req);
  if (!token) return undefined;
  const entry = proxyTokens.get(token);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    proxyTokens.delete(token);
    return undefined;
  }
  return entry.userId;
}

function readBearerToken(req: Request): string | undefined {
  const authorization = req.header("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return trimOrUndefined(match?.[1]);
}

function gcProxyTokens(): void {
  const now = Date.now();
  for (const [token, entry] of proxyTokens) {
    if (entry.expiresAt <= now) proxyTokens.delete(token);
  }
}
