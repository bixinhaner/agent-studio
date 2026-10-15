import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  collectOffloadGarbage,
  hasOffloadedFiles,
  listOffloadedChecksums,
  markThreadWorkspaceActive,
  offloadObjectPath,
  offloadThreadWorkspace,
  restoreOffloadedThreadFiles,
  type OffloadCandidateLookup
} from "./thread-file-offload.js";

const sha256 = (content: string) => createHash("sha256").update(content).digest("hex");

describe("thread file offload", () => {
  let root: string;
  let workspace: string;
  let storageRoot: string;
  let offloadRoot: string;
  let storage: Map<string, string>;
  let lookup: OffloadCandidateLookup;

  async function writeFile(relative: string, content: string) {
    const target = path.join(workspace, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
    return target;
  }

  async function storeObject(content: string) {
    const checksum = sha256(content);
    const target = path.join(storageRoot, checksum);
    await fs.writeFile(target, content);
    storage.set(checksum, target);
    lookup.sizes.add(Buffer.byteLength(content));
  }

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "thread-offload-"));
    workspace = path.join(root, "sessions", "thread-1");
    storageRoot = path.join(root, "storage");
    offloadRoot = path.join(root, "offload");
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(storageRoot, { recursive: true });
    storage = new Map();
    lookup = { sizes: new Set(), objectForChecksum: (checksum) => storage.get(checksum) };
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("offloads files stored in workspace storage and restores them as independent copies", async () => {
    await storeObject("upload-bytes");
    await storeObject("report-bytes");
    const upload = await writeFile(".agent-studio/uploads/thread-1/a.xlsx", "upload-bytes");
    const report = await writeFile("deliverables/report.pptx", "report-bytes");
    await fs.chmod(report, 0o640);
    const mtime = new Date("2026-01-02T03:04:05Z");
    await fs.utimes(report, mtime, mtime);
    const unrelated = await writeFile("notes.txt", "not-in-storage");
    // Excluded locations, even when the bytes are in storage.
    const derived = await writeFile("workspace-files/report.pptx", "report-bytes");
    const scratch = await writeFile(".agent-studio/tmp/copy.pptx", "report-bytes");

    const preview = await offloadThreadWorkspace({ workspace, offloadRoot, lookup, minBytes: 1, dryRun: true });
    expect(preview).toMatchObject({ files: 2 });
    expect(await hasOffloadedFiles(workspace)).toBe(false);
    await expect(fs.stat(upload)).resolves.toBeTruthy();

    const result = await offloadThreadWorkspace({ workspace, offloadRoot, lookup, minBytes: 1, dryRun: false });
    expect(result).toMatchObject({ files: 2, bytes: 24 });
    await expect(fs.stat(upload)).rejects.toThrow();
    await expect(fs.stat(report)).rejects.toThrow();
    for (const kept of [unrelated, derived, scratch]) await expect(fs.stat(kept)).resolves.toBeTruthy();
    expect((await listOffloadedChecksums(workspace)).sort()).toEqual([sha256("upload-bytes"), sha256("report-bytes")].sort());
    // The store object shares the storage inode instead of using new space.
    const object = await fs.stat(offloadObjectPath(offloadRoot, sha256("report-bytes")));
    expect(object.ino).toBe((await fs.stat(storage.get(sha256("report-bytes"))!)).ino);

    expect(await restoreOffloadedThreadFiles(workspace, offloadRoot)).toEqual({ restored: 2, skippedExisting: 0, missingObjects: 0 });
    expect(await fs.readFile(upload, "utf8")).toBe("upload-bytes");
    const restored = await fs.stat(report);
    expect(restored.mode & 0o777).toBe(0o640);
    expect(restored.mtime.getTime()).toBe(mtime.getTime());
    expect(restored.ino).not.toBe(object.ino);
    expect(await hasOffloadedFiles(workspace)).toBe(false);

    // Editing the restored copy must not touch storage.
    await fs.writeFile(report, "edited");
    expect(await fs.readFile(storage.get(sha256("report-bytes"))!, "utf8")).toBe("report-bytes");
  });

  it("skips small, hard-linked and unknown files", async () => {
    await storeObject("tiny");
    await storeObject("linked-bytes");
    await writeFile("tiny.txt", "tiny");
    const linked = await writeFile("linked.txt", "linked-bytes");
    await fs.link(linked, path.join(root, "other-link"));
    await writeFile("same-size.txt", "linkedXbytes");

    const result = await offloadThreadWorkspace({ workspace, offloadRoot, lookup, minBytes: 5, dryRun: false });
    expect(result.files).toBe(0);
    expect(await hasOffloadedFiles(workspace)).toBe(false);
  });

  it("leaves workspaces nested in a legacy shared directory alone", async () => {
    await storeObject("own-upload");
    await storeObject("nested-upload");
    const own = await writeFile(".agent-studio/uploads/t1/a.pdf", "own-upload");
    const nested = await writeFile("thread-2/.agent-studio/uploads/t2/b.pdf", "nested-upload");

    const result = await offloadThreadWorkspace({
      workspace,
      excludeDirs: [path.join(workspace, "thread-2")],
      offloadRoot,
      lookup,
      minBytes: 1,
      dryRun: false
    });
    expect(result.files).toBe(1);
    await expect(fs.stat(own)).rejects.toThrow();
    expect(await fs.readFile(nested, "utf8")).toBe("nested-upload");
  });

  it("keeps files it cannot remove and drops them from the manifest", async () => {
    await storeObject("removable");
    await storeObject("protected");
    const removable = await writeFile("a.txt", "removable");
    const protectedFile = await writeFile("locked/b.txt", "protected");
    await fs.chmod(path.dirname(protectedFile), 0o555);
    try {
      const result = await offloadThreadWorkspace({ workspace, offloadRoot, lookup, minBytes: 1, dryRun: false });
      expect(result.files).toBe(1);
      await expect(fs.stat(removable)).rejects.toThrow();
      expect(await fs.readFile(protectedFile, "utf8")).toBe("protected");
      expect(await listOffloadedChecksums(workspace)).toEqual([sha256("removable")]);
    } finally {
      await fs.chmod(path.dirname(protectedFile), 0o755);
    }
  });

  it("keeps a file recreated after offload and reports missing objects without failing", async () => {
    await storeObject("first");
    await storeObject("second");
    const first = await writeFile("a.txt", "first");
    const second = await writeFile("b.txt", "second");
    await offloadThreadWorkspace({ workspace, offloadRoot, lookup, minBytes: 1, dryRun: false });

    await fs.writeFile(first, "user rewrote it");
    await fs.rm(offloadObjectPath(offloadRoot, sha256("second")));

    expect(await restoreOffloadedThreadFiles(workspace, offloadRoot)).toEqual({ restored: 0, skippedExisting: 1, missingObjects: 1 });
    expect(await fs.readFile(first, "utf8")).toBe("user rewrote it");
    await expect(fs.stat(second)).rejects.toThrow();
    // Only the lost record remains; nothing is left to restore.
    expect(await listOffloadedChecksums(workspace)).toEqual([]);
    const manifest = JSON.parse(await fs.readFile(path.join(workspace, ".agent-studio", "offloaded-files.json"), "utf8"));
    expect(manifest.lost).toHaveLength(1);
  });

  it("is a no-op restore without a manifest and waits for a held lock", async () => {
    expect(await restoreOffloadedThreadFiles(workspace, offloadRoot)).toEqual({ restored: 0, skippedExisting: 0, missingObjects: 0 });

    await storeObject("locked");
    const file = await writeFile("c.txt", "locked");
    await offloadThreadWorkspace({ workspace, offloadRoot, lookup, minBytes: 1, dryRun: false });
    const lock = path.join(workspace, ".agent-studio", "offload.lock");
    await fs.mkdir(lock);
    const restoring = restoreOffloadedThreadFiles(workspace, offloadRoot);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await expect(fs.stat(file)).rejects.toThrow();
    await fs.rm(lock, { recursive: true });
    expect((await restoring).restored).toBe(1);
    expect(await fs.readFile(file, "utf8")).toBe("locked");
  });

  it("collects only unreferenced store objects", async () => {
    await storeObject("kept");
    await storeObject("dropped");
    await writeFile("kept.txt", "kept");
    await writeFile("dropped.txt", "dropped");
    await offloadThreadWorkspace({ workspace, offloadRoot, lookup, minBytes: 1, dryRun: false });
    const referenced = new Set([sha256("kept")]);

    expect(await collectOffloadGarbage(offloadRoot, referenced, true)).toEqual({ removed: 1, bytes: 0 });
    await expect(fs.stat(offloadObjectPath(offloadRoot, sha256("dropped")))).resolves.toBeTruthy();
    await collectOffloadGarbage(offloadRoot, referenced, false);
    await expect(fs.stat(offloadObjectPath(offloadRoot, sha256("dropped")))).rejects.toThrow();
    await expect(fs.stat(offloadObjectPath(offloadRoot, sha256("kept")))).resolves.toBeTruthy();
  });

  it("writes the activity marker", async () => {
    await markThreadWorkspaceActive(workspace);
    await expect(fs.stat(path.join(workspace, ".agent-studio", "last-active"))).resolves.toBeTruthy();
  });
});
