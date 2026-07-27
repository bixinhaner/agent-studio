import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { Response } from "express";

const OFFICE_PDF_EXTENSIONS = new Set([
  ".doc",
  ".docx",
  ".odt",
  ".rtf",
  ".ppt",
  ".pptx",
  ".odp",
  ".odg",
  ".vsd",
  ".vsdx"
]);

type ConversionRunner = (input: {
  sourcePath: string;
  outputDir: string;
  profileDir: string;
  timeoutMs: number;
  binaryPath: string;
}) => Promise<void>;

export type OfficePreviewInput =
  | {
      fileName: string;
      sourcePath: string;
      content?: never;
      fingerprint?: string;
    }
  | {
      fileName: string;
      content: Buffer;
      fingerprint?: string;
      sourcePath?: never;
    };

export type OfficePdfPreview = {
  buffer: Buffer;
  fileName: string;
  cacheHit: boolean;
};

export type OfficePreviewServiceOptions = {
  cacheRoot?: string;
  binaryPath?: string;
  timeoutMs?: number;
  maxConcurrent?: number;
  cacheMaxBytes?: number;
  cacheTtlMs?: number;
  runConversion?: ConversionRunner;
};

function safeBaseName(fileName: string): string {
  const normalized = path.basename(fileName.trim() || "document");
  return normalized.replace(/[\u0000-\u001f\u007f]/g, "_") || "document";
}

function outputPdfName(fileName: string): string {
  const safeName = safeBaseName(fileName);
  const extension = path.extname(safeName);
  const stem = extension ? safeName.slice(0, -extension.length) : safeName;
  return `${stem || "document"}.pdf`;
}

function previewKey(input: OfficePreviewInput, sourceStat?: { size: number; mtimeMs: number }): string {
  const hash = createHash("sha256");
  hash.update(safeBaseName(input.fileName).toLowerCase());
  hash.update("\u0000");
  if (input.fingerprint?.trim()) {
    hash.update(input.fingerprint.trim());
  } else if (input.sourcePath && sourceStat) {
    hash.update(path.resolve(input.sourcePath));
    hash.update("\u0000");
    hash.update(String(sourceStat.size));
    hash.update("\u0000");
    hash.update(String(sourceStat.mtimeMs));
  } else if (input.content) {
    hash.update(input.content);
  }
  return hash.digest("hex");
}

async function defaultRunConversion(input: Parameters<ConversionRunner>[0]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const args = [
      `-env:UserInstallation=${pathToFileURL(input.profileDir).href}`,
      "--headless",
      "--convert-to",
      "pdf",
      "--outdir",
      input.outputDir,
      input.sourcePath
    ];
    const child = spawn(input.binaryPath, args, {
      stdio: ["ignore", "ignore", "pipe"]
    });
    const stderrChunks: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (stderrChunks.reduce((total, item) => total + item.length, 0) < 16 * 1024) {
        stderrChunks.push(buffer);
      }
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Office preview conversion timed out"));
    }, input.timeoutMs);
    timer.unref();
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      reject(
        new Error(
          stderr ||
            `Office preview conversion failed${signal ? ` (${signal})` : code === null ? "" : ` (exit ${code})`}`
        )
      );
    });
  });
}

export function supportsOfficePdfPreview(fileName: string): boolean {
  return OFFICE_PDF_EXTENSIONS.has(path.extname(safeBaseName(fileName)).toLowerCase());
}

export class OfficePreviewService {
  private readonly cacheRoot: string;
  private readonly binaryPath: string;
  private readonly timeoutMs: number;
  private readonly maxConcurrent: number;
  private readonly cacheMaxBytes: number;
  private readonly cacheTtlMs: number;
  private readonly runConversion: ConversionRunner;
  private readonly inFlight = new Map<string, Promise<OfficePdfPreview>>();
  private activeConversions = 0;
  private nextCleanupAt = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(options: OfficePreviewServiceOptions = {}) {
    this.cacheRoot =
      options.cacheRoot ||
      process.env.OFFICE_PREVIEW_CACHE_DIR?.trim() ||
      path.join(os.tmpdir(), "agent-studio-office-preview");
    this.binaryPath = options.binaryPath || process.env.LIBREOFFICE_BIN?.trim() || "soffice";
    this.timeoutMs = Math.max(1_000, options.timeoutMs ?? 90_000);
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? 2);
    this.cacheMaxBytes = Math.max(64 * 1024 * 1024, options.cacheMaxBytes ?? 2 * 1024 * 1024 * 1024);
    this.cacheTtlMs = Math.max(60 * 60 * 1_000, options.cacheTtlMs ?? 7 * 24 * 60 * 60 * 1_000);
    this.runConversion = options.runConversion || defaultRunConversion;
  }

  private async cleanupCacheIfNeeded(): Promise<void> {
    const now = Date.now();
    if (now < this.nextCleanupAt) return;
    this.nextCleanupAt = now + 60 * 60 * 1_000;
    const entries = await fs.readdir(this.cacheRoot, { withFileTypes: true }).catch(() => []);
    const cachedFiles = (
      await Promise.all(
        entries
          .filter((entry) => entry.isFile() && (entry.name.endsWith(".pdf") || entry.name.endsWith(".tmp")))
          .map(async (entry) => {
            const filePath = path.join(this.cacheRoot, entry.name);
            const stat = await fs.stat(filePath).catch(() => null);
            return stat?.isFile() ? { filePath, name: entry.name, size: stat.size, mtimeMs: stat.mtimeMs } : null;
          })
      )
    ).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    let retainedBytes = 0;
    for (const entry of cachedFiles.sort((left, right) => right.mtimeMs - left.mtimeMs)) {
      const expired = now - entry.mtimeMs > this.cacheTtlMs;
      const temporary = entry.name.endsWith(".tmp");
      const overLimit = retainedBytes + entry.size > this.cacheMaxBytes;
      if (temporary || expired || overLimit) {
        await fs.rm(entry.filePath, { force: true }).catch(() => undefined);
        continue;
      }
      retainedBytes += entry.size;
    }
  }

  private async acquire(): Promise<void> {
    if (this.activeConversions < this.maxConcurrent) {
      this.activeConversions += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.activeConversions += 1;
  }

  private release(): void {
    this.activeConversions = Math.max(0, this.activeConversions - 1);
    this.waiters.shift()?.();
  }

  async createPdfPreview(input: OfficePreviewInput): Promise<OfficePdfPreview> {
    if (!supportsOfficePdfPreview(input.fileName)) {
      throw new Error("This file type does not support paginated preview");
    }
    const sourceStat = input.sourcePath ? await fs.stat(input.sourcePath) : undefined;
    if (sourceStat && !sourceStat.isFile()) {
      throw new Error("Office preview source is not a file");
    }
    const key = previewKey(input, sourceStat);
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const pending = this.createPdfPreviewOnce(input, key);
    this.inFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async createPdfPreviewOnce(input: OfficePreviewInput, key: string): Promise<OfficePdfPreview> {
    await fs.mkdir(this.cacheRoot, { recursive: true });
    await this.cleanupCacheIfNeeded();
    const cachedPath = path.join(this.cacheRoot, `${key}.pdf`);
    const cached = await fs.stat(cachedPath).catch(() => null);
    if (cached?.isFile() && cached.size > 0) {
      return {
        buffer: await fs.readFile(cachedPath),
        fileName: outputPdfName(input.fileName),
        cacheHit: true
      };
    }

    await this.acquire();
    let jobDir = "";
    try {
      jobDir = await fs.mkdtemp(path.join(this.cacheRoot, "job-"));
      const sourceDir = path.join(jobDir, "source");
      const outputDir = path.join(jobDir, "output");
      const profileDir = path.join(jobDir, "profile");
      await Promise.all([
        fs.mkdir(sourceDir, { recursive: true }),
        fs.mkdir(outputDir, { recursive: true }),
        fs.mkdir(profileDir, { recursive: true })
      ]);
      const sourceFileName = safeBaseName(input.fileName);
      const sourcePath = path.join(sourceDir, `${randomUUID()}-${sourceFileName}`);
      if ("sourcePath" in input && input.sourcePath) {
        await fs.copyFile(input.sourcePath, sourcePath);
      } else {
        await fs.writeFile(sourcePath, input.content as Buffer);
      }

      await this.runConversion({
        sourcePath,
        outputDir,
        profileDir,
        timeoutMs: this.timeoutMs,
        binaryPath: this.binaryPath
      });

      const expectedPdf = path.join(outputDir, outputPdfName(path.basename(sourcePath)));
      const generated = await fs.stat(expectedPdf).catch(() => null);
      if (!generated?.isFile() || generated.size === 0) {
        throw new Error("Office preview conversion did not produce a PDF");
      }
      const stagedCachePath = `${cachedPath}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await fs.copyFile(expectedPdf, stagedCachePath);
        await fs.rename(stagedCachePath, cachedPath);
      } finally {
        await fs.rm(stagedCachePath, { force: true }).catch(() => undefined);
      }
      return {
        buffer: await fs.readFile(cachedPath),
        fileName: outputPdfName(input.fileName),
        cacheHit: false
      };
    } finally {
      if (jobDir) {
        await fs.rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
      }
      this.release();
    }
  }
}

export const officePreviewService = new OfficePreviewService();

export async function sendOfficePdfPreview(
  res: Response,
  input: OfficePreviewInput & { requested: boolean }
): Promise<boolean> {
  if (!input.requested || !supportsOfficePdfPreview(input.fileName)) return false;
  try {
    const preview = await officePreviewService.createPdfPreview(input);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Office-Preview-Cache", preview.cacheHit ? "hit" : "miss");
    res.setHeader("Content-Length", String(preview.buffer.length));
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(preview.fileName)}`);
    res.type("application/pdf");
    res.status(200).send(preview.buffer);
    return true;
  } catch (error) {
    console.warn("[office-preview] Falling back to the original file preview", {
      fileName: safeBaseName(input.fileName),
      detail: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}
