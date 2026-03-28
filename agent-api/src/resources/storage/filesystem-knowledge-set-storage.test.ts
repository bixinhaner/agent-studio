import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";

import { FilesystemKnowledgeSetStorage } from "./filesystem-knowledge-set-storage.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0, tempRoots.length).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

describe("FilesystemKnowledgeSetStorage", () => {
  it("saves a batch of files and returns normalized inventory", async () => {
    const rootDir = await createTempRoot();
    const storage = new FilesystemKnowledgeSetStorage(rootDir);
    await fs.mkdir(storage.resolveReadableMountPath("ks-1"), { recursive: true });
    await fs.writeFile(path.join(storage.resolveReadableMountPath("ks-1"), "stale.txt"), "stale");

    const result = await storage.saveFiles({
      knowledgeSetId: "ks-1",
      files: [
        { name: " ./faq.md ", buffer: Buffer.from("# FAQ\n"), mimeType: "text/markdown" },
        { name: "guide\\intro.txt", buffer: Buffer.from("intro"), mimeType: "text/plain" }
      ]
    });

    expect(result.mountPath).toBe(storage.resolveReadableMountPath("ks-1"));
    expect(result.items).toEqual([
      {
        kind: "file",
        relativePath: "faq.md",
        displayName: "faq.md",
        mimeType: "text/markdown",
        sizeBytes: 6n,
        checksum: undefined,
        sourceArchiveName: undefined
      },
      {
        kind: "file",
        relativePath: "guide/intro.txt",
        displayName: "intro.txt",
        mimeType: "text/plain",
        sizeBytes: 5n,
        checksum: undefined,
        sourceArchiveName: undefined
      }
    ]);
    await expect(fs.readFile(path.join(result.mountPath, "faq.md"), "utf8")).resolves.toBe("# FAQ\n");
    await expect(fs.readFile(path.join(result.mountPath, "guide", "intro.txt"), "utf8")).resolves.toBe("intro");
    await expect(fs.access(path.join(result.mountPath, "stale.txt"))).rejects.toThrow();
  });

  it("expands a zip archive and returns a normalized item inventory", async () => {
    const rootDir = await createTempRoot();
    const storage = new FilesystemKnowledgeSetStorage(rootDir);

    const result = await storage.extractArchive({
      knowledgeSetId: "ks-1",
      archiveName: "docs.zip",
      buffer: Buffer.from(
        zipSync({
          "guide/readme.md": strToU8("# Readme\n"),
          "faq/usage.txt": strToU8("usage")
        })
      )
    });

    expect(result.mountPath).toBe(storage.resolveReadableMountPath("ks-1"));
    expect(result.items).toEqual([
      {
        kind: "file",
        relativePath: "faq/usage.txt",
        displayName: "usage.txt",
        mimeType: undefined,
        sizeBytes: 5n,
        checksum: undefined,
        sourceArchiveName: "docs.zip"
      },
      {
        kind: "file",
        relativePath: "guide/readme.md",
        displayName: "readme.md",
        mimeType: undefined,
        sizeBytes: 9n,
        checksum: undefined,
        sourceArchiveName: "docs.zip"
      }
    ]);
    await expect(fs.readFile(path.join(result.mountPath, "guide", "readme.md"), "utf8")).resolves.toBe("# Readme\n");
    await expect(fs.readFile(path.join(result.mountPath, "faq", "usage.txt"), "utf8")).resolves.toBe("usage");
  });

  it("rejects duplicate normalized paths during batch save", async () => {
    const rootDir = await createTempRoot();
    const storage = new FilesystemKnowledgeSetStorage(rootDir);

    await expect(
      storage.saveFiles({
        knowledgeSetId: "ks-1",
        files: [
          { name: "./faq.md", buffer: Buffer.from("first") },
          { name: "docs/../faq.md", buffer: Buffer.from("second") }
        ]
      })
    ).rejects.toThrow(/duplicate/i);

    await expect(fs.access(path.join(storage.resolveReadableMountPath("ks-1"), "faq.md"))).rejects.toThrow();
  });

  it("rejects duplicate normalized paths during archive extraction", async () => {
    const rootDir = await createTempRoot();
    const storage = new FilesystemKnowledgeSetStorage(rootDir);

    await expect(
      storage.extractArchive({
        knowledgeSetId: "ks-1",
        archiveName: "duplicate.zip",
        buffer: Buffer.from(
          zipSync({
            "./faq.md": strToU8("first"),
            "docs/../faq.md": strToU8("second")
          })
        )
      })
    ).rejects.toThrow(/duplicate/i);

    await expect(fs.access(path.join(storage.resolveReadableMountPath("ks-1"), "faq.md"))).rejects.toThrow();
  });

  it("rejects archive entries that escape the knowledge-set root", async () => {
    const rootDir = await createTempRoot();
    const storage = new FilesystemKnowledgeSetStorage(rootDir);

    await expect(
      storage.extractArchive({
        knowledgeSetId: "ks-1",
        archiveName: "bad.zip",
        buffer: Buffer.from(
          zipSync({
            "../evil.txt": strToU8("bad"),
            "docs/good.txt": strToU8("good")
          })
        )
      })
    ).rejects.toThrow(/path/i);

    await expect(fs.access(path.join(rootDir, "evil.txt"))).rejects.toThrow();
    await expect(fs.access(path.join(storage.resolveReadableMountPath("ks-1"), "docs", "good.txt"))).rejects.toThrow();
  });
});

async function createTempRoot(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "knowledge-set-storage-"));
  tempRoots.push(dir);
  return dir;
}
