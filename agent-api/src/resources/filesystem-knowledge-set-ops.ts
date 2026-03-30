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

async function ensureSafeRootDirectory(rootPath: string): Promise<string> {
  const resolvedRoot = ensureRoot(rootPath);
  const parsed = path.parse(resolvedRoot);
  const segments = resolvedRoot.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let currentPath = parsed.root || path.sep;
  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);
    const stats = await fs.lstat(currentPath);
    if (stats.isSymbolicLink()) {
      throw new Error("knowledge set root path cannot traverse symlinks");
    }
  }
  const stats = await fs.lstat(resolvedRoot);
  if (!stats.isDirectory()) {
    throw new Error("knowledge set root path is invalid");
  }
  return resolvedRoot;
}

function ensureRealPathInsideRoot(resolvedRoot: string, candidatePath: string): string {
  if (candidatePath === resolvedRoot || candidatePath.startsWith(`${resolvedRoot}${path.sep}`)) {
    return candidatePath;
  }
  throw new Error("knowledge set path escapes storage root");
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

async function resolveInsideRoot(
  rootPath: string,
  relativePath: string,
  options?: { allowMissingLeaf?: boolean }
): Promise<string> {
  const resolvedRoot = ensureRoot(rootPath);
  const normalizedRelativePath = normalizeRelativePath(relativePath);
  const candidate = path.resolve(path.join(resolvedRoot, normalizedRelativePath));
  if (!candidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("knowledge set path escapes storage root");
  }
  let currentPath = resolvedRoot;
  const segments = normalizedRelativePath.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    currentPath = path.join(currentPath, segments[index]);
    try {
      const stats = await fs.lstat(currentPath);
      if (stats.isSymbolicLink()) {
        throw new Error("knowledge set path cannot traverse symlinks");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        if (options?.allowMissingLeaf) {
          break;
        }
      }
      throw error;
    }
  }
  return candidate;
}

function sortItems(items: KnowledgeSetItem[]): KnowledgeSetItem[] {
  return [...items].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function scanRecursive(rootPath: string, currentPath: string, items: KnowledgeSetItem[]): Promise<void> {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(currentPath, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
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
  try {
    await ensureSafeRootDirectory(resolvedRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const items: KnowledgeSetItem[] = [];
  await scanRecursive(resolvedRoot, resolvedRoot, items);
  return sortItems(items);
}

export async function deleteFile(rootPath: string, relativePath: string): Promise<void> {
  const resolvedRoot = await ensureSafeRootDirectory(rootPath);
  const targetPath = await resolveInsideRoot(resolvedRoot, relativePath);
  const targetRealPath = ensureRealPathInsideRoot(resolvedRoot, await fs.realpath(targetPath));
  const stats = await fs.lstat(targetRealPath);
  if (stats.isSymbolicLink()) {
    throw new Error("knowledge set path cannot traverse symlinks");
  }
  if (!stats.isFile()) {
    throw new Error("knowledge set file path does not reference a file");
  }
  await fs.rm(targetRealPath);
}

export async function renameFile(rootPath: string, relativePath: string, nextRelativePath: string): Promise<void> {
  const resolvedRoot = await ensureSafeRootDirectory(rootPath);
  const sourcePath = await resolveInsideRoot(resolvedRoot, relativePath);
  const targetPath = await resolveInsideRoot(resolvedRoot, nextRelativePath, { allowMissingLeaf: true });
  const sourceRealPath = ensureRealPathInsideRoot(resolvedRoot, await fs.realpath(sourcePath));
  const sourceStats = await fs.lstat(sourceRealPath);
  if (sourceStats.isSymbolicLink()) {
    throw new Error("knowledge set path cannot traverse symlinks");
  }
  if (!sourceStats.isFile()) {
    throw new Error("knowledge set file path does not reference a file");
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const targetParentRealPath = ensureRealPathInsideRoot(resolvedRoot, await fs.realpath(path.dirname(targetPath)));
  const targetRealPath = path.join(targetParentRealPath, path.basename(targetPath));
  try {
    const targetStats = await fs.lstat(targetRealPath);
    if (targetStats.isSymbolicLink()) {
      throw new Error("knowledge set path cannot traverse symlinks");
    }
    throw new Error("knowledge set target path already exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  await fs.rename(sourceRealPath, targetRealPath);
}
