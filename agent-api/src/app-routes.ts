import { Router, type Express, type RequestHandler } from "express";

import { requireCurrentUser, requireRole } from "./auth/current-user.js";

export function registerCommonApiRoutes(
  app: Pick<Express, "use">,
  options: {
    currentUserMiddleware: RequestHandler;
    authRouter: Router;
    rbacAdminRouter?: Router;
    adminRouter: Router;
    resourcesAdminRouter?: Router;
    modeAdminRouter?: Router;
    portalRouter: Router;
    resourcesPortalRouter?: Router;
    serviceTokenMiddleware: RequestHandler;
    zendeskRouter: Router;
  }
): void {
  app.use(options.currentUserMiddleware);
  app.use("/api/auth", options.authRouter);
  app.use("/api/admin/rbac", requireCurrentUser, options.rbacAdminRouter ?? Router());
  app.use(
    "/api/admin",
    requireCurrentUser,
    requireRole("admin"),
    options.adminRouter,
    options.resourcesAdminRouter ?? Router(),
    options.modeAdminRouter ?? Router()
  );
  app.use("/api/portal", requireCurrentUser, options.portalRouter, options.resourcesPortalRouter ?? Router());
  app.use("/api/integrations/zendesk", options.serviceTokenMiddleware, options.zendeskRouter);
  app.use("/api", requireCurrentUser);
}
