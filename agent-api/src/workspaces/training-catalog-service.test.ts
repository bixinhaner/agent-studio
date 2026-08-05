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
      findFirst: vi.fn().mockResolvedValue(null)
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
});
