import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";

import { registerCommonApiRoutes } from "../app-routes.js";
import { createAdminRouter as createOverviewAdminRouter } from "../admin/router.js";
import type { DingTalkClient } from "../auth/dingtalk.js";
import { createAuthRouter } from "../auth/router.js";
import { createCurrentUserMiddleware } from "../auth/current-user.js";
import { createSessionCookieManager } from "../auth/session-cookie.js";
import { createPortalRouter } from "../portal/router.js";
import type { AuthenticatedUser, UserRecord, UserRepositoryLike } from "../persistence/user-repository.js";
import { FilesystemKnowledgeSetStorage } from "./storage/filesystem-knowledge-set-storage.js";
import { createResourcesAdminRouter } from "./admin-router.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0, tempRoots.length).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

describe("resources admin router", () => {
  it("supports workspace list, create, and update while keeping overview working", async () => {
    const { app, cookies, adminUser, allowedFilesystemRoot } = await buildResourcesAdminApp();

    const listResponse = await request(app)
      .get("/api/admin/workspaces")
      .set("Cookie", cookies.create(adminUser.id));

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.workspaces).toEqual([]);

    const createResponse = await request(app)
      .post("/api/admin/workspaces")
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        name: "Docs Workspace",
        slug: "docs-workspace",
        sourceType: "filesystem",
        rootPath: path.join(allowedFilesystemRoot, "docs")
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.workspace).toMatchObject({
      name: "Docs Workspace",
      slug: "docs-workspace",
      sourceType: "filesystem",
      rootPath: path.join(allowedFilesystemRoot, "docs")
    });

    const patchResponse = await request(app)
      .patch(`/api/admin/workspaces/${createResponse.body.workspace.id}`)
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        description: "Shared docs",
        status: "inactive"
      });

    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body.workspace).toMatchObject({
      id: createResponse.body.workspace.id,
      description: "Shared docs",
      status: "inactive"
    });

    const overviewResponse = await request(app)
      .get("/api/admin/overview")
      .set("Cookie", cookies.create(adminUser.id));

    expect(overviewResponse.status).toBe(200);
    expect(overviewResponse.body.counts).toEqual({
      users: 0,
      threads: 0,
      activeSessions: 0
    });
  });

  it("uploads files into a managed knowledge set and refreshes items", async () => {
    const { app, cookies, adminUser, knowledgeSets } = await buildResourcesAdminApp();
    const knowledgeSet = await knowledgeSets.create({
      name: "Policies",
      slug: "policies",
      sourceType: "managed_upload"
    });

    const response = await request(app)
      .post(`/api/admin/knowledge-sets/${knowledgeSet.id}/files`)
      .set("Cookie", cookies.create(adminUser.id))
      .attach("files", Buffer.from("# FAQ\n"), { filename: "faq.md", contentType: "text/markdown" })
      .attach("files", Buffer.from("guide"), { filename: "guide.txt", contentType: "text/plain" });

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([
      expect.objectContaining({ relativePath: "faq.md", mimeType: "text/markdown", sizeBytes: "6" }),
      expect.objectContaining({ relativePath: "guide.txt", mimeType: "text/plain", sizeBytes: "5" })
    ]);
  });

  it("supports knowledge-set list, create, update, and item listing", async () => {
    const { app, cookies, adminUser } = await buildResourcesAdminApp();

    const emptyList = await request(app)
      .get("/api/admin/knowledge-sets")
      .set("Cookie", cookies.create(adminUser.id));

    expect(emptyList.status).toBe(200);
    expect(emptyList.body.knowledgeSets).toEqual([]);

    const createResponse = await request(app)
      .post("/api/admin/knowledge-sets")
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        name: "Policies",
        slug: "policies",
        sourceType: "managed_upload",
        storageKey: "uploads/policies.zip"
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.knowledgeSet).toMatchObject({
      name: "Policies",
      slug: "policies",
      sourceType: "managed_upload",
      storageKey: "uploads/policies.zip"
    });

    const patchResponse = await request(app)
      .patch(`/api/admin/knowledge-sets/${createResponse.body.knowledgeSet.id}`)
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        description: "Updated policies",
        status: "inactive"
      });

    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body.knowledgeSet).toMatchObject({
      id: createResponse.body.knowledgeSet.id,
      description: "Updated policies",
      status: "inactive"
    });

    const itemsResponse = await request(app)
      .get(`/api/admin/knowledge-sets/${createResponse.body.knowledgeSet.id}/items`)
      .set("Cookie", cookies.create(adminUser.id));

    expect(itemsResponse.status).toBe(200);
    expect(itemsResponse.body.items).toEqual([]);

    const listResponse = await request(app)
      .get("/api/admin/knowledge-sets")
      .set("Cookie", cookies.create(adminUser.id));

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.knowledgeSets).toEqual([
      expect.objectContaining({
        id: createResponse.body.knowledgeSet.id,
        description: "Updated policies",
        status: "inactive"
      })
    ]);
  });

  it("rejects file and archive uploads for non-managed knowledge sets", async () => {
    const { app, cookies, adminUser, knowledgeSets, allowedFilesystemRoot } = await buildResourcesAdminApp();
    const knowledgeSet = await knowledgeSets.create({
      name: "Filesystem Docs",
      slug: "filesystem-docs",
      sourceType: "filesystem",
      rootPath: path.join(allowedFilesystemRoot, "docs")
    });

    const fileResponse = await request(app)
      .post(`/api/admin/knowledge-sets/${knowledgeSet.id}/files`)
      .set("Cookie", cookies.create(adminUser.id))
      .attach("files", Buffer.from("# FAQ\n"), { filename: "faq.md", contentType: "text/markdown" });

    expect(fileResponse.status).toBe(400);
    expect(fileResponse.body).toEqual({ detail: "only managed_upload knowledge sets support file uploads" });

    const archiveResponse = await request(app)
      .post(`/api/admin/knowledge-sets/${knowledgeSet.id}/archive`)
      .set("Cookie", cookies.create(adminUser.id))
      .set("Content-Type", "application/zip")
      .set("X-Archive-Name", "docs.zip")
      .send(Buffer.from(zipSync({ "faq.md": strToU8("# FAQ\n") })));

    expect(archiveResponse.status).toBe(400);
    expect(archiveResponse.body).toEqual({ detail: "only managed_upload knowledge sets support archive uploads" });
  });

  it("uploads an archive into a managed knowledge set and refreshes items", async () => {
    const { app, cookies, adminUser, knowledgeSets } = await buildResourcesAdminApp();
    const knowledgeSet = await knowledgeSets.create({
      name: "Runbooks",
      slug: "runbooks",
      sourceType: "managed_upload"
    });

    const response = await request(app)
      .post(`/api/admin/knowledge-sets/${knowledgeSet.id}/archive`)
      .set("Cookie", cookies.create(adminUser.id))
      .set("Content-Type", "application/zip")
      .set("X-Archive-Name", "docs.zip")
      .send(
        Buffer.from(
          zipSync({
            "guide/readme.md": strToU8("# Readme\n"),
            "faq/usage.txt": strToU8("usage")
          })
        )
      );

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([
      expect.objectContaining({ relativePath: "faq/usage.txt", sourceArchiveName: "docs.zip" }),
      expect.objectContaining({ relativePath: "guide/readme.md", sourceArchiveName: "docs.zip" })
    ]);
  });

  it("gets and replaces workspace bindings", async () => {
    const { app, cookies, adminUser, workspaces, knowledgeSets, allowedFilesystemRoot } = await buildResourcesAdminApp();
    const workspace = await workspaces.create({
      name: "Workspace",
      slug: "workspace",
      sourceType: "filesystem",
      rootPath: path.join(allowedFilesystemRoot, "workspace")
    });
    const knowledgeSet = await knowledgeSets.create({
      name: "Policies",
      slug: "policies",
      sourceType: "managed_upload"
    });

    const putResponse = await request(app)
      .put(`/api/admin/workspaces/${workspace.id}/knowledge-sets`)
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        bindings: [{ knowledgeSetId: knowledgeSet.id, mountType: "default" }]
      });

    expect(putResponse.status).toBe(200);
    expect(putResponse.body.bindings).toEqual([
      expect.objectContaining({ workspaceId: workspace.id, knowledgeSetId: knowledgeSet.id, mountType: "default" })
    ]);

    const getResponse = await request(app)
      .get(`/api/admin/workspaces/${workspace.id}/knowledge-sets`)
      .set("Cookie", cookies.create(adminUser.id));

    expect(getResponse.status).toBe(200);
    expect(getResponse.body.bindings).toEqual([
      expect.objectContaining({ workspaceId: workspace.id, knowledgeSetId: knowledgeSet.id, mountType: "default" })
    ]);
  });

  it("gets and replaces resource policies", async () => {
    const { app, cookies, adminUser } = await buildResourcesAdminApp();

    const putResponse = await request(app)
      .put("/api/admin/resource-policies")
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        groups: [{ subjectType: "role", subjectId: "employee", resourceType: "workspace" }],
        policies: [
          {
            subjectType: "role",
            subjectId: "employee",
            resourceType: "workspace",
            resourceId: "workspace-1",
            effect: "allow"
          }
        ]
      });

    expect(putResponse.status).toBe(200);
    expect(putResponse.body.policies).toEqual([
      expect.objectContaining({
        subjectType: "role",
        subjectId: "employee",
        resourceType: "workspace",
        resourceId: "workspace-1",
        effect: "allow"
      })
    ]);

    const getResponse = await request(app)
      .get("/api/admin/resource-policies")
      .set("Cookie", cookies.create(adminUser.id));

    expect(getResponse.status).toBe(200);
    expect(getResponse.body.policies).toEqual([
      expect.objectContaining({
        subjectType: "role",
        subjectId: "employee",
        resourceType: "workspace",
        resourceId: "workspace-1",
        effect: "allow"
      })
    ]);
  });

  it("gets and replaces policies for a single workspace resource", async () => {
    const { app, cookies, adminUser, workspaces, resourcePolicies, allowedFilesystemRoot } = await buildResourcesAdminApp();
    const workspace = await workspaces.create({
      name: "Workspace",
      slug: "workspace",
      sourceType: "filesystem",
      rootPath: path.join(allowedFilesystemRoot, "workspace")
    });
    resourcePolicies.records.push({
      id: "policy-1",
      organizationId: undefined,
      subjectType: "role",
      subjectId: "employee",
      resourceType: "workspace",
      resourceId: workspace.id,
      effect: "allow",
      createdAt: new Date("2026-03-30T00:00:00.000Z").toISOString(),
      updatedAt: new Date("2026-03-30T00:00:00.000Z").toISOString()
    });

    const getResponse = await request(app)
      .get(`/api/admin/resources/workspaces/${workspace.id}/policies`)
      .set("Cookie", cookies.create(adminUser.id));

    expect(getResponse.status).toBe(200);
    expect(getResponse.body.policies).toEqual([
      expect.objectContaining({ resourceType: "workspace", resourceId: workspace.id, effect: "allow" })
    ]);

    const putResponse = await request(app)
      .put(`/api/admin/resources/workspaces/${workspace.id}/policies`)
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        policies: [
          { subjectType: "role", subjectId: "employee", effect: "allow" },
          { subjectType: "department", subjectId: "dept-rd", effect: "deny" }
        ]
      });

    expect(putResponse.status).toBe(200);
    expect(putResponse.body.policies).toHaveLength(2);
  });

  it("gets and replaces policies for a single knowledge set resource", async () => {
    const { app, cookies, adminUser, knowledgeSets } = await buildResourcesAdminApp();
    const knowledgeSet = await knowledgeSets.create({
      name: "Policies",
      slug: "policies",
      sourceType: "managed_upload"
    });

    const putResponse = await request(app)
      .put(`/api/admin/resources/knowledge-sets/${knowledgeSet.id}/policies`)
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        policies: [
          { subjectType: "role", subjectId: "employee", effect: "allow" },
          { subjectType: "user", subjectId: "user-1", effect: "deny" }
        ]
      });

    expect(putResponse.status).toBe(200);
    expect(putResponse.body.policies).toHaveLength(2);

    const getResponse = await request(app)
      .get(`/api/admin/resources/knowledge-sets/${knowledgeSet.id}/policies`)
      .set("Cookie", cookies.create(adminUser.id));

    expect(getResponse.status).toBe(200);
    expect(getResponse.body.policies).toHaveLength(2);
    expect(getResponse.body.policies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceType: "knowledge_set",
          resourceId: knowledgeSet.id,
          subjectType: "role",
          subjectId: "employee",
          effect: "allow"
        }),
        expect.objectContaining({
          resourceType: "knowledge_set",
          resourceId: knowledgeSet.id,
          subjectType: "user",
          subjectId: "user-1",
          effect: "deny"
        })
      ])
    );
  });

  it("protects the admin resources routes behind the existing admin registration path", async () => {
    const { app, cookies, user } = await buildResourcesAdminApp({
      user: makeUser({ id: "employee-1", role: "employee" })
    });

    const response = await request(app)
      .get("/api/admin/workspaces")
      .set("Cookie", cookies.create(user.id));

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ detail: "Forbidden" });
  });

  it("rejects filesystem rootPath writes outside the allowed whitelist", async () => {
    const { app, cookies, adminUser, workspaces, knowledgeSets } = await buildResourcesAdminApp();

    const createWorkspaceResponse = await request(app)
      .post("/api/admin/workspaces")
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        name: "Outside Workspace",
        slug: "outside-workspace",
        sourceType: "filesystem",
        rootPath: "/outside/workspace"
      });

    expect(createWorkspaceResponse.status).toBe(400);
    expect(createWorkspaceResponse.body).toEqual({ detail: "workspace 不在允许目录白名单中" });

    const workspace = await workspaces.create({
      name: "Inside Workspace",
      slug: "inside-workspace",
      sourceType: "filesystem",
      rootPath: "/tmp/inside-workspace"
    });

    const patchWorkspaceResponse = await request(app)
      .patch(`/api/admin/workspaces/${workspace.id}`)
      .set("Cookie", cookies.create(adminUser.id))
      .send({ rootPath: "/outside/updated-workspace" });

    expect(patchWorkspaceResponse.status).toBe(400);
    expect(patchWorkspaceResponse.body).toEqual({ detail: "workspace 不在允许目录白名单中" });

    const createKnowledgeSetResponse = await request(app)
      .post("/api/admin/knowledge-sets")
      .set("Cookie", cookies.create(adminUser.id))
      .send({
        name: "Outside Knowledge Set",
        slug: "outside-knowledge-set",
        sourceType: "filesystem",
        rootPath: "/outside/knowledge-set"
      });

    expect(createKnowledgeSetResponse.status).toBe(400);
    expect(createKnowledgeSetResponse.body).toEqual({ detail: "workspace 不在允许目录白名单中" });

    const knowledgeSet = await knowledgeSets.create({
      name: "Inside Knowledge Set",
      slug: "inside-knowledge-set",
      sourceType: "filesystem",
      rootPath: "/tmp/inside-knowledge-set"
    });

    const patchKnowledgeSetResponse = await request(app)
      .patch(`/api/admin/knowledge-sets/${knowledgeSet.id}`)
      .set("Cookie", cookies.create(adminUser.id))
      .send({ rootPath: "/outside/updated-knowledge-set" });

    expect(patchKnowledgeSetResponse.status).toBe(400);
    expect(patchKnowledgeSetResponse.body).toEqual({ detail: "workspace 不在允许目录白名单中" });
  });

  it("rejects empty multipart file uploads", async () => {
    const { app, cookies, adminUser, knowledgeSets } = await buildResourcesAdminApp();
    const knowledgeSet = await knowledgeSets.create({
      name: "Policies",
      slug: "policies-empty",
      sourceType: "managed_upload"
    });

    const response = await request(app)
      .post(`/api/admin/knowledge-sets/${knowledgeSet.id}/files`)
      .set("Cookie", cookies.create(adminUser.id))
      .field("note", "no files");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ detail: "at least one file upload is required" });
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
    throw new Error("not used in admin router tests");
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

type WorkspaceRecord = {
  id: string;
  organizationId?: string;
  name: string;
  slug: string;
  description?: string;
  status: string;
  sourceType: string;
  rootPath?: string;
  createdAt: string;
  updatedAt: string;
};

type KnowledgeSetItemRecord = {
  id: string;
  kind: string;
  relativePath: string;
  displayName: string;
  mimeType?: string;
  sizeBytes?: string;
  checksum?: string;
  sourceArchiveName?: string;
  createdAt: string;
  updatedAt: string;
};

type KnowledgeSetRecord = {
  id: string;
  organizationId?: string;
  name: string;
  slug: string;
  description?: string;
  status: string;
  sourceType: string;
  rootPath?: string;
  storageKey?: string;
  createdAt: string;
  updatedAt: string;
  items: KnowledgeSetItemRecord[];
  workspaceBindings: WorkspaceBindingRecord[];
};

type WorkspaceBindingRecord = {
  id: string;
  workspaceId: string;
  knowledgeSetId: string;
  mountType: string;
  createdAt: string;
  updatedAt: string;
};

type ResourcePolicyRecord = {
  id: string;
  organizationId?: string;
  subjectType: "role" | "department" | "user";
  subjectId: string;
  resourceType: "workspace" | "knowledge_set";
  resourceId: string;
  effect: "allow" | "deny";
  createdAt: string;
  updatedAt: string;
};

class FakeWorkspaceRepository {
  private counter = 0;
  readonly records: WorkspaceRecord[] = [];

  async count(): Promise<number> {
    return this.records.length;
  }

  async create(payload: {
    organizationId?: string;
    name: string;
    slug: string;
    description?: string;
    status?: string;
    sourceType: string;
    rootPath?: string;
  }): Promise<WorkspaceRecord> {
    const now = new Date().toISOString();
    const record: WorkspaceRecord = {
      id: `workspace-${++this.counter}`,
      organizationId: trimOrUndefined(payload.organizationId),
      name: payload.name,
      slug: payload.slug,
      description: trimOrUndefined(payload.description),
      status: trimOrUndefined(payload.status) ?? "active",
      sourceType: payload.sourceType,
      rootPath: trimOrUndefined(payload.rootPath),
      createdAt: now,
      updatedAt: now
    };
    this.records.push(structuredClone(record));
    return structuredClone(record);
  }

  async update(id: string, payload: Partial<Omit<WorkspaceRecord, "id" | "createdAt" | "updatedAt">>): Promise<WorkspaceRecord> {
    const record = this.records.find((item) => item.id === id);
    if (!record) throw new Error("workspace 不存在");
    Object.assign(record, {
      organizationId: payload.organizationId === undefined ? record.organizationId : trimOrUndefined(payload.organizationId),
      name: payload.name ?? record.name,
      slug: payload.slug ?? record.slug,
      description: payload.description === undefined ? record.description : trimOrUndefined(payload.description),
      status: payload.status === undefined ? record.status : trimOrUndefined(payload.status) ?? "active",
      sourceType: payload.sourceType ?? record.sourceType,
      rootPath: payload.rootPath === undefined ? record.rootPath : trimOrUndefined(payload.rootPath),
      updatedAt: new Date().toISOString()
    });
    return structuredClone(record);
  }

  async get(id: string): Promise<WorkspaceRecord | undefined> {
    const record = this.records.find((item) => item.id === id);
    return record ? structuredClone(record) : undefined;
  }

  async list(): Promise<WorkspaceRecord[]> {
    return structuredClone(this.records);
  }
}

class FakeKnowledgeSetRepository {
  private knowledgeSetCounter = 0;
  private itemCounter = 0;
  private bindingCounter = 0;
  readonly records: KnowledgeSetRecord[] = [];
  readonly bindings: WorkspaceBindingRecord[] = [];

  constructor(private readonly workspaces: FakeWorkspaceRepository) {}

  async create(payload: {
    organizationId?: string;
    name: string;
    slug: string;
    description?: string;
    status?: string;
    sourceType: string;
    rootPath?: string;
    storageKey?: string;
  }): Promise<KnowledgeSetRecord> {
    const now = new Date().toISOString();
    const record: KnowledgeSetRecord = {
      id: `knowledge-set-${++this.knowledgeSetCounter}`,
      organizationId: trimOrUndefined(payload.organizationId),
      name: payload.name,
      slug: payload.slug,
      description: trimOrUndefined(payload.description),
      status: trimOrUndefined(payload.status) ?? "active",
      sourceType: payload.sourceType,
      rootPath: trimOrUndefined(payload.rootPath),
      storageKey: trimOrUndefined(payload.storageKey),
      createdAt: now,
      updatedAt: now,
      items: [],
      workspaceBindings: []
    };
    this.records.push(structuredClone(record));
    return structuredClone(record);
  }

  async update(
    id: string,
    payload: Partial<Omit<KnowledgeSetRecord, "id" | "items" | "workspaceBindings" | "createdAt" | "updatedAt">>
  ): Promise<KnowledgeSetRecord> {
    const record = this.records.find((item) => item.id === id);
    if (!record) throw new Error("knowledge set 不存在");
    Object.assign(record, {
      organizationId: payload.organizationId === undefined ? record.organizationId : trimOrUndefined(payload.organizationId),
      name: payload.name ?? record.name,
      slug: payload.slug ?? record.slug,
      description: payload.description === undefined ? record.description : trimOrUndefined(payload.description),
      status: payload.status === undefined ? record.status : trimOrUndefined(payload.status) ?? "active",
      sourceType: payload.sourceType ?? record.sourceType,
      rootPath: payload.rootPath === undefined ? record.rootPath : trimOrUndefined(payload.rootPath),
      storageKey: payload.storageKey === undefined ? record.storageKey : trimOrUndefined(payload.storageKey),
      updatedAt: new Date().toISOString()
    });
    return this.getRequired(id);
  }

  async get(id: string): Promise<KnowledgeSetRecord | undefined> {
    const record = this.records.find((item) => item.id === id);
    if (!record) return undefined;
    return this.getRequired(record.id);
  }

  async list(): Promise<KnowledgeSetRecord[]> {
    return Promise.all(this.records.map((item) => this.getRequired(item.id)));
  }

  async listItems(knowledgeSetId: string): Promise<KnowledgeSetItemRecord[]> {
    const record = await this.getRequired(knowledgeSetId);
    return structuredClone(record.items);
  }

  async replaceItems(
    knowledgeSetId: string,
    items: Array<{
      kind: string;
      relativePath: string;
      displayName: string;
      mimeType?: string;
      sizeBytes?: bigint;
      checksum?: string;
      sourceArchiveName?: string;
    }>
  ): Promise<KnowledgeSetRecord> {
    const record = this.records.find((item) => item.id === knowledgeSetId);
    if (!record) throw new Error("knowledge set 不存在");
    const now = new Date().toISOString();
    record.items = items.map((item) => ({
      id: `item-${++this.itemCounter}`,
      kind: item.kind,
      relativePath: item.relativePath,
      displayName: item.displayName,
      mimeType: trimOrUndefined(item.mimeType),
      sizeBytes: item.sizeBytes?.toString(),
      checksum: trimOrUndefined(item.checksum),
      sourceArchiveName: trimOrUndefined(item.sourceArchiveName),
      createdAt: now,
      updatedAt: now
    }));
    record.updatedAt = now;
    return this.getRequired(record.id);
  }

  async listWorkspaceBindings(workspaceId: string): Promise<WorkspaceBindingRecord[]> {
    return structuredClone(this.bindings.filter((item) => item.workspaceId === workspaceId));
  }

  async replaceWorkspaceBindings(
    workspaceId: string,
    bindings: Array<{
      knowledgeSetId: string;
      mountType: string;
    }>
  ): Promise<WorkspaceBindingRecord[]> {
    const workspace = await this.workspaces.get(workspaceId);
    if (!workspace) throw new Error("workspace 不存在");
    this.bindings.splice(
      0,
      this.bindings.length,
      ...this.bindings.filter((item) => item.workspaceId !== workspaceId)
    );
    const now = new Date().toISOString();
    const next = bindings.map((binding) => ({
      id: `binding-${++this.bindingCounter}`,
      workspaceId,
      knowledgeSetId: binding.knowledgeSetId,
      mountType: binding.mountType,
      createdAt: now,
      updatedAt: now
    }));
    this.bindings.push(...structuredClone(next));
    return structuredClone(next);
  }

  private async getRequired(id: string): Promise<KnowledgeSetRecord> {
    const record = this.records.find((item) => item.id === id);
    if (!record) throw new Error("knowledge set 不存在");
    return {
      ...structuredClone(record),
      workspaceBindings: structuredClone(this.bindings.filter((item) => item.knowledgeSetId === id))
    };
  }
}

class FakeResourcePolicyRepository {
  private counter = 0;
  readonly records: ResourcePolicyRecord[] = [];

  async listAll(): Promise<ResourcePolicyRecord[]> {
    return structuredClone(this.records);
  }

  async replacePoliciesForGroups(input: {
    groups: Array<{ subjectType: ResourcePolicyRecord["subjectType"]; subjectId: string; resourceType: ResourcePolicyRecord["resourceType"] }>;
    policies: Array<Omit<ResourcePolicyRecord, "id" | "createdAt" | "updatedAt">>;
  }): Promise<ResourcePolicyRecord[]> {
    const groupKeys = new Set(input.groups.map((group) => `${group.subjectType}:${group.subjectId}:${group.resourceType}`));
    this.records.splice(
      0,
      this.records.length,
      ...this.records.filter((item) => !groupKeys.has(`${item.subjectType}:${item.subjectId}:${item.resourceType}`))
    );
    const now = new Date().toISOString();
    const next = input.policies.map((policy) => ({
      id: `policy-${++this.counter}`,
      organizationId: trimOrUndefined(policy.organizationId),
      subjectType: policy.subjectType,
      subjectId: policy.subjectId,
      resourceType: policy.resourceType,
      resourceId: policy.resourceId,
      effect: policy.effect,
      createdAt: now,
      updatedAt: now
    }));
    this.records.push(...structuredClone(next));
    return structuredClone(next);
  }

  async replacePolicies(
    policies: Array<Omit<ResourcePolicyRecord, "id" | "createdAt" | "updatedAt">>
  ): Promise<ResourcePolicyRecord[]> {
    return this.replacePoliciesForGroups({
      groups: policies.map((policy) => ({
        subjectType: policy.subjectType,
        subjectId: policy.subjectId,
        resourceType: policy.resourceType
      })),
      policies
    });
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

async function buildResourcesAdminApp(options?: {
  user?: AuthenticatedUser;
}) {
  const dingtalkClient: DingTalkClient = {
    async exchangeCode() {
      throw new Error("not used in admin router tests");
    },
    async listDepartments() {
      throw new Error("not used in admin router tests");
    },
    async listDepartmentUsers() {
      throw new Error("not used in admin router tests");
    },
    async getUser() {
      throw new Error("not used in admin router tests");
    }
  };
  const users = new FakeUserRepository();
  const user = options?.user ?? makeUser();
  users.seed(user);
  const workspaces = new FakeWorkspaceRepository();
  const knowledgeSets = new FakeKnowledgeSetRepository(workspaces);
  const resourcePolicies = new FakeResourcePolicyRepository();
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "resources-admin-"));
  const allowedFilesystemRoot = await fs.mkdtemp(path.join(os.tmpdir(), "resources-admin-workspaces-"));
  tempRoots.push(storageRoot);
  tempRoots.push(allowedFilesystemRoot);
  const storage = new FilesystemKnowledgeSetStorage(storageRoot);

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
    adminRouter: createOverviewAdminRouter({
      users: { count: async () => 0 },
      threads: { count: async () => 0 },
      sessions: { countActive: async () => 0 },
      zendesk: {
        async getOverview() {
          return {
            ready: false,
            missing: [],
            settings: {
              enabled: false,
              hasZendeskApiToken: false,
              hasWebhookSigningSecret: false,
              lastValidatedAt: null
            }
          } as never;
        }
      }
    }),
    resourcesAdminRouter: createResourcesAdminRouter({
      workspaces: workspaces as never,
      knowledgeSets: knowledgeSets as never,
      resourcePolicies: resourcePolicies as never,
      storage,
      validateFilesystemPath: (input?: string | null) => {
        const raw = (input || "").trim();
        const candidate = raw ? path.resolve(raw) : "";
        if (!candidate) {
          throw new Error("workspace 不在允许目录白名单中");
        }
        if (candidate === allowedFilesystemRoot || candidate.startsWith(`${allowedFilesystemRoot}${path.sep}`)) {
          return candidate;
        }
        throw new Error("workspace 不在允许目录白名单中");
      }
    }),
    portalRouter: createPortalRouter({
      runtimeOptions: {
        resolve: async () => ({
          modes: [],
          workspaces: [{ id: "/workspace/default", label: "default", isDefault: true }],
          canUpload: true,
          defaults: {
            mode: "",
            workspace: "/workspace/default"
          }
        })
      },
      listDepartmentIdsForUser: async () => []
    }),
    serviceTokenMiddleware: (_req, _res, next) => next(),
    zendeskRouter: express.Router()
  });

  return {
    app,
    cookies,
    adminUser: user,
    user,
    workspaces,
    knowledgeSets,
    resourcePolicies,
    storage,
    allowedFilesystemRoot
  };
}

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}
