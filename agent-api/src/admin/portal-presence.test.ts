import express, { Router } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { registerCommonApiRoutes } from "../app-routes.js";
import {
  createPortalPresenceAuditRouter,
  createPortalPresenceRouter,
  presenceSlotStart,
  type PortalPresenceDb
} from "./portal-presence.js";

type Row = {
  userId: string;
  slotStart: Date;
  firstSeenAt: Date;
  lastSeenAt: Date;
  hits: number;
  buildId: string | null;
  userAgent?: string | null;
  organizationId?: string | null;
};

function memoryDb() {
  const rows = new Map<string, Row>();
  const keyOf = (userId: string, slotStart: Date) => `${userId}|${slotStart.toISOString()}`;
  const db: PortalPresenceDb = {
    portalPresenceSlot: {
      upsert: vi.fn(async ({ where, create, update }) => {
        const key = keyOf(where.userId_slotStart.userId, where.userId_slotStart.slotStart);
        const existing = rows.get(key);
        if (existing) {
          rows.set(key, { ...existing, lastSeenAt: update.lastSeenAt, hits: existing.hits + update.hits.increment, buildId: update.buildId ?? null });
        } else {
          rows.set(key, { ...create, hits: 1, buildId: create.buildId ?? null });
        }
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      findMany: vi.fn(async ({ where }) =>
        [...rows.values()]
          .filter((row) => row.slotStart >= where.slotStart.gte && row.slotStart < where.slotStart.lt)
          .sort((a, b) => a.slotStart.getTime() - b.slotStart.getTime())
      )
    },
    user: {
      findMany: vi.fn(async ({ where }) =>
        where.id.in.map((id: string) => ({ id, displayName: id === "u-xiao" ? "肖秩瑄" : "谭茗月", email: `${id}@example.com` }))
      )
    }
  };
  return { db, rows };
}

function setup(clock: { now: Date }) {
  const { db, rows } = memoryDb();
  const app = express();
  app.use(express.json());
  registerCommonApiRoutes(app, {
    currentUserMiddleware: (req, _res, next) => {
      const user = req.header("x-user");
      const role = req.header("x-role") ?? "member";
      if (user) {
        req.currentUser = { id: user, status: "active", role, userType: "internal_employee" } as never;
        req.currentMembership = { status: "active" } as never;
        req.currentOrganization = { id: "org_internal", type: "internal" } as never;
      }
      next();
    },
    authRouter: Router(),
    portalRouter: Router(),
    zendeskRouter: Router(),
    serviceTokenMiddleware: (_req, _res, next) => next(),
    adminRouter: createPortalPresenceAuditRouter(() => db) as never,
    portalPresenceRouter: createPortalPresenceRouter({ getDb: () => db, now: () => clock.now })
  });
  return { app, db, rows };
}

describe("portal presence", () => {
  it("records signed-in visits in 10-minute slots and skips heartbeats inside a minute", async () => {
    const clock = { now: new Date("2026-11-02T03:41:10.000Z") };
    const { app, db, rows } = setup(clock);

    await request(app).post("/api/portal-presence").send({}).expect(401);
    await request(app).post("/api/portal-presence").set("x-user", "u-xiao").send({ build_id: "b1" }).expect(204);
    clock.now = new Date("2026-11-02T03:41:40.000Z");
    await request(app).post("/api/portal-presence").set("x-user", "u-xiao").send({ build_id: "b1" }).expect(204);
    expect(db.portalPresenceSlot.upsert).toHaveBeenCalledTimes(1);

    clock.now = new Date("2026-11-02T03:46:00.000Z");
    await request(app).post("/api/portal-presence").set("x-user", "u-xiao").send({ build_id: "b2" }).expect(204);
    const row = rows.get("u-xiao|2026-11-02T03:40:00.000Z");
    expect(row).toMatchObject({ hits: 2, buildId: "b2", organizationId: "org_internal" });
    expect(row?.firstSeenAt.toISOString()).toBe("2026-11-02T03:41:10.000Z");
    expect(row?.lastSeenAt.toISOString()).toBe("2026-11-02T03:46:00.000Z");
  });

  it("answers who had the portal open in a time range, for internal administrators only", async () => {
    const clock = { now: new Date("2026-11-02T03:20:00.000Z") };
    const { app } = setup(clock);
    for (const [user, at] of [
      ["u-tan", "2026-11-02T03:20:00.000Z"],
      ["u-xiao", "2026-11-02T03:39:00.000Z"],
      ["u-xiao", "2026-11-02T04:05:00.000Z"],
      ["u-tan", "2026-11-02T05:30:00.000Z"]
    ] as const) {
      clock.now = new Date(at);
      await request(app).post("/api/portal-presence").set("x-user", user).send({}).expect(204);
    }

    const range = { from: "2026-11-02T03:34:00.000Z", to: "2026-11-02T05:09:00.000Z" };
    await request(app).get("/api/admin/portal-presence").query(range).set("x-user", "viewer").expect(403);
    const response = await request(app).get("/api/admin/portal-presence").query(range).set("x-user", "boss").set("x-role", "admin").expect(200);
    expect(response.body.total).toBe(1);
    expect(response.body.items[0]).toMatchObject({
      userId: "u-xiao",
      userName: "肖秩瑄",
      firstSeenAt: "2026-11-02T03:39:00.000Z",
      lastSeenAt: "2026-11-02T04:05:00.000Z",
      activeMinutes: 20,
      slots: ["2026-11-02T03:30:00.000Z", "2026-11-02T04:00:00.000Z"]
    });

    const filtered = await request(app)
      .get("/api/admin/portal-presence")
      .query({ from: "2026-11-02T03:00:00.000Z", to: "2026-11-02T06:00:00.000Z", user: "谭" })
      .set("x-user", "boss")
      .set("x-role", "admin")
      .expect(200);
    expect(filtered.body.items.map((item: { userId: string }) => item.userId)).toEqual(["u-tan"]);
  }, 15_000);

  it("rejects reversed or overly long ranges", async () => {
    const { app } = setup({ now: new Date() });
    for (const query of [
      { from: "2026-11-02T05:00:00Z", to: "2026-11-02T04:00:00Z" },
      { from: "2026-09-01T00:00:00Z", to: "2026-11-02T00:00:00Z" },
      { from: "yesterday", to: "2026-11-02T00:00:00Z" }
    ]) {
      await request(app).get("/api/admin/portal-presence").query(query).set("x-user", "boss").set("x-role", "admin").expect(400);
    }
  });

  it("buckets times into 10-minute slots", () => {
    expect(presenceSlotStart(new Date("2026-11-02T03:59:59.999Z")).toISOString()).toBe("2026-11-02T03:50:00.000Z");
  });
});
