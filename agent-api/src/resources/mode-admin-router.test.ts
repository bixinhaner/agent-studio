import express, { type Request } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createModeAdminRouter } from "./mode-admin-router.js";

function createHarness(input?: { skillPackageVisible?: boolean }) {
  const createConfigured = vi.fn(async (payload) => ({ id: "agent-1", ...payload.agentMode }));
  const agentModes = {
    list: vi.fn(async () => [
      { id: "global", name: "Global" },
      { id: "current", name: "Current", organizationId: "org-1" },
      { id: "other", name: "Other", organizationId: "org-2" }
    ]),
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    replaceSkillPackages: vi.fn(),
    replaceInstructionSources: vi.fn(),
    createConfigured,
    updateConfigured: vi.fn()
  };
  const runProfiles = {
    list: vi.fn(async () => []),
    create: vi.fn(),
    get: vi.fn(async () => ({
      id: "run-1",
      name: "Balanced",
      defaultModel: "gpt-5",
      status: "active",
      organizationId: "org-1"
    })),
    update: vi.fn()
  };
  const skillPackages = {
    list: vi.fn(async () => []),
    create: vi.fn(),
    get: vi.fn(async () => ({
      id: "skill-1",
      name: "Support",
      status: "active",
      visibleToUsers: input?.skillPackageVisible ?? true,
      organizationId: "org-1",
      items: []
    })),
    update: vi.fn(),
    replaceItems: vi.fn()
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.currentOrganization = { id: "org-1" } as Request["currentOrganization"];
    next();
  });
  app.use(createModeAdminRouter({ runProfiles, skillPackages, agentModes }));
  return { app, createConfigured };
}

const configuration = {
  agentMode: {
    name: "Support agent",
    slug: "support-agent",
    status: "active",
    visibleToUsers: true,
    runProfileId: "run-1"
  },
  skillPackageIds: ["skill-1"],
  instructionSources: [{ sourceType: "workspace_agents_md", sourceRef: "{\"version\":1,\"kind\":\"inline\",\"content\":\"# Role\"}" }]
};

describe("mode admin configured agent routes", () => {
  it("creates the complete configuration in one repository call and injects the current organization", async () => {
    const { app, createConfigured } = createHarness();
    await request(app).post("/agent-modes/configured").send(configuration).expect(201);
    expect(createConfigured).toHaveBeenCalledOnce();
    expect(createConfigured.mock.calls[0]?.[0].agentMode.organizationId).toBe("org-1");
  });

  it("rejects a user-visible agent that binds an admin-only skill package", async () => {
    const { app, createConfigured } = createHarness({ skillPackageVisible: false });
    const response = await request(app).post("/agent-modes/configured").send(configuration).expect(400);
    expect(response.body.detail).toContain("不会进入当前智能体的用户运行时");
    expect(createConfigured).not.toHaveBeenCalled();
  });

  it("does not return resources owned by another organization", async () => {
    const { app } = createHarness();
    const response = await request(app).get("/agent-modes").expect(200);
    expect(response.body.agentModes.map((item: { id: string }) => item.id)).toEqual(["global", "current"]);
  });
});
