export type SkillPackageRuntimeBindingRecord = {
  id: string;
  runtimeType: string;
  bindingType: string;
  bindingPayload: unknown;
  createdAt: string;
  updatedAt: string;
};

export type SkillPackageItemRecord = {
  id: string;
  capabilityKey: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  runtimeBindings: SkillPackageRuntimeBindingRecord[];
};

export type SkillPackageRecord = {
  id: string;
  organizationId?: string;
  name: string;
  slug: string;
  description?: string;
  status: string;
  visibleToUsers: boolean;
  createdAt: string;
  updatedAt: string;
  items: SkillPackageItemRecord[];
};

type CreateSkillPackagePayload = {
  id?: string;
  organizationId?: string;
  name: string;
  slug: string;
  description?: string;
  status?: string;
  visibleToUsers?: boolean;
};

type ReplaceSkillPackageItemsPayload = Array<{
  capabilityKey: string;
  description?: string;
  runtimeBindings: Array<{
    runtimeType: string;
    bindingType: string;
    bindingPayload: unknown;
  }>;
}>;

type SkillPackageRow = {
  id: string;
  organizationId: string | null;
  name: string;
  slug: string;
  description: string | null;
  status: string | null;
  visibleToUsers: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type SkillPackageItemRow = {
  id: string;
  skillPackageId: string;
  capabilityKey: string;
  description: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type SkillPackageRuntimeBindingRow = {
  id: string;
  skillPackageItemId: string;
  runtimeType: string;
  bindingType: string;
  bindingPayload: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type SkillPackageTable = {
  findUnique(args: { where: { id?: string; slug?: string } }): Promise<SkillPackageRow | null>;
  findMany(args?: { orderBy?: { createdAt?: "asc" | "desc"; updatedAt?: "asc" | "desc" } }): Promise<SkillPackageRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<SkillPackageRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<SkillPackageRow>;
};

type SkillPackageItemTable = {
  findMany(args: {
    where: { skillPackageId: string };
    orderBy?: { capabilityKey?: "asc" | "desc"; createdAt?: "asc" | "desc" };
  }): Promise<SkillPackageItemRow[]>;
  deleteMany(args: { where: { skillPackageId: string } }): Promise<{ count: number }>;
  create(args: { data: Record<string, unknown> }): Promise<SkillPackageItemRow>;
};

type SkillPackageRuntimeBindingTable = {
  findMany(args: {
    where: { skillPackageItemId: string };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<SkillPackageRuntimeBindingRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<SkillPackageRuntimeBindingRow>;
};

export type SkillPackageRepositoryDb = {
  skillPackage: SkillPackageTable;
  skillPackageItem: SkillPackageItemTable;
  skillPackageRuntimeBinding: SkillPackageRuntimeBindingTable;
  $transaction<T>(callback: (tx: SkillPackageRepositoryDb) => Promise<T>): Promise<T>;
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

function mapRuntimeBinding(row: SkillPackageRuntimeBindingRow): SkillPackageRuntimeBindingRecord {
  return {
    id: row.id,
    runtimeType: row.runtimeType,
    bindingType: row.bindingType,
    bindingPayload: row.bindingPayload,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

export class SkillPackageRepository {
  constructor(private readonly db: SkillPackageRepositoryDb) {}

  async create(payload: CreateSkillPackagePayload): Promise<SkillPackageRecord> {
    const created = await this.db.skillPackage.create({
      data: {
        id: trimOrUndefined(payload.id),
        organizationId: trimOrUndefined(payload.organizationId) ?? null,
        name: payload.name,
        slug: payload.slug,
        description: trimOrUndefined(payload.description) ?? null,
        status: trimOrUndefined(payload.status) ?? "active",
        visibleToUsers: payload.visibleToUsers ?? false
      }
    });
    return this.loadRecord(this.db, created);
  }

  async get(id: string): Promise<SkillPackageRecord | undefined> {
    const skillPackageId = trimOrUndefined(id);
    if (!skillPackageId) return undefined;
    const row = await this.db.skillPackage.findUnique({ where: { id: skillPackageId } });
    return row ? this.loadRecord(this.db, row) : undefined;
  }

  async list(): Promise<SkillPackageRecord[]> {
    const rows = await this.db.skillPackage.findMany({
      orderBy: { createdAt: "asc" }
    });
    return Promise.all(rows.map((row) => this.loadRecord(this.db, row)));
  }

  async update(id: string, payload: Partial<CreateSkillPackagePayload>): Promise<SkillPackageRecord> {
    const skillPackageId = trimOrUndefined(id);
    if (!skillPackageId) {
      throw new Error("skill package 不存在");
    }
    const existing = await this.db.skillPackage.findUnique({ where: { id: skillPackageId } });
    if (!existing) {
      throw new Error("skill package 不存在");
    }
    const updated = await this.db.skillPackage.update({
      where: { id: skillPackageId },
      data: {
        organizationId:
          payload.organizationId === undefined ? existing.organizationId : trimOrUndefined(payload.organizationId) ?? null,
        name: payload.name ?? existing.name,
        slug: payload.slug ?? existing.slug,
        description:
          payload.description === undefined ? existing.description : trimOrUndefined(payload.description) ?? null,
        status: payload.status === undefined ? existing.status : trimOrUndefined(payload.status) ?? "active",
        visibleToUsers: payload.visibleToUsers === undefined ? existing.visibleToUsers : payload.visibleToUsers,
        updatedAt: new Date()
      }
    });
    return this.loadRecord(this.db, updated);
  }

  async replaceItems(skillPackageId: string, items: ReplaceSkillPackageItemsPayload): Promise<SkillPackageRecord> {
    return this.db.$transaction(async (tx) => {
      const record = await this.requireSkillPackage(tx, skillPackageId);
      await tx.skillPackageItem.deleteMany({ where: { skillPackageId: record.id } });
      for (const item of items) {
        const createdItem = await tx.skillPackageItem.create({
          data: {
            skillPackageId: record.id,
            capabilityKey: item.capabilityKey,
            description: trimOrUndefined(item.description) ?? null
          }
        });
        for (const runtimeBinding of item.runtimeBindings) {
          await tx.skillPackageRuntimeBinding.create({
            data: {
              skillPackageItemId: createdItem.id,
              runtimeType: runtimeBinding.runtimeType,
              bindingType: runtimeBinding.bindingType,
              bindingPayload: runtimeBinding.bindingPayload
            }
          });
        }
      }
      const refreshed = await tx.skillPackage.update({
        where: { id: record.id },
        data: {
          updatedAt: new Date()
        }
      });
      return this.loadRecord(tx, refreshed);
    });
  }

  async copy(
    id: string,
    overrides: { name: string; slug: string; status: string; visibleToUsers: boolean }
  ): Promise<SkillPackageRecord> {
    return this.db.$transaction(async (tx) => {
      const existing = await this.requireSkillPackage(tx, id);
      const loaded = await this.loadRecord(tx, existing);
      const copied = await tx.skillPackage.create({
        data: {
          organizationId: trimOrUndefined(loaded.organizationId) ?? null,
          name: overrides.name,
          slug: overrides.slug,
          description: trimOrUndefined(loaded.description) ?? null,
          status: trimOrUndefined(overrides.status) ?? "disabled",
          visibleToUsers: overrides.visibleToUsers
        }
      });

      for (const item of loaded.items) {
        const copiedItem = await tx.skillPackageItem.create({
          data: {
            skillPackageId: copied.id,
            capabilityKey: item.capabilityKey,
            description: trimOrUndefined(item.description) ?? null
          }
        });
        for (const runtimeBinding of item.runtimeBindings) {
          await tx.skillPackageRuntimeBinding.create({
            data: {
              skillPackageItemId: copiedItem.id,
              runtimeType: runtimeBinding.runtimeType,
              bindingType: runtimeBinding.bindingType,
              bindingPayload: runtimeBinding.bindingPayload
            }
          });
        }
      }

      return this.loadRecord(tx, copied);
    });
  }

  private async requireSkillPackage(db: SkillPackageRepositoryDb, skillPackageId: string): Promise<SkillPackageRow> {
    const normalized = trimOrUndefined(skillPackageId);
    if (!normalized) {
      throw new Error("skill package 不存在");
    }
    const row = await db.skillPackage.findUnique({ where: { id: normalized } });
    if (!row) {
      throw new Error("skill package 不存在");
    }
    return row;
  }

  private async loadRecord(db: SkillPackageRepositoryDb, row: SkillPackageRow): Promise<SkillPackageRecord> {
    const itemRows = await db.skillPackageItem.findMany({
      where: { skillPackageId: row.id },
      orderBy: { capabilityKey: "asc" }
    });
    const items = await Promise.all(
      itemRows.map(async (item) => ({
        id: item.id,
        capabilityKey: item.capabilityKey,
        description: trimOrUndefined(item.description),
        createdAt: toIsoString(item.createdAt),
        updatedAt: toIsoString(item.updatedAt),
        runtimeBindings: await db.skillPackageRuntimeBinding
          .findMany({
            where: { skillPackageItemId: item.id },
            orderBy: { createdAt: "asc" }
          })
          .then((records) => records.map(mapRuntimeBinding))
      }))
    );

    return {
      id: row.id,
      organizationId: trimOrUndefined(row.organizationId),
      name: row.name,
      slug: row.slug,
      description: trimOrUndefined(row.description),
      status: trimOrUndefined(row.status) ?? "active",
      visibleToUsers: row.visibleToUsers,
      createdAt: toIsoString(row.createdAt),
      updatedAt: toIsoString(row.updatedAt),
      items
    };
  }
}
