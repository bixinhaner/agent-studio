import express, { type Request, type Response, type Router } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import type { CrestSsoConfig } from "../../auth/router.js";
import type { AuthIdentityRepository } from "../../persistence/auth-identity-repository.js";
import type {
  CrestDelegationCredentialRecord,
  CrestDelegationCredentialRepository
} from "../../persistence/crest-delegation-credential-repository.js";

const rpcSchema = z.object({
  rpc: z.object({
    jsonrpc: z.string().optional(),
    method: z.string().trim().min(1),
    params: z.unknown().optional(),
    id: z.unknown().optional()
  })
});

const refreshResponseSchema = z.object({
  delegationToken: z.string().trim().min(1),
  delegationExpiresAt: z.string().trim().min(1),
  delegationRefreshToken: z.string().trim().min(1).optional(),
  delegationRefreshExpiresAt: z.string().trim().min(1).optional()
});

type CrestRouterOptions = {
  config: CrestSsoConfig;
  configResolver?: () => Promise<CrestSsoConfig | undefined>;
  identities: AuthIdentityRepository;
  credentials: CrestDelegationCredentialRepository;
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

function isExpired(value: string | undefined): boolean {
  if (!value) return true;
  const time = new Date(value).getTime();
  return Number.isNaN(time) || time <= Date.now();
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
    const credential = await options.credentials.getForUser(userId);
    const delegation = readDelegation(identity?.profileJson);
    res.json({
      connected:
        options.credentials.isUsable(credential) ||
        Boolean(identity && delegation.token && (!delegation.expiresAt || !isExpired(delegation.expiresAt))),
      delegation_expires_at: credential?.delegationExpiresAt ?? delegation.expiresAt ?? null,
      delegation_refresh_expires_at: credential?.delegationRefreshExpiresAt ?? null
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
      const input = rpcSchema.parse(req.body ?? {});
      const delegation = await ensureDelegation({ options, config, userId });
      let response = await callCrestRpc({ config, delegationToken: delegation.delegationToken, rpc: input.rpc });
      if (!response.ok && response.status === 401 && delegation.delegationRefreshToken) {
        const refreshed = await refreshDelegation({ options, config, userId, credential: delegation });
        response = await callCrestRpc({ config, delegationToken: refreshed.delegationToken, rpc: input.rpc });
      }
      const data = (await response.json().catch(() => ({}))) as unknown;
      res.status(response.ok ? 200 : response.status).json(data);
    } catch (error) {
      res.status(400).json({ detail: error instanceof Error ? error.message : "Crest request failed" });
    }
  });

  return router;
}

async function ensureDelegation(input: {
  options: CrestRouterOptions;
  config: Required<CrestSsoConfig>;
  userId: string;
}): Promise<CrestDelegationCredentialRecord> {
  const credential = await input.options.credentials.getForUser(input.userId);
  if (credential) {
    if (!isExpired(credential.delegationExpiresAt)) return credential;
    if (credential.delegationRefreshToken && !isExpired(credential.delegationRefreshExpiresAt)) {
      return refreshDelegation({ ...input, credential });
    }
  }

  const identity = (await input.options.identities.listForUser(input.userId)).find((item) => item.provider === "crest");
  const legacy = readDelegation(identity?.profileJson);
  if (!legacy.token) {
    throw new Error("Crest delegation is not available; sign in from Crest again");
  }
  if (legacy.expiresAt && isExpired(legacy.expiresAt)) {
    throw new Error("Crest delegation has expired; sign in from Crest again");
  }
  return {
    id: "legacy-profile",
    userId: input.userId,
    delegationToken: legacy.token,
    delegationExpiresAt: legacy.expiresAt ?? new Date(Date.now() + 60_000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function refreshDelegation(input: {
  options: CrestRouterOptions;
  config: Required<CrestSsoConfig>;
  userId: string;
  credential: CrestDelegationCredentialRecord;
}): Promise<CrestDelegationCredentialRecord> {
  if (!input.credential.delegationRefreshToken) {
    throw new Error("Crest delegation has expired; sign in from Crest again");
  }
  const response = await fetch(`${input.config.baseUrl}/v1/agent-studio/delegation/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: input.config.clientId,
      clientSecret: input.config.clientSecret,
      delegationToken: input.credential.delegationToken,
      refreshToken: input.credential.delegationRefreshToken
    })
  });
  const data = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      await input.options.credentials.deleteForUser(input.userId);
      throw new Error("Crest delegation refresh failed; sign in from Crest again");
    }
    throw new Error("Crest delegation refresh is temporarily unavailable");
  }
  const parsed = refreshResponseSchema.parse(data);
  return input.options.credentials.upsertForUser({
    userId: input.userId,
    providerSubject: input.credential.providerSubject,
    delegationToken: parsed.delegationToken,
    delegationExpiresAt: parsed.delegationExpiresAt,
    delegationRefreshToken: parsed.delegationRefreshToken ?? input.credential.delegationRefreshToken,
    delegationRefreshExpiresAt: parsed.delegationRefreshExpiresAt ?? input.credential.delegationRefreshExpiresAt,
    lastRefreshedAt: new Date()
  });
}

function callCrestRpc(input: {
  config: Required<CrestSsoConfig>;
  delegationToken: string;
  rpc: z.infer<typeof rpcSchema>["rpc"];
}): Promise<globalThis.Response> {
  return fetch(`${input.config.baseUrl}/v1/agent-studio/mcp/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: input.config.clientId,
      clientSecret: input.config.clientSecret,
      delegationToken: input.delegationToken,
      rpc: input.rpc
    })
  });
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
