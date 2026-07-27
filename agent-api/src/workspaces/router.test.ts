import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createPortalWorkspaceRouter } from "./router.js";

const actor = {
  userId: "user-1",
  organizationId: "org-1",
  securityDomainId: "domain-1"
};

function node(overrides: Record<string, unknown> = {}) {
  return {
    id: "file-1",
    parentId: "folder-1",
    kind: "file",
    name: "report.md",
    mimeType: "text/markdown",
    sizeBytes: 7,
    checksum: "abc",
    state: "active",
    createdByType: "user",
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
    ...overrides
  };
}

function version(overrides: Record<string, unknown> = {}) {
  return {
    id: "version-1",
    fileId: "file-1",
    versionNo: 1,
    mimeType: "text/markdown",
    sizeBytes: 7,
    checksum: "abc",
    createdByType: "user",
    changeType: "create",
    createdAt: "2026-07-27T00:00:00.000Z",
    ...overrides
  };
}

function createTestApp(serviceOverrides: Record<string, unknown> = {}) {
  const service = {
    ensureWorkspace: vi.fn().mockResolvedValue({
      id: "workspace-1",
      name: "我的工作区",
      status: "active",
      quotaBytes: 1024,
      usedBytes: 7,
      historyFolderId: "history-1"
    }),
    listNodes: vi.fn().mockResolvedValue([node()]),
    getNode: vi.fn().mockResolvedValue(node({ id: "folder-1", kind: "folder", name: "Nested" })),
    createFolder: vi.fn().mockResolvedValue(node({ id: "folder-2", kind: "folder", name: "项目" })),
    saveFile: vi.fn().mockResolvedValue({ file: node(), version: version() }),
    renameOrMoveNode: vi.fn().mockResolvedValue(node({ name: "renamed.md" })),
    trashNode: vi.fn().mockResolvedValue(node({ state: "trashed" })),
    restoreNode: vi.fn().mockResolvedValue(node()),
    getFile: vi.fn().mockResolvedValue({ file: node(), version: version(), content: Buffer.from("# hello") }),
    listVersions: vi.fn().mockResolvedValue([version()]),
    restoreVersion: vi.fn().mockResolvedValue({ file: node(), version: version({ id: "version-2", versionNo: 2 }) }),
    listFolderTasks: vi.fn().mockResolvedValue([]),
    getFolderTaskSummary: vi.fn().mockResolvedValue({
      taskCount: 0,
      tasksWithFiles: 0,
      fileCount: 0
    }),
    listThreadFiles: vi.fn().mockResolvedValue([node()]),
    moveThread: vi.fn(),
    recent: vi.fn().mockResolvedValue({ nodes: [], tasks: [] }),
    trash: vi.fn().mockResolvedValue({
      nodes: [node({ state: "trashed" })],
      tasks: [{
        id: "thread-archived",
        title: "Archived task",
        status: "archived",
        folderId: "folder-1",
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z"
      }]
    }),
    agentOutputs: vi.fn().mockResolvedValue({ nodes: [node({ createdByType: "agent" })], tasks: [] }),
    search: vi.fn().mockResolvedValue({ nodes: [], tasks: [] }),
    getChangeSet: vi.fn(),
    revertChangeSet: vi.fn(),
    ...serviceOverrides
  };
  const app = express();
  app.use(express.json());
  app.use(
    "/api/portal/workspace",
    createPortalWorkspaceRouter({
      service: service as never,
      resolveActor: async () => actor
    })
  );
  return { app, service };
}

describe("createPortalWorkspaceRouter", () => {
  it("returns the user workspace without exposing a server storage path", async () => {
    const { app } = createTestApp();
    const response = await request(app).get("/api/portal/workspace").expect(200);
    expect(response.body.workspace).toMatchObject({
      id: "workspace-1",
      history_folder_id: "history-1"
    });
    expect(JSON.stringify(response.body)).not.toContain("storageRoot");
    expect(JSON.stringify(response.body)).not.toContain("/var/");
  });

  it("passes the all-parents trash query to the service", async () => {
    const { app, service } = createTestApp();
    await request(app).get("/api/portal/workspace/nodes?state=trashed&all=1").expect(200);
    expect(service.listNodes).toHaveBeenCalledWith({
      actor,
      parentId: undefined,
      state: "trashed",
      allParents: true,
      includeMigrated: false
    });
  });

  it("reveals migrated historical files only when the caller explicitly asks for them", async () => {
    const { app, service } = createTestApp();
    await request(app)
      .get("/api/portal/workspace/nodes?parent_id=history-1&include_migrated=1")
      .expect(200);
    expect(service.listNodes).toHaveBeenCalledWith({
      actor,
      parentId: "history-1",
      state: "active",
      allParents: false,
      includeMigrated: true
    });
  });

  it("loads one nested node for URL and breadcrumb restoration", async () => {
    const { app, service } = createTestApp();
    const response = await request(app).get("/api/portal/workspace/nodes/folder-1").expect(200);
    expect(response.body.node.name).toBe("Nested");
    expect(service.getNode).toHaveBeenCalledWith({ actor, nodeId: "folder-1" });
  });

  it("uploads raw bytes with stable file metadata", async () => {
    const { app, service } = createTestApp();
    const response = await request(app)
      .post("/api/portal/workspace/files")
      .set("Content-Type", "application/octet-stream")
      .set("X-File-Name", "report.md")
      .set("X-File-Type", "text/markdown")
      .set("X-Parent-Id", "folder-1")
      .send(Buffer.from("# hello"))
      .expect(201);
    expect(response.body.file.id).toBe("file-1");
    expect(response.body.version.version_no).toBe(1);
    expect(service.saveFile).toHaveBeenCalledWith(expect.objectContaining({
      actor,
      parentId: "folder-1",
      name: "report.md",
      mimeType: "text/markdown",
      conflict: "keep_both"
    }));
  });

  it("decodes UTF-8 filenames supplied by the Portal uploader", async () => {
    const { app, service } = createTestApp();
    await request(app)
      .post("/api/portal/workspace/files")
      .set("Content-Type", "application/octet-stream")
      .set("X-File-Name", encodeURIComponent("印尼市场报告.md"))
      .send(Buffer.from("# hello"))
      .expect(201);
    expect(service.saveFile).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "印尼市场报告.md"
      })
    );
  });

  it("serves a selected immutable version with safe response headers", async () => {
    const { app, service } = createTestApp();
    const response = await request(app)
      .get("/api/portal/workspace/files/file-1/content?version_id=version-1")
      .expect(200);
    expect(response.text).toBe("# hello");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(service.getFile).toHaveBeenCalledWith({
      actor,
      fileId: "file-1",
      versionId: "version-1"
    });
  });

  it("lists stable files bound to a historical task", async () => {
    const { app, service } = createTestApp();
    const response = await request(app)
      .get("/api/portal/workspace/tasks/thread-1/files")
      .expect(200);
    expect(response.body.files).toHaveLength(1);
    expect(service.listThreadFiles).toHaveBeenCalledWith({ actor, threadId: "thread-1" });
  });

  it("returns folder task and historical-file totals with each task file count", async () => {
    const task = {
      id: "thread-1",
      title: "Historical report",
      status: "regular",
      folderId: "history-1",
      fileCount: 3,
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:00:00.000Z"
    };
    const { app, service } = createTestApp({
      listFolderTasks: vi.fn().mockResolvedValue([task]),
      getFolderTaskSummary: vi.fn().mockResolvedValue({
        taskCount: 243,
        tasksWithFiles: 45,
        fileCount: 142
      })
    });
    const response = await request(app)
      .get("/api/portal/workspace/folders/history-1/tasks?take=500")
      .expect(200);
    expect(response.body.tasks[0].file_count).toBe(3);
    expect(response.body.summary).toEqual({
      task_count: 243,
      tasks_with_files: 45,
      file_count: 142
    });
    expect(service.listFolderTasks).toHaveBeenCalledWith({
      actor,
      folderId: "history-1",
      includeArchived: false,
      take: 500
    });
  });

  it("lists the agent-output smart view without creating a duplicate folder", async () => {
    const { app, service } = createTestApp();
    const response = await request(app).get("/api/portal/workspace/agent-outputs?take=20").expect(200);
    expect(response.body.nodes[0].created_by_type).toBe("agent");
    expect(service.agentOutputs).toHaveBeenCalledWith({ actor, take: 20 });
  });

  it("returns trashed files and archived tasks in one recoverable view", async () => {
    const { app, service } = createTestApp();
    const response = await request(app).get("/api/portal/workspace/trash?take=25").expect(200);
    expect(response.body.nodes[0].state).toBe("trashed");
    expect(response.body.tasks[0].status).toBe("archived");
    expect(service.trash).toHaveBeenCalledWith({ actor, take: 25 });
  });
});
