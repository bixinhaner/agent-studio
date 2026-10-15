import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

// Thread workspaces keep their own copy of every portal upload and published deliverable,
// although the same bytes already live in immutable user-workspace storage. For idle threads
// those copies are offloaded: the storage object is hard-linked into a content-addressed store
// (no extra space, and it survives the user later purging the workspace file), the thread copy
// is removed, and a manifest in the thread records how to put it back. Restoring copies (never
// links) the object back, so agents can edit restored files in place without touching storage.

const MANIFEST_SEGMENTS = [".agent-studio", "offloaded-files.json"];
const LOCK_SEGMENTS = [".agent-studio", "offload.lock"];
const LOCK_STALE_MS = 10 * 60 * 1000;
// Regenerated or agent-managed directories that are never offloaded.
const SKIPPED_TOP_LEVEL = new Set(["workspace-files", "node_modules"]);
const OFFLOADABLE_AGENT_STUDIO_DIRS = new Set(["uploads"]);

export type OffloadedFileEntry = {
  path: string;
  sha256: string;
  size: number;
  mode: number;
  mtimeMs: number;
  offloadedAt: string;
};

type OffloadManifest = {
  version: 1;
  entries: OffloadedFileEntry[];
  lost?: Array<{ path: string; sha256: string; lostAt: string }>;
};

export type RestoreResult = { restored: number; skippedExisting: number; missingObjects: number };

export type OffloadCandidateLookup = {
  sizes: Set<number>;
  // Absolute path of an immutable storage object with this sha256, if one exists.
  objectForChecksum: (sha256: string) => string | undefined;
};

export type OffloadResult = { files: number; bytes: number; hashed: number };

function manifestPath(workspace: string): string {
  return path.join(workspace, ...MANIFEST_SEGMENTS);
}

export function offloadObjectPath(offloadRoot: string, sha256: string): string {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Invalid offload checksum");
  return path.join(offloadRoot, "objects", sha256.slice(0, 2), sha256);
}

function isInside(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalized = path.resolve(candidate);
  return normalized.startsWith(`${normalizedRoot}${path.sep}`);
}

function resolveEntryPath(workspace: string, relativePath: string): string {
  const target = path.resolve(workspace, ...relativePath.split("/"));
  if (!isInside(workspace, target)) throw new Error(`Offloaded path escapes the workspace: ${relativePath}`);
  return target;
}

async function withLock<T>(workspace: string, run: () => Promise<T>): Promise<T> {
  const lockPath = path.join(workspace, ...LOCK_SEGMENTS);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const startedAt = Date.now();
  while (true) {
    try {
      await fs.mkdir(lockPath);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const stat = await fs.stat(lockPath).catch(() => undefined);
      if (stat && Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        await fs.rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
        continue;
      }
      if (Date.now() - startedAt > LOCK_STALE_MS) throw new Error(`Timed out waiting for offload lock: ${lockPath}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  try {
    return await run();
  } finally {
    await fs.rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function readManifest(workspace: string): Promise<OffloadManifest | undefined> {
  const content = await fs.readFile(manifestPath(workspace), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (content === undefined) return undefined;
  const parsed = JSON.parse(content) as Partial<OffloadManifest>;
  return {
    version: 1,
    entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    ...(Array.isArray(parsed.lost) && parsed.lost.length ? { lost: parsed.lost } : {})
  };
}

async function writeManifest(workspace: string, manifest: OffloadManifest): Promise<void> {
  const target = manifestPath(workspace);
  if (manifest.entries.length === 0 && !manifest.lost?.length) {
    await fs.rm(target, { force: true });
    return;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o640 });
  await fs.rename(temporary, target);
}

// The thread cleanup job judges idleness by file mtimes; chat-only turns may not write any file.
export async function markThreadWorkspaceActive(workspace: string): Promise<void> {
  const marker = path.join(workspace, ".agent-studio", "last-active");
  await fs.mkdir(path.dirname(marker), { recursive: true });
  await fs.writeFile(marker, `${new Date().toISOString()}\n`);
}

export async function hasOffloadedFiles(workspace: string): Promise<boolean> {
  return Boolean(await fs.lstat(manifestPath(workspace)).catch(() => undefined));
}

export async function listOffloadedChecksums(workspace: string): Promise<string[]> {
  const manifest = await readManifest(workspace).catch(() => undefined);
  return manifest?.entries.map((entry) => entry.sha256) ?? [];
}

// Puts every offloaded file of the workspace back. Cheap when nothing was offloaded (one lstat).
export async function restoreOffloadedThreadFiles(workspace: string, offloadRoot: string): Promise<RestoreResult> {
  const result: RestoreResult = { restored: 0, skippedExisting: 0, missingObjects: 0 };
  if (!(await hasOffloadedFiles(workspace))) return result;
  return withLock(workspace, async () => {
    const manifest = await readManifest(workspace);
    if (!manifest) return result;
    const lost = [...(manifest.lost ?? [])];
    for (const [index, entry] of manifest.entries.entries()) {
      const target = resolveEntryPath(workspace, entry.path);
      if (await fs.lstat(target).catch(() => undefined)) {
        // Recreated since it was offloaded; the newer file wins.
        result.skippedExisting += 1;
        continue;
      }
      const object = offloadObjectPath(offloadRoot, entry.sha256);
      if (!(await fs.stat(object).catch(() => undefined))) {
        result.missingObjects += 1;
        lost.push({ path: entry.path, sha256: entry.sha256, lostAt: new Date().toISOString() });
        continue;
      }
      const temporary = `${target}.restore-${process.pid}-${Date.now()}`;
      try {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(object, temporary);
        await fs.chmod(temporary, entry.mode & 0o777);
        const mtime = new Date(entry.mtimeMs);
        await fs.utimes(temporary, mtime, mtime);
        await fs.rename(temporary, target);
        result.restored += 1;
      } catch (error) {
        await fs.rm(temporary, { force: true }).catch(() => undefined);
        // Keep this and later entries so the next request retries them.
        await writeManifest(workspace, {
          version: 1,
          entries: manifest.entries.slice(index),
          ...(lost.length ? { lost } : {})
        });
        throw error;
      }
    }
    await writeManifest(workspace, { version: 1, entries: [], ...(lost.length ? { lost } : {}) });
    return result;
  });
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function* offloadableFiles(
  workspace: string,
  excludeDirs: ReadonlySet<string>,
  relative = ""
): AsyncGenerator<string> {
  const directory = relative ? path.join(workspace, ...relative.split("/")) : workspace;
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    if (!relative && SKIPPED_TOP_LEVEL.has(entry.name)) continue;
    if (relative === ".agent-studio" && !OFFLOADABLE_AGENT_STUDIO_DIRS.has(entry.name)) continue;
    if (entry.isDirectory()) {
      if (excludeDirs.has(path.join(directory, entry.name))) continue;
      yield* offloadableFiles(workspace, excludeDirs, childRelative);
    } else if (entry.isFile()) {
      yield childRelative;
    }
  }
}

async function ensureObject(offloadRoot: string, sha256: string, source: string, size: number): Promise<void> {
  const object = offloadObjectPath(offloadRoot, sha256);
  const existing = await fs.stat(object).catch(() => undefined);
  if (existing) {
    if (existing.size !== size) throw new Error(`Offload object size mismatch: ${object}`);
    return;
  }
  await fs.mkdir(path.dirname(object), { recursive: true, mode: 0o750 });
  try {
    await fs.link(source, object);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return;
    if (code !== "EXDEV" && code !== "EPERM") throw error;
    const temporary = `${object}.tmp-${process.pid}`;
    await fs.copyFile(source, temporary);
    await fs.rename(temporary, object);
  }
  const linked = await fs.stat(object);
  if (linked.size !== size) throw new Error(`Offload object size mismatch: ${object}`);
}

// Offloads files of one idle thread workspace whose bytes already exist as a storage object.
// excludeDirs: absolute paths of other workspaces nested inside this one (legacy shared agent dirs).
export async function offloadThreadWorkspace(input: {
  workspace: string;
  excludeDirs?: string[];
  offloadRoot: string;
  lookup: OffloadCandidateLookup;
  minBytes: number;
  dryRun: boolean;
}): Promise<OffloadResult> {
  const workspace = path.resolve(input.workspace);
  const result: OffloadResult = { files: 0, bytes: 0, hashed: 0 };
  const run = async () => {
    const found: Array<{ entry: OffloadedFileEntry; absolute: string; source: string }> = [];
    const excludeDirs = new Set((input.excludeDirs ?? []).map((directory) => path.resolve(directory)));
    for await (const relative of offloadableFiles(workspace, excludeDirs)) {
      const absolute = path.join(workspace, ...relative.split("/"));
      const stat = await fs.lstat(absolute).catch(() => undefined);
      if (!stat?.isFile() || stat.nlink > 1 || stat.size < input.minBytes || !input.lookup.sizes.has(stat.size)) continue;
      const sha256 = await sha256File(absolute);
      result.hashed += 1;
      const source = input.lookup.objectForChecksum(sha256);
      if (!source) continue;
      const sourceStat = await fs.stat(source).catch(() => undefined);
      if (!sourceStat?.isFile() || sourceStat.size !== stat.size) continue;
      found.push({
        entry: {
          path: relative,
          sha256,
          size: stat.size,
          mode: stat.mode & 0o777,
          mtimeMs: stat.mtimeMs,
          offloadedAt: new Date().toISOString()
        },
        absolute,
        source
      });
    }
    if (input.dryRun) {
      for (const item of found) {
        result.files += 1;
        result.bytes += item.entry.size;
      }
      return result;
    }
    const offloaded: OffloadedFileEntry[] = [];
    for (const item of found) {
      await ensureObject(input.offloadRoot, item.entry.sha256, item.source, item.entry.size);
      offloaded.push(item.entry);
    }
    if (offloaded.length === 0) return result;
    // Record before deleting: a crash in between leaves files that restore simply skips.
    const manifest = (await readManifest(workspace)) ?? { version: 1 as const, entries: [] };
    manifest.entries.push(...offloaded);
    await writeManifest(workspace, manifest);
    const removedPaths = new Set<string>();
    for (const item of found) {
      const current = await fs.lstat(item.absolute).catch(() => undefined);
      // Keep files that changed after hashing; drop their manifest entry below.
      if (!current?.isFile() || current.size !== item.entry.size || current.mtimeMs !== item.entry.mtimeMs) continue;
      await fs.rm(item.absolute, { force: true });
      removedPaths.add(item.entry.path);
      result.files += 1;
      result.bytes += item.entry.size;
    }
    if (removedPaths.size !== offloaded.length) {
      manifest.entries = manifest.entries.filter(
        (entry) => !offloaded.includes(entry) || removedPaths.has(entry.path)
      );
      await writeManifest(workspace, manifest);
    }
    return result;
  };
  return withLock(workspace, run);
}

// Removes store objects that no manifest references any more.
export async function collectOffloadGarbage(offloadRoot: string, referenced: Set<string>, dryRun: boolean): Promise<{
  removed: number;
  bytes: number;
}> {
  const result = { removed: 0, bytes: 0 };
  const objectsRoot = path.join(offloadRoot, "objects");
  for (const prefix of await fs.readdir(objectsRoot).catch(() => [] as string[])) {
    const directory = path.join(objectsRoot, prefix);
    for (const name of await fs.readdir(directory).catch(() => [] as string[])) {
      if (referenced.has(name)) continue;
      const object = path.join(directory, name);
      const stat = await fs.lstat(object).catch(() => undefined);
      if (!stat?.isFile()) continue;
      // Only the store's own link holds the data when nlink is 1.
      if (stat.nlink === 1) result.bytes += stat.size;
      result.removed += 1;
      if (!dryRun) await fs.rm(object, { force: true });
    }
  }
  return result;
}
