import fs from "node:fs/promises";
import path from "node:path";
import { Router, type Request, type Response } from "express";

import { PolicyService } from "./policy-service.js";
import type { KnowledgeSetStorage } from "./storage/knowledge-set-storage.js";

type KnowledgeSetRecord = {
  id: string;
  name: string;
  slug: string;
  status: string;
  sourceType: string;
  storageKey?: string;
};

type KnowledgeSetRepositoryLike = {
  list(): Promise<KnowledgeSetRecord[]>;
};

const MANAGED_UPLOAD_SOURCE_TYPE = "managed_upload";
const KNOWLEDGE_SET_PATH_SEGMENT = `${path.sep}data${path.sep}knowledge-sets${path.sep}`;

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function isPathInside(parentDir: string, candidatePath: string): boolean {
  const normalizedParent = path.resolve(parentDir);
  const normalizedCandidate = path.resolve(candidatePath);
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}${path.sep}`);
}

export function createResourcesPortalRouter(options: {
  knowledgeSets: KnowledgeSetRepositoryLike;
  storage: Pick<KnowledgeSetStorage, "resolveReadableMountPath">;
  policies: Pick<PolicyService, "filterAllowedResources">;
  listDepartmentIdsForUser(userId: string): Promise<string[]>;
}): Router {
  const router = Router();

  router.get("/resources", async (req: Request, res: Response) => {
    const currentUser = req.currentUser;
    if (!currentUser) {
      res.status(401).json({ detail: "Unauthorized" });
      return;
    }

    const roleIds = [currentUser.role ?? "employee"];
    const departmentIds = await options.listDepartmentIdsForUser(currentUser.id);

    const allKnowledgeSets = await options.knowledgeSets.list();
    const activeKnowledgeSets = allKnowledgeSets.filter(
      (knowledgeSet) => knowledgeSet.status === "active" && knowledgeSet.sourceType === MANAGED_UPLOAD_SOURCE_TYPE
    );
    const visibleKnowledgeSetIds = await options.policies.filterAllowedResources({
      userId: currentUser.id,
      roleIds,
      departmentIds,
      resourceType: "knowledge_set",
      candidateIds: activeKnowledgeSets.map((knowledgeSet) => knowledgeSet.id)
    });

    const visibleKnowledgeSetIdSet = new Set(visibleKnowledgeSetIds);
    const knowledgeSets = activeKnowledgeSets
      .filter((knowledgeSet) => visibleKnowledgeSetIdSet.has(knowledgeSet.id))
      .map((knowledgeSet) => ({
        id: knowledgeSet.id,
        label: knowledgeSet.name,
        slug: knowledgeSet.slug
      }));

    res.json({ knowledgeSets });
  });

  router.get("/resources/files/content", async (req: Request, res: Response) => {
    const currentUser = req.currentUser;
    if (!currentUser) {
      res.status(401).json({ detail: "Unauthorized" });
      return;
    }

    const rawPath = trimOrUndefined(req.query.path);
    if (!rawPath) {
      res.status(400).json({ detail: "path 不能为空" });
      return;
    }

    const normalizedRequestedPath = path.resolve(rawPath);
    if (!normalizedRequestedPath.includes(KNOWLEDGE_SET_PATH_SEGMENT)) {
      res.status(400).json({ detail: "仅支持资料集文件预览" });
      return;
    }

    const roleIds = [currentUser.role ?? "employee"];
    const departmentIds = await options.listDepartmentIdsForUser(currentUser.id);
    const allKnowledgeSets = await options.knowledgeSets.list();
    const activeKnowledgeSets = allKnowledgeSets.filter(
      (knowledgeSet) => knowledgeSet.status === "active" && knowledgeSet.sourceType === MANAGED_UPLOAD_SOURCE_TYPE
    );
    const visibleKnowledgeSetIds = await options.policies.filterAllowedResources({
      userId: currentUser.id,
      roleIds,
      departmentIds,
      resourceType: "knowledge_set",
      candidateIds: activeKnowledgeSets.map((knowledgeSet) => knowledgeSet.id)
    });
    const visibleKnowledgeSetIdSet = new Set(visibleKnowledgeSetIds);
    const visibleKnowledgeSets = activeKnowledgeSets.filter((knowledgeSet) => visibleKnowledgeSetIdSet.has(knowledgeSet.id));

    const matchedKnowledgeSet = visibleKnowledgeSets.find((knowledgeSet) => {
      try {
        const mountPath = options.storage.resolveReadableMountPath(trimOrUndefined(knowledgeSet.storageKey) ?? knowledgeSet.id);
        return isPathInside(mountPath, normalizedRequestedPath);
      } catch {
        return false;
      }
    });
    if (!matchedKnowledgeSet) {
      res.status(403).json({ detail: "当前用户无权预览该资料集文件" });
      return;
    }

    const stat = await fs.stat(normalizedRequestedPath).catch(() => null);
    if (!stat || !stat.isFile()) {
      res.status(404).json({ detail: "文件不存在" });
      return;
    }

    const fileName = path.basename(normalizedRequestedPath);
    const ext = path.extname(fileName);
    const fileBuffer = await fs.readFile(normalizedRequestedPath);
    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.type(ext || "application/octet-stream");
    res.status(200).send(fileBuffer);
  });

  return router;
}
