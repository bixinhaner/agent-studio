import express, { Router } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { registerCommonApiRoutes } from "./app-routes.js";
import { createLocalBridgeRouter } from "./local-bridge-router.js";

describe("registerCommonApiRoutes Local Bridge authentication", () => {
  it("parses Portal sessions but lets a desktop app redeem a pairing code without a session cookie", async () => {
    const createDevice = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "device-1",
      ...data
    }));
    const connections = new Map<string, any>();
    const testDb: any = {
      localBridgeDevice: { create: createDevice },
      localBridgeConnection: {
        create: async ({ data }: any) => { const c = { id: `connection-${connections.size + 1}`, status: "pending", ...data }; connections.set(c.tokenHash, c); return c; },
        findUnique: async ({ where }: any) => connections.get(where.tokenHash),
        updateMany: async ({ where, data }: any) => { const c = [...connections.values()].find(v => (where.id ? v.id === where.id : v.tokenHash === where.tokenHash) && v.status === where.status); if (!c) return { count: 0 }; Object.assign(c, data); return { count: 1 }; },
        update: async () => ({})
      },
      $transaction: (fn: any) => fn(testDb)
    };
    const app = express();
    app.use(express.json());
    registerCommonApiRoutes(app, {
      currentUserMiddleware: (req, _res, next) => {
        if (req.header("x-test-user") === "portal-user") {
          req.currentUser = { id: "user-1", status: "active" } as never;
          req.currentOrganization = { id: "organization-1", type: "internal" } as never;
          req.currentMembership = {
            status: "active",
            membershipType: "employee",
            organizationId: "organization-1",
            organization: req.currentOrganization
          } as never;
        }
        next();
      },
      authRouter: Router(),
      adminRouter: Router() as never,
      portalRouter: Router(),
      localBridgeRouter: createLocalBridgeRouter(testDb),
      serviceTokenMiddleware: (_req, _res, next) => next(),
      zendeskRouter: Router()
    });

    const pairing = await request(app)
      .post("/api/local-bridge/devices/pairing")
      .set("x-test-user", "portal-user")
      .expect(201);

    const outdated = await request(app)
      .post("/api/local-bridge/devices/pairing")
      .set("x-test-user", "portal-user")
      .expect(201);
    const refused = await request(app)
      .post("/api/local-bridge/agent/pair")
      .send({ code: outdated.body.code, name: "Old Mac", platform: "darwin" })
      .expect(426);
    expect(refused.body.detail).toContain("新版");
    expect([...connections.values()].find(c => c.status === "update_required")).toBeTruthy();
    expect(createDevice).not.toHaveBeenCalled();

    const paired = await request(app)
      .post("/api/local-bridge/agent/pair")
      .set("x-local-bridge-version", "0.3.0")
      .send({ code: pairing.body.code, name: "Test Mac", platform: "darwin" })
      .expect(201);

    expect(paired.body).toEqual(expect.objectContaining({ device_id: "device-1" }));

    expect(createDevice).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        name: "Test Mac",
        platform: "darwin",
        status: "active"
      })
    });
    await request(app).get("/api/local-bridge/devices").expect(401, { detail: "Unauthorized" });
    await request(app)
      .post("/api/local-bridge/agent/poll")
      .expect(401, { detail: "Missing device token" });
    await request(app).get("/api/generic").expect(401, { detail: "Unauthorized" });
  });
});
