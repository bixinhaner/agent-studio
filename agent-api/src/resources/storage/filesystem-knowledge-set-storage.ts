import fs from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";

import type { KnowledgeSetStorage, KnowledgeSetStorageItem, KnowledgeSetStorageResult } from "./knowledge-set-storage.js";

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeRelativePath(input: string): string {
  const trimmed = trimOrUndefined(input);
  if (!trimmed) {
    throw new Error("knowledge set path is required");
  }
  const normalized = path.posix.normalize(trimmed.replaceAll("\\", "/"));
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("\0")) {
    throw new Error("knowledge set path is invalid");
  }
  if (path.posix.isAbsolute(normalized)) {
    throw new Error("knowledge set path is invalid");
  }
  return normalized;
}

function ensureInsideRoot(rootDir: string, candidate: string): string {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    return resolvedCandidate;
  }
  throw new Error("knowledge set path escapes storage root");
}

function normalizeKnowledgeSetStorageKey(knowledgeSetStorageKey: string): string {
  const normalized = trimOrUndefined(knowledgeSetStorageKey);
  if (!normalized) {
    throw new Error("knowledgeSetStorageKey is required");
  }
  if (normalized === "." || normalized === ".." || normalized.includes("/") || normalized.includes("\\") || normalized.includes("\0")) {
    throw new Error("knowledgeSetStorageKey is invalid");
  }
  return normalized;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function sortItems(items: KnowledgeSetStorageItem[]): KnowledgeSetStorageItem[] {
  return [...items].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function assertUniqueRelativePath(relativePath: string, seenPaths: Set<string>): void {
  if (seenPaths.has(relativePath)) {
    throw new Error(`duplicate knowledge set path: ${relativePath}`);
  }
  seenPaths.add(relativePath);
}

export class FilesystemKnowledgeSetStorage implements KnowledgeSetStorage {
  constructor(private readonly rootDir: string) {}

  async deleteKnowledgeSetData(knowledgeSetStorageKey: string): Promise<void> {
    const mountPath = this.resolveReadableMountPath(knowledgeSetStorageKey);
    await fs.rm(mountPath, { recursive: true, force: true });
  }

  resolveReadableMountPath(knowledgeSetStorageKey: string): string {
    const normalizedKnowledgeSetStorageKey = normalizeKnowledgeSetStorageKey(knowledgeSetStorageKey);
    return ensureInsideRoot(this.rootDir, path.join(this.rootDir, normalizedKnowledgeSetStorageKey));
  }

  async saveFiles(input: {
    knowledgeSetStorageKey: string;
    files: Array<{ name: string; buffer: Buffer; mimeType?: string }>;
  }): Promise<KnowledgeSetStorageResult> {
    const mountPath = this.resolveReadableMountPath(input.knowledgeSetStorageKey);
    await fs.mkdir(this.rootDir, { recursive: true });
    const stagingDir = await fs.mkdtemp(path.join(this.rootDir, ".staging-"));

    try {
      const items: KnowledgeSetStorageItem[] = [];
      const seenPaths = new Set<string>();
      for (const file of input.files) {
        const relativePath = normalizeRelativePath(file.name);
        assertUniqueRelativePath(relativePath, seenPaths);
        const targetPath = ensureInsideRoot(stagingDir, path.join(stagingDir, relativePath));
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, file.buffer);
        items.push({
          kind: "file",
          relativePath,
          displayName: path.posix.basename(relativePath),
          mimeType: trimOrUndefined(file.mimeType),
          sizeBytes: BigInt(file.buffer.length),
          checksum: undefined,
          sourceArchiveName: undefined
        });
      }
      await this.commitStagingDir(stagingDir, mountPath);
      return { mountPath, items: sortItems(items) };
    } catch (error) {
      await fs.rm(stagingDir, { recursive: true, force: true });
      throw error;
    }
  }

  async extractArchive(input: {
    knowledgeSetStorageKey: string;
    archiveName: string;
    buffer: Buffer;
  }): Promise<KnowledgeSetStorageResult> {
    const mountPath = this.resolveReadableMountPath(input.knowledgeSetStorageKey);
    await fs.mkdir(this.rootDir, { recursive: true });
    const stagingDir = await fs.mkdtemp(path.join(this.rootDir, ".staging-"));

    try {
      const archiveEntries = unzipSync(new Uint8Array(input.buffer));
      const items: KnowledgeSetStorageItem[] = [];
      const seenPaths = new Set<string>();
      for (const [entryName, content] of Object.entries(archiveEntries)) {
        if (entryName.endsWith("/")) {
          continue;
        }
        const relativePath = normalizeRelativePath(entryName);
        assertUniqueRelativePath(relativePath, seenPaths);
        const targetPath = ensureInsideRoot(stagingDir, path.join(stagingDir, relativePath));
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, Buffer.from(content));
        items.push({
          kind: "file",
          relativePath,
          displayName: path.posix.basename(relativePath),
          mimeType: undefined,
          sizeBytes: BigInt(content.byteLength),
          checksum: undefined,
          sourceArchiveName: trimOrUndefined(input.archiveName)
        });
      }
      await this.commitStagingDir(stagingDir, mountPath);
      return { mountPath, items: sortItems(items) };
    } catch (error) {
      await fs.rm(stagingDir, { recursive: true, force: true });
      throw error;
    }
  }

  private async commitStagingDir(stagingDir: string, mountPath: string): Promise<void> {
    const backupParent = await fs.mkdtemp(path.join(this.rootDir, ".backup-"));
    const backupPath = path.join(backupParent, "previous");
    const hasExistingMount = await pathExists(mountPath);

    try {
      if (hasExistingMount) {
        await fs.rename(mountPath, backupPath);
      }

      try {
        await fs.rename(stagingDir, mountPath);
      } catch (error) {
        if (hasExistingMount && (await pathExists(backupPath))) {
          await fs.rename(backupPath, mountPath);
        }
        throw error;
      }

      await fs.rm(backupParent, { recursive: true, force: true });
    } catch (error) {
      await fs.rm(backupParent, { recursive: true, force: true });
      throw error;
    }
  }
}
