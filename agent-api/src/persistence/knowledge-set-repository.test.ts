import { describe, expect, it } from "vitest";

import { KnowledgeSetRepository } from "./knowledge-set-repository.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

type FakeKnowledgeSetRow = {
  id: string;
  organizationId: string | null;
  name: string;
  slug: string;
  description: string | null;
  status: string | null;
  sourceType: string;
  rootPath: string | null;
  storageKey: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type FakeKnowledgeSetItemRow = {
  id: string;
  knowledgeSetId: string;
  kind: string;
  relativePath: string;
  displayName: string;
  mimeType: string | null;
  sizeBytes: bigint | null;
  checksum: string | null;
  sourceArchiveName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type FakeWorkspaceKnowledgeSetRow = {
  id: string;
  workspaceId: string;
  knowledgeSetId: string;
  mountType: string;
  createdAt: Date;
  updatedAt: Date;
};

class FakeKnowledgeSetDb {
  private knowledgeSetCounter = 0;
  private itemCounter = 0;
  private bindingCounter = 0;

  readonly knowledgeSets: FakeKnowledgeSetRow[] = [];
  readonly items: FakeKnowledgeSetItemRow[] = [];
  readonly bindings: FakeWorkspaceKnowledgeSetRow[] = [];

  readonly knowledgeSet = {
    findUnique: async ({ where }: { where: { id?: string; slug?: string } }) => {
      const row = this.knowledgeSets.find((item) => {
        if (where.id) return item.id === where.id;
        if (where.slug) return item.slug === where.slug;
        return false;
      });
      return row ? clone(row) : null;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeKnowledgeSetRow = {
        id: typeof data.id === "string" ? data.id : `knowledge-set-${++this.knowledgeSetCounter}`,
        organizationId: typeof data.organizationId === "string" ? data.organizationId : null,
        name: typeof data.name === "string" ? data.name : "",
        slug: typeof data.slug === "string" ? data.slug : "",
        description: typeof data.description === "string" ? data.description : null,
        status: typeof data.status === "string" ? data.status : null,
        sourceType: typeof data.sourceType === "string" ? data.sourceType : "",
        rootPath: typeof data.rootPath === "string" ? data.rootPath : null,
        storageKey: typeof data.storageKey === "string" ? data.storageKey : null,
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.knowledgeSets.push(row);
      return clone(row);
    }
  };

  readonly knowledgeSetItem = {
    findMany: async ({
      where,
      orderBy
    }: {
      where: { knowledgeSetId: string };
      orderBy?: { relativePath?: "asc" | "desc"; createdAt?: "asc" | "desc" };
    }) => {
      const rows = this.items.filter((item) => item.knowledgeSetId === where.knowledgeSetId);
      const [field, direction] = orderBy?.relativePath
        ? (["relativePath", orderBy.relativePath] as const)
        : (["createdAt", orderBy?.createdAt ?? "asc"] as const);
      rows.sort((left, right) => {
        const leftValue = field === "relativePath" ? left.relativePath : left.createdAt.getTime();
        const rightValue = field === "relativePath" ? right.relativePath : right.createdAt.getTime();
        const diff = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
        return direction === "asc" ? diff : -diff;
      });
      return clone(rows);
    },
    deleteMany: async ({ where }: { where: { knowledgeSetId: string } }) => {
      const before = this.items.length;
      const remaining = this.items.filter((item) => item.knowledgeSetId !== where.knowledgeSetId);
      this.items.splice(0, this.items.length, ...remaining);
      return { count: before - this.items.length };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeKnowledgeSetItemRow = {
        id: typeof data.id === "string" ? data.id : `item-${++this.itemCounter}`,
        knowledgeSetId: typeof data.knowledgeSetId === "string" ? data.knowledgeSetId : "",
        kind: typeof data.kind === "string" ? data.kind : "",
        relativePath: typeof data.relativePath === "string" ? data.relativePath : "",
        displayName: typeof data.displayName === "string" ? data.displayName : "",
        mimeType: typeof data.mimeType === "string" ? data.mimeType : null,
        sizeBytes: typeof data.sizeBytes === "bigint" ? data.sizeBytes : null,
        checksum: typeof data.checksum === "string" ? data.checksum : null,
        sourceArchiveName: typeof data.sourceArchiveName === "string" ? data.sourceArchiveName : null,
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.items.push(row);
      return clone(row);
    }
  };

  readonly workspaceKnowledgeSet = {
    findMany: async ({
      where,
      orderBy
    }: {
      where: { knowledgeSetId: string };
      orderBy?: { createdAt?: "asc" | "desc" };
    }) => {
      const rows = this.bindings.filter((item) => item.knowledgeSetId === where.knowledgeSetId);
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    deleteMany: async ({ where }: { where: { knowledgeSetId: string } }) => {
      const before = this.bindings.length;
      const remaining = this.bindings.filter((item) => item.knowledgeSetId !== where.knowledgeSetId);
      this.bindings.splice(0, this.bindings.length, ...remaining);
      return { count: before - this.bindings.length };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeWorkspaceKnowledgeSetRow = {
        id: typeof data.id === "string" ? data.id : `binding-${++this.bindingCounter}`,
        workspaceId: typeof data.workspaceId === "string" ? data.workspaceId : "",
        knowledgeSetId: typeof data.knowledgeSetId === "string" ? data.knowledgeSetId : "",
        mountType: typeof data.mountType === "string" ? data.mountType : "",
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.bindings.push(row);
      return clone(row);
    }
  };

  async $transaction<T>(callback: (tx: FakeKnowledgeSetDb) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

describe("KnowledgeSetRepository", () => {
  it("creates a knowledge set and normalizes nullable strings", async () => {
    const repository = new KnowledgeSetRepository(new FakeKnowledgeSetDb() as never);

    const knowledgeSet = await repository.create({
      organizationId: "  org-1 ",
      name: "Policies",
      slug: "policies",
      description: " ",
      status: " ",
      sourceType: "managed",
      rootPath: " ",
      storageKey: " uploads/policies.zip "
    });

    expect(knowledgeSet).toMatchObject({
      organizationId: "org-1",
      name: "Policies",
      slug: "policies",
      description: undefined,
      status: "active",
      sourceType: "managed",
      rootPath: undefined,
      storageKey: "uploads/policies.zip",
      items: [],
      workspaceBindings: []
    });
    expect(knowledgeSet.createdAt).toMatch(/\.\d{3}Z$/);
  });

  it("replaces knowledge-set items with the current state", async () => {
    const db = new FakeKnowledgeSetDb();
    db.knowledgeSets.push({
      id: "knowledge-set-1",
      organizationId: null,
      name: "Policies",
      slug: "policies",
      description: null,
      status: "active",
      sourceType: "managed",
      rootPath: null,
      storageKey: "uploads/policies.zip",
      createdAt: new Date("2026-03-27T00:00:00.000Z"),
      updatedAt: new Date("2026-03-27T00:00:00.000Z")
    });
    db.items.push({
      id: "item-old",
      knowledgeSetId: "knowledge-set-1",
      kind: "file",
      relativePath: "old.md",
      displayName: "Old",
      mimeType: "text/markdown",
      sizeBytes: 10n,
      checksum: "old-checksum",
      sourceArchiveName: null,
      createdAt: new Date("2026-03-27T00:00:00.000Z"),
      updatedAt: new Date("2026-03-27T00:00:00.000Z")
    });
    const repository = new KnowledgeSetRepository(db as never);

    const record = await repository.replaceItems("knowledge-set-1", [
      {
        kind: "file",
        relativePath: "docs/policy.md",
        displayName: "Policy",
        mimeType: "text/markdown",
        sizeBytes: 128n,
        checksum: "checksum-1",
        sourceArchiveName: "policy.zip"
      },
      {
        kind: "file",
        relativePath: "docs/faq.md",
        displayName: "FAQ",
        mimeType: undefined,
        sizeBytes: undefined,
        checksum: undefined,
        sourceArchiveName: undefined
      }
    ]);

    expect(db.items).toHaveLength(2);
    expect(db.items.map((item) => item.relativePath)).toEqual(["docs/policy.md", "docs/faq.md"]);
    expect(record.items).toEqual([
      {
        id: expect.any(String),
        kind: "file",
        relativePath: "docs/faq.md",
        displayName: "FAQ",
        mimeType: undefined,
        sizeBytes: undefined,
        checksum: undefined,
        sourceArchiveName: undefined,
        createdAt: expect.any(String),
        updatedAt: expect.any(String)
      },
      {
        id: expect.any(String),
        kind: "file",
        relativePath: "docs/policy.md",
        displayName: "Policy",
        mimeType: "text/markdown",
        sizeBytes: "128",
        checksum: "checksum-1",
        sourceArchiveName: "policy.zip",
        createdAt: expect.any(String),
        updatedAt: expect.any(String)
      }
    ]);
  });

  it("replaces workspace bindings with the current state", async () => {
    const db = new FakeKnowledgeSetDb();
    db.knowledgeSets.push({
      id: "knowledge-set-1",
      organizationId: null,
      name: "Policies",
      slug: "policies",
      description: null,
      status: "active",
      sourceType: "managed",
      rootPath: null,
      storageKey: null,
      createdAt: new Date("2026-03-27T00:00:00.000Z"),
      updatedAt: new Date("2026-03-27T00:00:00.000Z")
    });
    db.bindings.push({
      id: "binding-old",
      workspaceId: "workspace-old",
      knowledgeSetId: "knowledge-set-1",
      mountType: "reference",
      createdAt: new Date("2026-03-27T00:00:00.000Z"),
      updatedAt: new Date("2026-03-27T00:00:00.000Z")
    });
    const repository = new KnowledgeSetRepository(db as never);

    const record = await repository.replaceWorkspaceBindings("knowledge-set-1", [
      { workspaceId: "workspace-a", mountType: "reference" },
      { workspaceId: "workspace-b", mountType: "mirror" }
    ]);

    expect(db.bindings).toHaveLength(2);
    expect(db.bindings.map((item) => item.workspaceId)).toEqual(["workspace-a", "workspace-b"]);
    expect(record.workspaceBindings).toEqual([
      {
        id: expect.any(String),
        workspaceId: "workspace-a",
        knowledgeSetId: "knowledge-set-1",
        mountType: "reference",
        createdAt: expect.any(String),
        updatedAt: expect.any(String)
      },
      {
        id: expect.any(String),
        workspaceId: "workspace-b",
        knowledgeSetId: "knowledge-set-1",
        mountType: "mirror",
        createdAt: expect.any(String),
        updatedAt: expect.any(String)
      }
    ]);
  });
});
