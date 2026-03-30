import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { deleteFile, renameFile, scanDirectory } from "./filesystem-knowledge-set-ops.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0, tempRoots.length).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function createTempRoot(): Promise<string> {
  const tempBase = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(tempBase, "knowledge-set-ops-"));
  tempRoots.push(root);
  return root;
}

describe("filesystem knowledge set ops", () => {
  it("scans nested files recursively and returns sorted inventory items", async () => {
    const root = await createTempRoot();
    await fs.mkdir(path.join(root, "guides"), { recursive: true });
    await fs.writeFile(path.join(root, "faq.md"), "# FAQ\n");
    await fs.writeFile(path.join(root, "guides", "intro.txt"), "hello");

    const items = await scanDirectory(root);

    expect(items).toEqual([
      expect.objectContaining({ relativePath: "faq.md", displayName: "faq.md", sizeBytes: BigInt(6) }),
      expect.objectContaining({ relativePath: "guides/intro.txt", displayName: "intro.txt", sizeBytes: BigInt(5) })
    ]);
  });

  it("deletes a file inside the root without removing the root directory", async () => {
    const root = await createTempRoot();
    await fs.writeFile(path.join(root, "faq.md"), "# FAQ\n");

    await deleteFile(root, "faq.md");

    await expect(fs.access(path.join(root, "faq.md"))).rejects.toThrow();
    await expect(fs.access(root)).resolves.toBeUndefined();
  });

  it("renames a file inside the root and preserves nested directories", async () => {
    const root = await createTempRoot();
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.writeFile(path.join(root, "docs", "faq.md"), "# FAQ\n");

    await renameFile(root, "docs/faq.md", "guides/readme.md");

    await expect(fs.access(path.join(root, "docs", "faq.md"))).rejects.toThrow();
    await expect(fs.readFile(path.join(root, "guides", "readme.md"), "utf8")).resolves.toBe("# FAQ\n");
  });

  it("rejects renaming onto an existing target file", async () => {
    const root = await createTempRoot();
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.writeFile(path.join(root, "docs", "faq.md"), "# FAQ\n");
    await fs.writeFile(path.join(root, "docs", "readme.md"), "existing");

    await expect(renameFile(root, "docs/faq.md", "docs/readme.md")).rejects.toThrow("already exists");
    await expect(fs.readFile(path.join(root, "docs", "faq.md"), "utf8")).resolves.toBe("# FAQ\n");
    await expect(fs.readFile(path.join(root, "docs", "readme.md"), "utf8")).resolves.toBe("existing");
  });

  it("rejects delete and rename paths that escape the root", async () => {
    const root = await createTempRoot();
    await fs.writeFile(path.join(root, "faq.md"), "# FAQ\n");

    await expect(deleteFile(root, "../faq.md")).rejects.toThrow("knowledge set path escapes storage root");
    await expect(renameFile(root, "faq.md", "../readme.md")).rejects.toThrow("knowledge set path escapes storage root");
  });

  it("rejects deleting or renaming the root path itself", async () => {
    const root = await createTempRoot();
    await fs.writeFile(path.join(root, "faq.md"), "# FAQ\n");

    await expect(deleteFile(root, ".")).rejects.toThrow("knowledge set file path is invalid");
    await expect(renameFile(root, ".", "next.md")).rejects.toThrow("knowledge set file path is invalid");
  });

  it("does not traverse symlinked paths under the knowledge-set root", async () => {
    const root = await createTempRoot();
    const outside = await createTempRoot();
    await fs.mkdir(path.join(outside, "secret"), { recursive: true });
    await fs.writeFile(path.join(outside, "secret", "data.txt"), "secret");
    await fs.symlink(path.join(outside, "secret"), path.join(root, "linked"));

    await expect(scanDirectory(root)).resolves.toEqual([]);
    await expect(deleteFile(root, "linked/data.txt")).rejects.toThrow("symlinks");
    await expect(renameFile(root, "linked/data.txt", "linked/renamed.txt")).rejects.toThrow("symlinks");
    await expect(fs.readFile(path.join(outside, "secret", "data.txt"), "utf8")).resolves.toBe("secret");
  });

  it("rejects knowledge-set roots whose ancestor path segments are symlinks", async () => {
    const rootParent = await createTempRoot();
    const outside = await createTempRoot();
    await fs.mkdir(path.join(outside, "docs"), { recursive: true });
    await fs.writeFile(path.join(outside, "docs", "data.txt"), "secret");
    await fs.symlink(outside, path.join(rootParent, "linked-root"));
    const root = path.join(rootParent, "linked-root", "docs");

    await expect(scanDirectory(root)).rejects.toThrow("cannot traverse symlinks");
    await expect(deleteFile(root, "data.txt")).rejects.toThrow("cannot traverse symlinks");
    await expect(renameFile(root, "data.txt", "renamed.txt")).rejects.toThrow("cannot traverse symlinks");
  });
});
