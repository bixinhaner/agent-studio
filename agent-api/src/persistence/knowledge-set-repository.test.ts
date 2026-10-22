import { describe, expect, it, vi } from "vitest";

import { KnowledgeSetRepository, type KnowledgeSetRepositoryDb } from "./knowledge-set-repository.js";

const row = {
  id: "ks-1",
  organizationId: null,
  name: "Product docs",
  slug: "product-docs",
  description: null,
  status: "active",
  sourceType: "managed_upload",
  rootPath: null,
  storageKey: "product-docs",
  createdAt: new Date("2026-10-01T00:00:00.000Z"),
  updatedAt: new Date("2026-10-02T00:00:00.000Z")
};

describe("KnowledgeSetRepository", () => {
  it("lists set summaries without loading item rows", async () => {
    const itemFindMany = vi.fn(async () => [
      { id: "item-1", knowledgeSetId: "ks-1", kind: "file", relativePath: "a.md", displayName: "a.md", mimeType: null, sizeBytes: null, checksum: null, sourceArchiveName: null, createdAt: row.createdAt, updatedAt: row.updatedAt }
    ]);
    const db = {
      knowledgeSet: { findMany: vi.fn(async () => [row]) },
      knowledgeSetItem: { findMany: itemFindMany }
    } as unknown as KnowledgeSetRepositoryDb;
    const repository = new KnowledgeSetRepository(db);

    const summaries = await repository.listSummaries();
    expect(itemFindMany).not.toHaveBeenCalled();
    expect(summaries).toEqual([
      {
        id: "ks-1",
        organizationId: undefined,
        name: "Product docs",
        slug: "product-docs",
        description: undefined,
        status: "active",
        sourceType: "managed_upload",
        rootPath: undefined,
        storageKey: "product-docs",
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-02T00:00:00.000Z"
      }
    ]);

    const [full] = await repository.list();
    expect(full).toEqual({ ...summaries[0], items: [expect.objectContaining({ relativePath: "a.md" })] });
  });
});
