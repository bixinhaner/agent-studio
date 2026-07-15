import express, { type Request } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { CodexSkillService } from "./codex-skill-service.js";
import { createAdminCodexSkillRouter, createPortalCodexSkillRouter } from "./router.js";

function appFor(router: express.Router) {
  const app = express();
  app.use((req, _res, next) => {
    req.currentOrganization = { id: "org-1" } as Request["currentOrganization"];
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
