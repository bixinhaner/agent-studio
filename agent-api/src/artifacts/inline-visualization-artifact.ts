import fs from "node:fs/promises";
import path from "node:path";

import type { ThreadArtifactRecord } from "../persistence/thread-artifact-repository.js";

/** Legacy location (July 2026): lived under the thread tmp dir and was only readable via artifact records. */
export const INLINE_VISUALIZATION_ROOT = ".agent-studio/tmp/home/.codex/visualizations";
/**
 * Durable per-workspace directory the managed visualize skill (and the fallback
 * runtime hint) points the model at. It sits
 * outside `.agent-studio/tmp` (cleaned after idle days) and outside `.codex`
 * (read-only inside the Codex sandbox), and is read directly without artifact
 * records because shell-written files never produce file-change events.
 */
export const INLINE_VISUALIZATION_DIR = ".agent-studio/visualizations";
/** Upper bound for serving one visualization; the skill keeps fragments under 2 MB. */
export const INLINE_VISUALIZATION_MAX_BYTES = 4 * 1024 * 1024;

export function inlineVisualizationDirectory(workspacePath: string): string {
  return path.join(workspacePath, INLINE_VISUALIZATION_DIR);
}

export function inlineVisualizationRuntimeHint(workspacePath: string): string {
  const directory = inlineVisualizationDirectory(workspacePath);
  return `Inline visualizations: write each fragment as \`<title>.html\` directly in \`${directory}\` (writable and kept with the conversation; \`.codex\` is read-only, other locations cannot be shown) and reference it as \`::codex-inline-vis{file="<title>.html"}\`.`;
}

export class InlineVisualizationArtifactError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409
  ) {
    super(message);
    this.name = "InlineVisualizationArtifactError";
  }
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

function isPathInside(parentDir: string, candidatePath: string): boolean {
  const relative = path.relative(parentDir, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function normalizeInlineVisualizationFileName(value: string): string {
  const fileName = value.trim();
  if (
    !fileName ||
    fileName.length > 255 ||
    fileName.includes("\0") ||
    fileName !== path.basename(fileName) ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    !/\.html?$/i.test(fileName)
  ) {
    throw new InlineVisualizationArtifactError("A single HTML visualization file name is required", 400);
  }
  return fileName;
}

export function selectInlineVisualizationArtifact(
  artifacts: ThreadArtifactRecord[],
  requestedFileName: string
): ThreadArtifactRecord | undefined {
  const fileName = normalizeInlineVisualizationFileName(requestedFileName);
  const prefix = `${INLINE_VISUALIZATION_ROOT}/`;
  return artifacts
    .filter((artifact) => {
      const relativePath = normalizeRelativePath(artifact.relativePath);
      return (
        artifact.source === "assistant_generated" &&
        relativePath.startsWith(prefix) &&
        path.posix.basename(relativePath) === fileName
      );
    })
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
}

async function readVisualizationFileWithinRoot(input: {
  rootPath: string;
  absolutePath: string;
  maxFileBytes: number;
}): Promise<{ buffer: Buffer; fileName: string }> {
  const [rootRealPath, fileLstat] = await Promise.all([
    fs.realpath(input.rootPath).catch(() => undefined),
    fs.lstat(input.absolutePath).catch(() => undefined)
  ]);
  if (!rootRealPath || !fileLstat) {
    throw new InlineVisualizationArtifactError("Visualization file does not exist", 404);
  }
  if (fileLstat.isSymbolicLink()) {
    throw new InlineVisualizationArtifactError("Visualization symbolic links are not allowed", 403);
  }
  if (!fileLstat.isFile()) {
    throw new InlineVisualizationArtifactError("Visualization file does not exist", 404);
  }

  const fileRealPath = await fs.realpath(input.absolutePath).catch(() => undefined);
  if (!fileRealPath || !isPathInside(rootRealPath, fileRealPath)) {
    throw new InlineVisualizationArtifactError("Visualization artifact escapes its protected root", 403);
  }

  const maxFileBytes = Math.max(1, Math.floor(input.maxFileBytes));
  if (fileLstat.size > maxFileBytes) {
    throw new InlineVisualizationArtifactError("Visualization file is larger than the preview limit", 403);
  }

  const buffer = await fs.readFile(fileRealPath);
  const statAfter = await fs.stat(fileRealPath).catch(() => undefined);
  if (
    !statAfter ||
    !statAfter.isFile() ||
    statAfter.size !== fileLstat.size ||
    statAfter.mtimeMs !== fileLstat.mtimeMs
  ) {
    throw new InlineVisualizationArtifactError("Visualization file is still being updated", 409);
  }
  return { buffer, fileName: path.basename(fileRealPath) };
}

export async function readInlineVisualizationArtifact(input: {
  workspacePath: string;
  artifact: ThreadArtifactRecord;
  maxFileBytes: number;
}): Promise<{ buffer: Buffer; fileName: string }> {
  const relativePath = normalizeRelativePath(input.artifact.relativePath);
  const visualizationRoot = path.resolve(input.workspacePath, INLINE_VISUALIZATION_ROOT);
  const absolutePath = path.resolve(input.workspacePath, relativePath);
  if (
    input.artifact.source !== "assistant_generated" ||
    !relativePath.startsWith(`${INLINE_VISUALIZATION_ROOT}/`) ||
    !isPathInside(visualizationRoot, absolutePath) ||
    !/\.html?$/i.test(absolutePath)
  ) {
    throw new InlineVisualizationArtifactError("Visualization artifact path is invalid", 403);
  }
  return readVisualizationFileWithinRoot({ rootPath: visualizationRoot, absolutePath, maxFileBytes: input.maxFileBytes });
}

export type LoadedInlineVisualization = {
  buffer: Buffer;
  fileName: string;
  source: "workspace" | "legacy_artifact";
  artifactId?: string;
};

/**
 * Resolves `::codex-inline-vis{file=...}` for a thread: the durable workspace
 * directory first, then legacy artifact-registered files for older turns.
 */
export async function loadInlineVisualization(input: {
  workspacePath: string;
  fileName: string;
  maxFileBytes: number;
  listArtifacts: () => Promise<ThreadArtifactRecord[]>;
}): Promise<LoadedInlineVisualization> {
  const fileName = normalizeInlineVisualizationFileName(input.fileName);
  const rootPath = inlineVisualizationDirectory(input.workspacePath);
  try {
    const result = await readVisualizationFileWithinRoot({
      rootPath,
      absolutePath: path.join(rootPath, fileName),
      maxFileBytes: input.maxFileBytes
    });
    return { ...result, source: "workspace" };
  } catch (error) {
    if (!(error instanceof InlineVisualizationArtifactError) || error.status !== 404) throw error;
  }
  const artifact = selectInlineVisualizationArtifact(await input.listArtifacts(), fileName);
  if (!artifact) throw new InlineVisualizationArtifactError("Visualization file does not exist", 404);
  const result = await readInlineVisualizationArtifact({
    workspacePath: input.workspacePath,
    artifact,
    maxFileBytes: input.maxFileBytes
  });
  return { ...result, source: "legacy_artifact", artifactId: artifact.id };
}

/** Coarse credential scan shared by artifact registration and visualization previews. */
export function detectSecretLikeContent(buffer: Buffer): string | undefined {
  const text = buffer.toString("utf8");
  const patterns: Array<{ pattern: RegExp; reason: string }> = [
    { pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i, reason: "Private key content was detected" },
    { pattern: /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{16,}/i, reason: "Secret-like credential content was detected" },
    { pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/, reason: "API key-like content was detected" }
  ];
  for (const item of patterns) {
    if (item.pattern.test(text)) return item.reason;
  }
  return undefined;
}
