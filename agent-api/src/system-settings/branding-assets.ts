import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const BRANDING_ASSET_KINDS = [
  "logo",
  "icon",
  "assistant-avatar",
  "login-background",
  "portal-welcome-illustration"
] as const;
export type BrandingAssetKind = (typeof BRANDING_ASSET_KINDS)[number];

type BrandingAssetUploadFile = {
  buffer: Buffer;
  mimetype?: string;
  originalname?: string;
  size?: number;
};

type BrandingAssetImageType = {
  extension: "png" | "jpg" | "webp";
  mimeType: "image/png" | "image/jpeg" | "image/webp";
};

type BrandingAssetSaveResult = {
  url: string;
  fileName: string;
  mimeType: BrandingAssetImageType["mimeType"];
  sizeBytes: number;
};

type BrandingAssetReadResult = {
  absolutePath: string;
  mimeType: BrandingAssetImageType["mimeType"];
};

const ASSET_FILE_PATTERN = /^(logo|icon|assistant-avatar|login-background|portal-welcome-illustration)-[a-f0-9]{24}\.(png|jpg|webp)$/;

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error !== null && typeof error === "object" && "code" in error;
}

function detectImageType(buffer: Buffer): BrandingAssetImageType | undefined {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: "png", mimeType: "image/png" };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: "jpg", mimeType: "image/jpeg" };
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { extension: "webp", mimeType: "image/webp" };
  }
  return undefined;
}

function mimeTypeForFileName(fileName: string): BrandingAssetImageType["mimeType"] | undefined {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return undefined;
}

function ensureInsideRoot(rootDir: string, candidatePath: string): string {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedCandidate = path.resolve(candidatePath);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("branding asset path escapes storage root");
  }
  return resolvedCandidate;
}

export function parseBrandingAssetKind(value: unknown): BrandingAssetKind {
  const normalized = typeof value === "string" ? value.trim() : "";
  if ((BRANDING_ASSET_KINDS as readonly string[]).includes(normalized)) {
    return normalized as BrandingAssetKind;
  }
  throw new Error("kind must be logo, icon, assistant-avatar, login-background, or portal-welcome-illustration");
}

export class BrandingAssetStorage {
  constructor(private readonly rootDir: string) {}

  async save(input: { kind: BrandingAssetKind; file: BrandingAssetUploadFile }): Promise<BrandingAssetSaveResult> {
    const buffer = input.file.buffer;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error("uploaded file is empty");
    }
    const imageType = detectImageType(buffer);
    if (!imageType) {
      throw new Error("only PNG, JPG, and WebP images can be uploaded");
    }

    const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 24);
    const fileName = `${input.kind}-${hash}.${imageType.extension}`;
    const absolutePath = ensureInsideRoot(this.rootDir, path.join(this.rootDir, fileName));
    await fs.mkdir(this.rootDir, { recursive: true });
    try {
      await fs.writeFile(absolutePath, buffer, { flag: "wx" });
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") {
        throw error;
      }
    }

    return {
      url: `/public-api/branding/assets/${encodeURIComponent(fileName)}`,
      fileName,
      mimeType: imageType.mimeType,
      sizeBytes: buffer.length
    };
  }

  async resolveForRead(fileName: string): Promise<BrandingAssetReadResult | undefined> {
    const normalizedFileName = fileName.trim();
    if (!ASSET_FILE_PATTERN.test(normalizedFileName)) {
      return undefined;
    }
    const mimeType = mimeTypeForFileName(normalizedFileName);
    if (!mimeType) {
      return undefined;
    }
    const absolutePath = ensureInsideRoot(this.rootDir, path.join(this.rootDir, normalizedFileName));
    const stat = await fs.stat(absolutePath).catch(() => null);
    if (!stat?.isFile()) {
      return undefined;
    }
    return { absolutePath, mimeType };
  }
}
