import express, { Router } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { registerCommonApiRoutes } from "../app-routes.js";
import { createSendFailureAuditRouter } from "./send-failure-audit-router.js";

function setup() {
  const query = vi.fn(async (sql: { text: string }) => sql.text.includes("count(*)") ? [{ total: 1 }] : [{ id: "orphan", threadId: null, stage: "thread_create" }]);
  const app = express();
  registerCommonApiRoutes(app, {
    currentUserMiddleware: (req, _res, next) => {
      const role = req.header("x-role");
      if (role) {
        req.currentUser = { id: "user", status: "active", role, userType: "internal_employee" } as never;
        req.currentMembership = { status: "active" } as never;
        req.currentOrganization = { id: "org", type: "internal" } as never;
      }
      next();
    }, authRouter: Router(), portalRouter: Router(), zendeskRouter: Router(),
    serviceTokenMiddleware: (_req, _res, next) => next(),
    adminRouter: createSendFailureAuditRouter(() => ({ $queryRaw: query } as never)) as never
  });
  return { app, query };
}

describe("send failure admin audit", () => {
  it("requires an internal administrator before querying any records", async () => {
    const { app, query } = setup();
    await request(app).get("/api/admin/conversations/send-failures").expect(401);
    await request(app).get("/api/admin/conversations/send-failures").set("x-role", "member").expect(403);
    expect(query).not.toHaveBeenCalled();
  });
  it("returns unlinked failures with a bounded page and parameterized filters", async () => {
    const { app, query } = setup();
    const response = await request(app).get("/api/admin/conversations/send-failures").query({ user: "O'Reilly", stage: "thread_create", page: 2, from: "2026-10-09T00:00:00Z" }).set("x-role", "admin").expect(200);
    expect(response.body).toEqual({ items: [{ id: "orphan", threadId: null, stage: "thread_create" }], total: 1, page: 2, pageSize: 25 });
    const sql = query.mock.calls[0][0] as unknown as { text: string; values: unknown[] };
    expect(sql.text).toContain("f.thread_id IS NULL");
    expect(sql.text).toContain("t.security_domain_id IS NULL");
    expect(sql.text).not.toContain("O'Reilly");
    expect(sql.values).toContain("O'Reilly");
    expect(sql.values).toContain(25);
  });
  it("rejects invalid dates and page bounds", async () => {
    const { app, query } = setup();
    for (const params of [{ page: 0 }, { from: "invalid" }, { from: "2026-10-10T00:00:00Z", to: "2026-10-09T00:00:00Z" }]) {
      await request(app).get("/api/admin/conversations/send-failures").query(params).set("x-role", "admin").expect(400);
    }
    expect(query).not.toHaveBeenCalled();
  });
});
