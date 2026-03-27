import { Router, type Request, type Response } from "express";

import { ZendeskIntegrationService } from "../integrations/zendesk/service.js";

export function createAdminRouter(options: {
  users: { count(): Promise<number> };
  threads: { count(): Promise<number> };
  sessions: { countActive(): Promise<number> };
  zendesk?: Pick<ZendeskIntegrationService, "getOverview">;
}): Router {
  const router = Router();
  const zendesk = options.zendesk ?? new ZendeskIntegrationService();

  router.get("/overview", async (_req: Request, res: Response) => {
    try {
      const [users, threads, activeSessions, zendeskOverview] = await Promise.all([
        options.users.count(),
        options.threads.count(),
        options.sessions.countActive(),
        zendesk.getOverview()
      ]);

      res.json({
        counts: {
          users,
          threads,
          activeSessions
        },
        integrations: {
          zendesk: {
            enabled: zendeskOverview.settings.enabled,
            ready: zendeskOverview.ready,
            missing: zendeskOverview.missing,
            hasZendeskApiToken: zendeskOverview.settings.hasZendeskApiToken,
            hasWebhookSigningSecret: zendeskOverview.settings.hasWebhookSigningSecret,
            lastValidatedAt: zendeskOverview.settings.lastValidatedAt ?? null
          }
        }
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "加载管理概览失败";
      res.status(500).json({ detail });
    }
  });

  return router;
}
