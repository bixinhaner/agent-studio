export type DepartmentRecord = {
  id: string;
  organizationId?: string;
  externalId: string;
  name: string;
  parentDepartmentId?: string;
  sortOrder: number;
  status: string;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type DepartmentTreeNode = DepartmentRecord & {
  children: DepartmentTreeNode[];
};

type DepartmentRow = {
  id: string;
  organizationId: string | null;
  externalId: string;
  name: string;
  parentDepartmentId: string | null;
  sortOrder: number;
  status: string | null;
  lastSyncedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type DepartmentTable = {
  findUnique(args: { where: { id?: string; externalId?: string } }): Promise<DepartmentRow | null>;
  findMany(args?: { orderBy?: Array<{ sortOrder?: "asc" | "desc"; createdAt?: "asc" | "desc" }> }): Promise<DepartmentRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<DepartmentRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<DepartmentRow>;
};

export type DepartmentRepositoryDb = {
  department: DepartmentTable;
  $transaction<T>(callback: (tx: DepartmentRepositoryDb) => Promise<T>): Promise<T>;
};

type UpsertDepartmentInput = {
  externalId: string;
  name: string;
  parentExternalId?: string | null;
  sortOrder?: number;
  status?: string;
  lastSyncedAt?: Date | null;
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

function mapDepartment(row: DepartmentRow): DepartmentRecord {
  return {
    id: row.id,
    organizationId: trimOrUndefined(row.organizationId),
    externalId: row.externalId,
    name: row.name,
    parentDepartmentId: trimOrUndefined(row.parentDepartmentId),
    sortOrder: row.sortOrder,
    status: trimOrUndefined(row.status) ?? "active",
    lastSyncedAt: row.lastSyncedAt ? toIsoString(row.lastSyncedAt) : undefined,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

export class DepartmentRepository {
  constructor(private readonly db: DepartmentRepositoryDb) {}

  async upsertMany(input: UpsertDepartmentInput[]): Promise<void> {
    if (input.length === 0) return;

    const normalized = input.map((item) => {
      const externalId = trimOrUndefined(item.externalId);
      if (!externalId) {
        throw new Error("department externalId is required");
      }

      return {
        externalId,
        name: item.name,
        parentExternalId: trimOrUndefined(item.parentExternalId) ?? null,
        sortOrder: item.sortOrder ?? 0,
        status: trimOrUndefined(item.status) ?? "active",
        lastSyncedAt: item.lastSyncedAt ?? null
      };
    });

    await this.db.$transaction(async (tx) => {
      const rowsByExternalId = new Map<string, DepartmentRow>();

      for (const item of normalized) {
        const existing = await tx.department.findUnique({ where: { externalId: item.externalId } });
        const data = {
          externalId: item.externalId,
          name: item.name,
          sortOrder: item.sortOrder,
          status: item.status,
          lastSyncedAt: item.lastSyncedAt,
          parentDepartmentId: null
        };
        const row = existing
          ? await tx.department.update({
              where: { id: existing.id },
              data: {
                ...data,
                updatedAt: new Date()
              }
            })
          : await tx.department.create({ data });
        rowsByExternalId.set(item.externalId, row);
      }

      for (const item of normalized) {
        const row = rowsByExternalId.get(item.externalId);
        if (!row) continue;

        const parentDepartmentId = item.parentExternalId
          ? rowsByExternalId.get(item.parentExternalId)?.id ??
            (await tx.department.findUnique({ where: { externalId: item.parentExternalId } }))?.id ??
            null
          : null;
        await tx.department.update({
          where: { id: row.id },
          data: {
            parentDepartmentId,
            updatedAt: new Date()
          }
        });
      }
    });
  }

  async listTree(): Promise<DepartmentTreeNode[]> {
    const rows = await this.db.department.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
    });
    const nodeById = new Map<string, DepartmentTreeNode>();
    for (const row of rows) {
      nodeById.set(row.id, { ...mapDepartment(row), children: [] });
    }

    const roots: DepartmentTreeNode[] = [];
    for (const row of rows) {
      const node = nodeById.get(row.id);
      if (!node) continue;

      const parentDepartmentId = trimOrUndefined(row.parentDepartmentId);
      if (parentDepartmentId) {
        const parent = nodeById.get(parentDepartmentId);
        if (parent) {
          parent.children.push(node);
          continue;
        }
      }
      roots.push(node);
    }

    const sortNodes = (nodes: DepartmentTreeNode[]): DepartmentTreeNode[] => {
      nodes.sort((left, right) => {
        if (left.sortOrder !== right.sortOrder) {
          return left.sortOrder - right.sortOrder;
        }
        return left.createdAt.localeCompare(right.createdAt);
      });
      for (const node of nodes) {
        sortNodes(node.children);
      }
      return nodes;
    };

    return sortNodes(roots);
  }

  async getByExternalId(externalId: string): Promise<DepartmentRecord | null> {
    const normalized = trimOrUndefined(externalId);
    if (!normalized) return null;
    const row = await this.db.department.findUnique({ where: { externalId: normalized } });
    return row ? mapDepartment(row) : null;
  }

  async getById(id: string): Promise<DepartmentRecord | null> {
    const departmentId = trimOrUndefined(id);
    if (!departmentId) return null;
    const row = await this.db.department.findUnique({ where: { id: departmentId } });
    return row ? mapDepartment(row) : null;
  }
}
