import fs from "node:fs/promises";
import path from "node:path";

type KnowledgeSetItem = {
  kind: "file";
  relativePath: string;
  displayName: string;
  mimeType?: string;
  sizeBytes?: bigint;
  checksum?: string;
  sourceArchiveName?: string;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function ensureRoot(rootPath: string): string {
  const normalized = trimOrUndefined(rootPath);
  if (!normalized) {
    throw new Error("knowledge set root path is required");
  }
  return path.resolve(normalized);
}

function normalizeRelativePath(relativePath: string): string {
  const trimmed = trimOrUndefined(relativePath);
  if (!trimmed) {
    throw new Error("knowledge set file path is invalid");
  }
  const normalized = path.posix.normalize(trimmed.replaceAll("\\", "/"));
  if (!normalized || normalized === "." || normalized.includes("\0")) {
    throw new Error("knowledge set file path is invalid");
  }
  if (normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    throw new Error("knowledge set path escapes storage root");
  }
  return normalized;
}

function resolveInsideRoot(rootPath: string, relativePath: string): string {
  const resolvedRoot = ensureRoot(rootPath);
  const normalizedRelativePath = normalizeRelativePath(relativePath);
  const candidate = path.resolve(path.join(resolvedRoot, normalizedRelativePath));
  if (candidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    return candidate;
  }
  throw new Error("knowledge set path escapes storage root");
}

function sortItems(items: KnowledgeSetItem[]): KnowledgeSetItem[] {
  return [...items].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function scanRecursive(rootPath: string, currentPath: string, items: KnowledgeSetItem[]): Promise<void> {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      await scanRecursive(rootPath, entryPath, items);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const stats = await fs.stat(entryPath);
    const relativePath = path.relative(rootPath, entryPath).split(path.sep).join("/");
    items.push({
      kind: "file",
      relativePath,
      displayName: path.basename(entryPath),
      sizeBytes: BigInt(stats.size)
    });
  }
}

export async function scanDirectory(rootPath: string): Promise<KnowledgeSetItem[]> {
  const resolvedRoot = ensureRoot(rootPath);
  await fs.mkdir(resolvedRoot, { recursive: true });
  const items: KnowledgeSetItem[] = [];
  await scanRecursive(resolvedRoot, resolvedRoot, items);
  return sortItems(items);
}

export async function deleteFile(rootPath: string, relativePath: string): Promise<void> {
  const targetPath = resolveInsideRoot(rootPath, relativePath);
  await fs.rm(targetPath, { force: true });
}

export async function renameFile(rootPath: string, relativePath: string, nextRelativePath: string): Promise<void> {
  const sourcePath = resolveInsideRoot(rootPath, relativePath);
  const targetPath = resolveInsideRoot(rootPath, nextRelativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.rename(sourcePath, targetPath);
}
