import { describe, expect, it, vi } from "vitest";

import { TrainingCatalogAccessError, TrainingCatalogService } from "./training-catalog-service.js";

const viewer = {
  userId: "viewer-1",
  organizationId: "org-1",
  organizationType: "internal"
};

function createService() {
  const rootSummary = {
    id: "root-1",
    parentId: undefined,
    kind: "folder",
    name: "员工AI培训",
    state: "active",
    createdByType: "user",
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z"
  };
  const db = {
    portalTrainingConfiguration: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({})
    },
    user: {
      findFirst: vi.fn().mockResolvedValue({ id: "source-1" })
    },
    userWorkspace: {
      findFirst: vi.fn().mockResolvedValue({
        id: "workspace-1",
        name: "我的工作区",
        securityDomainId: "domain-1"
      })
    },
    workspaceNode: {
      findFirst: vi.fn().mockResolvedValue({ id: "root-1" }),
      findMany: vi.fn().mockResolvedValue([
        { id: "root-1", parentId: null, kind: "folder" },
        { id: "folder-1", parentId: "root-1", kind: "folder" },
        { id: "file-1", parentId: "folder-1", kind: "file" },
        { id: "private-file", parentId: null, kind: "file" }
      ])
    },
    thread: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(4)
    }
  };
  const workspaces = {
    getNode: vi.fn().mockImplementation(async ({ nodeId }: { nodeId: string }) => ({
      ...rootSummary,
      id: nodeId,
      kind: nodeId.startsWith("file") ? "file" : "folder"
    })),
    listNodes: vi.fn().mockResolvedValue([]),
    listFolderAncestorPaths: vi.fn().mockResolvedValue({}),
    listFolderTasks: vi.fn().mockResolvedValue([]),
    getFolderTaskSummary: vi.fn().mockResolvedValue({ taskCount: 0, tasksWithFiles: 0, fileCount: 0 }),
    listThreadFiles: vi.fn().mockResolvedValue([]),
    getFile: vi.fn(),
    listVersions: vi.fn()
  };
  return {
    db,
    workspaces,
    service: new TrainingCatalogService(
      db as never,
      workspaces as never,
      { sourceEmail: "like@baicells.com", rootFolderName: "员工AI培训" }
    )
  };
}

describe("TrainingCatalogService", () => {
  it("rejects non-internal viewers before resolving the source account", async () => {
    const { db, service } = createService();

    await expect(service.getCatalog({ ...viewer, organizationType: "customer" }))
      .rejects.toMatchObject({ status: 403 } satisfies Partial<TrainingCatalogAccessError>);
    expect(db.user.findFirst).not.toHaveBeenCalled();
  });

  it("keeps node reads inside the configured training subtree", async () => {
    const { service, workspaces } = createService();

    await expect(service.getNode({ viewer, nodeId: "file-1" })).resolves.toMatchObject({ id: "file-1" });
    await expect(service.getNode({ viewer, nodeId: "private-file" }))
      .rejects.toMatchObject({ status: 404 } satisfies Partial<TrainingCatalogAccessError>);
    expect(workspaces.getNode).not.toHaveBeenCalledWith(expect.objectContaining({ nodeId: "private-file" }));
  });

  it("uses persisted configuration and can disable the catalog", async () => {
    const { db, service } = createService();
    db.portalTrainingConfiguration.findUnique.mockResolvedValue({
      enabled: false,
      sourceEmail: "owner@baicells.com",
      rootFolderName: "培训目录",
      updatedAt: new Date("2026-08-06T00:00:00.000Z")
    });

    await expect(service.getCatalog(viewer))
      .rejects.toMatchObject({ status: 404, message: "培训案例尚未启用" });
    const status = await service.getConfigurationStatus(viewer);
    expect(status).toMatchObject({
      enabled: false,
      sourceEmail: "owner@baicells.com",
      validationStatus: "disabled"
    });
  });

  it("validates and persists enabled configuration before exposing it", async () => {
    const { db, service } = createService();

    const status = await service.saveConfiguration({
      viewer,
      actorUserId: "admin-1",
      enabled: true,
      sourceEmail: "like@baicells.com",
      rootFolderName: "员工AI培训"
    });

    expect(db.portalTrainingConfiguration.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-1" },
      update: expect.objectContaining({ updatedByUserId: "admin-1" })
    }));
    expect(status).toMatchObject({ validationStatus: "valid", folderCount: 1, threadCount: 4 });
  });
});
