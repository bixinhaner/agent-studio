import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import {
  createAuthenticatedExternalWebGate,
  createExternalWebSurfaceGate,
  createPublicExternalWebGate,
  EXTERNAL_WEB_MAINTENANCE_MESSAGE,
  ExternalWebAccessService
} from "./external-web-access.js";

function createDb() {
  let row: {
    key: string;
    enabled: boolean;
    updatedByUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null = null;
  return {
    runtimeControl: {
      async findUnique() {
        return row;
      },
      async upsert(input: {
        create: { key: string; enabled: boolean; updatedByUserId: string };
        update: { enabled: boolean; updatedByUserId: string };
      }) {
        const now = new Date();
        row = row
          ? { ...row, ...input.update, updatedAt: now }
          : { ...input.create, createdAt: now, updatedAt: now };
        return row;
      }
    }
  };
}

describe("ExternalWebAccessService", () => {
  it("defaults to open and audits state changes", async () => {
    const audits = { create: vi.fn(async () => ({})) };
    const service = new ExternalWebAccessService(createDb(), audits);

    await expect(service.getState()).resolves.toMatchObject({
      maintenanceEnabled: false,
      updatedAt: null
    });

    const next = await service.setMaintenanceEnabled({
      maintenanceEnabled: true,
      actorUserId: "admin-1",
      organizationId: "internal-org"
    });

    expect(next.maintenanceEnabled).toBe(true);
    expect(audits.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "admin-1",
        actionType: "runtime_control.external_web_maintenance",
        beforePayload: expect.objectContaining({ maintenanceEnabled: false }),
        afterPayload: expect.objectContaining({ maintenanceEnabled: true })
      })
    );
  });
});

describe("external Web access gates", () => {
  it("returns the single maintenance message for public Web routes", async () => {
    const app = express();
    app.use(createPublicExternalWebGate({ isMaintenanceEnabled: async () => true }));
    app.get("/entry", (_req, res) => res.json({ ok: true }));

    const response = await request(app).get("/entry");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ detail: EXTERNAL_WEB_MAINTENANCE_MESSAGE });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("blocks external actors while preserving internal employees", async () => {
    const app = express();
    app.use((req, _res, next) => {
      if (req.header("x-actor") === "external") {
        req.currentUser = { id: "external-1", userType: "external_user" } as never;
        req.currentOrganization = { id: "customer-1", type: "customer" } as never;
      } else {
        req.currentUser = { id: "internal-1", userType: "internal_employee" } as never;
        req.currentOrganization = { id: "internal-org", type: "internal" } as never;
      }
      next();
    });
    app.use(createAuthenticatedExternalWebGate({ isMaintenanceEnabled: async () => true }));
    app.get("/portal", (_req, res) => res.json({ ok: true }));

    expect((await request(app).get("/portal").set("x-actor", "external")).status).toBe(503);
    expect((await request(app).get("/portal").set("x-actor", "internal")).status).toBe(200);
  });

  it("shows maintenance before authentication on internal-only Web surfaces", async () => {
    const app = express();
    app.use(createExternalWebSurfaceGate({ isMaintenanceEnabled: async () => true }));
    app.get("/share", (_req, res) => res.status(401).json({ detail: "Unauthorized" }));

    const response = await request(app).get("/share");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ detail: EXTERNAL_WEB_MAINTENANCE_MESSAGE });
  });
});
