import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CodexSkillService } from "./codex-skill-service.js";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const root = path.resolve(process.cwd(), "tmp");
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, "codex-skill-validation-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("CodexSkillService validation", () => {
  it("does not impose Agent Studio-specific file size, total size, or file count limits", async () => {
    const root = await createTemporaryDirectory();
    const skillDirectory = path.join(root, "large-assets-skill");
    const assetsDirectory = path.join(skillDirectory, "assets");
    await fs.mkdir(assetsDirectory, { recursive: true });
    await fs.writeFile(
      path.join(skillDirectory, "SKILL.md"),
      "---\nname: large-assets-skill\ndescription: Use large templates and reference assets.\n---\n\n# Large assets\n"
    );
    await fs.writeFile(path.join(assetsDirectory, "reviewed-template.pdf"), Buffer.alloc(3 * 1024 * 1024));
    await Promise.all(
      Array.from({ length: 81 }, (_, index) =>
        fs.writeFile(path.join(assetsDirectory, `reference-${index}.txt`), "reference")
      )
    );

    const service = new CodexSkillService(
      {} as ConstructorParameters<typeof CodexSkillService>[0],
      { draftRoot: path.join(root, "drafts"), publishedSkillsRoot: path.join(root, "published") }
    );
    const validation = await service.validateSkillDirectory(skillDirectory);

    expect(validation.ok).toBe(true);
    expect(validation.errors).toEqual([]);
    expect(validation.metadata?.fileCount).toBe(83);
    expect(validation.metadata?.totalBytes).toBeGreaterThan(3 * 1024 * 1024);
  });
});
