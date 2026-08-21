import { randomBytes } from "node:crypto";
import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";

import type { DwsCommandExecutor, DwsUserIdentity } from "./dws-executor.js";

type DwsProxyTokenEntry = {
  userId: string;
  workspacePath: string;
  expiresAt: number;
};

type DwsRouterOptions = {
  executor: Pick<DwsCommandExecutor, "execute">;
  resolveIdentity: (userId: string) => Promise<DwsUserIdentity | undefined>;
};

const execSchema = z.object({
  args: z.array(z.string().min(1).max(32_000)).min(1).max(160)
});

const proxyTokens = new Map<string, DwsProxyTokenEntry>();
export const DWS_PROXY_TOKEN_TTL_MS = 8 * 60 * 60_000;

export function issueDwsProxyTokenLease(
  input: { userId: string; workspacePath: string },
  ttlMs = DWS_PROXY_TOKEN_TTL_MS
): { token: string; expiresAt: string } {
  gcProxyTokens();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + ttlMs;
  proxyTokens.set(token, {
    userId: input.userId,
    workspacePath: input.workspacePath,
    expiresAt
  });
  return {
    token,
    expiresAt: new Date(expiresAt).toISOString()
  };
}

export function createDwsRouter(options: DwsRouterOptions): Router {
  const router = express.Router();

  router.post("/exec", async (req: Request, res: Response) => {
    const lease = resolveProxyLease(req);
    if (!lease) {
      res.status(401).json({ detail: "DWS runtime authorization has expired" });
      return;
    }

    const parsed = execSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ detail: "Invalid DWS command arguments" });
      return;
    }
    const identity = await options.resolveIdentity(lease.userId).catch(() => undefined);
    if (!identity) {
      res.status(403).json({ detail: "Current Agent Studio user has no usable DingTalk identity" });
      return;
    }

    res.status(200);
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const abortController = new AbortController();
    let completed = false;
    res.once("close", () => {
      if (!completed) abortController.abort();
    });
    const writeEvent = (event: Record<string, unknown>) => {
      if (!res.destroyed) res.write(`${JSON.stringify(event)}\n`);
    };

    try {
      const code = await options.executor.execute({
        identity,
        workspacePath: lease.workspacePath,
        args: parsed.data.args,
        signal: abortController.signal,
        onOutput: (event) => writeEvent(event)
      });
      writeEvent({ stream: "exit", code });
    } catch (error) {
      writeEvent({
        stream: "stderr",
        data: `${error instanceof Error ? error.message : "DWS command failed"}\n`
      });
      writeEvent({ stream: "exit", code: 1 });
    } finally {
      completed = true;
      if (!res.destroyed) res.end();
    }
  });

  return router;
}

function resolveProxyLease(req: Request): DwsProxyTokenEntry | undefined {
  const authorization = req.header("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token) return undefined;
  const entry = proxyTokens.get(token);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    proxyTokens.delete(token);
    return undefined;
  }
  return entry;
}

function gcProxyTokens(): void {
  const now = Date.now();
  for (const [token, entry] of proxyTokens) {
    if (entry.expiresAt <= now) proxyTokens.delete(token);
  }
}
