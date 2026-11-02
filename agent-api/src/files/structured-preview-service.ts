import { fork } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Response } from "express";

import {
  detectPreviewFile,
  type StructuredPreviewInput,
  type StructuredPreviewJob,
  type StructuredPreviewMode,
  type StructuredPreviewResult
} from "./structured-preview-core.js";

export { detectPreviewFile };
export type { DetectedPreviewFile, StructuredPreviewInput, StructuredPreviewMode } from "./structured-preview-core.js";

const PREVIEW_TIMEOUT_MS = 30_000;
/** Heap cap of each preview process; a file that needs more fails its preview instead of the API. */
const PREVIEW_MAX_OLD_SPACE_MB = 512;
const MAX_CONCURRENT_PREVIEWS = 4;
let activePreviews = 0;
const previewWaiters: Array<() => void> = [];

export class StructuredPreviewError extends Error {}

function childEntry(): { modulePath: string; execArgv: string[] } {
  const here = fileURLToPath(import.meta.url);
  // Source checkouts (tests, tsx dev server) run the TypeScript entry through tsx.
  if (here.endsWith(".ts")) {
    return { modulePath: path.join(path.dirname(here), "structured-preview-child.ts"), execArgv: ["--import", "tsx"] };
  }
  return { modulePath: path.join(path.dirname(here), "structured-preview-child.js"), execArgv: [] };
}

function runInChild(job: StructuredPreviewJob, options: { maxOldSpaceMb: number; timeoutMs: number }): Promise<StructuredPreviewResult> {
  const entry = childEntry();
  return new Promise((resolve, reject) => {
    const child = fork(entry.modulePath, [], {
      execArgv: [...entry.execArgv, `--max-old-space-size=${options.maxOldSpaceMb}`],
      // Buffers cross the IPC channel as binary instead of JSON arrays.
      serialization: "advanced",
      stdio: ["ignore", "ignore", "pipe", "ipc"]
    });
    let settled = false;
    let stderr = "";
    const finish = (error: Error | undefined, result?: StructuredPreviewResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      if (error) reject(error);
      else resolve(result!);
    };
    const timer = setTimeout(() => finish(new StructuredPreviewError("File preview timed out")), options.timeoutMs);
    timer.unref();
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 4_000) stderr += chunk.toString("utf8");
    });
    child.once("message", (reply: { ok: true; result: StructuredPreviewResult } | { ok: false; error: string }) => {
      if (reply.ok) finish(undefined, reply.result);
      else finish(new StructuredPreviewError(reply.error));
    });
    child.once("error", (error) => finish(error));
    // "close" follows the last IPC message and stderr output, unlike "exit".
    child.once("close", (code, signal) => {
      const outOfMemory = /heap out of memory|Allocation failed/i.test(stderr);
      finish(
        new StructuredPreviewError(
          outOfMemory
            ? "The file is too large or complex to preview"
            : `File preview process exited unexpectedly (${signal ?? `code ${code}`})`
        )
      );
    });
    child.send(job, (error) => {
      if (error) finish(error);
    });
  });
}

/**
 * Parses untrusted user files (workbooks, compressed Draw.io XML, whole-file text
 * decoding) in a separate process with a capped heap and a timeout. An out-of-memory
 * abort there fails only this preview; in a worker thread it aborted the whole chat
 * service.
 */
export async function runStructuredPreview(
  job: StructuredPreviewJob,
  options: { maxOldSpaceMb?: number; timeoutMs?: number } = {}
): Promise<StructuredPreviewResult> {
  if (activePreviews >= MAX_CONCURRENT_PREVIEWS) {
    await new Promise<void>((resolve) => previewWaiters.push(resolve));
  }
  activePreviews += 1;
  try {
    return await runInChild(job, {
      maxOldSpaceMb: options.maxOldSpaceMb ?? PREVIEW_MAX_OLD_SPACE_MB,
      timeoutMs: options.timeoutMs ?? PREVIEW_TIMEOUT_MS
    });
  } finally {
    activePreviews = Math.max(0, activePreviews - 1);
    previewWaiters.shift()?.();
  }
}

export async function sendStructuredPreview(
  res: Response,
  input: StructuredPreviewInput & { requested?: StructuredPreviewMode; query?: Record<string, unknown> }
): Promise<boolean> {
  if (!input.requested) return false;
  const detected = await detectPreviewFile(input);
  const mode = input.requested === "auto" ? detected.category : input.requested;
  if (mode !== detected.category || (mode !== "text" && mode !== "table" && mode !== "diagram")) return false;

  const previewInput: StructuredPreviewInput = input.content
    ? { fileName: input.fileName, mimeType: input.mimeType, content: input.content }
    : { fileName: input.fileName, mimeType: input.mimeType, sourcePath: input.sourcePath };
  const query = Object.fromEntries(
    Object.entries(input.query ?? {}).filter(([, value]) => typeof value === "string")
  );
  const result = await runStructuredPreview({ input: previewInput, mode, query });

  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (result.type === "svg") {
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.type("image/svg+xml").status(200).send(result.body);
    return true;
  }
  res.status(200).json(result.body);
  return true;
}

export async function detectedContentType(input: StructuredPreviewInput): Promise<string> {
  return (await detectPreviewFile(input)).mimeType;
}
