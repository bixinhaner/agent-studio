import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createTrainingCatalogRouter } from "./training-catalog-router.js";

const viewer = {
  userId: "viewer-1",
  organizationId: "org-1",
  organizationType: "internal"
};

const rootFolder = {
  id: "training-root",
  parentId: undefined,
  kind: "folder",
  name: "员工AI培训",
  systemKey: undefined,
  mimeType: undefined,
  sizeBytes: undefined,
  checksum: undefined,
  state: "active",
  createdByType: "user",
  sourceThreadId: undefined,
  createdAt: "2026-07-30T00:00:00.000Z",
  updatedAt: "2026-07-31T00:00:00.000Z"
};

function createApp() {
  const service = {
    getCatalog: vi.fn().mockResolvedValue({
      workspaceId: "workspace-1",
      workspaceName: "我的工作区",
      rootFolder,
      sourceActor: { userId: "source-1", organizationId: "org-1" },
      folderIds: new Set([rootFolder.id]),
      nodeIds: new Set([rootFolder.id])
    }),
    listNodes: vi.fn().mockResolvedValue([rootFolder]),
    getNode: vi.fn().mockResolvedValue(rootFolder),
    listFolderAncestorPaths: vi.fn().mockResolvedValue({ [rootFolder.id]: [rootFolder.id] }),
    listFolderTasks: vi.fn().mockResolvedValue({
      tasks: [{
        id: "thread-1",
        title: "检查切换抓包",
        status: "regular",
        folderId: rootFolder.id,
        fileCount: 2,
        createdAt: "2026-07-31T00:00:00.000Z",
        updatedAt: "2026-07-31T01:00:00.000Z"
      }],
      summary: { taskCount: 1, tasksWithFiles: 1, fileCount: 2 }
    }),
    listThreadFiles: vi.fn().mockResolvedValue([]),
    listThreads: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue({ nodes: [], tasks: [] }),
    getFile: vi.fn(),
    listFileVersions: vi.fn()
  };
  const app = express();
  app.use(express.json());
  app.use("/api/portal/training", createTrainingCatalogRouter({
    service: service as never,
    resolveViewer: async () => viewer
  }));
  return { app, service };
}

describe("createTrainingCatalogRouter", () => {
  it("exposes the configured training root and folder tasks through read endpoints", async () => {
    const { app, service } = createApp();

    const catalog = await request(app).get("/api/portal/training").expect(200);
    expect(catalog.body.workspace).toMatchObject({ status: "readonly", read_only: true });
    expect(catalog.body.nodes).toEqual([expect.objectContaining({ id: rootFolder.id, name: "员工AI培训" })]);

    const tasks = await request(app)
      .get(`/api/portal/training/folders/${rootFolder.id}/tasks`)
      .expect(200);
    expect(tasks.body.tasks).toEqual([
      expect.objectContaining({ id: "thread-1", title: "检查切换抓包", file_count: 2 })
    ]);
    expect(service.listFolderTasks).toHaveBeenCalledWith(expect.objectContaining({
      viewer,
      folderId: rootFolder.id
    }));
  });

  it("does not expose mutation routes", async () => {
    const { app } = createApp();

    await request(app)
      .post(`/api/portal/training/folders/${rootFolder.id}/tasks`)
      .send({ title: "should not be created" })
      .expect(404);
    await request(app)
      .patch(`/api/portal/training/nodes/${rootFolder.id}`)
      .send({ name: "should not change" })
      .expect(404);
  });
});
