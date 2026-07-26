import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalFsWorkspaceStorage, normalizeWorkspaceStorageKey } from "./storage.js";

let testRoot = "";

beforeEach(async () => {
  const base = path.resolve(process.cwd(), "temp");
  await fs.mkdir(base, { recursive: true });
  testRoot = await fs.mkdtemp(path.join(base, "workspace-storage-test-"));
});

afterEach(async () => {
  if (testRoot) {
    await fs.rm(testRoot, { recursive: true, force: true });
  }
});

describe("normalizeWorkspaceStorageKey", () => {
  it("normalizes portable relative keys", () => {
    expect(normalizeWorkspaceStorageKey("files\\workspace\\file.txt")).toBe("files/workspace/file.txt");
  });

  it.each(["", "/etc/passwd", "../secret", "folder/../secret", "folder/./file"])(
    "rejects unsafe key %s",
    (value) => {
      expect(() => normalizeWorkspaceStorageKey(value)).toThrow(/invalid/);
    }
  );
});

describe("LocalFsWorkspaceStorage", () => {
  it("writes and reads immutable objects", async () => {
    const storage = new LocalFsWorkspaceStorage(testRoot);
    const saved = await storage.putImmutable("user-workspaces/a/files/b/v1.txt", Buffer.from("hello"));
    expect(saved.sizeBytes).toBe(5);
    expect(await storage.read(saved.storageKey)).toEqual(Buffer.from("hello"));
    await expect(storage.putImmutable(saved.storageKey, Buffer.from("changed"))).rejects.toThrow(/different content/);
  });

  it("rejects symlink sources during legacy import", async () => {
    const sourceRoot = path.join(testRoot, "source");
    const targetRoot = path.join(testRoot, "target");
    await fs.mkdir(sourceRoot, { recursive: true });
    await fs.writeFile(path.join(sourceRoot, "real.txt"), "hello");
    await fs.symlink(path.join(sourceRoot, "real.txt"), path.join(sourceRoot, "link.txt"));
    const storage = new LocalFsWorkspaceStorage(targetRoot);
    await expect(
      storage.importLegacyFile({
        sourcePath: path.join(sourceRoot, "link.txt"),
        allowedRoots: [sourceRoot],
        storageKey: "files/imported.txt"
      })
    ).rejects.toThrow(/regular unlinked file/);
  });

  it("rejects legacy sources outside allowed roots", async () => {
    const allowedRoot = path.join(testRoot, "allowed");
    const otherRoot = path.join(testRoot, "other");
    await fs.mkdir(allowedRoot, { recursive: true });
    await fs.mkdir(otherRoot, { recursive: true });
    const sourcePath = path.join(otherRoot, "file.txt");
    await fs.writeFile(sourcePath, "hello");
    const storage = new LocalFsWorkspaceStorage(path.join(testRoot, "target"));
    await expect(
      storage.importLegacyFile({
        sourcePath,
        allowedRoots: [allowedRoot],
        storageKey: "files/imported.txt"
      })
    ).rejects.toThrow(/outside the allowed roots/);
  });
});
