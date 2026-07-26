export type ThreadArtifactStatus = "ready" | "blocked";

export type ThreadArtifactRecord = {
  id: string;
  organizationId?: string;
  threadId: string;
  userId?: string;
  source: string;
  relativePath: string;
  displayName: string;
  mimeType?: string;
  sizeBytes?: number;
  checksum?: string;
  previewStatus: ThreadArtifactStatus | string;
  downloadStatus: ThreadArtifactStatus | string;
  blockedReason?: string;
  metadata?: unknown;
  workspaceFileId?: string;
  workspaceFileVersionId?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type UpsertThreadArtifactInput = {
  organizationId?: string;
  threadId: string;
  userId?: string;
  source: string;
  relativePath: string;
  displayName: string;
  mimeType?: string;
  sizeBytes?: number;
  checksum?: string;
  previewStatus: ThreadArtifactStatus | string;
  downloadStatus: ThreadArtifactStatus | string;
  blockedReason?: string;
  metadata?: unknown;
  workspaceFileId?: string;
  workspaceFileVersionId?: string;
  expiresAt?: Date;
};

type ThreadArtifactRow = {
  id: string;
  organizationId: string | null;
  threadId: string;
  userId: string | null;
  source: string;
  relativePath: string;
  displayName: string;
  mimeType: string | null;
  sizeBytes: bigint | number | null;
  checksum: string | null;
  previewStatus: string;
  downloadStatus: string;
  blockedReason: string | null;
  metadata: unknown;
  workspaceFileId: string | null;
  workspaceFileVersionId: string | null;
  expiresAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type ThreadArtifactTable = {
  findMany(args?: {
    where?: { threadId?: string; id?: string; relativePath?: string };
    orderBy?: { createdAt?: "asc" | "desc"; updatedAt?: "asc" | "desc" };
  }): Promise<ThreadArtifactRow[]>;
  findFirst(args?: {
    where?: { threadId?: string; id?: string; relativePath?: string };
    orderBy?: { createdAt?: "asc" | "desc"; updatedAt?: "asc" | "desc" };
  }): Promise<ThreadArtifactRow | null>;
  upsert(args: {
    where: { threadId_relativePath: { threadId: string; relativePath: string } };
    update: Record<string, unknown>;
    create: Record<string, unknown>;
  }): Promise<ThreadArtifactRow>;
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Promise<ThreadArtifactRow>;
};

export type ThreadArtifactRepositoryDb = {
  threadArtifact: ThreadArtifactTable;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function toNumber(value: bigint | number | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const numeric = typeof value === "bigint" ? Number(value) : value;
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : undefined;
}

function mapThreadArtifact(row: ThreadArtifactRow): ThreadArtifactRecord {
  return {
    id: row.id,
    organizationId: trimOrUndefined(row.organizationId),
    threadId: row.threadId,
    userId: trimOrUndefined(row.userId),
    source: row.source,
    relativePath: row.relativePath,
    displayName: row.displayName,
    mimeType: trimOrUndefined(row.mimeType),
    sizeBytes: toNumber(row.sizeBytes),
    checksum: trimOrUndefined(row.checksum),
    previewStatus: row.previewStatus,
    downloadStatus: row.downloadStatus,
    blockedReason: trimOrUndefined(row.blockedReason),
    metadata: row.metadata ?? undefined,
    workspaceFileId: trimOrUndefined(row.workspaceFileId),
    workspaceFileVersionId: trimOrUndefined(row.workspaceFileVersionId),
    expiresAt: toIsoString(row.expiresAt),
    createdAt: toIsoString(row.createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updatedAt) ?? new Date().toISOString()
  };
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

export class ThreadArtifactRepository {
  constructor(private readonly db: ThreadArtifactRepositoryDb) {}

  async listForThread(threadId: string): Promise<ThreadArtifactRecord[]> {
    const normalizedThreadId = trimOrUndefined(threadId);
    if (!normalizedThreadId) return [];
    const rows = await this.db.threadArtifact.findMany({
      where: { threadId: normalizedThreadId },
      orderBy: { createdAt: "desc" }
    });
    return rows.map(mapThreadArtifact);
  }

  async getForThread(threadId: string, artifactId: string): Promise<ThreadArtifactRecord | undefined> {
    const normalizedThreadId = trimOrUndefined(threadId);
    const normalizedArtifactId = trimOrUndefined(artifactId);
    if (!normalizedThreadId || !normalizedArtifactId) return undefined;
    const row = await this.db.threadArtifact.findFirst({
      where: {
        id: normalizedArtifactId,
        threadId: normalizedThreadId
      }
    });
    return row ? mapThreadArtifact(row) : undefined;
  }

  async getByThreadPath(threadId: string, relativePath: string): Promise<ThreadArtifactRecord | undefined> {
    const normalizedThreadId = trimOrUndefined(threadId);
    const normalizedRelativePath = normalizeRelativePath(relativePath);
    if (!normalizedThreadId || !normalizedRelativePath) return undefined;
    const row = await this.db.threadArtifact.findFirst({
      where: {
        threadId: normalizedThreadId,
        relativePath: normalizedRelativePath
      }
    });
    return row ? mapThreadArtifact(row) : undefined;
  }

  async upsertForThreadPath(input: UpsertThreadArtifactInput): Promise<ThreadArtifactRecord> {
    const threadId = trimOrUndefined(input.threadId);
    const source = trimOrUndefined(input.source);
    const relativePath = normalizeRelativePath(input.relativePath);
    const displayName = trimOrUndefined(input.displayName);
    if (!threadId) throw new Error("threadId is required");
    if (!source) throw new Error("artifact source is required");
    if (!relativePath) throw new Error("artifact relativePath is required");
    if (!displayName) throw new Error("artifact displayName is required");

    const sharedData = {
      organizationId: trimOrUndefined(input.organizationId) ?? null,
      threadId,
      userId: trimOrUndefined(input.userId) ?? null,
      source,
      relativePath,
      displayName,
      mimeType: trimOrUndefined(input.mimeType) ?? null,
      sizeBytes: input.sizeBytes === undefined ? null : BigInt(Math.max(0, Math.floor(input.sizeBytes))),
      checksum: trimOrUndefined(input.checksum) ?? null,
      previewStatus: trimOrUndefined(input.previewStatus) ?? "blocked",
      downloadStatus: trimOrUndefined(input.downloadStatus) ?? "blocked",
      blockedReason: trimOrUndefined(input.blockedReason) ?? null,
      metadata: input.metadata ?? null,
      expiresAt: input.expiresAt ?? null
    };
    const createData = {
      ...sharedData,
      workspaceFileId: trimOrUndefined(input.workspaceFileId) ?? null,
      workspaceFileVersionId: trimOrUndefined(input.workspaceFileVersionId) ?? null
    };
    const workspaceLinkUpdate =
      input.workspaceFileId !== undefined || input.workspaceFileVersionId !== undefined
        ? {
            workspaceFileId: trimOrUndefined(input.workspaceFileId) ?? null,
            workspaceFileVersionId: trimOrUndefined(input.workspaceFileVersionId) ?? null
          }
        : {};

    const row = await this.db.threadArtifact.upsert({
      where: {
        threadId_relativePath: {
          threadId,
          relativePath
        }
      },
      create: createData,
      update: {
        ...sharedData,
        ...workspaceLinkUpdate,
        updatedAt: new Date()
      }
    });
    return mapThreadArtifact(row);
  }

  async linkWorkspaceFile(
    artifactId: string,
    workspaceFileId: string,
    workspaceFileVersionId: string
  ): Promise<ThreadArtifactRecord> {
    const normalizedArtifactId = trimOrUndefined(artifactId);
    const normalizedFileId = trimOrUndefined(workspaceFileId);
    const normalizedVersionId = trimOrUndefined(workspaceFileVersionId);
    if (!normalizedArtifactId) throw new Error("artifactId is required");
    if (!normalizedFileId) throw new Error("workspaceFileId is required");
    if (!normalizedVersionId) throw new Error("workspaceFileVersionId is required");
    const row = await this.db.threadArtifact.update({
      where: { id: normalizedArtifactId },
      data: {
        workspaceFileId: normalizedFileId,
        workspaceFileVersionId: normalizedVersionId,
        updatedAt: new Date()
      }
    });
    return mapThreadArtifact(row);
  }
}
