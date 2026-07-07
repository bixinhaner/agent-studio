import { Router, type Express, type RequestHandler } from "express";

import { requireCurrentOrganization, requireCurrentUser, requireInternalRole } from "./auth/current-user.js";

type AdminRouterLike = Router & {
  systemSettingsRouter?: Router;
};

export function registerCommonApiRoutes(
  app: Pick<Express, "use">,
  options: {
    currentUserMiddleware: RequestHandler;
    authRouter: Router;
    rbacAdminRouter?: Router;
    adminRouter: AdminRouterLike;
    systemSettingsRouter?: Router;
    integrationCenterRouter?: Router;
    monitoringAdminRouter?: Router;
    resourcesAdminRouter?: Router;
    modeAdminRouter?: Router;
    codexMemoryAdminRouter?: Router;
    adminSkillRouter?: Router;
    portalRouter: Router;
    resourcesPortalRouter?: Router;
    portalSkillRouter?: Router;
    serviceTokenMiddleware: RequestHandler;
    zendeskRouter: Router;
    crestRouter?: Router;
    actionConnectorProvisionRouter?: Router;
    actionConnectorRuntimeRouter?: Router;
  }
): void {
  const systemSettingsMount = Router();
  systemSettingsMount.use("/system-settings", options.systemSettingsRouter ?? options.adminRouter.systemSettingsRouter ?? Router());

  app.use(options.currentUserMiddleware);
  app.use("/api/auth", options.authRouter);
  app.use(
    "/api/admin",
    requireCurrentUser,
    requireCurrentOrganization,
    options.rbacAdminRouter ?? Router(),
    requireInternalRole("admin"),
    options.adminRouter,
    systemSettingsMount,
    options.integrationCenterRouter ?? Router(),
    options.monitoringAdminRouter ?? Router(),
    options.resourcesAdminRouter ?? Router(),
    options.modeAdminRouter ?? Router(),
    options.codexMemoryAdminRouter ?? Router(),
    options.adminSkillRouter ?? Router()
  );
  app.use(
    "/api/portal",
    requireCurrentUser,
    requireCurrentOrganization,
    options.portalRouter,
    options.resourcesPortalRouter ?? Router(),
    options.portalSkillRouter ?? Router()
  );
  app.use("/api/integrations/zendesk", options.serviceTokenMiddleware, options.zendeskRouter);
  app.use("/api/integrations/crest", options.crestRouter ?? Router());
  app.use(
    "/api/integrations/action-connectors",
    options.serviceTokenMiddleware,
    options.actionConnectorProvisionRouter ?? Router()
  );
  app.use("/api/action-connectors", options.actionConnectorRuntimeRouter ?? Router());
  app.use("/api", requireCurrentUser, requireCurrentOrganization);
}
