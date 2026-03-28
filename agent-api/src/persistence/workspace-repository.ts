export type WorkspaceRecord = {
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

type CreateWorkspacePayload = {
  id?: string;
  organizationId?: string;
  name: string;
  slug: string;
  description?: string;
  status?: string;
  sourceType: string;
  rootPath?: string;
};

type WorkspaceRow = {
  id: string;
  organizationId: string | null;
  name: string;
  slug: string;
  description: string | null;
  status: string | null;
  sourceType: string;
  rootPath: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type WorkspaceTable = {
  count(args?: unknown): Promise<number>;
  findUnique(args: { where: { id?: string; slug?: string } }): Promise<WorkspaceRow | null>;
  findMany(args?: { orderBy?: { createdAt?: "asc" | "desc"; updatedAt?: "asc" | "desc" } }): Promise<WorkspaceRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<WorkspaceRow>;
};

export type WorkspaceRepositoryDb = {
  workspace: WorkspaceTable;
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

function mapWorkspace(row: WorkspaceRow): WorkspaceRecord {
  return {
    id: row.id,
    organizationId: trimOrUndefined(row.organizationId),
    name: row.name,
    slug: row.slug,
    description: trimOrUndefined(row.description),
    status: trimOrUndefined(row.status) ?? "active",
    sourceType: row.sourceType,
    rootPath: trimOrUndefined(row.rootPath),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

export class WorkspaceRepository {
  constructor(private readonly db: WorkspaceRepositoryDb) {}

  async count(): Promise<number> {
    return this.db.workspace.count();
  }

  async create(payload: CreateWorkspacePayload): Promise<WorkspaceRecord> {
    const created = await this.db.workspace.create({
      data: {
        id: trimOrUndefined(payload.id),
        organizationId: trimOrUndefined(payload.organizationId) ?? null,
        name: payload.name,
        slug: payload.slug,
        description: trimOrUndefined(payload.description) ?? null,
        status: trimOrUndefined(payload.status) ?? "active",
        sourceType: payload.sourceType,
        rootPath: trimOrUndefined(payload.rootPath) ?? null
      }
    });
    return mapWorkspace(created);
  }

  async get(id: string): Promise<WorkspaceRecord | undefined> {
    const workspaceId = trimOrUndefined(id);
    if (!workspaceId) return undefined;
    const row = await this.db.workspace.findUnique({ where: { id: workspaceId } });
    return row ? mapWorkspace(row) : undefined;
  }

  async list(): Promise<WorkspaceRecord[]> {
    const rows = await this.db.workspace.findMany({
      orderBy: { createdAt: "asc" }
    });
    return rows.map(mapWorkspace);
  }
}
