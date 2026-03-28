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

function normalizeKnowledgeSetId(knowledgeSetId: string): string {
  const normalized = trimOrUndefined(knowledgeSetId);
  if (!normalized) {
    throw new Error("knowledgeSetId is required");
  }
  return normalized;
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

  resolveReadableMountPath(knowledgeSetId: string): string {
    const normalizedKnowledgeSetId = normalizeKnowledgeSetId(knowledgeSetId);
    return ensureInsideRoot(this.rootDir, path.join(this.rootDir, normalizedKnowledgeSetId));
  }

  async saveFiles(input: {
    knowledgeSetId: string;
    files: Array<{ name: string; buffer: Buffer; mimeType?: string }>;
  }): Promise<KnowledgeSetStorageResult> {
    const mountPath = this.resolveReadableMountPath(input.knowledgeSetId);
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
    knowledgeSetId: string;
    archiveName: string;
    buffer: Buffer;
  }): Promise<KnowledgeSetStorageResult> {
    const mountPath = this.resolveReadableMountPath(input.knowledgeSetId);
    await fs.mkdir(this.rootDir, { recursive: true });
    const stagingDir = await fs.mkdtemp(path.join(this.rootDir, ".staging-"));

    try {
      const archiveEntries = unzipSync(new Uint8Array(input.buffer));
      const items: KnowledgeSetStorageItem[] = [];
      const seenPaths = new Set<string>();
      for (const [entryName, content] of Object.entries(archiveEntries)) {
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
    await fs.rm(mountPath, { recursive: true, force: true });
    await fs.rename(stagingDir, mountPath);
  }
}
