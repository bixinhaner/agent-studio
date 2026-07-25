import fs from "node:fs/promises";
import path from "node:path";

import type { ThreadArtifactRecord } from "../persistence/thread-artifact-repository.js";

export const INLINE_VISUALIZATION_ROOT = ".agent-studio/tmp/home/.codex/visualizations";

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

  const [rootRealPath, fileLstat] = await Promise.all([
    fs.realpath(visualizationRoot).catch(() => undefined),
    fs.lstat(absolutePath).catch(() => undefined)
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

  const fileRealPath = await fs.realpath(absolutePath).catch(() => undefined);
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
