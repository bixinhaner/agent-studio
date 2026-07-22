type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function normalizeFilePath(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/\\/g, "/").trim();
  return normalized.startsWith("./") ? normalized.slice(2) : normalized;
}

function isAbsoluteFilePath(path: string): boolean {
  return path.startsWith("/") || /^[a-z]:\//i.test(path);
}

function absolutePathEndsWithRelativePath(absolutePath: string, relativePath: string): boolean {
  if (!isAbsoluteFilePath(absolutePath) || isAbsoluteFilePath(relativePath) || !relativePath) return false;
  return absolutePath === relativePath || absolutePath.endsWith(`/${relativePath}`);
}

function isFileChangePart(value: unknown): value is UnknownRecord {
  const part = asRecord(value);
  return part?.type === "data" && part.name === "codex_file_change";
}

function isReadyChange(change: UnknownRecord): boolean {
  const kind = typeof change.kind === "string" ? change.kind.trim().toLowerCase() : "";
  const previewStatus = typeof change.preview_status === "string" ? change.preview_status : change.previewStatus;
  const downloadStatus = typeof change.download_status === "string" ? change.download_status : change.downloadStatus;
  return (
    kind === "ready" ||
    kind === "artifact" ||
    kind === "available" ||
    previewStatus === "ready" ||
    downloadStatus === "ready" ||
    change.can_preview === true ||
    change.canPreview === true ||
    change.can_download === true ||
    change.canDownload === true
  );
}

function mergeChange(current: UnknownRecord | undefined, incoming: UnknownRecord): UnknownRecord {
  if (!current) return incoming;
  if (isReadyChange(current) && !isReadyChange(incoming)) {
    return { ...incoming, ...current };
  }
  return { ...current, ...incoming };
}

type FileChangeGroup = {
  aliases: Set<string>;
  absoluteAliases: Set<string>;
  relativeAliases: Set<string>;
  change: UnknownRecord;
};

function createFileChangeGroup(path: string, change: UnknownRecord): FileChangeGroup {
  const absolute = isAbsoluteFilePath(path);
  return {
    aliases: new Set([path]),
    absoluteAliases: new Set(absolute ? [path] : []),
    relativeAliases: new Set(absolute ? [] : [path]),
    change: { ...change, path }
  };
}

function canMergePathAlias(group: FileChangeGroup, path: string): boolean {
  if (group.aliases.has(path)) return true;

  if (isAbsoluteFilePath(path)) {
    if (group.absoluteAliases.size > 0 || group.relativeAliases.size !== 1) return false;
    const [relativePath] = group.relativeAliases;
    return absolutePathEndsWithRelativePath(path, relativePath);
  }

  if (group.relativeAliases.size > 0 || group.absoluteAliases.size !== 1) return false;
  const [absolutePath] = group.absoluteAliases;
  return absolutePathEndsWithRelativePath(absolutePath, path);
}

function appendFileChange(groups: FileChangeGroup[], path: string, change: UnknownRecord): void {
  const exactGroup = groups.find((group) => group.aliases.has(path));
  const candidates = exactGroup ? [exactGroup] : groups.filter((group) => canMergePathAlias(group, path));

  // A suffix match can point at multiple real files. Keep ambiguous paths separate.
  if (candidates.length !== 1) {
    groups.push(createFileChangeGroup(path, change));
    return;
  }

  const group = candidates[0];
  group.aliases.add(path);
  if (isAbsoluteFilePath(path)) group.absoluteAliases.add(path);
  else group.relativeAliases.add(path);

  const normalizedIncoming = { ...change, path };
  group.change = mergeChange(group.change, normalizedIncoming);
}

/**
 * A runtime file-change event and the final artifact event describe the same user-facing file.
 * Keep one block after the answer and let the ready artifact state win by file path.
 */
export function consolidateCodexFileChangeParts(parts: readonly unknown[]): unknown[] {
  const fileChangeIndexes: number[] = [];
  const changeGroups: FileChangeGroup[] = [];
  let latestData: UnknownRecord = {};

  parts.forEach((part, index) => {
    if (!isFileChangePart(part)) return;
    fileChangeIndexes.push(index);
    const data = asRecord(part.data) ?? {};
    latestData = { ...latestData, ...data };
    const changes = Array.isArray(data.changes) ? data.changes : [];
    for (const value of changes) {
      const change = asRecord(value);
      if (!change) continue;
      const path = normalizeFilePath(change.path);
      if (!path) continue;
      appendFileChange(changeGroups, path, change);
    }
  });

  if (fileChangeIndexes.length === 0) return [...parts];

  const consolidatedPart = {
    type: "data",
    name: "codex_file_change",
    data: {
      ...latestData,
      changes: changeGroups.map((group) => group.change)
    }
  };

  return [...parts.filter((part) => !isFileChangePart(part)), consolidatedPart];
}
