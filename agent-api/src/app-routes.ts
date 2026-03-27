import type { Express, RequestHandler, Router } from "express";

import { requireCurrentUser, requireRole } from "./auth/current-user.js";

export function registerCommonApiRoutes(
  app: Pick<Express, "use">,
  options: {
    currentUserMiddleware: RequestHandler;
    authRouter: Router;
    adminRouter: Router;
    portalRouter: Router;
    serviceTokenMiddleware: RequestHandler;
    zendeskRouter: Router;
  }
): void {
  app.use(options.currentUserMiddleware);
  app.use("/api/auth", options.authRouter);
  app.use("/api/admin", requireCurrentUser, requireRole("admin"), options.adminRouter);
  app.use("/api/portal", requireCurrentUser, options.portalRouter);
  app.use("/api/integrations/zendesk", options.serviceTokenMiddleware, options.zendeskRouter);
  app.use("/api", requireCurrentUser);
}
