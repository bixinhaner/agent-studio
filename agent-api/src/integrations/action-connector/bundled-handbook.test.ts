import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "../../../bundled-skills/omc-operations");

type Manifest = {
  schemaVersion: string;
  catalogVersion: string;
  totalOperations: number;
  searchIndex: string;
  categories: Array<{ id: string; count: number; file: string }>;
};

describe("bundled API handbook", () => {
  it("contains a complete progressive operation library", async () => {
    const manifest = JSON.parse(
      await readFile(path.join(skillRoot, "references/manifest.json"), "utf8")
    ) as Manifest;
    const documents = (await readdir(path.join(skillRoot, "references/api-docs"))).filter((name) =>
      name.endsWith(".json")
    );
    const categories = (await readdir(path.join(skillRoot, "references/api-categories"))).filter((name) =>
      name.endsWith(".json")
    );
    const searchLines = (await readFile(path.join(skillRoot, "references", manifest.searchIndex), "utf8"))
      .split("\n")
      .filter((line) => line.trim() !== "");

    expect(manifest.schemaVersion).toBe("1.0");
    expect(manifest.catalogVersion).toMatch(/^[a-f0-9]{16}$/);
    expect(manifest.totalOperations).toBeGreaterThan(500);
    expect(documents).toHaveLength(manifest.totalOperations);
    expect(manifest.searchIndex).toBe("api-index.jsonl");
    expect(searchLines).toHaveLength(manifest.totalOperations);
    expect(categories).toHaveLength(manifest.categories.length);
    expect(manifest.categories.reduce((total, category) => total + category.count, 0)).toBe(
      manifest.totalOperations
    );

    for (const category of manifest.categories) {
      const index = JSON.parse(
        await readFile(path.join(skillRoot, "references", category.file), "utf8")
      ) as { category: string; operations: Array<{ operationId: string; document: string }> };
      expect(index.category).toBe(category.id);
      expect(index.operations).toHaveLength(category.count);
      for (const operation of index.operations) {
        expect(documents).toContain(`${operation.operationId}.json`);
      }
    }
  });

  it("uses local handbook discovery instead of the OMC remote catalog workflow", async () => {
    const skill = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");

    expect(skill).toContain("references/manifest.json");
    expect(skill).toContain("references/api-index.jsonl");
    expect(skill).toContain("references/api-categories");
    expect(skill).toContain("references/api-docs");
    expect(skill).not.toContain("/api/v1/agent/catalog");
    expect(skill).not.toContain('node "$CLI" describe');
  });
});
