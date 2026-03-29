export type PermissionRecord = {
  id: string;
  key: string;
  name: string;
  description?: string;
  category: string;
  isSystem: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PermissionDefinition = {
  key: string;
  name: string;
  description?: string;
  category: string;
  isSystem?: boolean;
  isActive?: boolean;
};

type PermissionRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: string;
  isSystem: boolean;
  isActive: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type PermissionTable = {
  findUnique(args: { where: { id?: string; key?: string } }): Promise<PermissionRow | null>;
  findMany(args?: {
    where?: { key?: { in: string[] } };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<PermissionRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<PermissionRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<PermissionRow>;
};

export type PermissionRepositoryDb = {
  permission: PermissionTable;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function mapPermission(row: PermissionRow): PermissionRecord {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: trimOrUndefined(row.description),
    category: row.category,
    isSystem: Boolean(row.isSystem),
    isActive: Boolean(row.isActive),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

export class PermissionRepository {
  constructor(private readonly db: PermissionRepositoryDb) {}

  async list(): Promise<PermissionRecord[]> {
    const rows = await this.db.permission.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map(mapPermission);
  }

  async getById(permissionId: string): Promise<PermissionRecord | null> {
    const normalized = trimOrUndefined(permissionId);
    if (!normalized) return null;
    const row = await this.db.permission.findUnique({ where: { id: normalized } });
    return row ? mapPermission(row) : null;
  }

  async getByKey(key: string): Promise<PermissionRecord | null> {
    const normalized = trimOrUndefined(key);
    if (!normalized) return null;
    const row = await this.db.permission.findUnique({ where: { key: normalized } });
    return row ? mapPermission(row) : null;
  }

  async listByKeys(keys: string[]): Promise<PermissionRecord[]> {
    const normalizedKeys = keys.map(trimOrUndefined).filter((value): value is string => Boolean(value));
    if (normalizedKeys.length === 0) return [];
    const rows = await this.db.permission.findMany({
      where: { key: { in: normalizedKeys } },
      orderBy: { createdAt: "asc" }
    });
    return rows.map(mapPermission);
  }

  async create(input: PermissionDefinition): Promise<PermissionRecord> {
    const key = trimOrUndefined(input.key);
    const name = trimOrUndefined(input.name);
    const category = trimOrUndefined(input.category);
    if (!key || !name || !category) {
      throw new Error("permission key, name, and category are required");
    }
    const created = await this.db.permission.create({
      data: {
        key,
        name,
        description: trimOrUndefined(input.description) ?? null,
        category,
        isSystem: input.isSystem ?? true,
        isActive: input.isActive ?? true
      }
    });
    return mapPermission(created);
  }

  async update(permissionId: string, input: Partial<PermissionDefinition>): Promise<PermissionRecord> {
    const normalizedId = trimOrUndefined(permissionId);
    if (!normalizedId) {
      throw new Error("permission 不存在");
    }
    const existing = await this.db.permission.findUnique({ where: { id: normalizedId } });
    if (!existing) {
      throw new Error("permission 不存在");
    }
    const updated = await this.db.permission.update({
      where: { id: normalizedId },
      data: {
        key: trimOrUndefined(input.key) ?? existing.key,
        name: trimOrUndefined(input.name) ?? existing.name,
        description: input.description === undefined ? existing.description : trimOrUndefined(input.description) ?? null,
        category: trimOrUndefined(input.category) ?? existing.category,
        isSystem: input.isSystem ?? existing.isSystem,
        isActive: input.isActive ?? existing.isActive,
        updatedAt: new Date()
      }
    });
    return mapPermission(updated);
  }

  async upsertMany(inputs: PermissionDefinition[]): Promise<PermissionRecord[]> {
    const output: PermissionRecord[] = [];
    for (const input of inputs) {
      const existing = await this.getByKey(input.key);
      output.push(existing ? await this.update(existing.id, input) : await this.create(input));
    }
    return output;
  }
}
