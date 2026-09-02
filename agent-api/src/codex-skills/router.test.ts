import express, { type Request } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { ManagedSkillNameConflictError, type CodexSkillService } from "./codex-skill-service.js";
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

describe("managed Codex Skill install conflict route", () => {
  it("returns a structured 409 and forwards an explicit fork confirmation", async () => {
    const conflict = {
      skillId: "shared-1",
      skillName: "tp-generator",
      ownerUserId: "owner-2",
      ownerDisplayName: "Shared Owner",
      suggestedName: "tp-generator-personal"
    };
    const installSkillFromDirectory = vi.fn()
      .mockRejectedValueOnce(new ManagedSkillNameConflictError(conflict))
      .mockResolvedValueOnce({ id: "personal-1", skillName: "tp-generator-personal" });
    const service = { installSkillFromDirectory } as unknown as CodexSkillService;
    const app = appFor(createPortalCodexSkillRouter(service));
    app.locals.resolveCodexSkillThreadPath = vi.fn(async () => "/threads/thread-1/tp-generator");

    const blocked = await request(app)
      .post("/codex-managed-skills/install-from-thread-path")
      .send({ thread_id: "thread-1", path: "tp-generator" })
      .expect(409);
    expect(blocked.body).toEqual({
      detail: "Skill tp-generator 由其他成员共享，不能直接覆盖",
      code: "SKILL_NAME_SHARED_CONFLICT",
      conflict
    });

    await request(app)
      .post("/codex-managed-skills/install-from-thread-path")
      .send({ thread_id: "thread-1", path: "tp-generator", conflict_action: "fork" })
      .expect(201);
    expect(installSkillFromDirectory).toHaveBeenLastCalledWith(expect.objectContaining({ conflictAction: "fork" }));
  });
});
