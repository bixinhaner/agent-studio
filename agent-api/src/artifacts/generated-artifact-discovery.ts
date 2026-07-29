import fs from "node:fs/promises";
import path from "node:path";

import type { RuntimeFileChange } from "./runtime-generated-artifacts.js";

const GENERATED_ARTIFACT_SCAN_DIRS = new Set([
  "output",
  "outputs",
  "artifacts",
  "downloads",
  "deliverables",
  "exports"
]);
const GENERATED_ARTIFACT_SCAN_LIMIT = 50;
const GENERATED_ARTIFACT_VISIT_LIMIT = 1000;
const PRIMARY_DELIVERABLE_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".zip",
  ".md",
  ".markdown",
  ".csv",
  ".tsv",
  ".txt",
  ".html",
  ".htm",
  ".mp4",
  ".srt"
]);
const VISUAL_DELIVERABLE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

function isPathInside(parentDir: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentDir), path.resolve(candidatePath));
  return relative === "" || Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveWorkspaceFilePath(
  workspacePath: string,
  filePath: string
): { absolutePath: string; relativePath: string } {
  const workspace = path.resolve(workspacePath);
  const requestedPath = trimOrUndefined(filePath);
  if (!requestedPath) throw new Error("File path is required");
  const absolutePath = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : path.resolve(workspace, requestedPath);
  if (!isPathInside(workspace, absolutePath)) throw new Error("File path is outside the thread workspace");
  const relativePath = normalizeRelativePath(path.relative(workspace, absolutePath));
  if (!relativePath) throw new Error("File path is not a file inside the thread workspace");
  return { absolutePath, relativePath };
}

function decodeLocalArtifactReference(value: string): string | undefined {
  let normalized = value.trim().replace(/^<|>$/g, "").trim();
  if (!normalized || /^https?:\/\//i.test(normalized)) return undefined;
  normalized = normalized.replace(/^(?:sandbox:|file:\/\/)/i, "");
  normalized = normalized.replace(/["'`}>,.;:]+$/g, "").trim();
  if (!normalized) return undefined;
  try {
    return decodeURIComponent(normalized);
  } catch {
    return normalized;
  }
}

function mergeRuntimeFileChanges(groups: RuntimeFileChange[][]): RuntimeFileChange[] {
  const out: RuntimeFileChange[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const change of group) {
      const normalizedPath = trimOrUndefined(change.path);
      if (!normalizedPath) continue;
      const key = path.resolve(normalizedPath);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        path: normalizedPath,
        kind: change.kind || "update",
        sourcePath: change.sourcePath,
        dataBase64: change.dataBase64,
        metadata: change.metadata
      });
    }
  }
  return out;
}

export function extractReferencedArtifactChanges(input: {
  text: string;
  workspacePath: string;
}): RuntimeFileChange[] {
  const normalizedText = trimOrUndefined(input.text);
  if (!normalizedText) return [];

  const out: RuntimeFileChange[] = [];
  const seen = new Set<string>();
  const pushPath = (value: string) => {
    const decoded = decodeLocalArtifactReference(value);
    if (!decoded) return;
    let resolved: { absolutePath: string; relativePath: string };
    try {
      resolved = resolveWorkspaceFilePath(input.workspacePath, decoded);
    } catch {
      return;
    }
    if (seen.has(resolved.relativePath)) return;
    seen.add(resolved.relativePath);
    out.push({ path: resolved.absolutePath, kind: "text_reference" });
  };

  for (const match of normalizedText.matchAll(/::codex-file-citation\{[^}\n]*\bpath=(?:"([^"]+)"|'([^']+)')[^}\n]*\}/g)) {
    pushPath(match[1] ?? match[2] ?? "");
  }
  for (const match of normalizedText.matchAll(/\]\(([^)\n]+)\)/g)) pushPath(match[1] ?? "");
  for (const match of normalizedText.matchAll(/<([^<>\n]+)>/g)) pushPath(match[1] ?? "");
  for (const match of normalizedText.matchAll(/\bsandbox:([^\s<>)\]"}]+)/gi)) pushPath(`sandbox:${match[1] ?? ""}`);
  for (const match of normalizedText.matchAll(/(?:^|[\s(["'])(\/[^\s<>)\]"}]+)/g)) pushPath(match[1] ?? "");
  return out;
}

export async function collectGeneratedArtifactChanges(input: {
  workspacePath: string;
  changedAfter?: Date;
  allowedExtensions: string[];
}): Promise<RuntimeFileChange[]> {
  const workspace = path.resolve(input.workspacePath);
  const sinceMs = input.changedAfter?.getTime() ?? 0;
  const allowedExtensions = new Set(input.allowedExtensions);
  const allowAllExtensions = allowedExtensions.has("*");
  const candidates: Array<{ change: RuntimeFileChange; priority: number; modifiedAt: number }> = [];
  let visitedFiles = 0;

  const scanDir = async (dir: string) => {
    if (visitedFiles >= GENERATED_ARTIFACT_VISIT_LIMIT) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (visitedFiles >= GENERATED_ARTIFACT_VISIT_LIMIT) break;
      if (entry.name.startsWith(".")) continue;
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanDir(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      visitedFiles += 1;
      const relativePath = normalizeRelativePath(path.relative(workspace, absolutePath));
      const extension = path.extname(relativePath).trim().toLowerCase();
      if (!allowAllExtensions && !allowedExtensions.has(extension)) continue;
      const stat = await fs.stat(absolutePath).catch(() => null);
      if (!stat?.isFile()) continue;
      if (sinceMs > 0 && stat.mtimeMs + 2000 < sinceMs) continue;
      const baseName = path.basename(relativePath).toLowerCase();
      const looksLikeQaOutput =
        baseName.endsWith(".inspect.ndjson") ||
        /^(?:preview|page|slide|montage|contact[-_]?sheet)(?:[-_.]|\d)/.test(baseName);
      const extensionPriority = PRIMARY_DELIVERABLE_EXTENSIONS.has(extension)
        ? 0
        : VISUAL_DELIVERABLE_EXTENSIONS.has(extension)
          ? 1
          : 2;
      candidates.push({
        change: { path: absolutePath, kind: "workspace_scan" },
        priority: extensionPriority + (looksLikeQaOutput ? 2 : 0),
        modifiedAt: stat.mtimeMs
      });
    }
  };

  const topLevelEntries = await fs.readdir(workspace, { withFileTypes: true }).catch(() => []);
  for (const entry of topLevelEntries) {
    if (!entry.isDirectory() || !GENERATED_ARTIFACT_SCAN_DIRS.has(entry.name)) continue;
    await scanDir(path.join(workspace, entry.name));
  }
  return candidates
    .sort((left, right) =>
      left.priority - right.priority ||
      right.modifiedAt - left.modifiedAt ||
      left.change.path.localeCompare(right.change.path)
    )
    .slice(0, GENERATED_ARTIFACT_SCAN_LIMIT)
    .map((candidate) => candidate.change);
}

export function selectGeneratedArtifactChanges(input: {
  publishedChanges?: RuntimeFileChange[];
  referencedChanges: RuntimeFileChange[];
  runtimeChanges: RuntimeFileChange[];
  scannedChanges: RuntimeFileChange[];
}): RuntimeFileChange[] {
  if ((input.publishedChanges?.length ?? 0) > 0) {
    return mergeRuntimeFileChanges([input.publishedChanges!]);
  }
  if (input.referencedChanges.length > 0) {
    return mergeRuntimeFileChanges([input.referencedChanges]);
  }
  return mergeRuntimeFileChanges([input.runtimeChanges, input.scannedChanges]);
}
