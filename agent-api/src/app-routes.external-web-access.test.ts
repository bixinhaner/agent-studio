import express, { Router } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { registerCommonApiRoutes } from "./app-routes.js";
import { createAuthenticatedExternalWebGate } from "./external-web-access.js";

function pingRouter() {
  const router = Router();
  router.get("/ping", (_req, res) => res.json({ ok: true }));
  return router;
}

function createApp(actor: "internal" | "external") {
  const app = express();
  registerCommonApiRoutes(app, {
    currentUserMiddleware: (req, _res, next) => {
      const external = actor === "external";
      const organizationId = external ? "customer-1" : "internal-org";
      req.currentUser = {
        id: external ? "external-1" : "internal-1",
        userType: external ? "external_user" : "internal_employee",
        role: "employee",
        status: "active"
      } as never;
      req.currentOrganization = {
        id: organizationId,
        type: external ? "customer" : "internal"
      } as never;
      req.currentMembership = {
        status: "active",
        organizationId,
        organization: req.currentOrganization
      } as never;
      next();
    },
    authRouter: pingRouter(),
    adminRouter: Router() as never,
    portalRouter: pingRouter(),
    serviceTokenMiddleware: (_req, _res, next) => next(),
    zendeskRouter: pingRouter(),
    crestRouter: pingRouter(),
    externalWebAccessMiddleware: createAuthenticatedExternalWebGate({
      isMaintenanceEnabled: async () => true
    })
  });
  app.get("/api/generic", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("registerCommonApiRoutes external Web maintenance scope", () => {
  it("blocks external Portal and generic Web APIs", async () => {
    const app = createApp("external");

    expect((await request(app).get("/api/portal/ping")).status).toBe(503);
    expect((await request(app).get("/api/generic")).status).toBe(503);
    expect((await request(app).get("/api/auth/ping")).status).toBe(503);
  });

  it("keeps non-Web integrations and internal Portal access available", async () => {
    const externalApp = createApp("external");
    const internalApp = createApp("internal");

    expect((await request(externalApp).get("/api/integrations/zendesk/ping")).status).toBe(200);
    expect((await request(externalApp).get("/api/integrations/crest/ping")).status).toBe(200);
    expect((await request(internalApp).get("/api/portal/ping")).status).toBe(200);
  });
});
