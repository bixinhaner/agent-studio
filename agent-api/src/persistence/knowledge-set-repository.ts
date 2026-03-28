export type KnowledgeSetItemRecord = {
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

export type WorkspaceKnowledgeSetRecord = {
  id: string;
  workspaceId: string;
  knowledgeSetId: string;
  mountType: string;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeSetRecord = {
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
  workspaceBindings: WorkspaceKnowledgeSetRecord[];
};

type CreateKnowledgeSetPayload = {
  id?: string;
  organizationId?: string;
  name: string;
  slug: string;
  description?: string;
  status?: string;
  sourceType: string;
  rootPath?: string;
  storageKey?: string;
};

type ReplaceKnowledgeSetItemsPayload = Array<{
  kind: string;
  relativePath: string;
  displayName: string;
  mimeType?: string;
  sizeBytes?: bigint;
  checksum?: string;
  sourceArchiveName?: string;
}>;

type ReplaceWorkspaceBindingsPayload = Array<{
  workspaceId: string;
  mountType: string;
}>;

type KnowledgeSetRow = {
  id: string;
  organizationId: string | null;
  name: string;
  slug: string;
  description: string | null;
  status: string | null;
  sourceType: string;
  rootPath: string | null;
  storageKey: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type KnowledgeSetItemRow = {
  id: string;
  knowledgeSetId: string;
  kind: string;
  relativePath: string;
  displayName: string;
  mimeType: string | null;
  sizeBytes: bigint | null;
  checksum: string | null;
  sourceArchiveName: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type WorkspaceKnowledgeSetRow = {
  id: string;
  workspaceId: string;
  knowledgeSetId: string;
  mountType: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type KnowledgeSetTable = {
  findUnique(args: { where: { id?: string; slug?: string } }): Promise<KnowledgeSetRow | null>;
  create(args: { data: Record<string, unknown> }): Promise<KnowledgeSetRow>;
};

type KnowledgeSetItemTable = {
  findMany(args: { where: { knowledgeSetId: string }; orderBy?: { relativePath?: "asc" | "desc"; createdAt?: "asc" | "desc" } }): Promise<KnowledgeSetItemRow[]>;
  deleteMany(args: { where: { knowledgeSetId: string } }): Promise<{ count: number }>;
  create(args: { data: Record<string, unknown> }): Promise<KnowledgeSetItemRow>;
};

type WorkspaceKnowledgeSetTable = {
  findMany(args: { where: { knowledgeSetId: string }; orderBy?: { createdAt?: "asc" | "desc" } }): Promise<WorkspaceKnowledgeSetRow[]>;
  deleteMany(args: { where: { knowledgeSetId: string } }): Promise<{ count: number }>;
  create(args: { data: Record<string, unknown> }): Promise<WorkspaceKnowledgeSetRow>;
};

export type KnowledgeSetRepositoryDb = {
  knowledgeSet: KnowledgeSetTable;
  knowledgeSetItem: KnowledgeSetItemTable;
  workspaceKnowledgeSet: WorkspaceKnowledgeSetTable;
  $transaction<T>(callback: (tx: KnowledgeSetRepositoryDb) => Promise<T>): Promise<T>;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function mapKnowledgeSetItem(row: KnowledgeSetItemRow): KnowledgeSetItemRecord {
  return {
    id: row.id,
    kind: row.kind,
    relativePath: row.relativePath,
    displayName: row.displayName,
    mimeType: trimOrUndefined(row.mimeType),
    sizeBytes: row.sizeBytes === null ? undefined : row.sizeBytes.toString(),
    checksum: trimOrUndefined(row.checksum),
    sourceArchiveName: trimOrUndefined(row.sourceArchiveName),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

function mapWorkspaceKnowledgeSet(row: WorkspaceKnowledgeSetRow): WorkspaceKnowledgeSetRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    knowledgeSetId: row.knowledgeSetId,
    mountType: row.mountType,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

export class KnowledgeSetRepository {
  constructor(private readonly db: KnowledgeSetRepositoryDb) {}

  async create(payload: CreateKnowledgeSetPayload): Promise<KnowledgeSetRecord> {
    const created = await this.db.knowledgeSet.create({
      data: {
        id: trimOrUndefined(payload.id),
        organizationId: trimOrUndefined(payload.organizationId) ?? null,
        name: payload.name,
        slug: payload.slug,
        description: trimOrUndefined(payload.description) ?? null,
        status: trimOrUndefined(payload.status) ?? "active",
        sourceType: payload.sourceType,
        rootPath: trimOrUndefined(payload.rootPath) ?? null,
        storageKey: trimOrUndefined(payload.storageKey) ?? null
      }
    });
    return this.loadRecord(this.db, created);
  }

  async get(id: string): Promise<KnowledgeSetRecord | undefined> {
    const knowledgeSetId = trimOrUndefined(id);
    if (!knowledgeSetId) return undefined;
    const row = await this.db.knowledgeSet.findUnique({ where: { id: knowledgeSetId } });
    return row ? this.loadRecord(this.db, row) : undefined;
  }

  async replaceItems(knowledgeSetId: string, items: ReplaceKnowledgeSetItemsPayload): Promise<KnowledgeSetRecord> {
    return this.db.$transaction(async (tx) => {
      const record = await this.requireKnowledgeSet(tx, knowledgeSetId);
      await tx.knowledgeSetItem.deleteMany({ where: { knowledgeSetId: record.id } });
      for (const item of items) {
        await tx.knowledgeSetItem.create({
          data: {
            knowledgeSetId: record.id,
            kind: item.kind,
            relativePath: item.relativePath,
            displayName: item.displayName,
            mimeType: trimOrUndefined(item.mimeType) ?? null,
            sizeBytes: item.sizeBytes ?? null,
            checksum: trimOrUndefined(item.checksum) ?? null,
            sourceArchiveName: trimOrUndefined(item.sourceArchiveName) ?? null
          }
        });
      }
      return this.loadRecord(tx, record);
    });
  }

  async replaceWorkspaceBindings(
    knowledgeSetId: string,
    bindings: ReplaceWorkspaceBindingsPayload
  ): Promise<KnowledgeSetRecord> {
    return this.db.$transaction(async (tx) => {
      const record = await this.requireKnowledgeSet(tx, knowledgeSetId);
      await tx.workspaceKnowledgeSet.deleteMany({ where: { knowledgeSetId: record.id } });
      for (const binding of bindings) {
        await tx.workspaceKnowledgeSet.create({
          data: {
            knowledgeSetId: record.id,
            workspaceId: binding.workspaceId,
            mountType: binding.mountType
          }
        });
      }
      return this.loadRecord(tx, record);
    });
  }

  private async requireKnowledgeSet(db: KnowledgeSetRepositoryDb, knowledgeSetId: string): Promise<KnowledgeSetRow> {
    const normalized = trimOrUndefined(knowledgeSetId);
    if (!normalized) {
      throw new Error("knowledge set 不存在");
    }
    const row = await db.knowledgeSet.findUnique({ where: { id: normalized } });
    if (!row) {
      throw new Error("knowledge set 不存在");
    }
    return row;
  }

  private async loadRecord(db: KnowledgeSetRepositoryDb, row: KnowledgeSetRow): Promise<KnowledgeSetRecord> {
    const [items, workspaceBindings] = await Promise.all([
      db.knowledgeSetItem
        .findMany({
          where: { knowledgeSetId: row.id },
          orderBy: { relativePath: "asc" }
        })
        .then((records) => records.map(mapKnowledgeSetItem)),
      db.workspaceKnowledgeSet
        .findMany({
          where: { knowledgeSetId: row.id },
          orderBy: { createdAt: "asc" }
        })
        .then((records) => records.map(mapWorkspaceKnowledgeSet))
    ]);

    return {
      id: row.id,
      organizationId: trimOrUndefined(row.organizationId),
      name: row.name,
      slug: row.slug,
      description: trimOrUndefined(row.description),
      status: trimOrUndefined(row.status) ?? "active",
      sourceType: row.sourceType,
      rootPath: trimOrUndefined(row.rootPath),
      storageKey: trimOrUndefined(row.storageKey),
      createdAt: toIsoString(row.createdAt),
      updatedAt: toIsoString(row.updatedAt),
      items,
      workspaceBindings
    };
  }
}
