import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { registerCommonApiRoutes } from "../app-routes.js";
import { createSystemSettingsRouter } from "./router.js";
import { createDefaultSystemSettingsPayload } from "./types.js";

function buildPermissionGuard(allowedPermissions: string[]) {
  return (permissionKey: string) => (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!allowedPermissions.includes(permissionKey)) {
      res.status(403).json({ detail: "Forbidden" });
      return;
    }
    next();
  };
}

function buildState(overrides?: { publishedByUserId?: string }) {
  return {
    draft: {
      id: "system-settings-version-1",
      versionNumber: 1,
      revision: 0,
      status: "draft" as const,
      payload: createDefaultSystemSettingsPayload(),
      createdAt: "2026-03-30T00:00:00.000Z",
      updatedAt: "2026-03-30T00:00:00.000Z"
    },
    published: {
      id: "system-settings-version-2",
      versionNumber: 2,
      revision: 1,
      status: "published" as const,
      payload: createDefaultSystemSettingsPayload(),
      createdAt: "2026-03-30T00:00:00.000Z",
      updatedAt: "2026-03-30T00:01:00.000Z",
      publishedAt: "2026-03-30T00:01:00.000Z",
      publishedByUserId: overrides?.publishedByUserId ?? "admin-1"
    },
    draftMeta: {
      id: "system-settings-version-1",
      versionNumber: 1,
      revision: 0,
      status: "draft" as const,
      createdAt: "2026-03-30T00:00:00.000Z",
      updatedAt: "2026-03-30T00:00:00.000Z"
    },
    publishedMeta: {
      id: "system-settings-version-2",
      versionNumber: 2,
      revision: 1,
      status: "published" as const,
      createdAt: "2026-03-30T00:00:00.000Z",
      updatedAt: "2026-03-30T00:01:00.000Z",
      publishedAt: "2026-03-30T00:01:00.000Z",
      publishedByUserId: overrides?.publishedByUserId ?? "admin-1"
    }
  };
}

function buildApp(options?: { allowedPermissions?: string[] }) {
  const service = {
    read: vi.fn(async () => buildState()),
    updateDraft: vi.fn(async ({ patch }: { patch: Record<string, unknown> }) => {
      const state = buildState();
      const next = structuredClone(state);
      if (patch.branding && typeof patch.branding === "object" && patch.branding !== null) {
        const branding = patch.branding as { platformName?: unknown };
        if (typeof branding.platformName === "string") {
          next.draft.payload.branding.platformName = branding.platformName;
          next.published.payload.branding.platformName = branding.platformName;
        }
      }
      return next;
    }),
    publish: vi.fn(async () => buildState({ publishedByUserId: "admin-1" }))
  };

  const app = express();
  app.use(express.json());
  registerCommonApiRoutes(app, {
    currentUserMiddleware: (req, _res, next) => {
      req.currentUser = {
        id: "admin-1",
        role: "admin",
        status: "active",
        createdAt: "2026-03-30T00:00:00.000Z",
        updatedAt: "2026-03-30T00:00:00.000Z"
      };
      next();
    },
    authRouter: express.Router(),
    adminRouter: express.Router(),
    systemSettingsRouter: createSystemSettingsRouter({
      service,
      requirePermission: buildPermissionGuard(
        options?.allowedPermissions ?? ["system_settings.read", "system_settings.write", "system_settings.publish"]
      )
    }),
    portalRouter: express.Router(),
    serviceTokenMiddleware: (_req, _res, next) => next(),
    zendeskRouter: express.Router()
  });

  return { app, service };
}

describe("createSystemSettingsRouter", () => {
  it("returns draft and published settings to authorized admins", async () => {
    const { app, service } = buildApp();

    const response = await request(app).get("/api/admin/system-settings");

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("draft");
    expect(response.body).toHaveProperty("published");
    expect(service.read).toHaveBeenCalledTimes(1);
  });

  it("saves the current draft when write permission is granted", async () => {
    const { app, service } = buildApp();

    const response = await request(app)
      .put("/api/admin/system-settings/draft")
      .send({
        branding: {
          platformName: "Agent Studio Pro"
        }
      });

    expect(response.status).toBe(200);
    expect(response.body.draft.payload.branding.platformName).toBe("Agent Studio Pro");
    expect(service.updateDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "admin-1",
        patch: expect.objectContaining({
          branding: expect.objectContaining({
            platformName: "Agent Studio Pro"
          })
        })
      })
    );
  });

  it("publishes the current draft when publish permission is granted", async () => {
    const { app, service } = buildApp();

    const response = await request(app).post("/api/admin/system-settings/publish").send({});

    expect(response.status).toBe(200);
    expect(response.body.publishedMeta.publishedByUserId).toBe("admin-1");
    expect(service.publish).toHaveBeenCalledWith({ actorUserId: "admin-1" });
  });

  it("denies draft writes without system_settings.write", async () => {
    const { app, service } = buildApp({ allowedPermissions: ["system_settings.read", "system_settings.publish"] });

    const response = await request(app)
      .put("/api/admin/system-settings/draft")
      .send({
        branding: {
          platformName: "Blocked"
        }
      });

    expect(response.status).toBe(403);
    expect(service.updateDraft).not.toHaveBeenCalled();
  });
});
