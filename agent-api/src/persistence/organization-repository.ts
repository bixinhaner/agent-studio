export type OrganizationRecord = {
  id: string;
  slug: string;
  name: string;
  type: string;
  status: string;
  publicBrandId?: string;
  ownerUserId?: string;
  settingsJson?: unknown;
  createdAt: string;
  updatedAt: string;
};

type OrganizationRow = {
  id: string;
  slug: string;
  name: string;
  type: string | null;
  status: string | null;
  publicBrandId: string | null;
  ownerUserId: string | null;
  settingsJson: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type OrganizationTable = {
  findUnique(args: { where: { id?: string; slug?: string } }): Promise<OrganizationRow | null>;
  findMany(args?: {
    where?: { id?: { in: string[] }; slug?: string; status?: string; type?: string };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<OrganizationRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<OrganizationRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<OrganizationRow>;
};

export type OrganizationRepositoryDb = {
  organization: OrganizationTable;
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

function mapOrganization(row: OrganizationRow): OrganizationRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    type: trimOrUndefined(row.type) ?? "customer",
    status: trimOrUndefined(row.status) ?? "active",
    publicBrandId: trimOrUndefined(row.publicBrandId),
    ownerUserId: trimOrUndefined(row.ownerUserId),
    settingsJson: row.settingsJson ?? undefined,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

export class OrganizationRepository {
  constructor(private readonly db: OrganizationRepositoryDb) {}

  async getById(id: string): Promise<OrganizationRecord | undefined> {
    const normalized = trimOrUndefined(id);
    if (!normalized) return undefined;
    const row = await this.db.organization.findUnique({ where: { id: normalized } });
    return row ? mapOrganization(row) : undefined;
  }

  async getBySlug(slug: string): Promise<OrganizationRecord | undefined> {
    const normalized = trimOrUndefined(slug);
    if (!normalized) return undefined;
    const row = await this.db.organization.findUnique({ where: { slug: normalized } });
    return row ? mapOrganization(row) : undefined;
  }

  async listByIds(ids: string[]): Promise<OrganizationRecord[]> {
    const normalizedIds = [...new Set(ids.map((id) => trimOrUndefined(id)).filter(Boolean) as string[])];
    if (!normalizedIds.length) return [];
    const rows = await this.db.organization.findMany({
      where: { id: { in: normalizedIds } },
      orderBy: { createdAt: "asc" }
    });
    return rows.map(mapOrganization);
  }

  async list(input?: { type?: string; status?: string }): Promise<OrganizationRecord[]> {
    const rows = await this.db.organization.findMany({
      where: {
        type: trimOrUndefined(input?.type),
        status: trimOrUndefined(input?.status)
      },
      orderBy: { createdAt: "asc" }
    });
    return rows.map(mapOrganization);
  }

  async create(input: {
    slug: string;
    name: string;
    type?: string;
    status?: string;
    publicBrandId?: string | null;
    ownerUserId?: string | null;
    settingsJson?: unknown;
  }): Promise<OrganizationRecord> {
    const created = await this.db.organization.create({
      data: {
        slug: input.slug.trim(),
        name: input.name.trim(),
        type: trimOrUndefined(input.type) ?? "customer",
        status: trimOrUndefined(input.status) ?? "active",
        publicBrandId: trimOrUndefined(input.publicBrandId ?? undefined) ?? null,
        ownerUserId: trimOrUndefined(input.ownerUserId ?? undefined) ?? null,
        settingsJson: input.settingsJson ?? null
      }
    });
    return mapOrganization(created);
  }

  async update(id: string, input: {
    name?: string;
    type?: string;
    status?: string;
    publicBrandId?: string | null;
    ownerUserId?: string | null;
    settingsJson?: unknown;
  }): Promise<OrganizationRecord> {
    const normalized = trimOrUndefined(id);
    if (!normalized) {
      throw new Error("Organization does not exist");
    }
    const existing = await this.db.organization.findUnique({ where: { id: normalized } });
    if (!existing) {
      throw new Error("Organization does not exist");
    }
    const updated = await this.db.organization.update({
      where: { id: normalized },
      data: {
        name: input.name === undefined ? existing.name : input.name.trim(),
        type: input.type === undefined ? existing.type : trimOrUndefined(input.type) ?? existing.type,
        status: input.status === undefined ? existing.status : trimOrUndefined(input.status) ?? existing.status,
        publicBrandId:
          input.publicBrandId === undefined
            ? existing.publicBrandId
            : trimOrUndefined(input.publicBrandId ?? undefined) ?? null,
        ownerUserId:
          input.ownerUserId === undefined
            ? existing.ownerUserId
            : trimOrUndefined(input.ownerUserId ?? undefined) ?? null,
        settingsJson: input.settingsJson === undefined ? existing.settingsJson : input.settingsJson ?? null,
        updatedAt: new Date()
      }
    });
    return mapOrganization(updated);
  }
}
