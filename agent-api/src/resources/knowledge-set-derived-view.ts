import fs from "node:fs/promises";
import path from "node:path";

type KnowledgeSetItemLike = {
  relativePath: string;
  displayName: string;
  sizeBytes?: string | bigint;
  mimeType?: string;
  sourceArchiveName?: string;
  updatedAt?: string;
};

type DocumentAccumulator = {
  key: string;
  kind: "document_unit" | "standalone_markdown";
  relativePath: string;
  directoryPath: string;
  topLevelDirectory: string;
  docPath?: string;
  metaPath?: string;
  totalFiles: number;
  markdownFileCount: number;
  mediaFileCount: number;
  imageCount: number;
  auxiliaryFileCount: number;
  hasDocMarkdown: boolean;
  hasMetaJson: boolean;
  hasMediaDirectory: boolean;
  sourceArchiveNames: Set<string>;
  updatedAt?: string;
};

type TitleResolutionPayload = {
  title?: unknown;
  source?: unknown;
  filename_title?: unknown;
  filename_title_is_generic?: unknown;
  content_title?: unknown;
  content_title_is_generic?: unknown;
  core_title?: unknown;
  core_title_is_generic?: unknown;
};

type MetaPayload = {
  title?: unknown;
  source_name?: unknown;
  title_resolution?: TitleResolutionPayload;
};

export type KnowledgeSetDocumentStatus = "ready" | "missing_meta" | "missing_doc" | "partial";

export type KnowledgeSetDocumentSummary = {
  id: string;
  kind: "document_unit" | "standalone_markdown";
  title: string;
  titleSource: "meta" | "path";
  relativePath: string;
  directoryPath: string;
  topLevelDirectory: string;
  docPath?: string;
  metaPath?: string;
  status: KnowledgeSetDocumentStatus;
  updatedAt?: string;
  totalFiles: number;
  markdownFileCount: number;
  mediaFileCount: number;
  imageCount: number;
  auxiliaryFileCount: number;
  hasDocMarkdown: boolean;
  hasMetaJson: boolean;
  hasMediaDirectory: boolean;
  sourceArchiveNames: string[];
};

export type KnowledgeSetSummaryDirectory = {
  path: string;
  label: string;
  documentCount: number;
  warningDocumentCount: number;
  fileCount: number;
};

export type KnowledgeSetLibrarySummary = {
  totalDocuments: number;
  readyDocuments: number;
  warningDocuments: number;
  totalVisibleFiles: number;
  totalMarkdownFiles: number;
  totalMediaFiles: number;
  looseFileCount: number;
  ignoredJsonlFileCount: number;
  topLevelDirectoryCount: number;
  lastUpdatedAt?: string;
};

export type KnowledgeSetLibraryView = {
  summary: KnowledgeSetLibrarySummary;
  directories: KnowledgeSetSummaryDirectory[];
  documents: KnowledgeSetDocumentSummary[];
  knownFileNames: string[];
};

export type KnowledgeSetTreeDirectoryEntry = {
  kind: "directory";
  name: string;
  relativePath: string;
  fileCount: number;
  documentCount: number;
  warningDocumentCount: number;
};

export type KnowledgeSetTreeFileEntry = {
  kind: "file";
  name: string;
  relativePath: string;
  sizeBytes?: string;
  updatedAt?: string;
  mimeType?: string;
  sourceArchiveName?: string;
  extension: string;
};

export type KnowledgeSetTreeEntry = KnowledgeSetTreeDirectoryEntry | KnowledgeSetTreeFileEntry;

export type KnowledgeSetTreeView = {
  currentPath: string;
  parentPath: string | null;
  hiddenEntryCount: number;
  entries: KnowledgeSetTreeEntry[];
};

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".webp",
  ".svg",
  ".tif",
  ".tiff",
  ".avif"
]);

const GENERIC_TITLES = new Set([
  "about this document",
  "introduction",
  "appearance",
  "概述",
  "关于本文档"
]);

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizePosixPath(value: string | undefined): string {
  const trimmed = trimOrUndefined(value);
  if (!trimmed || trimmed === ".") return "";
  return path.posix.normalize(trimmed.replaceAll("\\", "/")).replace(/^\/+/, "").replace(/\/$/, "");
}

function posixDirname(value: string): string {
  const normalized = normalizePosixPath(value);
  if (!normalized) return "";
  const dirname = path.posix.dirname(normalized);
  return dirname === "." ? "" : dirname;
}

function posixBasename(value: string): string {
  return path.posix.basename(normalizePosixPath(value));
}

function fileExtension(value: string): string {
  return path.posix.extname(normalizePosixPath(value)).toLowerCase();
}

function isJsonlPath(value: string): boolean {
  return fileExtension(value) === ".jsonl";
}

function isDocMarkdownPath(value: string): boolean {
  return posixBasename(value).toLowerCase() === "doc.md";
}

function isMetaPath(value: string): boolean {
  return posixBasename(value).toLowerCase() === "meta.json";
}

function isStandaloneMarkdownPath(value: string): boolean {
  return fileExtension(value) === ".md" && !isDocMarkdownPath(value);
}

function mediaRootPath(value: string): string | undefined {
  const normalized = normalizePosixPath(value);
  if (!normalized) return undefined;
  if (normalized.startsWith("media/")) return "";
  const marker = "/media/";
  const index = normalized.indexOf(marker);
  if (index < 0) return undefined;
  return normalized.slice(0, index);
}

function isUnderDirectory(candidatePath: string, directoryPath: string): boolean {
  const candidate = normalizePosixPath(candidatePath);
  const directory = normalizePosixPath(directoryPath);
  if (!directory) return Boolean(candidate);
  return candidate === directory || candidate.startsWith(`${directory}/`);
}

function relativeToDirectory(candidatePath: string, directoryPath: string): string | undefined {
  const candidate = normalizePosixPath(candidatePath);
  const directory = normalizePosixPath(directoryPath);
  if (!directory) return candidate || undefined;
  if (candidate === directory) return "";
  if (!candidate.startsWith(`${directory}/`)) return undefined;
  return candidate.slice(directory.length + 1);
}

function topLevelDirectoryOf(value: string): string {
  const normalized = normalizePosixPath(value);
  if (!normalized) return "";
  return normalized.split("/")[0] || "";
}

function pickDocumentKey(item: KnowledgeSetItemLike): { key: string; kind: DocumentAccumulator["kind"] } | undefined {
  const relativePath = normalizePosixPath(item.relativePath);
  if (!relativePath) return undefined;
  if (isDocMarkdownPath(relativePath) || isMetaPath(relativePath)) {
    return { key: posixDirname(relativePath), kind: "document_unit" };
  }
  const mediaRoot = mediaRootPath(relativePath);
  if (mediaRoot !== undefined) {
    return { key: mediaRoot, kind: "document_unit" };
  }
  if (isStandaloneMarkdownPath(relativePath)) {
    return { key: relativePath, kind: "standalone_markdown" };
  }
  return undefined;
}

function ensureDocumentAccumulator(
  target: Map<string, DocumentAccumulator>,
  key: string,
  kind: DocumentAccumulator["kind"]
): DocumentAccumulator {
  let existing = target.get(key);
  if (existing) return existing;
  const relativePath = normalizePosixPath(key);
  const directoryPath = kind === "standalone_markdown" ? posixDirname(relativePath) : relativePath;
  existing = {
    key,
    kind,
    relativePath,
    directoryPath,
    topLevelDirectory: topLevelDirectoryOf(kind === "standalone_markdown" ? directoryPath : relativePath),
    totalFiles: 0,
    markdownFileCount: 0,
    mediaFileCount: 0,
    imageCount: 0,
    auxiliaryFileCount: 0,
    hasDocMarkdown: false,
    hasMetaJson: false,
    hasMediaDirectory: false,
    sourceArchiveNames: new Set<string>()
  };
  target.set(key, existing);
  return existing;
}

function toIsoTimestamp(value: string | undefined): string | undefined {
  const trimmed = trimOrUndefined(value);
  if (!trimmed) return undefined;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function maxTimestamp(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function normalizeTitleCandidate(value: unknown): string | undefined {
  const trimmed = trimOrUndefined(value);
  if (!trimmed) return undefined;
  const normalized = trimmed.replace(/\s+/g, " ");
  if (normalized.length > 140) return undefined;
  if (normalized.includes("<") || normalized.includes(">")) return undefined;
  if (GENERIC_TITLES.has(normalized.toLowerCase())) return undefined;
  return normalized;
}

function sourceNameToTitle(value: unknown): string | undefined {
  const sourceName = trimOrUndefined(value);
  if (!sourceName) return undefined;
  return normalizeTitleCandidate(sourceName.replace(/\.[^.]+$/, ""));
}

function titleFromMetaPayload(meta: MetaPayload): string | undefined {
  const titleResolution = meta.title_resolution;
  const resolvedTitle = normalizeTitleCandidate(titleResolution?.title);
  const filenameTitle = normalizeTitleCandidate(titleResolution?.filename_title);
  const contentTitle = normalizeTitleCandidate(titleResolution?.content_title);
  const coreTitle = normalizeTitleCandidate(titleResolution?.core_title);
  const metaTitle = normalizeTitleCandidate(meta.title);
  return (
    resolvedTitle ||
    filenameTitle ||
    contentTitle ||
    coreTitle ||
    metaTitle ||
    sourceNameToTitle(meta.source_name)
  );
}

async function resolveDocumentTitle(
  rootPath: string | undefined,
  unit: DocumentAccumulator
): Promise<{ title: string; titleSource: "meta" | "path" }> {
  const fallbackTitle =
    unit.kind === "standalone_markdown"
      ? path.posix.basename(unit.docPath || unit.relativePath, path.posix.extname(unit.docPath || unit.relativePath))
      : posixBasename(unit.relativePath) || "根目录文档";

  if (rootPath && unit.metaPath) {
    try {
      const metaPath = path.join(rootPath, ...normalizePosixPath(unit.metaPath).split("/"));
      const raw = await fs.readFile(metaPath, "utf8");
      const parsed = JSON.parse(raw) as MetaPayload;
      const title = titleFromMetaPayload(parsed);
      if (title) {
        return { title, titleSource: "meta" };
      }
    } catch {
      // Ignore malformed or missing meta payloads and fall back to the path label.
    }
  }

  return {
    title: fallbackTitle,
    titleSource: "path"
  };
}

function finalizeDocumentStatus(unit: DocumentAccumulator): KnowledgeSetDocumentStatus {
  if (unit.kind === "standalone_markdown") {
    return unit.hasDocMarkdown ? "ready" : "partial";
  }
  if (unit.hasDocMarkdown && unit.hasMetaJson) return "ready";
  if (unit.hasDocMarkdown && !unit.hasMetaJson) return "missing_meta";
  if (!unit.hasDocMarkdown && unit.hasMetaJson) return "missing_doc";
  return "partial";
}

function sortDocuments(left: KnowledgeSetDocumentSummary, right: KnowledgeSetDocumentSummary): number {
  const leftUpdated = Date.parse(left.updatedAt || "");
  const rightUpdated = Date.parse(right.updatedAt || "");
  if (Number.isFinite(leftUpdated) && Number.isFinite(rightUpdated) && leftUpdated !== rightUpdated) {
    return rightUpdated - leftUpdated;
  }
  if (left.status !== right.status) {
    return left.status === "ready" ? 1 : -1;
  }
  return left.title.localeCompare(right.title, "zh-CN");
}

function sortDirectories(left: KnowledgeSetSummaryDirectory, right: KnowledgeSetSummaryDirectory): number {
  if (left.warningDocumentCount !== right.warningDocumentCount) {
    return right.warningDocumentCount - left.warningDocumentCount;
  }
  if (left.documentCount !== right.documentCount) {
    return right.documentCount - left.documentCount;
  }
  return left.label.localeCompare(right.label, "zh-CN");
}

export async function buildKnowledgeSetLibraryView(
  items: KnowledgeSetItemLike[],
  options?: { rootPath?: string }
): Promise<KnowledgeSetLibraryView> {
  const visibleItems = items.filter((item) => !isJsonlPath(item.relativePath));
  const hiddenJsonlFiles = items.length - visibleItems.length;
  const documents = new Map<string, DocumentAccumulator>();
  let looseFileCount = 0;
  let totalMarkdownFiles = 0;
  let totalMediaFiles = 0;
  let lastUpdatedAt: string | undefined;
  const knownFileNames = new Set<string>();

  for (const item of visibleItems) {
    const relativePath = normalizePosixPath(item.relativePath);
    const updatedAt = toIsoTimestamp(item.updatedAt);
    lastUpdatedAt = maxTimestamp(lastUpdatedAt, updatedAt);
    const displayName = posixBasename(relativePath) || trimOrUndefined(item.displayName);
    if (displayName) {
      knownFileNames.add(displayName);
    }

    if (fileExtension(relativePath) === ".md") {
      totalMarkdownFiles += 1;
    }
    if (mediaRootPath(relativePath) !== undefined) {
      totalMediaFiles += 1;
    }

    const key = pickDocumentKey(item);
    if (!key) {
      looseFileCount += 1;
      continue;
    }

    const unit = ensureDocumentAccumulator(documents, key.key, key.kind);
    unit.totalFiles += 1;
    unit.updatedAt = maxTimestamp(unit.updatedAt, updatedAt);
    const archiveName = trimOrUndefined(item.sourceArchiveName);
    if (archiveName) {
      unit.sourceArchiveNames.add(archiveName);
    }

    if (isDocMarkdownPath(relativePath)) {
      unit.hasDocMarkdown = true;
      unit.docPath = relativePath;
      unit.markdownFileCount += 1;
      continue;
    }

    if (isStandaloneMarkdownPath(relativePath)) {
      unit.hasDocMarkdown = true;
      unit.docPath = relativePath;
      unit.markdownFileCount += 1;
      continue;
    }

    if (isMetaPath(relativePath)) {
      unit.hasMetaJson = true;
      unit.metaPath = relativePath;
      continue;
    }

    if (mediaRootPath(relativePath) !== undefined) {
      unit.hasMediaDirectory = true;
      unit.mediaFileCount += 1;
      if (IMAGE_EXTENSIONS.has(fileExtension(relativePath))) {
        unit.imageCount += 1;
      }
      continue;
    }

    if (fileExtension(relativePath) === ".md") {
      unit.markdownFileCount += 1;
    } else {
      unit.auxiliaryFileCount += 1;
    }
  }

  const summaries = await Promise.all(
    [...documents.values()].map(async (unit) => {
      const { title, titleSource } = await resolveDocumentTitle(options?.rootPath, unit);
      return {
        id: unit.docPath || unit.relativePath || unit.key || title,
        kind: unit.kind,
        title,
        titleSource,
        relativePath: unit.relativePath,
        directoryPath: unit.directoryPath,
        topLevelDirectory: unit.topLevelDirectory,
        docPath: unit.docPath,
        metaPath: unit.metaPath,
        status: finalizeDocumentStatus(unit),
        updatedAt: unit.updatedAt,
        totalFiles: unit.totalFiles,
        markdownFileCount: unit.markdownFileCount,
        mediaFileCount: unit.mediaFileCount,
        imageCount: unit.imageCount,
        auxiliaryFileCount: unit.auxiliaryFileCount,
        hasDocMarkdown: unit.hasDocMarkdown,
        hasMetaJson: unit.hasMetaJson,
        hasMediaDirectory: unit.hasMediaDirectory,
        sourceArchiveNames: [...unit.sourceArchiveNames].sort((left, right) => left.localeCompare(right, "zh-CN"))
      } satisfies KnowledgeSetDocumentSummary;
    })
  );

  summaries.sort(sortDocuments);

  const directoryMap = new Map<string, KnowledgeSetSummaryDirectory>();
  for (const document of summaries) {
    const pathKey = document.topLevelDirectory;
    const existing = directoryMap.get(pathKey) || {
      path: pathKey,
      label: pathKey || "根目录",
      documentCount: 0,
      warningDocumentCount: 0,
      fileCount: 0
    };
    existing.documentCount += 1;
    existing.fileCount += document.totalFiles;
    if (document.status !== "ready") {
      existing.warningDocumentCount += 1;
    }
    directoryMap.set(pathKey, existing);
  }

  const directories = [...directoryMap.values()].sort(sortDirectories);
  const readyDocuments = summaries.filter((document) => document.status === "ready").length;

  return {
    summary: {
      totalDocuments: summaries.length,
      readyDocuments,
      warningDocuments: Math.max(summaries.length - readyDocuments, 0),
      totalVisibleFiles: visibleItems.length,
      totalMarkdownFiles,
      totalMediaFiles,
      looseFileCount,
      ignoredJsonlFileCount: hiddenJsonlFiles,
      topLevelDirectoryCount: directories.length,
      lastUpdatedAt
    },
    directories,
    documents: summaries,
    knownFileNames: [...knownFileNames].sort((left, right) => left.localeCompare(right, "zh-CN"))
  };
}

function matchesCurrentDirectory(item: KnowledgeSetItemLike, currentPath: string): { directFile: boolean; directoryName?: string } | undefined {
  const remainder = relativeToDirectory(item.relativePath, currentPath);
  if (remainder === undefined || remainder === "") return undefined;
  const segments = remainder.split("/").filter(Boolean);
  if (segments.length === 0) return undefined;
  if (segments.length === 1) {
    return { directFile: true };
  }
  return { directFile: false, directoryName: segments[0] };
}

export function buildKnowledgeSetTreeView(
  items: KnowledgeSetItemLike[],
  documents: KnowledgeSetDocumentSummary[],
  options?: { currentPath?: string; includeJsonl?: boolean }
): KnowledgeSetTreeView {
  const currentPath = normalizePosixPath(options?.currentPath);
  const includeJsonl = options?.includeJsonl === true;
  const visibleItems = includeJsonl ? items : items.filter((item) => !isJsonlPath(item.relativePath));
  const hiddenEntryCount = includeJsonl
    ? 0
    : items.filter((item) => {
        const relativePath = normalizePosixPath(item.relativePath);
        return isJsonlPath(relativePath) && relativeToDirectory(relativePath, currentPath) !== undefined;
      }).length;

  const directoryMap = new Map<string, KnowledgeSetTreeDirectoryEntry>();
  const fileEntries: KnowledgeSetTreeFileEntry[] = [];

  for (const item of visibleItems) {
    const match = matchesCurrentDirectory(item, currentPath);
    if (!match) continue;
    const relativePath = normalizePosixPath(item.relativePath);
    if (match.directFile) {
      fileEntries.push({
        kind: "file",
        name: posixBasename(relativePath),
        relativePath,
        sizeBytes: typeof item.sizeBytes === "bigint" ? item.sizeBytes.toString() : trimOrUndefined(item.sizeBytes),
        updatedAt: toIsoTimestamp(item.updatedAt),
        mimeType: trimOrUndefined(item.mimeType),
        sourceArchiveName: trimOrUndefined(item.sourceArchiveName),
        extension: fileExtension(relativePath)
      });
      continue;
    }

    const directoryName = match.directoryName || "";
    const directoryPath = currentPath ? `${currentPath}/${directoryName}` : directoryName;
    const existing = directoryMap.get(directoryPath) || {
      kind: "directory" as const,
      name: directoryName,
      relativePath: directoryPath,
      fileCount: 0,
      documentCount: 0,
      warningDocumentCount: 0
    };
    existing.fileCount += 1;
    directoryMap.set(directoryPath, existing);
  }

  for (const entry of directoryMap.values()) {
    for (const document of documents) {
      const targetPath =
        document.kind === "standalone_markdown" ? document.docPath || document.relativePath : document.relativePath;
      if (!isUnderDirectory(targetPath, entry.relativePath)) continue;
      entry.documentCount += 1;
      if (document.status !== "ready") {
        entry.warningDocumentCount += 1;
      }
    }
  }

  const entries: KnowledgeSetTreeEntry[] = [
    ...[...directoryMap.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
    ...fileEntries.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
  ];

  return {
    currentPath,
    parentPath: currentPath ? posixDirname(currentPath) : null,
    hiddenEntryCount,
    entries
  };
}
