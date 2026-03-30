import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { registerCommonApiRoutes } from "../app-routes.js";
import type { DingTalkClient } from "../auth/dingtalk.js";
import { createAuthRouter } from "../auth/router.js";
import { createCurrentUserMiddleware } from "../auth/current-user.js";
import { createSessionCookieManager } from "../auth/session-cookie.js";
import type { AuthenticatedUser, UserRecord, UserRepositoryLike } from "../persistence/user-repository.js";
import { createModeAdminRouter } from "./mode-admin-router.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0, tempRoots.length).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("mode admin router", () => {
  it("creates, lists, and updates run profiles", async () => {
    const { app, cookies, adminUser } = await buildModeAdminApp();

    const createResponse = await request(app)
      .post("/api/admin/run-profiles")
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        name: "Standard Profile",
        slug: "standard-profile",
        defaultModel: "gpt-5.4",
        allowedModels: ["gpt-5.4", "gpt-5.4-mini"],
        defaultReasoningEffort: "high",
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
        networkAccessEnabled: true,
        webSearchMode: "disabled"
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.runProfile).toMatchObject({
      name: "Standard Profile",
      slug: "standard-profile",
      allowedModels: ["gpt-5.4", "gpt-5.4-mini"],
      networkAccessEnabled: true
    });

    const updateResponse = await request(app)
      .patch(`/api/admin/run-profiles/${createResponse.body.runProfile.id}`)
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        description: " Updated standard profile ",
        webSearchMode: "live"
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.runProfile).toMatchObject({
      id: createResponse.body.runProfile.id,
      description: "Updated standard profile",
      webSearchMode: "live"
    });

    const listResponse = await request(app).get("/api/admin/run-profiles").set("Cookie", cookies.create(adminUser.id));
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.runProfiles).toEqual([expect.objectContaining({ id: createResponse.body.runProfile.id })]);
  });

  it("copies a run profile into a disabled record", async () => {
    const { app, cookies, adminUser } = await buildModeAdminApp();

    const createResponse = await request(app)
      .post("/api/admin/run-profiles")
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        name: "Coding Default",
        slug: "coding-default",
        description: "default",
        status: "active",
        defaultModel: "gpt-5.4",
        allowedModels: ["gpt-5.4"],
        defaultReasoningEffort: "high",
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
        networkAccessEnabled: true,
        webSearchMode: "live"
      });

    const response = await request(app)
      .post(`/api/admin/run-profiles/${createResponse.body.runProfile.id}/copy`)
      .set("Cookie", cookies.create(adminUser.id))
      .send({ name: "Coding Default Copy", slug: "coding-default-copy" });

    expect(response.status).toBe(201);
    expect(response.body.runProfile).toMatchObject({
      name: "Coding Default Copy",
      slug: "coding-default-copy",
      status: "disabled",
      defaultModel: "gpt-5.4",
      allowedModels: ["gpt-5.4"]
    });
  });

  it("creates skill packages and replaces nested runtime bindings through the compatibility endpoint", async () => {
    const { app, cookies, adminUser } = await buildModeAdminApp();

    const createResponse = await request(app)
      .post("/api/admin/skill-packages")
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        name: "Code Tools",
        slug: "code-tools",
        visibleToUsers: true
      });

    expect(createResponse.status).toBe(201);

    const replaceResponse = await request(app)
      .put(`/api/admin/skill-packages/${createResponse.body.skillPackage.id}/runtime-bindings`)
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        items: [
          {
            capabilityKey: "filesystem.write",
            description: "Write files",
            runtimeBindings: [{ runtimeType: "codex", bindingType: "config_fragment", bindingPayload: { tool: "fs_write" } }]
          },
          {
            capabilityKey: "filesystem.read",
            description: "Read files",
            runtimeBindings: [
              { runtimeType: "codex", bindingType: "config_fragment", bindingPayload: { tool: "fs_read" } }
            ]
          }
        ]
      });

    expect(replaceResponse.status).toBe(200);
    expect(replaceResponse.body.skillPackage.items).toHaveLength(2);
    expect(replaceResponse.body.skillPackage.items[0]).toMatchObject({
      capabilityKey: "filesystem.write",
      runtimeBindings: [
        {
          runtimeType: "codex",
          bindingType: "config_fragment",
          bindingPayload: { tool: "fs_write" }
        }
      ]
    });

    const listResponse = await request(app).get("/api/admin/skill-packages").set("Cookie", cookies.create(adminUser.id));
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.skillPackages).toEqual([
      expect.objectContaining({
        id: createResponse.body.skillPackage.id,
        items: [
          expect.objectContaining({ capabilityKey: "filesystem.write" }),
          expect.objectContaining({ capabilityKey: "filesystem.read" })
        ]
      })
    ]);
  });

  it("copies a skill package into a disabled hidden record", async () => {
    const { app, cookies, adminUser } = await buildModeAdminApp();

    const createResponse = await request(app)
      .post("/api/admin/skill-packages")
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        name: "Code Tools",
        slug: "code-tools",
        description: "Existing tools",
        status: "active",
        visibleToUsers: true
      });

    await request(app)
      .put(`/api/admin/skill-packages/${createResponse.body.skillPackage.id}/runtime-bindings`)
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        items: [
          {
            capabilityKey: "filesystem.write",
            description: "Write files",
            runtimeBindings: [{ runtimeType: "codex", bindingType: "config_fragment", bindingPayload: { tool: "fs_write" } }]
          }
        ]
      })
      .expect(200);

    const response = await request(app)
      .post(`/api/admin/skill-packages/${createResponse.body.skillPackage.id}/copy`)
      .set("Cookie", cookies.create(adminUser.id))
      .send({ name: "Code Tools Copy", slug: "code-tools-copy" });

    expect(response.status).toBe(201);
    expect(response.body.skillPackage).toMatchObject({
      name: "Code Tools Copy",
      slug: "code-tools-copy",
      status: "disabled",
      visibleToUsers: false,
      items: [expect.objectContaining({ capabilityKey: "filesystem.write" })]
    });
  });

  it("creates agent modes and replaces skill package, workspace, and instruction-source bindings", async () => {
    const { app, cookies, adminUser, runProfiles, skillPackages } = await buildModeAdminApp();
    const runProfile = await runProfiles.create({
      name: "Standard Profile",
      slug: "standard-profile",
      defaultModel: "gpt-5.4",
      allowedModels: ["gpt-5.4"],
      defaultReasoningEffort: "high",
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: true,
      webSearchMode: "disabled"
    });
    const skillPackage = await skillPackages.create({
      name: "Code Tools",
      slug: "code-tools"
    });

    const createResponse = await request(app)
      .post("/api/admin/agent-modes")
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        name: "Coding Assistant",
        slug: "coding-assistant",
        runProfileId: runProfile.id,
        visibleToUsers: true
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.agentMode).toMatchObject({
      name: "Coding Assistant",
      runProfileId: runProfile.id
    });

    const skillPackagesResponse = await request(app)
      .put(`/api/admin/agent-modes/${createResponse.body.agentMode.id}/skill-packages`)
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        skillPackageIds: [skillPackage.id]
      });

    expect(skillPackagesResponse.status).toBe(200);
    expect(skillPackagesResponse.body.agentMode.skillPackages).toEqual([
      expect.objectContaining({ skillPackageId: skillPackage.id })
    ]);

    const workspacesResponse = await request(app)
      .put(`/api/admin/agent-modes/${createResponse.body.agentMode.id}/workspaces`)
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        workspaces: [
          {
            workspaceId: "workspace-1",
            isDefault: true,
            allowDirectorySelection: true,
            directoryScope: "authorized_workspace_and_knowledge_set",
            loadWorkspaceAgentsMd: true
          }
        ]
      });

    expect(workspacesResponse.status).toBe(200);
    expect(workspacesResponse.body.agentMode.workspaces).toEqual([
      expect.objectContaining({
        workspaceId: "workspace-1",
        isDefault: true,
        allowDirectorySelection: true,
        directoryScope: "authorized_workspace_and_knowledge_set",
        loadWorkspaceAgentsMd: true
      })
    ]);

    const instructionSourcesResponse = await request(app)
      .put(`/api/admin/agent-modes/${createResponse.body.agentMode.id}/instruction-sources`)
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        instructionSources: [
          {
            sourceType: "workspace_agents_md",
            sourceRef: "workspace-root",
            sortOrder: 10
          }
        ]
      });

    expect(instructionSourcesResponse.status).toBe(200);
    expect(instructionSourcesResponse.body.agentMode.instructionSources).toEqual([
      expect.objectContaining({
        sourceType: "workspace_agents_md",
        sourceRef: "workspace-root",
        sortOrder: 10
      })
    ]);

    const listResponse = await request(app).get("/api/admin/agent-modes").set("Cookie", cookies.create(adminUser.id));
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.agentModes).toEqual([
      expect.objectContaining({
        id: createResponse.body.agentMode.id,
        skillPackages: [expect.objectContaining({ skillPackageId: skillPackage.id })],
        workspaceRules: [expect.objectContaining({ workspaceId: "workspace-1" })],
        instructionSources: [expect.objectContaining({ sourceType: "workspace_agents_md" })]
      })
    ]);
  });

  it("copies an agent mode into a disabled hidden record with bindings", async () => {
    const { app, cookies, adminUser, runProfiles, skillPackages } = await buildModeAdminApp();
    const runProfile = await runProfiles.create({
      name: "Standard Profile",
      slug: "standard-profile",
      defaultModel: "gpt-5.4",
      allowedModels: ["gpt-5.4"],
      defaultReasoningEffort: "high",
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: true,
      webSearchMode: "disabled"
    });
    const skillPackage = await skillPackages.create({
      name: "Code Tools",
      slug: "code-tools",
      visibleToUsers: true
    });

    const createResponse = await request(app)
      .post("/api/admin/agent-modes")
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        name: "Coding Assistant",
        slug: "coding-assistant",
        runProfileId: runProfile.id,
        visibleToUsers: true,
        status: "active"
      })
      .expect(201);

    await request(app)
      .put(`/api/admin/agent-modes/${createResponse.body.agentMode.id}/skill-packages`)
      .set("Cookie", cookies.create(adminUser.id))
      .send({ skillPackageIds: [skillPackage.id] })
      .expect(200);

    await request(app)
      .put(`/api/admin/agent-modes/${createResponse.body.agentMode.id}/workspaces`)
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        workspaces: [
          {
            workspaceId: "workspace-1",
            isDefault: true,
            allowDirectorySelection: true,
            directoryScope: "authorized_workspace_and_knowledge_set",
            loadWorkspaceAgentsMd: true
          }
        ]
      })
      .expect(200);

    await request(app)
      .put(`/api/admin/agent-modes/${createResponse.body.agentMode.id}/instruction-sources`)
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        instructionSources: [
          {
            sourceType: "workspace_agents_md",
            sourceRef: "workspace-root",
            sortOrder: 1
          }
        ]
      })
      .expect(200);

    const response = await request(app)
      .post(`/api/admin/agent-modes/${createResponse.body.agentMode.id}/copy`)
      .set("Cookie", cookies.create(adminUser.id))
      .send({ name: "Coding Assistant Copy", slug: "coding-assistant-copy" });

    expect(response.status).toBe(201);
    expect(response.body.agentMode).toMatchObject({
      name: "Coding Assistant Copy",
      slug: "coding-assistant-copy",
      status: "disabled",
      visibleToUsers: false,
      runProfileId: runProfile.id,
      skillPackages: [expect.objectContaining({ skillPackageId: skillPackage.id })],
      workspaceRules: [expect.objectContaining({ workspaceId: "workspace-1" })],
      instructionSources: [expect.objectContaining({ sourceType: "workspace_agents_md", sourceRef: "workspace-root" })]
    });
  });

  it("reads and writes capability resource policies for run profiles, skill packages, and agent modes", async () => {
    const { app, cookies, adminUser, runProfiles, skillPackages, agentModes } = await buildModeAdminApp();
    const runProfile = await runProfiles.create({
      name: "Standard Profile",
      slug: "standard-profile",
      defaultModel: "gpt-5.4",
      allowedModels: ["gpt-5.4"],
      defaultReasoningEffort: "high",
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: true,
      webSearchMode: "disabled"
    });
    const skillPackage = await skillPackages.create({
      name: "Code Tools",
      slug: "code-tools",
      visibleToUsers: true
    });
    const agentMode = await agentModes.create({
      name: "Coding Assistant",
      slug: "coding-assistant",
      runProfileId: runProfile.id,
      visibleToUsers: true
    });

    await request(app)
      .put(`/api/admin/resources/run-profiles/${runProfile.id}/policies`)
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        policies: [{ subjectType: "role", subjectId: "employee", effect: "allow" }]
      })
      .expect(200);

    await request(app)
      .put(`/api/admin/resources/skill-packages/${skillPackage.id}/policies`)
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        policies: [{ subjectType: "department", subjectId: "dept-rd", effect: "deny" }]
      })
      .expect(200);

    await request(app)
      .put(`/api/admin/resources/agent-modes/${agentMode.id}/policies`)
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        policies: [{ subjectType: "user", subjectId: "user-123", effect: "allow" }]
      })
      .expect(200);

    const runProfilePolicies = await request(app)
      .get(`/api/admin/resources/run-profiles/${runProfile.id}/policies`)
      .set("Cookie", cookies.create(adminUser.id))
      .expect(200);
    expect(runProfilePolicies.body.policies).toEqual([
      expect.objectContaining({
        resourceType: "run_profile",
        resourceId: runProfile.id,
        subjectType: "role",
        subjectId: "employee",
        effect: "allow"
      })
    ]);

    const skillPackagePolicies = await request(app)
      .get(`/api/admin/resources/skill-packages/${skillPackage.id}/policies`)
      .set("Cookie", cookies.create(adminUser.id))
      .expect(200);
    expect(skillPackagePolicies.body.policies).toEqual([
      expect.objectContaining({
        resourceType: "skill_package",
        resourceId: skillPackage.id,
        subjectType: "department",
        subjectId: "dept-rd",
        effect: "deny"
      })
    ]);

    const agentModePolicies = await request(app)
      .get(`/api/admin/resources/agent-modes/${agentMode.id}/policies`)
      .set("Cookie", cookies.create(adminUser.id))
      .expect(200);
    expect(agentModePolicies.body.policies).toEqual([
      expect.objectContaining({
        resourceType: "agent_mode",
        resourceId: agentMode.id,
        subjectType: "user",
        subjectId: "user-123",
        effect: "allow"
      })
    ]);
  });

  it("keeps the admin auth guard in front of the mode admin routes", async () => {
    const { app, cookies, user } = await buildModeAdminApp({
      user: makeUser({ id: "employee-1", role: "employee" })
    });

    const response = await request(app).get("/api/admin/run-profiles").set("Cookie", cookies.create(user.id));

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ detail: "Forbidden" });
  });

  it("rejects invalid controlled values with a 400 response", async () => {
    const { app, cookies, adminUser } = await buildModeAdminApp();

    const runProfileResponse = await request(app)
      .post("/api/admin/run-profiles")
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        name: "Broken Profile",
        slug: "broken-profile",
        defaultModel: "gpt-5.4",
        allowedModels: ["gpt-5.4"],
        defaultReasoningEffort: "turbo",
        sandboxMode: "unsafe-mode",
        approvalPolicy: "sometimes",
        networkAccessEnabled: true,
        webSearchMode: "instant"
      });

    expect(runProfileResponse.status).toBe(400);
    expect(runProfileResponse.body.detail).toContain("defaultReasoningEffort");

    const skillPackageResponse = await request(app)
      .post("/api/admin/skill-packages")
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        name: "Code Tools",
        slug: "code-tools"
      });

    expect(skillPackageResponse.status).toBe(201);

    const runtimeBindingResponse = await request(app)
      .put(`/api/admin/skill-packages/${skillPackageResponse.body.skillPackage.id}/runtime-bindings`)
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        items: [
          {
            capabilityKey: "filesystem.read",
            runtimeBindings: [
              { runtimeType: "unknown-runtime", bindingType: "bad-binding", bindingPayload: { tool: "Read" } }
            ]
          }
        ]
      });

    expect(runtimeBindingResponse.status).toBe(400);
    expect(runtimeBindingResponse.body.detail).toContain("runtimeType");
  });

  it("returns 404 when updating or replacing bindings for missing resources", async () => {
    const { app, cookies, adminUser } = await buildModeAdminApp();

    const runProfileResponse = await request(app)
      .patch("/api/admin/run-profiles/missing-profile")
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        description: "missing"
      });

    expect(runProfileResponse.status).toBe(404);
    expect(runProfileResponse.body).toEqual({ detail: "run profile 不存在" });

    const instructionSourceResponse = await request(app)
      .put("/api/admin/agent-modes/missing-mode/instruction-sources")
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        instructionSources: [
          {
            sourceType: "inline_text",
            sourceRef: "Always write tests first."
          }
        ]
      });

    expect(instructionSourceResponse.status).toBe(404);
    expect(instructionSourceResponse.body).toEqual({ detail: "agent mode 不存在" });
  });
});

class FakeUserRepository implements UserRepositoryLike {
  constructor(private readonly users = new Map<string, AuthenticatedUser>()) {}

  async getById(id: string): Promise<AuthenticatedUser | undefined> {
    return this.users.get(id);
  }

  async getByExternalId(externalId: string): Promise<AuthenticatedUser | undefined> {
    for (const user of this.users.values()) {
      if (user.externalId === externalId) return user;
    }
    return undefined;
  }

  async upsertFromDingTalk(): Promise<AuthenticatedUser> {
    throw new Error("not used in mode admin router tests");
  }

  async updateLocalSettings(input: {
    userId: string;
    role: string;
    manualDisabled: boolean;
    adminNote?: string | null;
  }): Promise<UserRecord> {
    const existing = this.users.get(input.userId);
    if (!existing) {
      throw new Error("user 不存在");
    }

    const updated: AuthenticatedUser = {
      ...existing,
      role: input.role,
      status: input.manualDisabled ? "disabled" : "active",
      updatedAt: new Date().toISOString()
    };
    this.users.set(updated.id, updated);

    return {
      ...updated,
      statusSource: input.manualDisabled ? "manual_disable" : "sync",
      syncState: input.manualDisabled ? "disabled" : "active",
      manualDisabled: input.manualDisabled,
      adminNote: input.adminNote ?? undefined,
      lastSyncedAt: undefined
    };
  }

  seed(user: AuthenticatedUser): void {
    this.users.set(user.id, user);
  }
}

type RunProfileRecord = {
  id: string;
  organizationId?: string;
  name: string;
  slug: string;
  description?: string;
  status: string;
  defaultModel: string;
  allowedModels: string[];
  defaultReasoningEffort: string;
  sandboxMode: string;
  approvalPolicy: string;
  networkAccessEnabled: boolean;
  webSearchMode: string;
  createdAt: string;
  updatedAt: string;
};

type SkillPackageRuntimeBindingRecord = {
  id: string;
  runtimeType: string;
  bindingType: string;
  bindingPayload: unknown;
  createdAt: string;
  updatedAt: string;
};

type SkillPackageItemRecord = {
  id: string;
  capabilityKey: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  runtimeBindings: SkillPackageRuntimeBindingRecord[];
};

type SkillPackageRecord = {
  id: string;
  organizationId?: string;
  name: string;
  slug: string;
  description?: string;
  status: string;
  visibleToUsers: boolean;
  createdAt: string;
  updatedAt: string;
  items: SkillPackageItemRecord[];
};

type AgentModeSkillPackageRecord = {
  id: string;
  skillPackageId: string;
  createdAt: string;
  updatedAt: string;
};

type AgentModeWorkspaceRuleRecord = {
  id: string;
  workspaceId: string;
  isDefault: boolean;
  allowDirectorySelection: boolean;
  directoryScope: string;
  loadWorkspaceAgentsMd: boolean;
  createdAt: string;
  updatedAt: string;
};

type AgentModeInstructionSourceRecord = {
  id: string;
  sourceType: string;
  sourceRef: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type AgentModeRecord = {
  id: string;
  organizationId?: string;
  name: string;
  slug: string;
  description?: string;
  status: string;
  visibleToUsers: boolean;
  runProfileId: string;
  createdAt: string;
  updatedAt: string;
  skillPackages: AgentModeSkillPackageRecord[];
  workspaceRules: AgentModeWorkspaceRuleRecord[];
  instructionSources: AgentModeInstructionSourceRecord[];
};

class FakeRunProfileRepository {
  private counter = 0;
  readonly records: RunProfileRecord[] = [];

  async create(payload: {
    organizationId?: string;
    name: string;
    slug: string;
    description?: string;
    status?: string;
    defaultModel: string;
    allowedModels: string[];
    defaultReasoningEffort: string;
    sandboxMode: string;
    approvalPolicy: string;
    networkAccessEnabled?: boolean;
    webSearchMode: string;
  }): Promise<RunProfileRecord> {
    const now = new Date().toISOString();
    const record: RunProfileRecord = {
      id: `run-profile-${++this.counter}`,
      organizationId: trimOrUndefined(payload.organizationId),
      name: payload.name,
      slug: payload.slug,
      description: trimOrUndefined(payload.description),
      status: trimOrUndefined(payload.status) ?? "active",
      defaultModel: payload.defaultModel,
      allowedModels: [...payload.allowedModels],
      defaultReasoningEffort: payload.defaultReasoningEffort,
      sandboxMode: payload.sandboxMode,
      approvalPolicy: payload.approvalPolicy,
      networkAccessEnabled: payload.networkAccessEnabled ?? false,
      webSearchMode: payload.webSearchMode,
      createdAt: now,
      updatedAt: now
    };
    this.records.push(structuredClone(record));
    return structuredClone(record);
  }

  async get(id: string): Promise<RunProfileRecord | undefined> {
    return structuredClone(this.records.find((item) => item.id === id));
  }

  async list(): Promise<RunProfileRecord[]> {
    return structuredClone(this.records);
  }

  async update(
    id: string,
    payload: Partial<{
      organizationId?: string;
      name: string;
      slug: string;
      description?: string;
      status?: string;
      defaultModel: string;
      allowedModels: string[];
      defaultReasoningEffort: string;
      sandboxMode: string;
      approvalPolicy: string;
      networkAccessEnabled?: boolean;
      webSearchMode: string;
    }>
  ): Promise<RunProfileRecord> {
    const record = this.records.find((item) => item.id === id);
    if (!record) throw new Error("run profile 不存在");
    Object.assign(record, {
      organizationId: payload.organizationId === undefined ? record.organizationId : trimOrUndefined(payload.organizationId),
      name: payload.name ?? record.name,
      slug: payload.slug ?? record.slug,
      description: payload.description === undefined ? record.description : trimOrUndefined(payload.description),
      status: payload.status === undefined ? record.status : trimOrUndefined(payload.status) ?? "active",
      defaultModel: payload.defaultModel ?? record.defaultModel,
      allowedModels: payload.allowedModels === undefined ? record.allowedModels : [...payload.allowedModels],
      defaultReasoningEffort: payload.defaultReasoningEffort ?? record.defaultReasoningEffort,
      sandboxMode: payload.sandboxMode ?? record.sandboxMode,
      approvalPolicy: payload.approvalPolicy ?? record.approvalPolicy,
      networkAccessEnabled: payload.networkAccessEnabled === undefined ? record.networkAccessEnabled : payload.networkAccessEnabled,
      webSearchMode: payload.webSearchMode ?? record.webSearchMode,
      updatedAt: new Date().toISOString()
    });
    return structuredClone(record);
  }
}

class FakeSkillPackageRepository {
  private packageCounter = 0;
  private itemCounter = 0;
  private runtimeBindingCounter = 0;
  readonly records: SkillPackageRecord[] = [];

  async create(payload: {
    organizationId?: string;
    name: string;
    slug: string;
    description?: string;
    status?: string;
    visibleToUsers?: boolean;
  }): Promise<SkillPackageRecord> {
    const now = new Date().toISOString();
    const record: SkillPackageRecord = {
      id: `skill-package-${++this.packageCounter}`,
      organizationId: trimOrUndefined(payload.organizationId),
      name: payload.name,
      slug: payload.slug,
      description: trimOrUndefined(payload.description),
      status: trimOrUndefined(payload.status) ?? "active",
      visibleToUsers: payload.visibleToUsers ?? false,
      createdAt: now,
      updatedAt: now,
      items: []
    };
    this.records.push(structuredClone(record));
    return structuredClone(record);
  }

  async get(id: string): Promise<SkillPackageRecord | undefined> {
    return structuredClone(this.records.find((item) => item.id === id));
  }

  async list(): Promise<SkillPackageRecord[]> {
    return structuredClone(this.records);
  }

  async update(
    id: string,
    payload: Partial<{
      organizationId?: string;
      name: string;
      slug: string;
      description?: string;
      status?: string;
      visibleToUsers?: boolean;
    }>
  ): Promise<SkillPackageRecord> {
    const record = this.records.find((item) => item.id === id);
    if (!record) throw new Error("skill package 不存在");
    Object.assign(record, {
      organizationId: payload.organizationId === undefined ? record.organizationId : trimOrUndefined(payload.organizationId),
      name: payload.name ?? record.name,
      slug: payload.slug ?? record.slug,
      description: payload.description === undefined ? record.description : trimOrUndefined(payload.description),
      status: payload.status === undefined ? record.status : trimOrUndefined(payload.status) ?? "active",
      visibleToUsers: payload.visibleToUsers === undefined ? record.visibleToUsers : payload.visibleToUsers,
      updatedAt: new Date().toISOString()
    });
    return this.getRequired(record.id);
  }

  async replaceItems(
    id: string,
    items: Array<{
      capabilityKey: string;
      description?: string;
      runtimeBindings: Array<{
        runtimeType: string;
        bindingType: string;
        bindingPayload: unknown;
      }>;
    }>
  ): Promise<SkillPackageRecord> {
    const record = this.records.find((item) => item.id === id);
    if (!record) throw new Error("skill package 不存在");
    const now = new Date().toISOString();
    record.items = items.map((item) => ({
      id: `skill-package-item-${++this.itemCounter}`,
      capabilityKey: item.capabilityKey,
      description: trimOrUndefined(item.description),
      createdAt: now,
      updatedAt: now,
      runtimeBindings: item.runtimeBindings.map((binding) => ({
        id: `skill-package-runtime-binding-${++this.runtimeBindingCounter}`,
        runtimeType: binding.runtimeType,
        bindingType: binding.bindingType,
        bindingPayload: structuredClone(binding.bindingPayload),
        createdAt: now,
        updatedAt: now
      }))
    }));
    record.updatedAt = now;
    return this.getRequired(record.id);
  }

  private async getRequired(id: string): Promise<SkillPackageRecord> {
    const record = this.records.find((item) => item.id === id);
    if (!record) throw new Error("skill package 不存在");
    return structuredClone(record);
  }
}

class FakeAgentModeRepository {
  private modeCounter = 0;
  private skillPackageBindingCounter = 0;
  private workspaceRuleCounter = 0;
  private instructionSourceCounter = 0;
  readonly records: AgentModeRecord[] = [];

  async create(payload: {
    organizationId?: string;
    name: string;
    slug: string;
    description?: string;
    status?: string;
    visibleToUsers?: boolean;
    runProfileId: string;
  }): Promise<AgentModeRecord> {
    const now = new Date().toISOString();
    const record: AgentModeRecord = {
      id: `agent-mode-${++this.modeCounter}`,
      organizationId: trimOrUndefined(payload.organizationId),
      name: payload.name,
      slug: payload.slug,
      description: trimOrUndefined(payload.description),
      status: trimOrUndefined(payload.status) ?? "active",
      visibleToUsers: payload.visibleToUsers ?? true,
      runProfileId: payload.runProfileId,
      createdAt: now,
      updatedAt: now,
      skillPackages: [],
      workspaceRules: [],
      instructionSources: []
    };
    this.records.push(structuredClone(record));
    return structuredClone(record);
  }

  async get(id: string): Promise<AgentModeRecord | undefined> {
    return structuredClone(this.records.find((item) => item.id === id));
  }

  async list(): Promise<AgentModeRecord[]> {
    return structuredClone(this.records);
  }

  async update(
    id: string,
    payload: Partial<{
      organizationId?: string;
      name: string;
      slug: string;
      description?: string;
      status?: string;
      visibleToUsers?: boolean;
      runProfileId: string;
    }>
  ): Promise<AgentModeRecord> {
    const record = this.records.find((item) => item.id === id);
    if (!record) throw new Error("agent mode 不存在");
    Object.assign(record, {
      organizationId: payload.organizationId === undefined ? record.organizationId : trimOrUndefined(payload.organizationId),
      name: payload.name ?? record.name,
      slug: payload.slug ?? record.slug,
      description: payload.description === undefined ? record.description : trimOrUndefined(payload.description),
      status: payload.status === undefined ? record.status : trimOrUndefined(payload.status) ?? "active",
      visibleToUsers: payload.visibleToUsers === undefined ? record.visibleToUsers : payload.visibleToUsers,
      runProfileId: payload.runProfileId ?? record.runProfileId,
      updatedAt: new Date().toISOString()
    });
    return this.getRequired(record.id);
  }

  async replaceSkillPackages(id: string, skillPackageIds: string[]): Promise<AgentModeRecord> {
    const record = this.records.find((item) => item.id === id);
    if (!record) throw new Error("agent mode 不存在");
    const now = new Date().toISOString();
    record.skillPackages = skillPackageIds.map((skillPackageId) => ({
      id: `agent-mode-skill-package-${++this.skillPackageBindingCounter}`,
      skillPackageId,
      createdAt: now,
      updatedAt: now
    }));
    record.updatedAt = now;
    return this.getRequired(record.id);
  }

  async replaceWorkspaceRules(
    id: string,
    workspaceRules: Array<{
      workspaceId: string;
      isDefault?: boolean;
      allowDirectorySelection?: boolean;
      directoryScope: string;
      loadWorkspaceAgentsMd?: boolean;
    }>
  ): Promise<AgentModeRecord> {
    const record = this.records.find((item) => item.id === id);
    if (!record) throw new Error("agent mode 不存在");
    const now = new Date().toISOString();
    record.workspaceRules = workspaceRules.map((workspaceRule) => ({
      id: `agent-mode-workspace-${++this.workspaceRuleCounter}`,
      workspaceId: workspaceRule.workspaceId,
      isDefault: workspaceRule.isDefault ?? false,
      allowDirectorySelection: workspaceRule.allowDirectorySelection ?? false,
      directoryScope: workspaceRule.directoryScope,
      loadWorkspaceAgentsMd: workspaceRule.loadWorkspaceAgentsMd ?? false,
      createdAt: now,
      updatedAt: now
    }));
    record.updatedAt = now;
    return this.getRequired(record.id);
  }

  async replaceInstructionSources(
    id: string,
    instructionSources: Array<{
      sourceType: string;
      sourceRef: string;
      sortOrder?: number;
    }>
  ): Promise<AgentModeRecord> {
    const record = this.records.find((item) => item.id === id);
    if (!record) throw new Error("agent mode 不存在");
    const now = new Date().toISOString();
    record.instructionSources = instructionSources.map((instructionSource) => ({
      id: `agent-mode-instruction-source-${++this.instructionSourceCounter}`,
      sourceType: instructionSource.sourceType,
      sourceRef: instructionSource.sourceRef,
      sortOrder: instructionSource.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now
    }));
    record.updatedAt = now;
    return this.getRequired(record.id);
  }

  private async getRequired(id: string): Promise<AgentModeRecord> {
    const record = this.records.find((item) => item.id === id);
    if (!record) throw new Error("agent mode 不存在");
    return structuredClone(record);
  }
}

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: overrides.id ?? "admin-1",
    externalId: overrides.externalId ?? "ding-user-1",
    email: overrides.email ?? "user@example.com",
    displayName: overrides.displayName ?? "User One",
    role: overrides.role ?? "admin",
    status: overrides.status ?? "active",
    createdAt: overrides.createdAt ?? new Date("2026-01-01T00:00:00.000Z").toISOString(),
    updatedAt: overrides.updatedAt ?? new Date("2026-01-01T00:00:00.000Z").toISOString()
  };
}

async function buildModeAdminApp(options?: { user?: AuthenticatedUser }) {
  const dingtalkClient: DingTalkClient = {
    async exchangeCode() {
      throw new Error("not used in mode admin router tests");
    },
    async listDepartments() {
      throw new Error("not used in mode admin router tests");
    },
    async listDepartmentUsers() {
      throw new Error("not used in mode admin router tests");
    },
    async getUser() {
      throw new Error("not used in mode admin router tests");
    }
  };
  const users = new FakeUserRepository();
  const user = options?.user ?? makeUser();
  users.seed(user);
  const runProfiles = new FakeRunProfileRepository();
  const skillPackages = new FakeSkillPackageRepository();
  const agentModes = new FakeAgentModeRepository();
  const resourcePolicies = new FakeResourcePolicyRepository();

  const cookies = createSessionCookieManager({
    cookieName: "agent_studio_session",
    secret: "test-session-secret",
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    secure: false,
    sameSite: "lax"
  });

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  registerCommonApiRoutes(app, {
    currentUserMiddleware: createCurrentUserMiddleware({ users, cookies }),
    authRouter: createAuthRouter({
      users,
      cookies,
      dingtalkClient,
      dingtalkConfig: {
        clientId: "client-id",
        clientSecret: "client-secret",
        redirectUri: "https://example.com/callback",
        scope: "openid"
      },
      oauthStates: {
        cookieName: "agent_studio_session_oauth_state",
        issue() {
          return { state: "state", nonce: "nonce", cookie: "agent_studio_session_oauth_state=state" };
        },
        clear() {
          return "agent_studio_session_oauth_state=; Max-Age=0";
        },
        read() {
          return undefined;
        }
      }
    }),
    adminRouter: express.Router(),
    resourcesAdminRouter: createModeAdminRouter({
      runProfiles: runProfiles as never,
      skillPackages: skillPackages as never,
      agentModes: agentModes as never,
      resourcePolicies: resourcePolicies as never
    }),
    portalRouter: express.Router(),
    serviceTokenMiddleware: (_req, _res, next) => next(),
    zendeskRouter: express.Router()
  });

  return {
    app,
    cookies,
    adminUser: user,
    user,
    runProfiles,
    skillPackages,
    agentModes,
    resourcePolicies
  };
}

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

class FakeResourcePolicyRepository {
  private policies: Array<{
    id: string;
    organizationId?: string;
    subjectType: "role" | "department" | "user";
    subjectId: string;
    resourceType: "agent_mode" | "skill_package" | "run_profile";
    resourceId: string;
    effect: "allow" | "deny";
    createdAt: string;
    updatedAt: string;
  }> = [];

  async listAll() {
    return [...this.policies];
  }

  async replacePoliciesForResource(input: {
    resourceType: "agent_mode" | "skill_package" | "run_profile";
    resourceId: string;
    policies: Array<{
      organizationId?: string;
      subjectType: "role" | "department" | "user";
      subjectId: string;
      resourceType: "agent_mode" | "skill_package" | "run_profile";
      resourceId: string;
      effect: "allow" | "deny";
    }>;
  }) {
    this.policies = this.policies.filter(
      (policy) => !(policy.resourceType === input.resourceType && policy.resourceId === input.resourceId)
    );
    const now = new Date().toISOString();
    const next = input.policies.map((policy, index) => ({
      id: `${policy.resourceType}-${policy.resourceId}-${index + 1}`,
      organizationId: policy.organizationId,
      subjectType: policy.subjectType,
      subjectId: policy.subjectId,
      resourceType: policy.resourceType,
      resourceId: policy.resourceId,
      effect: policy.effect,
      createdAt: now,
      updatedAt: now
    }));
    this.policies.push(...next);
    return next;
  }
}
