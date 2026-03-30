import express, { Router } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { registerCommonApiRoutes } from "./app-routes.js";

describe("registerCommonApiRoutes", () => {
  it("mounts the RBAC router under /api/admin without the legacy /rbac segment", async () => {
    const app = express();
    const rbacRouter = Router();
    rbacRouter.get("/roles", (_req, res) => {
      res.json({ ok: true });
    });

    registerCommonApiRoutes(app, {
      currentUserMiddleware: (req, _res, next) => {
        req.currentUser = {
          id: "admin-user",
          role: "admin",
          status: "active",
          createdAt: "2026-03-30T00:00:00.000Z",
          updatedAt: "2026-03-30T00:00:00.000Z"
        };
        next();
      },
      authRouter: Router(),
      rbacAdminRouter: rbacRouter,
      adminRouter: Router(),
      portalRouter: Router(),
      serviceTokenMiddleware: (_req, _res, next) => next(),
      zendeskRouter: Router()
    });

    await request(app).get("/api/admin/roles").expect(200, { ok: true });
    await request(app).get("/api/admin/rbac/roles").expect(404);
  });

  it("mounts system settings under /api/admin/system-settings", async () => {
    const app = express();
    const systemSettingsRouter = Router();
    systemSettingsRouter.get("/", (_req, res) => {
      res.json({ ok: true });
    });
    systemSettingsRouter.post("/publish", (_req, res) => {
      res.json({ published: true });
    });

    registerCommonApiRoutes(app, {
      currentUserMiddleware: (req, _res, next) => {
        req.currentUser = {
          id: "admin-user",
          role: "admin",
          status: "active",
          createdAt: "2026-03-30T00:00:00.000Z",
          updatedAt: "2026-03-30T00:00:00.000Z"
        };
        next();
      },
      authRouter: Router(),
      adminRouter: Router(),
      systemSettingsRouter,
      portalRouter: Router(),
      serviceTokenMiddleware: (_req, _res, next) => next(),
      zendeskRouter: Router()
    });

    await request(app).get("/api/admin/system-settings").expect(200, { ok: true });
    await request(app).post("/api/admin/system-settings/publish").expect(200, { published: true });
    await request(app).get("/api/admin/publish").expect(404);
  });
});
