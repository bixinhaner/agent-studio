import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createJoinRequestRateLimiter, createOrgJoinRequestPublicRouter, createOrgTeamPortalRouter } from "./router.js";
import { OrgTeamError, type OrgTeamService } from "./service.js";

function portalApp(service: Partial<OrgTeamService>, membershipType = "customer_admin") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.currentUser = { id: "u_ali", email: "Ali@Opticoms.de" } as never;
    req.currentOrganization = { id: "org_opticoms" } as never;
    req.currentMembership = { membershipType } as never;
    next();
  });
  app.use("/api/org-team", createOrgTeamPortalRouter(service as OrgTeamService));
  return app;
}

describe("org team portal router", () => {
  it("acts on the signed-in admin's active organization only", async () => {
    const inviteMember = vi.fn(async () => ({ id: "invite_1" }));
    const response = await request(portalApp({ inviteMember } as never))
      .post("/api/org-team/team/invites")
      .send({ email: "b@opticoms.de", organizationId: "org_other" });

    expect(response.status).toBe(201);
    expect(inviteMember).toHaveBeenCalledWith(
      "org_opticoms",
      { kind: "customer", userId: "u_ali", email: "ali@opticoms.de", organizationId: "org_opticoms", membershipType: "customer_admin" },
      { email: "b@opticoms.de" }
    );
  });

  it("passes service errors through with their status and code", async () => {
    const getOverview = vi.fn(async () => {
      throw new OrgTeamError(403, "forbidden", "Only organization admins can manage the team.");
    });
    const response = await request(portalApp({ getOverview } as never, "customer_member")).get("/api/org-team/team");
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ detail: "Only organization admins can manage the team.", code: "forbidden" });
  });

  it("routes approve and reject decisions", async () => {
    const approveJoinRequest = vi.fn(async () => ({ status: "approved" }));
    const rejectJoinRequest = vi.fn(async () => ({ status: "rejected" }));
    const app = portalApp({ approveJoinRequest, rejectJoinRequest } as never);
    await request(app).post("/api/org-team/team/join-requests/join_1/approve").expect(200);
    await request(app).post("/api/org-team/team/join-requests/join_1/reject").expect(200);
    await request(app).post("/api/org-team/team/join-requests/join_1/delete").expect(404);
    expect(approveJoinRequest).toHaveBeenCalledWith("org_opticoms", expect.anything(), "join_1");
    expect(rejectJoinRequest).toHaveBeenCalledTimes(1);
  });
});

describe("public join request router", () => {
  it("uses the visitor address Caddy appended and rate limits it", async () => {
    const submitJoinRequest = vi.fn(async () => ({ ok: true as const }));
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.publicBrand = { id: "brand_ranley" } as never;
      next();
    });
    app.use(
      "/public-api/org-join-requests",
      createOrgJoinRequestPublicRouter({ submitJoinRequest } as never, createJoinRequestRateLimiter({ limit: 1, windowMs: 60_000 }))
    );

    await request(app).post("/public-api/org-join-requests").set("X-Forwarded-For", "1.1.1.1, 9.9.9.9").send({ email: "b@opticoms.de" }).expect(202);
    // A spoofed first hop does not reset the limit for the same visitor.
    await request(app).post("/public-api/org-join-requests").set("X-Forwarded-For", "2.2.2.2, 9.9.9.9").send({ email: "b@opticoms.de" }).expect(429);
    await request(app).post("/public-api/org-join-requests").set("X-Forwarded-For", "8.8.8.8").send({ email: "c@opticoms.de" }).expect(202);
    expect(submitJoinRequest).toHaveBeenCalledWith({ email: "b@opticoms.de", publicBrandId: "brand_ranley" });
  });
});
