type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function normalizeFilePath(value: unknown): string {
  return typeof value === "string" ? value.replace(/\\/g, "/").trim() : "";
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

function mergeChange(current: UnknownRecord | undefined, incoming: UnknownRecord, path: string): UnknownRecord {
  if (!current) return { ...incoming, path };
  if (isReadyChange(current) && !isReadyChange(incoming)) {
    return { ...incoming, ...current, path };
  }
  return { ...current, ...incoming, path };
}

/**
 * A runtime file-change event and the final artifact event describe the same user-facing file.
 * Keep one block after the answer and let the ready artifact state win by file path.
 */
export function consolidateCodexFileChangeParts(parts: readonly unknown[]): unknown[] {
  const fileChangeIndexes: number[] = [];
  const changesByPath = new Map<string, UnknownRecord>();
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
      changesByPath.set(path, mergeChange(changesByPath.get(path), change, path));
    }
  });

  if (fileChangeIndexes.length === 0) return [...parts];

  const consolidatedPart = {
    type: "data",
    name: "codex_file_change",
    data: {
      ...latestData,
      changes: [...changesByPath.values()]
    }
  };

  return [...parts.filter((part) => !isFileChangePart(part)), consolidatedPart];
}
