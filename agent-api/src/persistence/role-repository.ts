export type RoleRecord = {
  id: string;
  organizationId?: string;
  slug: string;
  name: string;
  description?: string;
  isSystem: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateRoleInput = {
  id?: string;
  organizationId?: string;
  slug: string;
  name: string;
  description?: string;
  isSystem?: boolean;
  isActive?: boolean;
};

export type UpdateRoleInput = Partial<CreateRoleInput>;

export type CloneRoleInput = {
  sourceRoleId: string;
  slug: string;
  name: string;
  description?: string | null;
  organizationId?: string;
};

type RoleRow = {
  id: string;
  organizationId: string | null;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type RoleTable = {
  findUnique(args: { where: { id?: string; slug?: string } }): Promise<RoleRow | null>;
  findMany(args?: {
    where?: { slug?: string; organizationId?: string | null };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<RoleRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<RoleRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<RoleRow>;
};

export type RoleRepositoryDb = {
  role: RoleTable;
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

function mapRole(row: RoleRow): RoleRecord {
  return {
    id: row.id,
    organizationId: trimOrUndefined(row.organizationId),
    slug: row.slug,
    name: row.name,
    description: trimOrUndefined(row.description),
    isSystem: row.isSystem,
    isActive: row.isActive,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

function isProtectedSystemRole(role: RoleRow): boolean {
  return role.isSystem && (role.slug === "super_admin" || role.slug === "admin");
}

export class RoleRepository {
  constructor(private readonly db: RoleRepositoryDb) {}

  async list(): Promise<RoleRecord[]> {
    const rows = await this.db.role.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map(mapRole);
  }

  async getById(roleId: string): Promise<RoleRecord | null> {
    const normalized = trimOrUndefined(roleId);
    if (!normalized) return null;
    const row = await this.db.role.findUnique({ where: { id: normalized } });
    return row ? mapRole(row) : null;
  }

  async getBySlug(slug: string): Promise<RoleRecord | null> {
    const normalized = trimOrUndefined(slug);
    if (!normalized) return null;

    const globalRows = await this.db.role.findMany({
      where: { slug: normalized, organizationId: null },
      orderBy: { createdAt: "asc" }
    });
    if (globalRows[0]) {
      return mapRole(globalRows[0]);
    }

    const rows = await this.db.role.findMany({
      where: { slug: normalized },
      orderBy: { createdAt: "asc" }
    });
    return rows[0] ? mapRole(rows[0]) : null;
  }

  async create(input: CreateRoleInput): Promise<RoleRecord> {
    const slug = trimOrUndefined(input.slug);
    const name = trimOrUndefined(input.name);
    if (!slug || !name) {
      throw new Error("role slug and name are required");
    }
    const created = await this.db.role.create({
      data: {
        id: trimOrUndefined(input.id),
        organizationId: trimOrUndefined(input.organizationId) ?? null,
        slug,
        name,
        description: trimOrUndefined(input.description) ?? null,
        isSystem: input.isSystem ?? false,
        isActive: input.isActive ?? true
      }
    });
    return mapRole(created);
  }

  async update(roleId: string, input: UpdateRoleInput): Promise<RoleRecord> {
    const normalized = trimOrUndefined(roleId);
    if (!normalized) {
      throw new Error("role 不存在");
    }
    const existing = await this.db.role.findUnique({ where: { id: normalized } });
    if (!existing) {
      throw new Error("role 不存在");
    }

    const updated = await this.db.role.update({
      where: { id: existing.id },
      data: {
        organizationId:
          input.organizationId === undefined ? existing.organizationId : trimOrUndefined(input.organizationId) ?? null,
        slug: input.slug === undefined ? existing.slug : trimOrUndefined(input.slug) ?? existing.slug,
        name: input.name === undefined ? existing.name : trimOrUndefined(input.name) ?? existing.name,
        description:
          input.description === undefined ? existing.description : trimOrUndefined(input.description) ?? null,
        isActive: input.isActive === undefined ? existing.isActive : input.isActive,
        updatedAt: new Date()
      }
    });
    return mapRole(updated);
  }

  async disable(roleId: string): Promise<RoleRecord> {
    const normalized = trimOrUndefined(roleId);
    if (!normalized) {
      throw new Error("role 不存在");
    }
    const existing = await this.db.role.findUnique({ where: { id: normalized } });
    if (!existing) {
      throw new Error("role 不存在");
    }
    if (isProtectedSystemRole(existing)) {
      throw new Error("system role 不能被禁用");
    }
    const updated = await this.db.role.update({
      where: { id: existing.id },
      data: {
        isActive: false,
        updatedAt: new Date()
      }
    });
    return mapRole(updated);
  }

  async clone(input: CloneRoleInput): Promise<RoleRecord> {
    const sourceRoleId = trimOrUndefined(input.sourceRoleId);
    const slug = trimOrUndefined(input.slug);
    const name = trimOrUndefined(input.name);
    if (!sourceRoleId || !slug || !name) {
      throw new Error("sourceRoleId, slug, and name are required");
    }
    const source = await this.db.role.findUnique({ where: { id: sourceRoleId } });
    if (!source) {
      throw new Error("source role 不存在");
    }
    const created = await this.db.role.create({
      data: {
        organizationId:
          input.organizationId === undefined ? source.organizationId : trimOrUndefined(input.organizationId) ?? null,
        slug,
        name,
        description:
          input.description === undefined ? source.description : trimOrUndefined(input.description) ?? null,
        isSystem: false,
        isActive: true
      }
    });
    return mapRole(created);
  }
}
