import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { RuntimeStreamEvent } from "../live-runtime-session.js";

export type RuntimeFileChange = {
  path: string;
  kind: string;
  sourcePath?: string;
  dataBase64?: string;
  metadata?: Record<string, unknown>;
};

const GENERATED_IMAGE_ITEM_TYPES = new Set(["image_generation_call", "image_generation_end"]);
const GENERATED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const GENERATED_IMAGE_DEST_DIR = "artifacts/generated-images";
const GENERATED_IMAGE_SCAN_LIMIT = 50;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeGeneratedImageName(value: string | undefined, fallback: string): string {
  const rawName = trimOrUndefined(value) ?? fallback;
  const extension = path.extname(rawName).toLowerCase();
  const base = path.basename(rawName, extension).replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  const safeBase = base || fallback;
  const safeExtension = GENERATED_IMAGE_EXTENSIONS.has(extension) ? extension : ".png";
  return `${safeBase}${safeExtension}`;
}

function imagePayloadCandidates(event: RuntimeStreamEvent): Record<string, unknown>[] {
  const raw = asRecord(event.raw);
  const payload = asRecord(raw?.payload);
  const payloadItem = asRecord(payload?.item);
  const direct = asRecord(event);
  return [asRecord(raw?.item), payloadItem, payload, raw, direct].filter((item): item is Record<string, unknown> => Boolean(item));
}

function extractRuntimeGeneratedImageChanges(event: RuntimeStreamEvent): RuntimeFileChange[] {
  const out: RuntimeFileChange[] = [];
  const seen = new Set<string>();
  for (const item of imagePayloadCandidates(event)) {
    const itemType = trimOrUndefined(item.type);
    if (!itemType || !GENERATED_IMAGE_ITEM_TYPES.has(itemType)) continue;

    const sourcePath = trimOrUndefined(item.saved_path) ?? trimOrUndefined(item.savedPath);
    const dataBase64 = trimOrUndefined(item.result);
    if (!sourcePath && !dataBase64) continue;

    const id = trimOrUndefined(item.id) ?? trimOrUndefined(item.call_id) ?? trimOrUndefined(item.callId);
    const key = sourcePath ?? id ?? createHash("sha256").update(dataBase64 ?? "").digest("hex");
    if (seen.has(key)) continue;
    seen.add(key);

    const fileName = normalizeGeneratedImageName(sourcePath ? path.basename(sourcePath) : id, "generated-image");
    out.push({
      path: sourcePath ?? fileName,
      kind: "generated_image",
      sourcePath,
      dataBase64,
      metadata: {
        runtimeItemType: itemType,
        imageGenerationId: id,
        revisedPrompt: trimOrUndefined(item.revised_prompt) ?? trimOrUndefined(item.revisedPrompt)
      }
    });
  }
  return out;
}

function extractRuntimeStandardFileChanges(event: RuntimeStreamEvent): RuntimeFileChange[] {
  const raw = asRecord(event.raw);
  const item = asRecord(raw?.item);
  if (event.type !== "item.completed" || !item || item.type !== "file_change") return [];
  const changes = Array.isArray(item.changes) ? item.changes : [];
  const out: RuntimeFileChange[] = [];
  const seen = new Set<string>();
  for (const change of changes) {
    const payload = asRecord(change);
    if (!payload) continue;
    const filePath = trimOrUndefined(payload.path);
    if (!filePath) continue;
    const kind = trimOrUndefined(payload.kind) ?? "update";
    const key = `${kind}::${filePath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path: filePath, kind });
  }
  return out;
}

export function extractRuntimeFileChanges(event: RuntimeStreamEvent): RuntimeFileChange[] {
  return [
    ...extractRuntimeStandardFileChanges(event),
    ...extractRuntimeGeneratedImageChanges(event)
  ];
}

export async function collectRuntimeGeneratedImageChanges(input: {
  codexHome?: string;
  codexThreadId?: string;
  changedAfter?: Date;
  limit?: number;
}): Promise<RuntimeFileChange[]> {
  const codexHome = trimOrUndefined(input.codexHome);
  const codexThreadId = trimOrUndefined(input.codexThreadId);
  if (!codexHome || !codexThreadId) return [];

  const resolvedCodexHome = path.resolve(codexHome);
  const generatedImageRoot = path.resolve(resolvedCodexHome, "generated_images", codexThreadId);
  if (!isPathInside(resolvedCodexHome, generatedImageRoot)) return [];

  const sinceMs = input.changedAfter?.getTime() ?? 0;
  const limit = Math.max(1, Math.min(input.limit ?? GENERATED_IMAGE_SCAN_LIMIT, GENERATED_IMAGE_SCAN_LIMIT));
  const out: RuntimeFileChange[] = [];
  const seen = new Set<string>();

  const scanDir = async (dir: string) => {
    if (out.length >= limit || !isPathInside(generatedImageRoot, dir)) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (out.length >= limit) break;
      if (entry.name.startsWith(".")) continue;
      const absolutePath = path.resolve(dir, entry.name);
      if (!isPathInside(generatedImageRoot, absolutePath)) continue;
      if (entry.isDirectory()) {
        await scanDir(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!GENERATED_IMAGE_EXTENSIONS.has(extension)) continue;
      const stat = await fs.stat(absolutePath).catch(() => null);
      if (!stat || !stat.isFile()) continue;
      if (sinceMs > 0 && stat.mtimeMs + 2000 < sinceMs) continue;
      if (seen.has(absolutePath)) continue;
      seen.add(absolutePath);

      out.push({
        path: absolutePath,
        kind: "generated_image",
        sourcePath: absolutePath,
        metadata: {
          runtimeItemType: "generated_image_scan",
          imageGenerationId: path.basename(entry.name, extension)
        }
      });
    }
  };

  await scanDir(generatedImageRoot);
  return out;
}

export async function materializeRuntimeGeneratedImageChanges(input: {
  changes: RuntimeFileChange[];
  workspacePath: string;
  codexHome?: string;
}): Promise<RuntimeFileChange[]> {
  const workspace = path.resolve(input.workspacePath);
  const codexHome = trimOrUndefined(input.codexHome) ? path.resolve(input.codexHome!) : undefined;
  const out: RuntimeFileChange[] = [];
  const seen = new Set<string>();

  for (const change of input.changes) {
    if (change.kind !== "generated_image") {
      out.push(change);
      continue;
    }

    const sourcePath = trimOrUndefined(change.sourcePath);
    const dataBase64 = trimOrUndefined(change.dataBase64);
    const sourceAbsolutePath = sourcePath && path.isAbsolute(sourcePath) ? path.resolve(sourcePath) : undefined;
    const sourceExtension = sourceAbsolutePath ? path.extname(sourceAbsolutePath).toLowerCase() : "";
    if (sourceAbsolutePath && sourceExtension && !GENERATED_IMAGE_EXTENSIONS.has(sourceExtension)) {
      continue;
    }
    const sourceInsideWorkspace = Boolean(sourceAbsolutePath && isPathInside(workspace, sourceAbsolutePath));
    const sourceInsideCodexHome = Boolean(sourceAbsolutePath && codexHome && isPathInside(codexHome, sourceAbsolutePath));

    if (sourceAbsolutePath && sourceInsideWorkspace) {
      out.push({ ...change, path: sourceAbsolutePath, dataBase64: undefined });
      continue;
    }
    if (sourceAbsolutePath && !sourceInsideCodexHome) {
      continue;
    }
    if (!sourceAbsolutePath && !dataBase64) {
      continue;
    }

    const generatedName = sourceAbsolutePath
      ? normalizeGeneratedImageName(path.basename(sourceAbsolutePath), "generated-image")
      : normalizeGeneratedImageName(trimOrUndefined(change.metadata?.imageGenerationId), "generated-image");
    const key = sourceAbsolutePath ?? generatedName;
    if (seen.has(key)) continue;
    seen.add(key);

    const destinationRelativePath = path.join(GENERATED_IMAGE_DEST_DIR, generatedName);
    const destinationAbsolutePath = path.resolve(workspace, destinationRelativePath);
    if (!isPathInside(workspace, destinationAbsolutePath)) continue;

    await fs.mkdir(path.dirname(destinationAbsolutePath), { recursive: true });
    if (sourceAbsolutePath) {
      try {
        await fs.copyFile(sourceAbsolutePath, destinationAbsolutePath);
      } catch (error) {
        if (!dataBase64) continue;
        await fs.writeFile(destinationAbsolutePath, Buffer.from(dataBase64, "base64"));
      }
    } else {
      await fs.writeFile(destinationAbsolutePath, Buffer.from(dataBase64!, "base64"));
    }

    out.push({
      path: destinationRelativePath,
      kind: change.kind,
      sourcePath: sourceAbsolutePath,
      metadata: change.metadata
    });
  }

  return out;
}
