import fs from "node:fs/promises";
import path from "node:path";
import { Router, type Request, type Response } from "express";

import { isInternalOrganizationType, resolveResourceRoleIds } from "../auth/resource-role-context.js";
import { sendOfficePdfPreview } from "../files/office-preview-service.js";
import { detectedContentType, sendStructuredPreview } from "../files/structured-preview-service.js";
import type { PublicBrandService } from "../public-brands/service.js";
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
  publicBrands?: Pick<PublicBrandService, "getForOrganization">;
}): Router {
  const router = Router();

  router.get("/resources", async (req: Request, res: Response) => {
    const currentUser = req.currentUser;
    if (!currentUser) {
      res.status(401).json({ detail: "Unauthorized" });
      return;
    }

    if ((await options.publicBrands?.getForOrganization(req.currentOrganization?.id))?.resourceBindingMode === "brand_managed") {
      res.json({ knowledgeSets: [] });
      return;
    }

    const roleIds = resolveResourceRoleIds({
      platformRole: currentUser.role,
      organizationType: req.currentOrganization?.type,
      membershipType: req.currentMembership?.membershipType
    });
    const departmentIds = isInternalOrganizationType(req.currentOrganization?.type)
      ? await options.listDepartmentIdsForUser(currentUser.id)
      : [];

    const allKnowledgeSets = await options.knowledgeSets.list();
    const activeKnowledgeSets = allKnowledgeSets.filter(
      (knowledgeSet) => knowledgeSet.status === "active" && knowledgeSet.sourceType === MANAGED_UPLOAD_SOURCE_TYPE
    );
    const visibleKnowledgeSetIds = await options.policies.filterAllowedResources({
      organizationId: req.currentOrganization?.id,
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

    if ((await options.publicBrands?.getForOrganization(req.currentOrganization?.id))?.resourceBindingMode === "brand_managed") {
      res.status(403).json({ detail: "Knowledge-set files are managed by the assigned assistant" });
      return;
    }

    const rawPath = trimOrUndefined(req.query.path);
    if (!rawPath) {
      res.status(400).json({ detail: "Path is required" });
      return;
    }

    const normalizedRequestedPath = path.resolve(rawPath);
    if (!normalizedRequestedPath.includes(KNOWLEDGE_SET_PATH_SEGMENT)) {
      res.status(400).json({ detail: "Only knowledge-set file preview is supported" });
      return;
    }

    const roleIds = resolveResourceRoleIds({
      platformRole: currentUser.role,
      organizationType: req.currentOrganization?.type,
      membershipType: req.currentMembership?.membershipType
    });
    const departmentIds = isInternalOrganizationType(req.currentOrganization?.type)
      ? await options.listDepartmentIdsForUser(currentUser.id)
      : [];
    const allKnowledgeSets = await options.knowledgeSets.list();
    const activeKnowledgeSets = allKnowledgeSets.filter(
      (knowledgeSet) => knowledgeSet.status === "active" && knowledgeSet.sourceType === MANAGED_UPLOAD_SOURCE_TYPE
    );
    const visibleKnowledgeSetIds = await options.policies.filterAllowedResources({
      organizationId: req.currentOrganization?.id,
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
      res.status(403).json({ detail: "Current user does not have permission to preview this knowledge-set file" });
      return;
    }

    const stat = await fs.stat(normalizedRequestedPath).catch(() => null);
    if (!stat || !stat.isFile()) {
      res.status(404).json({ detail: "File does not exist" });
      return;
    }

    const fileName = path.basename(normalizedRequestedPath);
    if (
      await sendOfficePdfPreview(res, {
        requested: req.query.preview === "pdf",
        fileName,
        sourcePath: normalizedRequestedPath
      })
    ) {
      return;
    }
    if (
      await sendStructuredPreview(res, {
        requested:
          typeof req.query.preview === "string" && req.query.preview !== "pdf"
            ? req.query.preview as "auto" | "text" | "table" | "diagram"
            : undefined,
        fileName,
        sourcePath: normalizedRequestedPath,
        query: req.query
      })
    ) {
      return;
    }
    const ext = path.extname(fileName);
    const fileBuffer = await fs.readFile(normalizedRequestedPath);
    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.type(ext || await detectedContentType({ fileName, sourcePath: normalizedRequestedPath }));
    res.status(200).send(fileBuffer);
  });

  return router;
}
