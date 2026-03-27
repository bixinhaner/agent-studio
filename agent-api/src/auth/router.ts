import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { requireCurrentUser, userOut } from "./current-user.js";
import { resolveDingTalkConfig, type DingTalkClient, type DingTalkConfig } from "./dingtalk.js";
import type { OAuthStateCookieManager, SessionCookieManager } from "./session-cookie.js";
import type { UserRepositoryLike } from "../persistence/user-repository.js";

const dingtalkSessionSchema = z.object({
  code: z.string().trim().min(1, "code is required"),
  state: z.string().trim().min(1, "state is required"),
  nonce: z.string().trim().min(1, "nonce is required")
});

export function createAuthRouter(options: {
  users: UserRepositoryLike;
  cookies: SessionCookieManager;
  dingtalkClient: DingTalkClient;
  dingtalkConfig: DingTalkConfig;
  oauthStates: OAuthStateCookieManager;
  sessionCookieReady?: boolean;
}): Router {
  const router = Router();

  router.get("/dingtalk/config", (_req: Request, res: Response) => {
    const resolved = resolveDingTalkConfig(options.dingtalkConfig);
    const missing = resolved.ok ? [] : [...resolved.missing];
    if (options.sessionCookieReady === false) {
      missing.push("session_cookie_secret");
    }
    if (missing.length) {
      res.status(503).json({
        detail: "DingTalk auth is not configured",
        missing
      });
      return;
    }
    if (!resolved.ok) {
      res.status(503).json({
        detail: "DingTalk auth is not configured",
        missing
      });
      return;
    }

    const issued = options.oauthStates.issue();
    res.setHeader("Set-Cookie", issued.cookie);
    res.json({
      config: {
        ...resolved.publicConfig,
        state: issued.state,
        nonce: issued.nonce
      }
    });
  });

  router.post("/dingtalk/session", async (req: Request, res: Response) => {
    try {
      const resolved = resolveDingTalkConfig(options.dingtalkConfig);
      const missing = resolved.ok ? [] : [...resolved.missing];
      if (options.sessionCookieReady === false) {
        missing.push("session_cookie_secret");
      }
      if (missing.length) {
        res.status(503).json({
          detail: "DingTalk auth is not configured",
          missing
        });
        return;
      }
      if (!resolved.ok) {
        res.status(503).json({
          detail: "DingTalk auth is not configured",
          missing
        });
        return;
      }

      const input = dingtalkSessionSchema.parse(req.body ?? {});
      const expectedState = options.oauthStates.read(req.headers.cookie);
      if (!expectedState || expectedState.state !== input.state || expectedState.nonce !== input.nonce) {
        res.setHeader("Set-Cookie", options.oauthStates.clear());
        res.status(401).json({ detail: "Invalid OAuth state" });
        return;
      }

      const identity = await options.dingtalkClient.exchangeCode(input.code);
      const user = await options.users.upsertFromDingTalk(identity);
      res.setHeader("Set-Cookie", [options.oauthStates.clear(), options.cookies.create(user.id)]);
      res.json({ user: userOut(user) });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "DingTalk login failed";
      res.status(400).json({ detail });
    }
  });

  router.get("/whoami", requireCurrentUser, (req: Request, res: Response) => {
    res.json({ user: userOut(req.currentUser!) });
  });

  router.post("/logout", (_req: Request, res: Response) => {
    res.setHeader("Set-Cookie", options.cookies.clear());
    res.status(204).end();
  });

  return router;
}
