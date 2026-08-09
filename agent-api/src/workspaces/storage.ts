import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type StoredWorkspaceObject = {
  storageKey: string;
  absolutePath: string;
  sizeBytes: number;
  checksum: string;
};

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

export function normalizeWorkspaceStorageKey(value: string): string {
  const raw = String(value || "").replace(/\\/g, "/").trim();
  if (!raw || raw.startsWith("/") || raw.includes("\0")) {
    throw new Error("Workspace storage key is invalid");
  }
  const segments = raw.split("/").filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Workspace storage key is invalid");
  }
  return segments.join("/");
}

export function workspaceObjectChecksum(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export class LocalFsWorkspaceStorage {
  readonly rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = path.resolve(rootPath);
  }

  resolve(storageKey: string): string {
    const normalized = normalizeWorkspaceStorageKey(storageKey);
    const candidate = path.resolve(this.rootPath, ...normalized.split("/"));
    if (!isPathInside(this.rootPath, candidate)) {
      throw new Error("Workspace storage key escapes the configured root");
    }
    return candidate;
  }

  async ensureReady(): Promise<void> {
    await fs.mkdir(this.rootPath, { recursive: true, mode: 0o750 });
  }

  async putImmutable(storageKey: string, content: Buffer): Promise<StoredWorkspaceObject> {
    await this.ensureReady();
    const normalized = normalizeWorkspaceStorageKey(storageKey);
    const absolutePath = this.resolve(normalized);
    const checksum = workspaceObjectChecksum(content);
    const existing = await fs.lstat(absolutePath).catch(() => null);
    if (existing) {
      if (!existing.isFile() || existing.isSymbolicLink()) {
        throw new Error("Workspace storage target is not a regular file");
      }
      const current = await fs.readFile(absolutePath);
      const currentChecksum = workspaceObjectChecksum(current);
      if (currentChecksum !== checksum) {
        throw new Error("Workspace immutable object already exists with different content");
      }
      return {
        storageKey: normalized,
        absolutePath,
        sizeBytes: current.length,
        checksum: currentChecksum
      };
    }

    await fs.mkdir(path.dirname(absolutePath), { recursive: true, mode: 0o750 });
    const temporaryPath = `${absolutePath}.tmp-${randomUUID()}`;
    await fs.writeFile(temporaryPath, content, { flag: "wx", mode: 0o640 });
    await fs.rename(temporaryPath, absolutePath);
    return {
      storageKey: normalized,
      absolutePath,
      sizeBytes: content.length,
      checksum
    };
  }

  async importLegacyFile(input: {
    sourcePath: string;
    allowedRoots: string[];
    storageKey: string;
  }): Promise<StoredWorkspaceObject> {
    const sourceLinkStat = await fs.lstat(input.sourcePath);
    if (sourceLinkStat.isSymbolicLink()) {
      throw new Error("Legacy workspace source must be a regular unlinked file");
    }
    const sourceRealPath = await fs.realpath(input.sourcePath);
    const allowedRealRoots = await Promise.all(
      input.allowedRoots.map(async (root) => fs.realpath(root).catch(() => path.resolve(root)))
    );
    if (!allowedRealRoots.some((root) => isPathInside(root, sourceRealPath))) {
      throw new Error("Legacy workspace file is outside the allowed roots");
    }
    const stat = await fs.lstat(sourceRealPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) {
      throw new Error("Legacy workspace source must be a regular unlinked file");
    }
    return this.putImmutable(input.storageKey, await fs.readFile(sourceRealPath));
  }

  async read(storageKey: string): Promise<Buffer> {
    const absolutePath = this.resolve(storageKey);
    const stat = await fs.lstat(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("Workspace object is not a regular file");
    }
    const realPath = await fs.realpath(absolutePath);
    if (!isPathInside(this.rootPath, realPath)) {
      throw new Error("Workspace object escapes the configured root");
    }
    return fs.readFile(realPath);
  }

  async stat(storageKey: string): Promise<{ sizeBytes: number }> {
    const absolutePath = this.resolve(storageKey);
    const stat = await fs.lstat(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("Workspace object is not a regular file");
    }
    return { sizeBytes: stat.size };
  }

  async remove(storageKey: string): Promise<void> {
    const absolutePath = this.resolve(storageKey);
    const stat = await fs.lstat(absolutePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!stat) return;
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("Workspace object is not a regular file");
    }
    await fs.unlink(absolutePath);
  }
}
