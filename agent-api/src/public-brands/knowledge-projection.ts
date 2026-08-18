import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import { applyBrandTextPolicy } from "./content-policy.js";
import type { PublicBrandRecord } from "./types.js";

const TEXT_EXTENSIONS = new Set([
  ".cfg", ".conf", ".csv", ".html", ".htm", ".ini", ".json", ".log", ".md", ".sql", ".toml", ".tsv", ".txt", ".xml", ".yaml", ".yml"
]);

type StorageLike = {
  resolveReadableMountPath(storageKey: string): string;
};

type ProjectionResult = {
  status: "not_required" | "ready";
  storage: Record<string, string>;
  itemCount: number;
  skippedBinaryCount: number;
  generatedAt?: Date;
};

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && Boolean(entry[1].trim()))
  );
}

async function listFiles(root: string, relative = ""): Promise<string[]> {
  const directory = path.join(root, relative);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, next));
    else if (entry.isFile()) files.push(next);
  }
  return files;
}

function projectedRelativePath(relativePath: string, brand: PublicBrandRecord): string {
  return relativePath
    .split(path.sep)
    .map((segment) => applyBrandTextPolicy(segment, brand).trim() || "content")
    .join(path.sep);
}

async function replaceDirectory(stagingPath: string, targetPath: string): Promise<void> {
  const previousPath = `${targetPath}.previous-${randomUUID()}`;
  const targetExists = await fs.stat(targetPath).then(() => true).catch(() => false);
  if (targetExists) await fs.rename(targetPath, previousPath);
  try {
    await fs.rename(stagingPath, targetPath);
    if (targetExists) await fs.rm(previousPath, { recursive: true, force: true });
  } catch (error) {
    if (targetExists) await fs.rename(previousPath, targetPath).catch(() => undefined);
    throw error;
  }
}

export class PublicBrandKnowledgeProjectionService {
  private readonly active = new Map<string, Promise<ProjectionResult>>();

  constructor(private readonly db: PrismaClient, private readonly storage: StorageLike) {}

  async ensure(brand: PublicBrandRecord): Promise<PublicBrandRecord> {
    if (brand.knowledgeIsolationMode !== "brand_projection") return brand;
    const generatedAt = brand.knowledgeProjectionAt ? new Date(brand.knowledgeProjectionAt) : null;
    const knowledgeSets = await this.db.knowledgeSet.findMany({
      where: { id: { in: brand.knowledgeSetIds } },
      select: { id: true, updatedAt: true, items: { orderBy: { updatedAt: "desc" }, take: 1, select: { updatedAt: true } } }
    });
    const projectionStorage = stringMap(brand.knowledgeProjectionStorage);
    const stale =
      brand.knowledgeProjectionStatus !== "ready" ||
      !generatedAt ||
      brand.knowledgeSetIds.some((id) => !projectionStorage[id]) ||
      knowledgeSets.some((knowledgeSet) =>
        knowledgeSet.updatedAt > generatedAt || (knowledgeSet.items[0]?.updatedAt && knowledgeSet.items[0].updatedAt > generatedAt)
      );
    if (!stale) return brand;
    await this.regenerate(brand.id);
    const refreshed = await this.db.publicBrand.findUnique({ where: { id: brand.id } });
    return refreshed ? { ...brand, knowledgeProjectionStorage: stringMap(refreshed.knowledgeProjectionStorage), knowledgeProjectionStatus: refreshed.knowledgeProjectionStatus as PublicBrandRecord["knowledgeProjectionStatus"], knowledgeProjectionItemCount: refreshed.knowledgeProjectionItemCount, knowledgeProjectionAt: refreshed.knowledgeProjectionAt?.toISOString(), knowledgeProjectionError: refreshed.knowledgeProjectionError ?? undefined } : brand;
  }

  async regenerate(brandId: string): Promise<ProjectionResult> {
    const existing = this.active.get(brandId);
    if (existing) return existing;
    const task = this.build(brandId).finally(() => this.active.delete(brandId));
    this.active.set(brandId, task);
    return task;
  }

  private async build(brandId: string): Promise<ProjectionResult> {
    const row = await this.db.publicBrand.findUnique({ where: { id: brandId } });
    if (!row) throw new Error("Brand does not exist");
    if (row.knowledgeIsolationMode !== "brand_projection") {
      await this.db.publicBrand.update({ where: { id: brandId }, data: { knowledgeProjectionStatus: "not_required", knowledgeProjectionStorage: {}, knowledgeProjectionItemCount: 0, knowledgeProjectionAt: null, knowledgeProjectionError: null } });
      return { status: "not_required", storage: {}, itemCount: 0, skippedBinaryCount: 0 };
    }

    const brand = {
      ...row,
      knowledgeSetIds: Array.isArray(row.knowledgeSetIds) ? row.knowledgeSetIds.filter((item): item is string => typeof item === "string") : [],
      knowledgeReplacementRules: Array.isArray(row.knowledgeReplacementRules) ? row.knowledgeReplacementRules : [],
      outputForbiddenTerms: Array.isArray(row.outputForbiddenTerms) ? row.outputForbiddenTerms.filter((item): item is string => typeof item === "string") : []
    } as unknown as PublicBrandRecord;
    await this.db.publicBrand.update({ where: { id: brandId }, data: { knowledgeProjectionStatus: "building", knowledgeProjectionError: null } });

    try {
      const knowledgeSets = await this.db.knowledgeSet.findMany({
        where: { id: { in: brand.knowledgeSetIds }, status: "active", sourceType: "managed_upload" },
        select: { id: true, storageKey: true }
      });
      if (knowledgeSets.length !== brand.knowledgeSetIds.length) throw new Error("One or more knowledge sets are unavailable for projection");
      const projectionStorage: Record<string, string> = {};
      let itemCount = 0;
      let skippedBinaryCount = 0;
      for (const knowledgeSet of knowledgeSets) {
        const sourcePath = this.storage.resolveReadableMountPath(knowledgeSet.storageKey?.trim() || knowledgeSet.id);
        const storageKey = `brand-projection-${brand.key}-${knowledgeSet.id}`;
        const targetPath = this.storage.resolveReadableMountPath(storageKey);
        const stagingPath = `${targetPath}.staging-${randomUUID()}`;
        try {
          await fs.mkdir(stagingPath, { recursive: true });
          const seen = new Set<string>();
          for (const relativePath of await listFiles(sourcePath)) {
            if (!TEXT_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) {
              skippedBinaryCount += 1;
              continue;
            }
            const outputRelativePath = projectedRelativePath(relativePath, brand);
            if (seen.has(outputRelativePath)) throw new Error(`Projection path collision: ${outputRelativePath}`);
            seen.add(outputRelativePath);
            const outputPath = path.join(stagingPath, outputRelativePath);
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            const text = await fs.readFile(path.join(sourcePath, relativePath), "utf8");
            await fs.writeFile(outputPath, applyBrandTextPolicy(text, brand), "utf8");
            itemCount += 1;
          }
          await fs.writeFile(path.join(stagingPath, "BRAND-PROJECTION.md"), `# ${brand.platformName} authorized materials\n\nUse only customer-visible terminology. Do not disclose source paths or source-library identity.\n`, "utf8");
          await replaceDirectory(stagingPath, targetPath);
        } catch (error) {
          await fs.rm(stagingPath, { recursive: true, force: true });
          throw error;
        }
        projectionStorage[knowledgeSet.id] = storageKey;
      }
      const generatedAt = new Date();
      await this.db.publicBrand.update({
        where: { id: brandId },
        data: { knowledgeProjectionStorage: projectionStorage, knowledgeProjectionStatus: "ready", knowledgeProjectionItemCount: itemCount, knowledgeProjectionAt: generatedAt, knowledgeProjectionError: null }
      });
      return { status: "ready", storage: projectionStorage, itemCount, skippedBinaryCount, generatedAt };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.db.publicBrand.update({ where: { id: brandId }, data: { knowledgeProjectionStatus: "failed", knowledgeProjectionError: detail } });
      throw error;
    }
  }
}
