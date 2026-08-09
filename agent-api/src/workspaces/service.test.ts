import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PortalWorkspaceService } from "./service.js";

const actor = {
  userId: "user-1",
  organizationId: "org-1",
  securityDomainId: "domain-1"
};

let runtimeRoot = "";

beforeEach(async () => {
  const tempRoot = path.resolve(process.cwd(), "temp");
  await fs.mkdir(tempRoot, { recursive: true });
  runtimeRoot = await fs.mkdtemp(path.join(tempRoot, "workspace-materialization-test-"));
});

afterEach(async () => {
  if (runtimeRoot) await fs.rm(runtimeRoot, { recursive: true, force: true });
});

describe("PortalWorkspaceService history compatibility", () => {
  it("returns every active ancestor for state propagation", async () => {
    const db = {
      userWorkspace: {
        findUnique: vi.fn().mockResolvedValue({
          id: "workspace-1",
          status: "active"
        })
      },
      workspaceNode: {
        findMany: vi.fn().mockResolvedValue([
          { id: "root-1", parentId: null },
          { id: "parent-1", parentId: "root-1" },
          { id: "child-1", parentId: "parent-1" }
        ])
      }
    };
    const service = new PortalWorkspaceService(db as never, {} as never);

    await expect(service.listFolderAncestorPaths({
      actor,
      folderIds: ["child-1", "root-1"]
    })).resolves.toEqual({
      "child-1": ["child-1", "parent-1", "root-1"],
      "root-1": ["root-1"]
    });
  });

  it("keeps migrated history files collapsed by default and reveals them on demand", async () => {
    const now = new Date("2026-07-27T00:00:00.000Z");
    const db = {
      userWorkspace: {
        findUnique: vi.fn().mockResolvedValue({
          id: "workspace-1",
          status: "active"
        })
      },
      workspaceNode: {
        findFirst: vi.fn()
          .mockResolvedValueOnce({ id: "history-1" })
          .mockResolvedValueOnce({ systemKey: "history_unfiled" })
          .mockResolvedValueOnce({ id: "history-1" })
          .mockResolvedValueOnce({ systemKey: "history_unfiled" }),
        findMany: vi.fn().mockResolvedValue([{
          id: "file-1",
          workspaceId: "workspace-1",
          parentId: "history-1",
          kind: "file",
          name: "report.pdf",
          systemKey: null,
          mimeType: "application/pdf",
          sizeBytes: 100n,
          checksum: "abc",
          state: "active",
          createdByType: "migration",
          sourceThreadId: "thread-1",
          createdAt: now,
          updatedAt: now
        }])
      }
    };
    const service = new PortalWorkspaceService(db as never, {} as never);

    await service.listNodes({ actor, parentId: "history-1" });
    expect(db.workspaceNode.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          NOT: {
            createdByType: "migration",
            sourceThreadId: { not: null }
          }
        })
      })
    );

    const files = await service.listNodes({
      actor,
      parentId: "history-1",
      includeMigrated: true
    });
    expect(db.workspaceNode.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ NOT: expect.anything() })
      })
    );
    expect(files[0]?.name).toBe("report.pdf");
  });

  it("counts distinct files and tasks with files for the whole history folder", async () => {
    const db = {
      userWorkspace: {
        findUnique: vi.fn().mockResolvedValue({
          id: "workspace-1",
          status: "active"
        })
      },
      workspaceNode: {
        findFirst: vi.fn().mockResolvedValue({ id: "history-1" })
      },
      thread: {
        count: vi.fn().mockResolvedValue(243)
      },
      threadFileBinding: {
        findMany: vi.fn().mockResolvedValue([
          { threadId: "thread-1", fileId: "file-1" },
          { threadId: "thread-1", fileId: "file-1" },
          { threadId: "thread-2", fileId: "file-2" }
        ])
      }
    };
    const service = new PortalWorkspaceService(db as never, {} as never);

    await expect(service.getFolderTaskSummary({
      actor,
      folderId: "history-1"
    })).resolves.toEqual({
      taskCount: 243,
      tasksWithFiles: 2,
      fileCount: 2
    });
  });
});

describe("PortalWorkspaceService trash retention", () => {
  it("previews recursive folders, conversations, files, and running conversations", async () => {
    const now = new Date("2026-08-09T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const db = {
      userWorkspace: {
        findUnique: vi.fn().mockResolvedValue({ id: "workspace-1", status: "active" })
      },
      workspaceNode: {
        findFirst: vi.fn().mockResolvedValue({
          id: "folder-root",
          workspaceId: "workspace-1",
          parentId: null,
          kind: "folder",
          name: "项目",
          normalizedName: "项目",
          systemKey: null,
          state: "active"
        }),
        findMany: vi.fn()
          .mockResolvedValueOnce([{ id: "folder-child" }, { id: "file-root" }])
          .mockResolvedValueOnce([{ id: "file-child" }])
          .mockResolvedValueOnce([]),
        count: vi.fn()
          .mockResolvedValueOnce(2)
          .mockResolvedValueOnce(2)
      },
      thread: {
        count: vi.fn()
          .mockResolvedValueOnce(5)
          .mockResolvedValueOnce(1)
      }
    };
    const service = new PortalWorkspaceService(db as never, {} as never);

    await expect(service.previewTrashNode({ actor, nodeId: "folder-root" })).resolves.toEqual({
      nodeId: "folder-root",
      name: "项目",
      folderCount: 2,
      fileCount: 2,
      threadCount: 5,
      runningThreadCount: 1,
      deleteAt: "2026-09-08T00:00:00.000Z"
    });
    expect(db.thread.count).toHaveBeenLastCalledWith({
      where: expect.objectContaining({
        workspaceTrashBatchId: null,
        runtimeSessions: { some: { status: "active" } }
      })
    });
    vi.useRealTimers();
  });

  it("moves a complete folder tree and every contained conversation into one batch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T00:00:00.000Z"));
    const root = {
      id: "folder-root",
      workspaceId: "workspace-1",
      parentId: "folder-parent",
      kind: "folder",
      name: "项目",
      normalizedName: "项目",
      systemKey: null,
      storageKey: null,
      mimeType: null,
      sizeBytes: null,
      checksum: null,
      state: "active",
      trashedAt: null,
      originalParentId: null,
      trashBatchId: null,
      trashRootId: null,
      purgeAt: null,
      createdByType: "user",
      createdByUserId: "user-1",
      sourceThreadId: null,
      metadata: null,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T00:00:00.000Z")
    };
    const tx = {
      workspaceNode: {
        updateMany: vi.fn().mockResolvedValue({ count: 4 }),
        update: vi.fn().mockResolvedValue(root),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          ...root,
          state: "trashed",
          trashedAt: new Date("2026-08-09T00:00:00.000Z"),
          trashBatchId: "batch-1",
          trashRootId: "folder-root",
          purgeAt: new Date("2026-09-08T00:00:00.000Z")
        })
      },
      thread: { updateMany: vi.fn().mockResolvedValue({ count: 4 }) }
    };
    const db = {
      userWorkspace: {
        findUnique: vi.fn().mockResolvedValue({ id: "workspace-1", status: "active" })
      },
      workspaceNode: {
        findFirst: vi.fn().mockResolvedValue(root),
        findMany: vi.fn()
          .mockResolvedValueOnce([{ id: "folder-child" }, { id: "file-root" }])
          .mockResolvedValueOnce([{ id: "file-child" }])
          .mockResolvedValueOnce([]),
        count: vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(2)
      },
      thread: {
        count: vi.fn().mockResolvedValueOnce(4).mockResolvedValueOnce(0)
      },
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx))
    };
    const service = new PortalWorkspaceService(db as never, {} as never);

    const result = await service.trashNode({ actor, nodeId: "folder-root" });

    expect(result.trashSummary).toEqual({ folderCount: 2, fileCount: 2, threadCount: 4 });
    expect(result.deleteAt).toBe("2026-09-08T00:00:00.000Z");
    expect(tx.workspaceNode.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ["folder-root", "folder-child", "file-root", "file-child"] } }),
      data: expect.objectContaining({ state: "trashed", purgeAt: new Date("2026-09-08T00:00:00.000Z") })
    }));
    expect(tx.thread.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ workspaceFolderId: { in: ["folder-root", "folder-child", "file-root", "file-child"] } })
    }));
    vi.useRealTimers();
  });
});

describe("PortalWorkspaceService.materializeTaskWorkspace", () => {
  it("materializes the selected folder hierarchy and reports a safe byte truncation", async () => {
    const now = new Date("2026-07-27T00:00:00.000Z");
    const db = {
      userWorkspace: {
        findUnique: vi.fn().mockResolvedValue({
          id: "workspace-1",
          status: "active"
        })
      },
      thread: {
        findFirst: vi.fn()
          .mockResolvedValueOnce({ id: "thread-1" })
          .mockResolvedValueOnce({ workspaceFolderId: "folder-root" })
      },
      workspaceNode: {
        findFirst: vi.fn().mockResolvedValue({
          id: "folder-root",
          systemKey: null
        }),
        findMany: vi.fn().mockResolvedValue([
          {
            id: "folder-root",
            parentId: null,
            kind: "folder",
            name: "项目",
            state: "active",
            createdAt: now
          },
          {
            id: "folder-child",
            parentId: "folder-root",
            kind: "folder",
            name: "资料",
            state: "active",
            createdAt: now
          },
          {
            id: "file-small",
            parentId: "folder-child",
            kind: "file",
            name: "说明.md",
            state: "active",
            createdAt: now
          },
          {
            id: "file-large",
            parentId: "folder-root",
            kind: "file",
            name: "数据.csv",
            state: "active",
            createdAt: now
          }
        ])
      },
      workspaceFileVersion: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "version-large",
            workspaceId: "workspace-1",
            fileId: "file-large",
            versionNo: 1,
            storageKey: "files/large",
            sizeBytes: 4n
          },
          {
            id: "version-small",
            workspaceId: "workspace-1",
            fileId: "file-small",
            versionNo: 1,
            storageKey: "files/small",
            sizeBytes: 3n
          }
        ])
      },
      threadFileBinding: {
        createMany: vi.fn().mockResolvedValue({ count: 2 })
      }
    };
    const storage = {
      read: vi.fn(async (storageKey: string) =>
        storageKey === "files/small" ? Buffer.from("abc") : Buffer.from("data")
      )
    };
    const service = new PortalWorkspaceService(db as never, storage as never);

    const result = await service.materializeTaskWorkspace({
      actor,
      threadId: "thread-1",
      runtimeWorkspacePath: runtimeRoot,
      maxBytes: 5
    });

    expect(result).toEqual({
      directoryName: "workspace-files",
      fileCount: 1,
      totalBytes: 3,
      truncated: true
    });
    await expect(fs.readFile(path.join(runtimeRoot, "workspace-files", "资料", "说明.md"), "utf8")).resolves.toBe("abc");
    await expect(fs.stat(path.join(runtimeRoot, "workspace-files", "数据.csv"))).rejects.toThrow();
    expect(db.threadFileBinding.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ threadId: "thread-1", fileId: "file-small", role: "context" }),
          expect.objectContaining({ threadId: "thread-1", fileId: "file-large", role: "context" })
        ])
      })
    );
  });
});

describe("PortalWorkspaceService.resolveTaskOutputTarget", () => {
  it("maps a nested materialized path back to the exact workspace file and version", async () => {
    const db = {
      userWorkspace: {
        findUnique: vi.fn().mockResolvedValue({
          id: "workspace-1",
          status: "active"
        })
      },
      thread: {
        findFirst: vi.fn()
          .mockResolvedValueOnce({ id: "thread-1" })
          .mockResolvedValueOnce({ workspaceFolderId: "folder-root" })
      },
      workspaceNode: {
        findFirst: vi.fn()
          .mockResolvedValueOnce({ id: "folder-root", systemKey: null })
          .mockResolvedValueOnce({ id: "folder-root", systemKey: null })
          .mockResolvedValueOnce({ id: "folder-child", kind: "folder" })
          .mockResolvedValueOnce({ id: "file-1", kind: "file" }),
        create: vi.fn()
      },
      workspaceFileVersion: {
        findFirst: vi.fn().mockResolvedValue({ id: "version-3" })
      }
    };
    const service = new PortalWorkspaceService(db as never, {} as never);

    const result = await service.resolveTaskOutputTarget({
      actor,
      threadId: "thread-1",
      relativePath: "workspace-files/资料/说明.md"
    });

    expect(result).toEqual({
      workspaceId: "workspace-1",
      parentId: "folder-child",
      preferredFileId: "file-1",
      previousVersionId: "version-3"
    });
    expect(db.workspaceNode.create).not.toHaveBeenCalled();
    expect(db.workspaceNode.findFirst).toHaveBeenLastCalledWith({
      where: {
        workspaceId: "workspace-1",
        parentId: "folder-child",
        normalizedName: "说明.md",
        state: "active"
      }
    });
  });
});

describe("PortalWorkspaceService.revertChangeSet", () => {
  it("keeps the original parent so an undone created file can be restored in place", async () => {
    const now = new Date("2026-07-27T00:00:00.000Z");
    const db = {
      userWorkspace: {
        findUnique: vi.fn().mockResolvedValue({
          id: "workspace-1",
          status: "active"
        })
      },
      workspaceChangeSet: {
        findFirst: vi.fn().mockResolvedValue({
          id: "change-set-1",
          workspaceId: "workspace-1",
          status: "applied",
          changes: [
            {
              id: "change-1",
              kind: "create",
              fileId: "file-1",
              beforeVersionId: null
            }
          ]
        }),
        update: vi.fn().mockResolvedValue({
          id: "change-set-1",
          status: "reverted",
          revertedAt: now
        })
      },
      workspaceNode: {
        findFirst: vi.fn().mockResolvedValue({
          id: "file-1",
          parentId: "folder-1"
        }),
        update: vi.fn().mockResolvedValue({})
      },
      workspaceChange: {
        update: vi.fn().mockResolvedValue({})
      }
    };
    const service = new PortalWorkspaceService(db as never, {} as never);

    const result = await service.revertChangeSet({
      actor,
      changeSetId: "change-set-1"
    });

    expect(result).toEqual({
      id: "change-set-1",
      status: "reverted",
      reverted_at: now.toISOString()
    });
    expect(db.workspaceNode.update).toHaveBeenCalledWith({
      where: { id: "file-1" },
      data: {
        state: "trashed",
        originalParentId: "folder-1",
        trashedAt: expect.any(Date)
      }
    });
  });
});
