import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";

import { LocalFsWorkspaceStorage, workspaceObjectChecksum } from "./storage.js";

export type WorkspaceActor = {
  userId: string;
  organizationId: string;
  securityDomainId?: string;
};

export type WorkspaceNodeKind = "folder" | "file";
export type WorkspaceNodeState = "active" | "trashed";

export type WorkspaceSummary = {
  id: string;
  name: string;
  status: string;
  quotaBytes: number;
  usedBytes: number;
  historyFolderId: string;
};

export type WorkspaceNodeSummary = {
  id: string;
  parentId?: string;
  kind: WorkspaceNodeKind;
  name: string;
  systemKey?: string;
  mimeType?: string;
  sizeBytes?: number;
  checksum?: string;
  state: WorkspaceNodeState;
  createdByType: string;
  sourceThreadId?: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceTaskSummary = {
  id: string;
  title: string;
  status: "regular" | "archived";
  folderId?: string;
  fileCount: number;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceFolderTaskSummary = {
  taskCount: number;
  tasksWithFiles: number;
  fileCount: number;
};

export type WorkspaceFileVersionSummary = {
  id: string;
  fileId: string;
  versionNo: number;
  mimeType?: string;
  sizeBytes: number;
  checksum: string;
  createdByType: string;
  createdByUserId?: string;
  createdByThreadId?: string;
  changeType: string;
  createdAt: string;
};

export type SavedWorkspaceFile = {
  file: WorkspaceNodeSummary;
  version: WorkspaceFileVersionSummary;
};

export type MaterializedTaskWorkspace = {
  directoryName: string;
  fileCount: number;
  totalBytes: number;
  truncated: boolean;
};

export type TaskOutputTarget = {
  workspaceId: string;
  parentId: string;
  preferredFileId?: string;
  previousVersionId?: string;
};

type WorkspaceRecord = Awaited<ReturnType<PrismaClient["userWorkspace"]["findUniqueOrThrow"]>>;
type WorkspaceNodeRecord = Awaited<ReturnType<PrismaClient["workspaceNode"]["findUniqueOrThrow"]>>;
type WorkspaceVersionRecord = Awaited<ReturnType<PrismaClient["workspaceFileVersion"]["findUniqueOrThrow"]>>;

const DEFAULT_WORKSPACE_QUOTA_BYTES = 10 * 1024 * 1024 * 1024;
const HISTORY_SYSTEM_KEY = "history_unfiled";

function asSafeNumber(value: bigint | number | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const numberValue = typeof value === "bigint" ? Number(value) : value;
  return Number.isSafeInteger(numberValue) && numberValue >= 0 ? numberValue : undefined;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function userWorkspaceScopeKey(actor: WorkspaceActor): string {
  return `${actor.organizationId || "_"}:${actor.securityDomainId || "_"}:${actor.userId}`;
}

export function normalizeWorkspaceNodeName(value: string): { name: string; normalizedName: string } {
  const name = String(value || "").normalize("NFKC").trim();
  if (!name || name === "." || name === ".." || name.length > 255 || /[\/\0]/.test(name)) {
    throw new Error("Workspace item name is invalid");
  }
  return {
    name,
    normalizedName: name.toLocaleLowerCase("zh-Hans-CN")
  };
}

function mapWorkspaceNode(row: WorkspaceNodeRecord): WorkspaceNodeSummary {
  return {
    id: row.id,
    parentId: row.parentId ?? undefined,
    kind: row.kind === "folder" ? "folder" : "file",
    name: row.name,
    systemKey: row.systemKey ?? undefined,
    mimeType: row.mimeType ?? undefined,
    sizeBytes: asSafeNumber(row.sizeBytes),
    checksum: row.checksum ?? undefined,
    state: row.state === "trashed" ? "trashed" : "active",
    createdByType: row.createdByType,
    sourceThreadId: row.sourceThreadId ?? undefined,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  };
}

function mapWorkspaceVersion(row: WorkspaceVersionRecord): WorkspaceFileVersionSummary {
  return {
    id: row.id,
    fileId: row.fileId,
    versionNo: row.versionNo,
    mimeType: row.mimeType ?? undefined,
    sizeBytes: asSafeNumber(row.sizeBytes) ?? 0,
    checksum: row.checksum,
    createdByType: row.createdByType,
    createdByUserId: row.createdByUserId ?? undefined,
    createdByThreadId: row.createdByThreadId ?? undefined,
    changeType: row.changeType,
    createdAt: toIso(row.createdAt)
  };
}

function mapTask(row: {
  id: string;
  title: string | null;
  status: string;
  workspaceFolderId: string | null;
  workspaceFileBindings?: Array<{ fileId: string }>;
  createdAt: Date | string;
  updatedAt: Date | string;
}): WorkspaceTaskSummary {
  return {
    id: row.id,
    title: row.title?.trim() || "新任务",
    status: row.status === "archived" ? "archived" : "regular",
    folderId: row.workspaceFolderId ?? undefined,
    fileCount: new Set((row.workspaceFileBindings || []).map((binding) => binding.fileId)).size,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  };
}

function fileNameWithCopySuffix(name: string, suffix: number): string {
  const extension = path.extname(name);
  const baseName = extension ? name.slice(0, -extension.length) : name;
  return `${baseName} (${suffix})${extension}`;
}

function versionStorageKey(input: {
  workspaceStorageRootKey: string;
  fileId: string;
  versionNo: number;
  checksum: string;
}): string {
  return `${input.workspaceStorageRootKey}/files/${input.fileId}/v${input.versionNo}-${input.checksum}`;
}

export class PortalWorkspaceService {
  constructor(
    private readonly db: PrismaClient,
    private readonly storage: LocalFsWorkspaceStorage
  ) {}

  async ensureWorkspace(actor: WorkspaceActor): Promise<WorkspaceSummary> {
    const scopeKey = userWorkspaceScopeKey(actor);
    const stableHash = createHash("sha256").update(scopeKey).digest("hex").slice(0, 32);
    const workspace = await this.db.userWorkspace.upsert({
      where: { scopeKey },
      update: {
        organizationId: actor.organizationId,
        securityDomainId: actor.securityDomainId ?? null,
        ownerUserId: actor.userId,
        status: "active"
      },
      create: {
        id: `uw_${stableHash}`,
        scopeKey,
        organizationId: actor.organizationId,
        securityDomainId: actor.securityDomainId ?? null,
        ownerUserId: actor.userId,
        name: "我的工作区",
        status: "active",
        storageRootKey: `user-workspaces/${stableHash}`,
        quotaBytes: BigInt(DEFAULT_WORKSPACE_QUOTA_BYTES),
        usedBytes: BigInt(0)
      }
    });
    const historyFolder = await this.db.workspaceNode.upsert({
      where: {
        workspaceId_systemKey: {
          workspaceId: workspace.id,
          systemKey: HISTORY_SYSTEM_KEY
        }
      },
      update: {
        name: "History",
        normalizedName: "history",
        state: "active"
      },
      create: {
        id: `wn_${stableHash}`,
        workspaceId: workspace.id,
        parentId: null,
        kind: "folder",
        name: "History",
        normalizedName: "history",
        systemKey: HISTORY_SYSTEM_KEY,
        createdByType: "migration"
      }
    });
    await this.db.thread.updateMany({
      where: {
        organizationId: actor.organizationId,
        securityDomainId: actor.securityDomainId ?? null,
        userId: actor.userId,
        userWorkspaceId: null
      },
      data: {
        userWorkspaceId: workspace.id,
        workspaceFolderId: historyFolder.id
      }
    });
    return {
      id: workspace.id,
      name: workspace.name,
      status: workspace.status,
      quotaBytes: asSafeNumber(workspace.quotaBytes) ?? DEFAULT_WORKSPACE_QUOTA_BYTES,
      usedBytes: asSafeNumber(workspace.usedBytes) ?? 0,
      historyFolderId: historyFolder.id
    };
  }

  async getWorkspaceRecord(actor: WorkspaceActor): Promise<WorkspaceRecord> {
    const workspace = await this.db.userWorkspace.findUnique({
      where: { scopeKey: userWorkspaceScopeKey(actor) }
    });
    if (!workspace || workspace.status !== "active") {
      await this.ensureWorkspace(actor);
      return this.db.userWorkspace.findUniqueOrThrow({
        where: { scopeKey: userWorkspaceScopeKey(actor) }
      });
    }
    return workspace;
  }

  async listNodes(input: {
    actor: WorkspaceActor;
    parentId?: string;
    state?: WorkspaceNodeState;
    allParents?: boolean;
    includeMigrated?: boolean;
  }): Promise<WorkspaceNodeSummary[]> {
    const workspace = await this.getWorkspaceRecord(input.actor);
    if (!input.allParents) await this.assertFolder(workspace.id, input.parentId);
    const parent = !input.allParents && input.parentId
      ? await this.db.workspaceNode.findFirst({
          where: { id: input.parentId, workspaceId: workspace.id, kind: "folder" },
          select: { systemKey: true }
        })
      : null;
    const rows = await this.db.workspaceNode.findMany({
      where: {
        workspaceId: workspace.id,
        ...(input.allParents ? {} : { parentId: input.parentId ?? null }),
        state: input.state ?? "active",
        ...(parent?.systemKey === HISTORY_SYSTEM_KEY && !input.includeMigrated
          ? {
              NOT: {
                createdByType: "migration",
                sourceThreadId: { not: null }
              }
            }
          : {})
      },
      orderBy: [{ kind: "asc" }, { name: "asc" }]
    });
    return rows
      .map(mapWorkspaceNode)
      .sort((left, right) =>
        left.kind === right.kind
          ? left.name.localeCompare(right.name, "zh-Hans-CN", { numeric: true, sensitivity: "base" })
          : left.kind === "folder"
            ? -1
            : 1
      );
  }

  async listFolderAncestorPaths(input: {
    actor: WorkspaceActor;
    folderIds: readonly string[];
  }): Promise<Record<string, string[]>> {
    const folderIds = Array.from(
      new Set(input.folderIds.map((folderId) => String(folderId || "").trim()).filter(Boolean))
    ).slice(0, 500);
    if (folderIds.length === 0) return {};

    const workspace = await this.getWorkspaceRecord(input.actor);
    const rows = await this.db.workspaceNode.findMany({
      where: {
        workspaceId: workspace.id,
        kind: "folder",
        state: "active"
      },
      select: {
        id: true,
        parentId: true
      }
    });
    const parentByFolderId = new Map(rows.map((row) => [row.id, row.parentId]));
    const paths: Record<string, string[]> = {};

    for (const folderId of folderIds) {
      const path: string[] = [];
      const seen = new Set<string>();
      let currentId: string | null = folderId;
      while (currentId && !seen.has(currentId) && path.length < 64) {
        if (!parentByFolderId.has(currentId)) break;
        seen.add(currentId);
        path.push(currentId);
        currentId = parentByFolderId.get(currentId) ?? null;
      }
      paths[folderId] = path;
    }

    return paths;
  }

  async getNode(input: {
    actor: WorkspaceActor;
    nodeId: string;
  }): Promise<WorkspaceNodeSummary> {
    const workspace = await this.getWorkspaceRecord(input.actor);
    return mapWorkspaceNode(await this.requireNode(workspace.id, input.nodeId));
  }

  async resolveTaskScope(input: {
    actor: WorkspaceActor;
    folderId?: string;
  }): Promise<{ workspaceId: string; folderId: string }> {
    const workspace = await this.getWorkspaceRecord(input.actor);
    const folderId =
      input.folderId ??
      (
        await this.db.workspaceNode.findFirst({
          where: {
            workspaceId: workspace.id,
            systemKey: HISTORY_SYSTEM_KEY,
            kind: "folder",
            state: "active"
          },
          select: { id: true }
        })
      )?.id;
    if (!folderId) throw new Error("Workspace history folder does not exist");
    await this.assertFolder(workspace.id, folderId);
    return {
      workspaceId: workspace.id,
      folderId
    };
  }

  async listFolderTasks(input: {
    actor: WorkspaceActor;
    folderId: string;
    includeArchived?: boolean;
    take?: number;
  }): Promise<WorkspaceTaskSummary[]> {
    const workspace = await this.getWorkspaceRecord(input.actor);
    await this.assertFolder(workspace.id, input.folderId);
    const rows = await this.db.thread.findMany({
      where: {
        organizationId: input.actor.organizationId,
        securityDomainId: input.actor.securityDomainId ?? null,
        userId: input.actor.userId,
        userWorkspaceId: workspace.id,
        workspaceFolderId: input.folderId,
        ...(input.includeArchived ? {} : { status: "active" })
      },
      select: {
        id: true,
        title: true,
        status: true,
        workspaceFolderId: true,
        workspaceFileBindings: {
          select: { fileId: true }
        },
        createdAt: true,
        updatedAt: true
      },
      orderBy: { updatedAt: "desc" },
      take: Math.min(Math.max(input.take ?? 100, 1), 500)
    });
    return rows.map(mapTask);
  }

  async getFolderTaskSummary(input: {
    actor: WorkspaceActor;
    folderId: string;
    includeArchived?: boolean;
  }): Promise<WorkspaceFolderTaskSummary> {
    const workspace = await this.getWorkspaceRecord(input.actor);
    await this.assertFolder(workspace.id, input.folderId);
    const threadWhere = {
      organizationId: input.actor.organizationId,
      securityDomainId: input.actor.securityDomainId ?? null,
      userId: input.actor.userId,
      userWorkspaceId: workspace.id,
      workspaceFolderId: input.folderId,
      ...(input.includeArchived ? {} : { status: "active" as const })
    };
    const [taskCount, bindings] = await Promise.all([
      this.db.thread.count({ where: threadWhere }),
      this.db.threadFileBinding.findMany({
        where: {
          thread: threadWhere,
          file: {
            workspaceId: workspace.id,
            kind: "file",
            state: "active"
          }
        },
        select: {
          threadId: true,
          fileId: true
        }
      })
    ]);
    return {
      taskCount,
      tasksWithFiles: new Set(bindings.map((binding) => binding.threadId)).size,
      fileCount: new Set(bindings.map((binding) => binding.fileId)).size
    };
  }

  async listThreadFiles(input: {
    actor: WorkspaceActor;
    threadId: string;
  }): Promise<WorkspaceNodeSummary[]> {
    const workspace = await this.getWorkspaceRecord(input.actor);
    await this.assertThreadOwned(input.actor, workspace.id, input.threadId);
    const bindings = await this.db.threadFileBinding.findMany({
      where: {
        threadId: input.threadId,
        file: {
          workspaceId: workspace.id,
          kind: "file",
          state: "active"
        }
      },
      include: { file: true },
      orderBy: { createdAt: "desc" }
    });
    const seen = new Set<string>();
    const files: WorkspaceNodeSummary[] = [];
    for (const binding of bindings) {
      if (seen.has(binding.fileId)) continue;
      seen.add(binding.fileId);
      files.push(mapWorkspaceNode(binding.file));
    }
    return files;
  }

  async materializeTaskWorkspace(input: {
    actor: WorkspaceActor;
    threadId: string;
    runtimeWorkspacePath: string;
    maxFiles?: number;
    maxBytes?: number;
  }): Promise<MaterializedTaskWorkspace> {
    const workspace = await this.getWorkspaceRecord(input.actor);
    await this.assertThreadOwned(input.actor, workspace.id, input.threadId);
    const thread = await this.db.thread.findFirst({
      where: {
        id: input.threadId,
        organizationId: input.actor.organizationId,
        securityDomainId: input.actor.securityDomainId ?? null,
        userId: input.actor.userId,
        OR: [{ userWorkspaceId: workspace.id }, { userWorkspaceId: null }]
      },
      select: {
        workspaceFolderId: true
      }
    });
    if (!thread) throw new Error("Thread does not exist");

    const directoryName = "workspace-files";
    const runtimeRoot = path.resolve(input.runtimeWorkspacePath);
    const targetRoot = path.resolve(runtimeRoot, directoryName);
    if (targetRoot === runtimeRoot || !targetRoot.startsWith(`${runtimeRoot}${path.sep}`)) {
      throw new Error("Task workspace materialization target is invalid");
    }
    await fs.rm(targetRoot, { recursive: true, force: true });
    await fs.mkdir(targetRoot, { recursive: true, mode: 0o750 });

    const maxFiles = Math.min(Math.max(input.maxFiles ?? 1000, 1), 2000);
    const maxBytes = Math.min(
      Math.max(input.maxBytes ?? 512 * 1024 * 1024, 1),
      2 * 1024 * 1024 * 1024
    );
    const selectedFolderId = thread.workspaceFolderId;
    if (!selectedFolderId) {
      return { directoryName, fileCount: 0, totalBytes: 0, truncated: false };
    }
    const selectedFolder = await this.db.workspaceNode.findFirst({
      where: {
        id: selectedFolderId,
        workspaceId: workspace.id,
        kind: "folder",
        state: "active"
      },
      select: { id: true, systemKey: true }
    });
    if (!selectedFolder) {
      return { directoryName, fileCount: 0, totalBytes: 0, truncated: false };
    }

    type MaterializationFile = {
      id: string;
      versionId: string;
      storageKey: string;
      relativePath: string;
      sizeBytes: bigint | number;
    };
    const files: MaterializationFile[] = [];
    let truncated = false;

    if (selectedFolder.systemKey === HISTORY_SYSTEM_KEY) {
      const bindings = await this.db.threadFileBinding.findMany({
        where: {
          threadId: input.threadId,
          file: {
            workspaceId: workspace.id,
            kind: "file",
            state: "active"
          }
        },
        include: {
          file: true,
          version: true
        },
        orderBy: { createdAt: "desc" },
        take: maxFiles + 1
      });
      const seen = new Set<string>();
      for (const binding of bindings) {
        if (seen.has(binding.fileId)) continue;
        if (files.length >= maxFiles) {
          truncated = true;
          break;
        }
        const version =
          binding.version ??
          (await this.db.workspaceFileVersion.findFirst({
            where: { workspaceId: workspace.id, fileId: binding.fileId },
            orderBy: { versionNo: "desc" }
          }));
        if (!version) continue;
        seen.add(binding.fileId);
        files.push({
          id: binding.fileId,
          versionId: version.id,
          storageKey: version.storageKey,
          relativePath: binding.file.name,
          sizeBytes: version.sizeBytes
        });
      }
    } else {
      const nodes = await this.db.workspaceNode.findMany({
        where: {
          workspaceId: workspace.id,
          state: "active"
        },
        orderBy: { createdAt: "asc" }
      });
      const byId = new Map(nodes.map((node) => [node.id, node]));
      const allDescendantFiles = nodes
        .filter((node) => node.kind === "file")
        .map((node) => {
          const segments = [node.name];
          let parentId = node.parentId;
          const visited = new Set<string>();
          while (parentId && parentId !== selectedFolder.id && !visited.has(parentId)) {
            visited.add(parentId);
            const parent = byId.get(parentId);
            if (!parent || parent.kind !== "folder") return null;
            segments.unshift(parent.name);
            parentId = parent.parentId;
          }
          return parentId === selectedFolder.id
            ? { id: node.id, relativePath: segments.join("/") }
            : null;
        })
        .filter((item): item is { id: string; relativePath: string } => Boolean(item));
      const descendantFiles = allDescendantFiles.slice(0, maxFiles);
      truncated ||= allDescendantFiles.length > descendantFiles.length;
      if (descendantFiles.length > 0) {
        const versions = await this.db.workspaceFileVersion.findMany({
          where: {
            workspaceId: workspace.id,
            fileId: { in: descendantFiles.map((item) => item.id) }
          },
          orderBy: [{ fileId: "asc" }, { versionNo: "desc" }]
        });
        const latestByFileId = new Map<string, WorkspaceVersionRecord>();
        for (const version of versions) {
          if (!latestByFileId.has(version.fileId)) latestByFileId.set(version.fileId, version);
        }
        for (const file of descendantFiles) {
          const version = latestByFileId.get(file.id);
          if (!version) continue;
          files.push({
            id: file.id,
            versionId: version.id,
            storageKey: version.storageKey,
            relativePath: file.relativePath,
            sizeBytes: version.sizeBytes
          });
        }
        await this.db.threadFileBinding.createMany({
          data: files.map((file) => ({
            id: randomUUID().replace(/-/g, ""),
            threadId: input.threadId,
            fileId: file.id,
            versionId: file.versionId,
            role: "context"
          })),
          skipDuplicates: true
        });
      }
    }

    let totalBytes = 0;
    let materializedFileCount = 0;
    for (const file of files) {
      const expectedBytes = asSafeNumber(file.sizeBytes) ?? 0;
      if (totalBytes + expectedBytes > maxBytes) {
        truncated = true;
        continue;
      }
      const targetPath = path.resolve(targetRoot, ...file.relativePath.split("/"));
      if (!targetPath.startsWith(`${targetRoot}${path.sep}`)) {
        throw new Error("Task workspace file target is invalid");
      }
      const content = await this.storage.read(file.storageKey);
      await fs.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o750 });
      await fs.writeFile(targetPath, content, { mode: 0o640 });
      totalBytes += content.length;
      materializedFileCount += 1;
    }

    return {
      directoryName,
      fileCount: materializedFileCount,
      totalBytes,
      truncated
    };
  }

  async createFolder(input: {
    actor: WorkspaceActor;
    parentId?: string;
    name: string;
  }): Promise<WorkspaceNodeSummary> {
    const workspace = await this.getWorkspaceRecord(input.actor);
    await this.assertFolder(workspace.id, input.parentId);
    const normalized = normalizeWorkspaceNodeName(input.name);
    await this.assertNameAvailable(workspace.id, input.parentId, normalized.normalizedName);
    const folder = await this.db.workspaceNode.create({
      data: {
        id: randomUUID().replace(/-/g, ""),
        workspaceId: workspace.id,
        parentId: input.parentId ?? null,
        kind: "folder",
        name: normalized.name,
        normalizedName: normalized.normalizedName,
        createdByType: "user",
        createdByUserId: input.actor.userId
      }
    });
    return mapWorkspaceNode(folder);
  }

  async saveFile(input: {
    actor: WorkspaceActor;
    parentId?: string;
    name: string;
    content: Buffer;
    mimeType?: string;
    conflict?: "keep_both" | "replace";
    createdByType?: "user" | "agent" | "migration";
    threadId?: string;
    role?: "input" | "context" | "output";
    preferredFileId?: string;
  }): Promise<SavedWorkspaceFile> {
    const workspace = await this.getWorkspaceRecord(input.actor);
    await this.assertFolder(workspace.id, input.parentId);
    if (input.threadId) {
      await this.assertThreadOwned(input.actor, workspace.id, input.threadId);
    }
    const normalized = normalizeWorkspaceNodeName(input.name);
    let existing = input.preferredFileId
      ? await this.db.workspaceNode.findFirst({
          where: {
            id: input.preferredFileId,
            workspaceId: workspace.id,
            kind: "file",
            state: "active"
          }
        })
      : await this.db.workspaceNode.findFirst({
          where: {
            workspaceId: workspace.id,
            parentId: input.parentId ?? null,
            normalizedName: normalized.normalizedName,
            state: "active"
          }
        });

    let finalName = normalized.name;
    let finalNormalizedName = normalized.normalizedName;
    if (existing?.kind === "folder" || (existing && input.conflict !== "replace" && !input.preferredFileId)) {
      existing = null;
      for (let suffix = 2; suffix <= 1000; suffix += 1) {
        const candidate = normalizeWorkspaceNodeName(fileNameWithCopySuffix(normalized.name, suffix));
        const conflict = await this.db.workspaceNode.findFirst({
          where: {
            workspaceId: workspace.id,
            parentId: input.parentId ?? null,
            normalizedName: candidate.normalizedName,
            state: "active"
          },
          select: { id: true }
        });
        if (!conflict) {
          finalName = candidate.name;
          finalNormalizedName = candidate.normalizedName;
          break;
        }
      }
    }

    if (BigInt(workspace.usedBytes) + BigInt(input.content.length) > BigInt(workspace.quotaBytes)) {
      throw new Error("Workspace storage quota has been exceeded");
    }

    const fileId = existing?.id ?? randomUUID().replace(/-/g, "");
    const latest = existing
      ? await this.db.workspaceFileVersion.findFirst({
          where: { fileId },
          orderBy: { versionNo: "desc" }
        })
      : null;
    const versionNo = (latest?.versionNo ?? 0) + 1;
    const checksum = workspaceObjectChecksum(input.content);
    const storageKey = versionStorageKey({
      workspaceStorageRootKey: workspace.storageRootKey,
      fileId,
      versionNo,
      checksum
    });
    const stored = await this.storage.putImmutable(storageKey, input.content);
    const createdByType = input.createdByType ?? "user";
    const result = await this.db.$transaction(async (tx) => {
      const file = existing
        ? await tx.workspaceNode.update({
            where: { id: fileId },
            data: {
              parentId: input.parentId ?? existing.parentId,
              name: finalName,
              normalizedName: finalNormalizedName,
              storageKey: stored.storageKey,
              mimeType: input.mimeType ?? existing.mimeType,
              sizeBytes: BigInt(stored.sizeBytes),
              checksum: stored.checksum,
              createdByType,
              sourceThreadId: input.threadId ?? existing.sourceThreadId,
              state: "active",
              trashedAt: null
            }
          })
        : await tx.workspaceNode.create({
            data: {
              id: fileId,
              workspaceId: workspace.id,
              parentId: input.parentId ?? null,
              kind: "file",
              name: finalName,
              normalizedName: finalNormalizedName,
              storageKey: stored.storageKey,
              mimeType: input.mimeType ?? null,
              sizeBytes: BigInt(stored.sizeBytes),
              checksum: stored.checksum,
              createdByType,
              createdByUserId: createdByType === "user" ? input.actor.userId : null,
              sourceThreadId: input.threadId ?? null
            }
          });
      const version = await tx.workspaceFileVersion.create({
        data: {
          id: randomUUID().replace(/-/g, ""),
          workspaceId: workspace.id,
          fileId,
          versionNo,
          storageKey: stored.storageKey,
          mimeType: input.mimeType ?? null,
          sizeBytes: BigInt(stored.sizeBytes),
          checksum: stored.checksum,
          createdByType,
          createdByUserId: createdByType === "user" ? input.actor.userId : null,
          createdByThreadId: input.threadId ?? null,
          changeType: existing ? "update" : "create"
        }
      });
      if (input.threadId) {
        await tx.threadFileBinding.create({
          data: {
            id: randomUUID().replace(/-/g, ""),
            threadId: input.threadId,
            fileId,
            versionId: version.id,
            role: input.role ?? (createdByType === "agent" ? "output" : "input")
          }
        });
      }
      await tx.userWorkspace.update({
        where: { id: workspace.id },
        data: { usedBytes: { increment: BigInt(stored.sizeBytes) } }
      });
      return { file, version };
    });
    return {
      file: mapWorkspaceNode(result.file),
      version: mapWorkspaceVersion(result.version)
    };
  }

  async getFile(input: {
    actor: WorkspaceActor;
    fileId: string;
    versionId?: string;
  }): Promise<{ file: WorkspaceNodeSummary; version: WorkspaceFileVersionSummary; content: Buffer }> {
    const workspace = await this.getWorkspaceRecord(input.actor);
    const file = await this.db.workspaceNode.findFirst({
      where: {
        id: input.fileId,
        workspaceId: workspace.id,
        kind: "file"
      }
    });
    if (!file) throw new Error("Workspace file does not exist");
    const version = input.versionId
      ? await this.db.workspaceFileVersion.findFirst({
          where: { id: input.versionId, fileId: file.id, workspaceId: workspace.id }
        })
      : await this.db.workspaceFileVersion.findFirst({
          where: { fileId: file.id, workspaceId: workspace.id },
          orderBy: { versionNo: "desc" }
        });
    if (!version) throw new Error("Workspace file version does not exist");
    return {
      file: mapWorkspaceNode(file),
      version: mapWorkspaceVersion(version),
      content: await this.storage.read(version.storageKey)
    };
  }

  async listVersions(input: {
    actor: WorkspaceActor;
    fileId: string;
  }): Promise<WorkspaceFileVersionSummary[]> {
    const workspace = await this.getWorkspaceRecord(input.actor);
    const file = await this.db.workspaceNode.findFirst({
      where: { id: input.fileId, workspaceId: workspace.id, kind: "file" },
      select: { id: true }
    });
    if (!file) throw new Error("Workspace file does not exist");
    const versions = await this.db.workspaceFileVersion.findMany({
      where: { workspaceId: workspace.id, fileId: input.fileId },
      orderBy: { versionNo: "desc" }
    });
    return versions.map(mapWorkspaceVersion);
  }

  async restoreVersion(input: {
    actor: WorkspaceActor;
    fileId: string;
    versionId: string;
    threadId?: string;
  }): Promise<SavedWorkspaceFile> {
    const resolved = await this.getFile(input);
    return this.saveFile({
      actor: input.actor,
      parentId: resolved.file.parentId,
      name: resolved.file.name,
      content: resolved.content,
      mimeType: resolved.version.mimeType ?? resolved.file.mimeType,
      conflict: "replace",
      createdByType: "user",
      threadId: input.threadId,
      role: "output",
      preferredFileId: input.fileId
    });
  }

  async renameOrMoveNode(input: {
    actor: WorkspaceActor;
    nodeId: string;
    name?: string;
    parentId?: string | null;
  }): Promise<WorkspaceNodeSummary> {
    const workspace = await this.getWorkspaceRecord(input.actor);
    const node = await this.requireNode(workspace.id, input.nodeId);
    if (node.systemKey) throw new Error("System workspace folders cannot be changed");
    const nextParentId = input.parentId === undefined ? node.parentId : input.parentId;
    await this.assertFolder(workspace.id, nextParentId ?? undefined);
    if (node.kind === "folder" && nextParentId) {
      await this.assertNotDescendant(workspace.id, node.id, nextParentId);
    }
    const normalized = input.name === undefined ? null : normalizeWorkspaceNodeName(input.name);
    if (normalized || nextParentId !== node.parentId) {
      await this.assertNameAvailable(
        workspace.id,
        nextParentId ?? undefined,
        normalized?.normalizedName ?? node.normalizedName,
        node.id
      );
    }
    const updated = await this.db.workspaceNode.update({
      where: { id: node.id },
      data: {
        parentId: nextParentId,
        ...(normalized
          ? {
              name: normalized.name,
              normalizedName: normalized.normalizedName
            }
          : {})
      }
    });
    return mapWorkspaceNode(updated);
  }

  async trashNode(input: {
    actor: WorkspaceActor;
    nodeId: string;
  }): Promise<WorkspaceNodeSummary> {
    const workspace = await this.getWorkspaceRecord(input.actor);
    const node = await this.requireNode(workspace.id, input.nodeId);
    if (node.systemKey) throw new Error("System workspace folders cannot be deleted");
    const updated = await this.db.workspaceNode.update({
      where: { id: node.id },
      data: {
        state: "trashed",
        originalParentId: node.parentId,
        trashedAt: new Date()
      }
    });
    return mapWorkspaceNode(updated);
  }

  async restoreNode(input: {
    actor: WorkspaceActor;
    nodeId: string;
  }): Promise<WorkspaceNodeSummary> {
    const workspace = await this.getWorkspaceRecord(input.actor);
    const node = await this.requireNode(workspace.id, input.nodeId);
    const targetParent = node.originalParentId
      ? await this.db.workspaceNode.findFirst({
          where: {
            id: node.originalParentId,
            workspaceId: workspace.id,
            kind: "folder",
            state: "active"
          },
          select: { id: true }
        })
      : null;
    let name = node.name;
    let normalizedName = node.normalizedName;
    const conflict = await this.db.workspaceNode.findFirst({
      where: {
        workspaceId: workspace.id,
        parentId: targetParent?.id ?? null,
        normalizedName,
        state: "active",
        NOT: { id: node.id }
      },
      select: { id: true }
    });
    if (conflict) {
      for (let suffix = 2; suffix <= 1000; suffix += 1) {
        const candidate = normalizeWorkspaceNodeName(fileNameWithCopySuffix(node.name, suffix));
        const duplicate = await this.db.workspaceNode.findFirst({
          where: {
            workspaceId: workspace.id,
            parentId: targetParent?.id ?? null,
            normalizedName: candidate.normalizedName,
            state: "active"
          },
          select: { id: true }
        });
        if (!duplicate) {
          name = candidate.name;
          normalizedName = candidate.normalizedName;
          break;
        }
      }
    }
    const restored = await this.db.workspaceNode.update({
      where: { id: node.id },
      data: {
        parentId: targetParent?.id ?? null,
        name,
        normalizedName,
        state: "active",
        trashedAt: null,
        originalParentId: null
      }
    });
    return mapWorkspaceNode(restored);
  }

  async search(input: {
    actor: WorkspaceActor;
    query: string;
  }): Promise<{ nodes: WorkspaceNodeSummary[]; tasks: WorkspaceTaskSummary[] }> {
    const workspace = await this.getWorkspaceRecord(input.actor);
    const query = input.query.trim();
    if (!query) return { nodes: [], tasks: [] };
    const [nodes, tasks] = await Promise.all([
      this.db.workspaceNode.findMany({
        where: {
          workspaceId: workspace.id,
          state: "active",
          name: { contains: query, mode: "insensitive" }
        },
        orderBy: { updatedAt: "desc" },
        take: 50
      }),
      this.db.thread.findMany({
        where: {
          organizationId: input.actor.organizationId,
          securityDomainId: input.actor.securityDomainId ?? null,
          userId: input.actor.userId,
          userWorkspaceId: workspace.id,
          title: { contains: query, mode: "insensitive" }
        },
        select: {
          id: true,
          title: true,
          status: true,
          workspaceFolderId: true,
          createdAt: true,
          updatedAt: true
        },
        orderBy: { updatedAt: "desc" },
        take: 50
      })
    ]);
    return {
      nodes: nodes.map(mapWorkspaceNode),
      tasks: tasks.map(mapTask)
    };
  }

  async recent(input: {
    actor: WorkspaceActor;
    take?: number;
  }): Promise<{ nodes: WorkspaceNodeSummary[]; tasks: WorkspaceTaskSummary[] }> {
    const workspace = await this.getWorkspaceRecord(input.actor);
    const take = Math.min(Math.max(input.take ?? 20, 1), 50);
    const [nodes, tasks] = await Promise.all([
      this.db.workspaceNode.findMany({
        where: {
          workspaceId: workspace.id,
          state: "active",
          systemKey: null,
          createdByType: { not: "migration" }
        },
        orderBy: { updatedAt: "desc" },
        take
      }),
      this.db.thread.findMany({
        where: {
          organizationId: input.actor.organizationId,
          securityDomainId: input.actor.securityDomainId ?? null,
          userId: input.actor.userId,
          userWorkspaceId: workspace.id,
          status: "active"
        },
        select: {
          id: true,
          title: true,
          status: true,
          workspaceFolderId: true,
          createdAt: true,
          updatedAt: true
        },
        orderBy: { updatedAt: "desc" },
        take
      })
    ]);
    return { nodes: nodes.map(mapWorkspaceNode), tasks: tasks.map(mapTask) };
  }

  async trash(input: {
    actor: WorkspaceActor;
    take?: number;
  }): Promise<{ nodes: WorkspaceNodeSummary[]; tasks: WorkspaceTaskSummary[] }> {
    const workspace = await this.getWorkspaceRecord(input.actor);
    const take = Math.min(Math.max(input.take ?? 100, 1), 200);
    const [nodes, tasks] = await Promise.all([
      this.db.workspaceNode.findMany({
        where: {
          workspaceId: workspace.id,
          state: "trashed"
        },
        orderBy: { updatedAt: "desc" },
        take
      }),
      this.db.thread.findMany({
        where: {
          organizationId: input.actor.organizationId,
          securityDomainId: input.actor.securityDomainId ?? null,
          userId: input.actor.userId,
          userWorkspaceId: workspace.id,
          status: "archived"
        },
        select: {
          id: true,
          title: true,
          status: true,
          workspaceFolderId: true,
          createdAt: true,
          updatedAt: true
        },
        orderBy: { updatedAt: "desc" },
        take
      })
    ]);
    return { nodes: nodes.map(mapWorkspaceNode), tasks: tasks.map(mapTask) };
  }

  async agentOutputs(input: {
    actor: WorkspaceActor;
    take?: number;
  }): Promise<{ nodes: WorkspaceNodeSummary[]; tasks: WorkspaceTaskSummary[] }> {
    const workspace = await this.getWorkspaceRecord(input.actor);
    const take = Math.min(Math.max(input.take ?? 50, 1), 100);
    const nodes = await this.db.workspaceNode.findMany({
      where: {
        workspaceId: workspace.id,
        kind: "file",
        state: "active",
        createdByType: "agent"
      },
      orderBy: { updatedAt: "desc" },
      take
    });
    const sourceThreadIds = Array.from(
      new Set(nodes.map((node) => node.sourceThreadId).filter((id): id is string => Boolean(id)))
    );
    const tasks =
      sourceThreadIds.length === 0
        ? []
        : await this.db.thread.findMany({
            where: {
              id: { in: sourceThreadIds },
              organizationId: input.actor.organizationId,
              securityDomainId: input.actor.securityDomainId ?? null,
              userId: input.actor.userId,
              userWorkspaceId: workspace.id
            },
            select: {
              id: true,
              title: true,
              status: true,
              workspaceFolderId: true,
              createdAt: true,
              updatedAt: true
            },
            orderBy: { updatedAt: "desc" },
            take
          });
    return {
      nodes: nodes.map(mapWorkspaceNode),
      tasks: tasks.map(mapTask)
    };
  }

  async moveThread(input: {
    actor: WorkspaceActor;
    threadId: string;
    folderId: string;
  }): Promise<WorkspaceTaskSummary> {
    const workspace = await this.getWorkspaceRecord(input.actor);
    await this.assertFolder(workspace.id, input.folderId);
    await this.assertThreadOwned(input.actor, workspace.id, input.threadId);
    const updated = await this.db.thread.update({
      where: { id: input.threadId },
      data: {
        userWorkspaceId: workspace.id,
        workspaceFolderId: input.folderId
      },
      select: {
        id: true,
        title: true,
        status: true,
        workspaceFolderId: true,
        createdAt: true,
        updatedAt: true
      }
    });
    return mapTask(updated);
  }

  async recordAppliedChange(input: {
    actor: WorkspaceActor;
    threadId: string;
    fileId: string;
    versionId: string;
    kind: "create" | "update" | "move" | "trash";
    beforeVersionId?: string;
    summary: string;
    runId?: string;
  }): Promise<string> {
    const workspace = await this.getWorkspaceRecord(input.actor);
    await this.assertThreadOwned(input.actor, workspace.id, input.threadId);
    const changeSetId = randomUUID().replace(/-/g, "");
    await this.db.$transaction([
      this.db.workspaceChangeSet.create({
        data: {
          id: changeSetId,
          workspaceId: workspace.id,
          threadId: input.threadId,
          runId: input.runId ?? null,
          status: "applied",
          summary: input.summary,
          appliedAt: new Date()
        }
      }),
      this.db.workspaceChange.create({
        data: {
          id: randomUUID().replace(/-/g, ""),
          changeSetId,
          fileId: input.fileId,
          kind: input.kind,
          beforeVersionId: input.beforeVersionId ?? null,
          afterVersionId: input.versionId,
          riskLevel: "low",
          status: "applied"
        }
      })
    ]);
    return changeSetId;
  }

  async getChangeSet(input: {
    actor: WorkspaceActor;
    changeSetId: string;
  }): Promise<Record<string, unknown>> {
    const workspace = await this.getWorkspaceRecord(input.actor);
    const changeSet = await this.db.workspaceChangeSet.findFirst({
      where: { id: input.changeSetId, workspaceId: workspace.id },
      include: { changes: true }
    });
    if (!changeSet) throw new Error("Workspace change set does not exist");
    return {
      id: changeSet.id,
      thread_id: changeSet.threadId,
      run_id: changeSet.runId,
      status: changeSet.status,
      summary: changeSet.summary,
      created_at: toIso(changeSet.createdAt),
      applied_at: changeSet.appliedAt ? toIso(changeSet.appliedAt) : null,
      reverted_at: changeSet.revertedAt ? toIso(changeSet.revertedAt) : null,
      changes: changeSet.changes.map((change) => ({
        id: change.id,
        file_id: change.fileId,
        kind: change.kind,
        before_version_id: change.beforeVersionId,
        after_version_id: change.afterVersionId,
        before_parent_id: change.beforeParentId,
        after_parent_id: change.afterParentId,
        risk_level: change.riskLevel,
        status: change.status
      }))
    };
  }

  async revertChangeSet(input: {
    actor: WorkspaceActor;
    changeSetId: string;
  }): Promise<Record<string, unknown>> {
    const workspace = await this.getWorkspaceRecord(input.actor);
    const changeSet = await this.db.workspaceChangeSet.findFirst({
      where: {
        id: input.changeSetId,
        workspaceId: workspace.id,
        status: "applied"
      },
      include: { changes: true }
    });
    if (!changeSet) throw new Error("Workspace change set is not available for revert");
    for (const change of changeSet.changes) {
      if (change.kind === "create" && change.fileId) {
        const createdFile = await this.db.workspaceNode.findFirst({
          where: { id: change.fileId, workspaceId: workspace.id },
          select: { id: true, parentId: true }
        });
        if (createdFile) {
          await this.db.workspaceNode.update({
            where: { id: createdFile.id },
            data: {
              state: "trashed",
              originalParentId: createdFile.parentId,
              trashedAt: new Date()
            }
          });
        }
      } else if (change.beforeVersionId && change.fileId) {
        await this.restoreVersion({
          actor: input.actor,
          fileId: change.fileId,
          versionId: change.beforeVersionId,
          threadId: changeSet.threadId ?? undefined
        });
      }
      await this.db.workspaceChange.update({
        where: { id: change.id },
        data: { status: "reverted" }
      });
    }
    const updated = await this.db.workspaceChangeSet.update({
      where: { id: changeSet.id },
      data: {
        status: "reverted",
        revertedAt: new Date()
      }
    });
    return {
      id: updated.id,
      status: updated.status,
      reverted_at: updated.revertedAt ? toIso(updated.revertedAt) : null
    };
  }

  async latestBoundFileForThreadName(input: {
    actor: WorkspaceActor;
    threadId: string;
    name: string;
  }): Promise<string | undefined> {
    const workspace = await this.getWorkspaceRecord(input.actor);
    const normalized = normalizeWorkspaceNodeName(input.name);
    const binding = await this.db.threadFileBinding.findFirst({
      where: {
        threadId: input.threadId,
        file: {
          workspaceId: workspace.id,
          normalizedName: normalized.normalizedName,
          state: "active"
        }
      },
      orderBy: { createdAt: "desc" },
      select: { fileId: true }
    });
    return binding?.fileId;
  }

  async resolveTaskOutputTarget(input: {
    actor: WorkspaceActor;
    threadId: string;
    relativePath: string;
  }): Promise<TaskOutputTarget> {
    const workspace = await this.getWorkspaceRecord(input.actor);
    await this.assertThreadOwned(input.actor, workspace.id, input.threadId);
    const thread = await this.db.thread.findFirst({
      where: {
        id: input.threadId,
        organizationId: input.actor.organizationId,
        securityDomainId: input.actor.securityDomainId ?? null,
        userId: input.actor.userId,
        OR: [{ userWorkspaceId: workspace.id }, { userWorkspaceId: null }]
      },
      select: { workspaceFolderId: true }
    });
    if (!thread) throw new Error("Thread does not exist");
    const scope = await this.resolveTaskScope({
      actor: input.actor,
      folderId: thread.workspaceFolderId ?? undefined
    });

    const segments = input.relativePath
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean);
    if (segments[0] !== "workspace-files") {
      return {
        workspaceId: scope.workspaceId,
        parentId: scope.folderId
      };
    }
    const materializedSegments = segments.slice(1);
    if (materializedSegments.length === 0) {
      throw new Error("Task output path does not identify a workspace file");
    }
    const names = materializedSegments.map((segment) => normalizeWorkspaceNodeName(segment));
    const selectedFolder = await this.db.workspaceNode.findFirst({
      where: {
        id: scope.folderId,
        workspaceId: workspace.id,
        kind: "folder",
        state: "active"
      },
      select: { id: true, systemKey: true }
    });
    if (!selectedFolder) throw new Error("Workspace folder does not exist");

    if (selectedFolder.systemKey === HISTORY_SYSTEM_KEY) {
      const fileName = names.at(-1)!;
      const binding = await this.db.threadFileBinding.findFirst({
        where: {
          threadId: input.threadId,
          file: {
            workspaceId: workspace.id,
            kind: "file",
            normalizedName: fileName.normalizedName,
            state: "active"
          }
        },
        include: { file: true, version: true },
        orderBy: { createdAt: "desc" }
      });
      const previousVersion =
        binding?.version ??
        (binding
          ? await this.db.workspaceFileVersion.findFirst({
              where: { workspaceId: workspace.id, fileId: binding.fileId },
              orderBy: { versionNo: "desc" }
            })
          : null);
      return {
        workspaceId: scope.workspaceId,
        parentId: binding?.file.parentId ?? scope.folderId,
        preferredFileId: binding?.fileId,
        previousVersionId: previousVersion?.id
      };
    }

    let parentId = scope.folderId;
    for (const directoryName of names.slice(0, -1)) {
      const existing = await this.db.workspaceNode.findFirst({
        where: {
          workspaceId: workspace.id,
          parentId,
          normalizedName: directoryName.normalizedName,
          state: "active"
        }
      });
      if (existing && existing.kind !== "folder") {
        throw new Error(`Task output directory conflicts with a file: ${directoryName.name}`);
      }
      if (existing) {
        parentId = existing.id;
        continue;
      }
      const folder = await this.db.workspaceNode.create({
        data: {
          id: randomUUID().replace(/-/g, ""),
          workspaceId: workspace.id,
          parentId,
          kind: "folder",
          name: directoryName.name,
          normalizedName: directoryName.normalizedName,
          createdByType: "agent",
          sourceThreadId: input.threadId
        }
      });
      parentId = folder.id;
    }

    const fileName = names.at(-1)!;
    const existing = await this.db.workspaceNode.findFirst({
      where: {
        workspaceId: workspace.id,
        parentId,
        normalizedName: fileName.normalizedName,
        state: "active"
      }
    });
    if (existing?.kind === "folder") {
      throw new Error(`Task output file conflicts with a folder: ${fileName.name}`);
    }
    const previousVersion = existing
      ? await this.db.workspaceFileVersion.findFirst({
          where: { workspaceId: workspace.id, fileId: existing.id },
          orderBy: { versionNo: "desc" }
        })
      : null;
    return {
      workspaceId: scope.workspaceId,
      parentId,
      preferredFileId: existing?.id,
      previousVersionId: previousVersion?.id
    };
  }

  private async assertThreadOwned(actor: WorkspaceActor, workspaceId: string, threadId: string): Promise<void> {
    const thread = await this.db.thread.findFirst({
      where: {
        id: threadId,
        organizationId: actor.organizationId,
        securityDomainId: actor.securityDomainId ?? null,
        userId: actor.userId,
        OR: [{ userWorkspaceId: workspaceId }, { userWorkspaceId: null }]
      },
      select: { id: true }
    });
    if (!thread) throw new Error("Thread does not exist");
  }

  private async assertFolder(workspaceId: string, folderId?: string): Promise<void> {
    if (!folderId) return;
    const folder = await this.db.workspaceNode.findFirst({
      where: {
        id: folderId,
        workspaceId,
        kind: "folder",
        state: "active"
      },
      select: { id: true }
    });
    if (!folder) throw new Error("Workspace folder does not exist");
  }

  private async requireNode(workspaceId: string, nodeId: string): Promise<WorkspaceNodeRecord> {
    const node = await this.db.workspaceNode.findFirst({
      where: { id: nodeId, workspaceId }
    });
    if (!node) throw new Error("Workspace item does not exist");
    return node;
  }

  private async assertNameAvailable(
    workspaceId: string,
    parentId: string | undefined,
    normalizedName: string,
    excludingId?: string
  ): Promise<void> {
    const existing = await this.db.workspaceNode.findFirst({
      where: {
        workspaceId,
        parentId: parentId ?? null,
        normalizedName,
        state: "active",
        ...(excludingId ? { NOT: { id: excludingId } } : {})
      },
      select: { id: true }
    });
    if (existing) throw new Error("A file or folder with the same name already exists");
  }

  private async assertNotDescendant(workspaceId: string, nodeId: string, candidateParentId: string): Promise<void> {
    let currentId: string | null = candidateParentId;
    for (let depth = 0; depth < 100 && currentId; depth += 1) {
      if (currentId === nodeId) {
        throw new Error("A folder cannot be moved into itself");
      }
      const current: { parentId: string | null } | null = await this.db.workspaceNode.findFirst({
        where: { id: currentId, workspaceId },
        select: { parentId: true }
      });
      currentId = current?.parentId ?? null;
    }
  }
}
