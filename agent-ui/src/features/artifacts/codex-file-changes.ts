export type CodexFileChangeView = {
  path: string;
  displayPath: string;
  kind: string;
  canPreview: boolean;
  canDownload: boolean;
  artifactId?: string;
  blockedReason?: string;
};

const IMAGE_ARTIFACT_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp"
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeArtifactFilePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}

export function artifactFileName(filePath: string): string {
  const normalized = normalizeArtifactFilePath(filePath).split("#", 1)[0].split("?", 1)[0];
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || normalized || "";
}

export function isImageArtifactFile(filePath: string): boolean {
  const fileName = artifactFileName(filePath).toLowerCase();
  const extension = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".") + 1) : "";
  return IMAGE_ARTIFACT_EXTENSIONS.has(extension);
}

export function isReadyFileChange(kind: string): boolean {
  return ["artifact", "available", "ready"].includes(kind.trim().toLowerCase());
}

function payloadsFromInput(input: unknown): Record<string, unknown>[] {
  if (Array.isArray(input)) return input.flatMap((item) => payloadsFromInput(item));
  const record = asRecord(input);
  if (!record) return [];
  if (Array.isArray(record.changes)) return [record];
  if (record.type === "data" && record.name === "codex_file_change") {
    const data = asRecord(record.data);
    return data ? [data] : [];
  }
  return [];
}

export function collectCodexFileChanges(input: unknown): CodexFileChangeView[] {
  const dedup = new Set<string>();
  const changes: CodexFileChangeView[] = [];

  for (const payload of payloadsFromInput(input)) {
    const rawChanges = Array.isArray(payload.changes) ? payload.changes : [];
    for (const item of rawChanges) {
      const record = asRecord(item);
      if (!record) continue;
      const path = normalizeArtifactFilePath(asString(record.path));
      if (!path) continue;
      const displayPath = normalizeArtifactFilePath(
        asString(record.display_path ?? record.displayPath)
      ) || path;
      const kind = asString(record.kind) || "update";
      const previewStatus = asString(record.preview_status ?? record.previewStatus);
      const downloadStatus = asString(record.download_status ?? record.downloadStatus);
      const key = `${kind}::${path}`;
      if (dedup.has(key)) continue;
      dedup.add(key);
      changes.push({
        path,
        displayPath,
        kind,
        canPreview: record.can_preview === true || record.canPreview === true || previewStatus === "ready",
        canDownload: record.can_download === true || record.canDownload === true || downloadStatus === "ready",
        artifactId: asString(record.artifact_id ?? record.artifactId) || undefined,
        blockedReason: asString(record.blocked_reason ?? record.blockedReason) || undefined
      });
    }
  }

  return changes;
}
