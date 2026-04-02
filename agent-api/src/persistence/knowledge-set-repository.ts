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

type KnowledgeSetTable = {
  findUnique(args: { where: { id?: string; slug?: string } }): Promise<KnowledgeSetRow | null>;
  findMany(args?: { orderBy?: { createdAt?: "asc" | "desc"; updatedAt?: "asc" | "desc" } }): Promise<KnowledgeSetRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<KnowledgeSetRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<KnowledgeSetRow>;
  delete(args: { where: { id: string } }): Promise<KnowledgeSetRow>;
};

type KnowledgeSetItemTable = {
  findMany(args: { where: { knowledgeSetId: string }; orderBy?: { relativePath?: "asc" | "desc"; createdAt?: "asc" | "desc" } }): Promise<KnowledgeSetItemRow[]>;
  deleteMany(args: { where: { knowledgeSetId: string } }): Promise<{ count: number }>;
  create(args: { data: Record<string, unknown> }): Promise<KnowledgeSetItemRow>;
};

export type KnowledgeSetRepositoryDb = {
  knowledgeSet: KnowledgeSetTable;
  knowledgeSetItem: KnowledgeSetItemTable;
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

  async list(): Promise<KnowledgeSetRecord[]> {
    const rows = await this.db.knowledgeSet.findMany({
      orderBy: { createdAt: "asc" }
    });
    return Promise.all(rows.map((row) => this.loadRecord(this.db, row)));
  }

  async update(
    id: string,
    payload: Partial<CreateKnowledgeSetPayload>
  ): Promise<KnowledgeSetRecord> {
    const knowledgeSetId = trimOrUndefined(id);
    if (!knowledgeSetId) {
      throw new Error("knowledge set 不存在");
    }
    const existing = await this.db.knowledgeSet.findUnique({ where: { id: knowledgeSetId } });
    if (!existing) {
      throw new Error("knowledge set 不存在");
    }
    const updated = await this.db.knowledgeSet.update({
      where: { id: knowledgeSetId },
      data: {
        organizationId:
          payload.organizationId === undefined ? existing.organizationId : trimOrUndefined(payload.organizationId) ?? null,
        name: payload.name ?? existing.name,
        slug: payload.slug ?? existing.slug,
        description:
          payload.description === undefined ? existing.description : trimOrUndefined(payload.description) ?? null,
        status: payload.status === undefined ? existing.status : trimOrUndefined(payload.status) ?? "active",
        sourceType: payload.sourceType ?? existing.sourceType,
        rootPath: payload.rootPath === undefined ? existing.rootPath : trimOrUndefined(payload.rootPath) ?? null,
        storageKey:
          payload.storageKey === undefined ? existing.storageKey : trimOrUndefined(payload.storageKey) ?? null,
        updatedAt: new Date()
      }
    });
    return this.loadRecord(this.db, updated);
  }

  async listItems(knowledgeSetId: string): Promise<KnowledgeSetItemRecord[]> {
    const record = await this.requireKnowledgeSet(this.db, knowledgeSetId);
    const rows = await this.db.knowledgeSetItem.findMany({
      where: { knowledgeSetId: record.id },
      orderBy: { relativePath: "asc" }
    });
    return rows.map(mapKnowledgeSetItem);
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
      const refreshed = await tx.knowledgeSet.update({
        where: { id: record.id },
        data: {
          updatedAt: new Date()
        }
      });
      return this.loadRecord(tx, refreshed);
    });
  }

  async delete(id: string): Promise<void> {
    const record = await this.requireKnowledgeSet(this.db, id);
    await this.db.knowledgeSet.delete({ where: { id: record.id } });
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
    const items = await db.knowledgeSetItem
      .findMany({
        where: { knowledgeSetId: row.id },
        orderBy: { relativePath: "asc" }
      })
      .then((records) => records.map(mapKnowledgeSetItem));

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
      items
    };
  }
}
