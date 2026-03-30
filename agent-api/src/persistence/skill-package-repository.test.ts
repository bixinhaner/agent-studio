import { describe, expect, it } from "vitest";

import { SkillPackageRepository } from "./skill-package-repository.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

type FakeSkillPackageRow = {
  id: string;
  organizationId: string | null;
  name: string;
  slug: string;
  description: string | null;
  status: string | null;
  visibleToUsers: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type FakeSkillPackageItemRow = {
  id: string;
  skillPackageId: string;
  capabilityKey: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type FakeRuntimeBindingRow = {
  id: string;
  skillPackageItemId: string;
  runtimeType: string;
  bindingType: string;
  bindingPayload: unknown;
  createdAt: Date;
  updatedAt: Date;
};

class FakeSkillPackageDb {
  private skillPackageCounter = 0;
  private itemCounter = 0;
  private runtimeBindingCounter = 0;

  readonly skillPackages: FakeSkillPackageRow[] = [];
  readonly items: FakeSkillPackageItemRow[] = [];
  readonly runtimeBindings: FakeRuntimeBindingRow[] = [];

  readonly skillPackage = {
    findUnique: async ({ where }: { where: { id?: string; slug?: string } }) => {
      const row = this.skillPackages.find((item) => {
        if (where.id) return item.id === where.id;
        if (where.slug) return item.slug === where.slug;
        return false;
      });
      return row ? clone(row) : null;
    },
    findMany: async ({ orderBy }: { orderBy?: { createdAt?: "asc" | "desc"; updatedAt?: "asc" | "desc" } } = {}) => {
      const rows = [...this.skillPackages];
      const [field, direction] = orderBy?.updatedAt
        ? (["updatedAt", orderBy.updatedAt] as const)
        : orderBy?.createdAt
          ? (["createdAt", orderBy.createdAt] as const)
          : (["createdAt", "asc"] as const);
      rows.sort((left, right) => {
        const diff = left[field].getTime() - right[field].getTime();
        return direction === "asc" ? diff : -diff;
      });
      return clone(rows);
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeSkillPackageRow = {
        id: typeof data.id === "string" ? data.id : `skill-package-${++this.skillPackageCounter}`,
        organizationId: typeof data.organizationId === "string" ? data.organizationId : null,
        name: typeof data.name === "string" ? data.name : "",
        slug: typeof data.slug === "string" ? data.slug : "",
        description: typeof data.description === "string" ? data.description : null,
        status: typeof data.status === "string" ? data.status : null,
        visibleToUsers: typeof data.visibleToUsers === "boolean" ? data.visibleToUsers : false,
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.skillPackages.push(row);
      return clone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.skillPackages.find((item) => item.id === where.id);
      if (!row) throw new Error("skill package not found");
      Object.assign(row, clone(data));
      row.updatedAt = data.updatedAt instanceof Date ? data.updatedAt : new Date();
      return clone(row);
    }
  };

  readonly skillPackageItem = {
    findMany: async ({ where, orderBy }: { where: { skillPackageId: string }; orderBy?: { capabilityKey?: "asc" | "desc"; createdAt?: "asc" | "desc" } }) => {
      const rows = this.items.filter((item) => item.skillPackageId === where.skillPackageId);
      const [field, direction] = orderBy?.capabilityKey
        ? (["capabilityKey", orderBy.capabilityKey] as const)
        : (["createdAt", orderBy?.createdAt ?? "asc"] as const);
      rows.sort((left, right) => {
        const leftValue = field === "capabilityKey" ? left.capabilityKey : left.createdAt.getTime();
        const rightValue = field === "capabilityKey" ? right.capabilityKey : right.createdAt.getTime();
        const diff = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
        return direction === "asc" ? diff : -diff;
      });
      return clone(rows);
    },
    deleteMany: async ({ where }: { where: { skillPackageId: string } }) => {
      const deletedItems = this.items.filter((item) => item.skillPackageId === where.skillPackageId);
      const deletedItemIds = new Set(deletedItems.map((item) => item.id));
      this.items.splice(0, this.items.length, ...this.items.filter((item) => item.skillPackageId !== where.skillPackageId));
      this.runtimeBindings.splice(0, this.runtimeBindings.length, ...this.runtimeBindings.filter((item) => !deletedItemIds.has(item.skillPackageItemId)));
      return { count: deletedItems.length };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeSkillPackageItemRow = {
        id: typeof data.id === "string" ? data.id : `skill-package-item-${++this.itemCounter}`,
        skillPackageId: typeof data.skillPackageId === "string" ? data.skillPackageId : "",
        capabilityKey: typeof data.capabilityKey === "string" ? data.capabilityKey : "",
        description: typeof data.description === "string" ? data.description : null,
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.items.push(row);
      return clone(row);
    }
  };

  readonly skillPackageRuntimeBinding = {
    findMany: async ({ where, orderBy }: { where: { skillPackageItemId?: string; skillPackageItemIdIn?: string[] }; orderBy?: { createdAt?: "asc" | "desc" } }) => {
      const ids = where.skillPackageItemIdIn ? new Set(where.skillPackageItemIdIn) : undefined;
      const rows = this.runtimeBindings.filter((item) => {
        if (where.skillPackageItemId) return item.skillPackageItemId === where.skillPackageItemId;
        if (ids) return ids.has(item.skillPackageItemId);
        return true;
      });
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    deleteMany: async ({ where }: { where: { skillPackageItemId?: string; skillPackageItemIdIn?: string[] } }) => {
      const ids = where.skillPackageItemIdIn ? new Set(where.skillPackageItemIdIn) : undefined;
      const before = this.runtimeBindings.length;
      this.runtimeBindings.splice(
        0,
        this.runtimeBindings.length,
        ...this.runtimeBindings.filter((item) => {
          if (where.skillPackageItemId) return item.skillPackageItemId !== where.skillPackageItemId;
          if (ids) return !ids.has(item.skillPackageItemId);
          return true;
        })
      );
      return { count: before - this.runtimeBindings.length };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeRuntimeBindingRow = {
        id: typeof data.id === "string" ? data.id : `runtime-binding-${++this.runtimeBindingCounter}`,
        skillPackageItemId: typeof data.skillPackageItemId === "string" ? data.skillPackageItemId : "",
        runtimeType: typeof data.runtimeType === "string" ? data.runtimeType : "",
        bindingType: typeof data.bindingType === "string" ? data.bindingType : "",
        bindingPayload: clone(data.bindingPayload),
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.runtimeBindings.push(row);
      return clone(row);
    }
  };

  async $transaction<T>(callback: (tx: FakeSkillPackageDb) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

describe("SkillPackageRepository", () => {
  it("replaces skill package items and runtime bindings", async () => {
    const repository = new SkillPackageRepository(new FakeSkillPackageDb() as never);
    const skillPackage = await repository.create({ name: "Code Tools", slug: "code-tools" });

    await repository.replaceItems(skillPackage.id, [
      {
        capabilityKey: "filesystem.write",
        description: "Write files",
        runtimeBindings: [{ runtimeType: "codex", bindingType: "config_fragment", bindingPayload: { tool: "fs_write" } }]
      },
      {
        capabilityKey: "filesystem.read",
        description: "Read files",
        runtimeBindings: [
          { runtimeType: "codex", bindingType: "config_fragment", bindingPayload: { tool: "fs_read" } },
          { runtimeType: "claude_code", bindingType: "prompt_hint", bindingPayload: { tool: "Read" } }
        ]
      }
    ]);

    await repository.replaceItems(skillPackage.id, [
      {
        capabilityKey: "filesystem.read",
        description: "Read files",
        runtimeBindings: [
          { runtimeType: "codex", bindingType: "config_fragment", bindingPayload: { tool: "fs_read" } },
          { runtimeType: "claude_code", bindingType: "prompt_hint", bindingPayload: { tool: "Read" } }
        ]
      }
    ]);

    const loaded = await repository.get(skillPackage.id);
    expect(loaded?.items).toHaveLength(1);
    expect(loaded?.items[0]?.runtimeBindings).toHaveLength(2);
    expect(loaded?.items[0]).toMatchObject({
      capabilityKey: "filesystem.read",
      description: "Read files"
    });
    expect(loaded?.items[0]?.runtimeBindings).toEqual([
      {
        id: expect.any(String),
        runtimeType: "codex",
        bindingType: "config_fragment",
        bindingPayload: { tool: "fs_read" },
        createdAt: expect.any(String),
        updatedAt: expect.any(String)
      },
      {
        id: expect.any(String),
        runtimeType: "claude_code",
        bindingType: "prompt_hint",
        bindingPayload: { tool: "Read" },
        createdAt: expect.any(String),
        updatedAt: expect.any(String)
      }
    ]);

    const updated = await repository.update(skillPackage.id, {
      description: " Runtime packaged skills ",
      visibleToUsers: true
    });

    expect(updated).toMatchObject({
      description: "Runtime packaged skills",
      visibleToUsers: true
    });
    await expect(repository.list()).resolves.toEqual([updated]);
  });

  it("copies a skill package with items and runtime bindings into a disabled hidden record", async () => {
    const repository = new SkillPackageRepository(new FakeSkillPackageDb() as never);
    const skillPackage = await repository.create({
      name: "Support Tools",
      slug: "support-tools",
      description: " Runtime skills ",
      status: "active",
      visibleToUsers: true
    });

    await repository.replaceItems(skillPackage.id, [
      {
        capabilityKey: "ticket.search",
        description: "Search tickets",
        runtimeBindings: [{ runtimeType: "codex", bindingType: "config_fragment", bindingPayload: { tool: "ticket_search" } }]
      }
    ]);

    const copied = await repository.copy(skillPackage.id, {
      name: "Support Tools Copy",
      slug: "support-tools-copy",
      status: "disabled",
      visibleToUsers: false
    });

    expect(copied.id).not.toBe(skillPackage.id);
    expect(copied).toMatchObject({
      name: "Support Tools Copy",
      slug: "support-tools-copy",
      status: "disabled",
      visibleToUsers: false,
      description: "Runtime skills"
    });
    expect(copied.items).toEqual([
      expect.objectContaining({
        capabilityKey: "ticket.search",
        description: "Search tickets",
        runtimeBindings: [
          expect.objectContaining({
            runtimeType: "codex",
            bindingType: "config_fragment",
            bindingPayload: { tool: "ticket_search" }
          })
        ]
      })
    ]);
  });
});
