import express, { type Request } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { CodexSkillService } from "./codex-skill-service.js";
import { createAdminCodexSkillRouter, createPortalCodexSkillRouter } from "./router.js";

function appFor(router: express.Router) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.currentOrganization = { id: "org-1" } as Request["currentOrganization"];
    req.currentUser = { id: "owner-1", displayName: "Owner" } as Request["currentUser"];
    next();
  });
  app.use(router);
  return app;
}

describe("managed Codex Skill content route", () => {
  it("is available to the admin router and not exposed by the portal router", async () => {
    const readManagedSkillMdForAdmin = vi.fn(async () => ({
      skill: { id: "skill-1", skillName: "support-triage" },
      content: "# Workflow"
    }));
    const service = { readManagedSkillMdForAdmin } as unknown as CodexSkillService;

    const adminResponse = await request(appFor(createAdminCodexSkillRouter(service)))
      .get("/codex-managed-skills/skill-1/content")
      .expect(200);
    expect(adminResponse.body.content).toBe("# Workflow");
    expect(readManagedSkillMdForAdmin).toHaveBeenCalledWith({ skillId: "skill-1", organizationId: "org-1" });

    await request(appFor(createPortalCodexSkillRouter(service)))
      .get("/codex-managed-skills/skill-1/content")
      .expect(404);
  });
});

describe("managed Codex Skill member sharing routes", () => {
  it("loads and replaces members without exposing an approval flow", async () => {
    const state = {
      skillId: "skill-1",
      ownerUserId: "owner-1",
      owner: { userId: "owner-1", displayName: "Owner" },
      members: [{ userId: "member-1", displayName: "Member" }],
      availableMembers: [{ userId: "member-1", displayName: "Member" }]
    };
    const service = {
      getManagedSkillSharing: vi.fn(async () => state),
      updateManagedSkillSharing: vi.fn(async () => state)
    } as unknown as CodexSkillService;
    const app = appFor(createPortalCodexSkillRouter(service));

    await request(app).get("/codex-managed-skills/skill-1/sharing").expect(200, state);
    await request(app).put("/codex-managed-skills/skill-1/sharing").send({ user_ids: ["member-1"] }).expect(200, state);
    expect(service.updateManagedSkillSharing).toHaveBeenCalledWith({
      actor: expect.objectContaining({ id: "owner-1", organizationId: "org-1" }),
      skillId: "skill-1",
      userIds: ["member-1"]
    });
  });
});
