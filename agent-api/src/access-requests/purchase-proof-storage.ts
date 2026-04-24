import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type PurchaseProofUploadFile = {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  buffer: Buffer;
};

export type StoredPurchaseProofFile = {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
};

function sanitizePathSegment(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replace(/[\/\\]/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function normalizeMimeType(value: string | undefined): string {
  return value?.trim() || "application/octet-stream";
}

export class PurchaseProofStorage {
  constructor(private readonly rootPath: string) {}

  async saveFiles(accessRequestId: string, files: PurchaseProofUploadFile[]): Promise<StoredPurchaseProofFile[]> {
    const safeRequestId = sanitizePathSegment(accessRequestId, "request");
    const requestDir = path.join(this.rootPath, safeRequestId);
    await fs.mkdir(requestDir, { recursive: true });

    const stored: StoredPurchaseProofFile[] = [];
    for (const file of files) {
      const safeName = sanitizePathSegment(file.originalName, "purchase-proof.bin");
      const storedName = `${Date.now()}-${randomUUID().replace(/-/g, "").slice(0, 10)}-${safeName}`;
      const storagePath = path.join(requestDir, storedName);
      await fs.writeFile(storagePath, file.buffer);
      stored.push({
        originalName: file.originalName.trim() || safeName,
        mimeType: normalizeMimeType(file.mimeType),
        sizeBytes: file.sizeBytes,
        storagePath
      });
    }
    return stored;
  }

  async readFile(storagePath: string): Promise<Buffer> {
    const root = path.resolve(this.rootPath);
    const target = path.resolve(storagePath);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      throw new Error("Purchase proof file path is invalid");
    }
    return fs.readFile(target);
  }
}
