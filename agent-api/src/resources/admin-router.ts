import express, { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import multer, { MulterError } from "multer";

import type { ResourcePolicyRecord } from "../persistence/resource-policy-repository.js";
import { deleteFile, renameFile, scanDirectory } from "./filesystem-knowledge-set-ops.js";
import type { KnowledgeSetStorage } from "./storage/knowledge-set-storage.js";

const MANAGED_UPLOAD_SOURCE_TYPE = "managed_upload";

type KnowledgeSetRepositoryLike = {
  list(): Promise<Array<{ sourceType?: string; slug?: string } & Record<string, unknown>>>;
  create(payload: {
    organizationId?: string;
    name: string;
    slug: string;
    description?: string;
    status?: string;
    sourceType: string;
    rootPath?: string;
    storageKey?: string;
  }): Promise<unknown>;
  update(
    id: string,
    payload: {
      organizationId?: string;
      name?: string;
      slug?: string;
      description?: string;
      status?: string;
      sourceType?: string;
      rootPath?: string;
      storageKey?: string;
    }
  ): Promise<unknown>;
  get(id: string): Promise<{ id: string; organizationId?: string; sourceType?: string; rootPath?: string } | undefined>;
  listItems(id: string): Promise<unknown[]>;
  replaceItems(
    id: string,
    items: Array<{
      kind: string;
      relativePath: string;
      displayName: string;
      mimeType?: string;
      sizeBytes?: bigint;
      checksum?: string;
      sourceArchiveName?: string;
    }>
  ): Promise<unknown>;
};

type ResourcePolicyRepositoryLike = {
  listAll(): Promise<ResourcePolicyRecord[]>;
  replacePolicies(
    policies: Array<Omit<ResourcePolicyRecord, "id" | "createdAt" | "updatedAt">>
  ): Promise<ResourcePolicyRecord[]>;
  replacePoliciesForResource(input: {
    resourceType: ResourcePolicyRecord["resourceType"];
    resourceId: string;
    policies: Array<Omit<ResourcePolicyRecord, "id" | "createdAt" | "updatedAt">>;
  }): Promise<ResourcePolicyRecord[]>;
  replacePoliciesForGroups(input: {
    groups: Array<{
      subjectType: ResourcePolicyRecord["subjectType"];
      subjectId: string;
      resourceType: ResourcePolicyRecord["resourceType"];
    }>;
    policies: Array<Omit<ResourcePolicyRecord, "id" | "createdAt" | "updatedAt">>;
  }): Promise<ResourcePolicyRecord[]>;
};

type ResourceAccessLogServiceLike = {
  record(input: {
    userId?: string;
    resourceType: string;
    resourceId: string;
    actionType: string;
    resultStatus: string;
    metadata?: unknown;
  }): Promise<unknown>;
};

type ResourcePolicyInput = {
  subjectType: ResourcePolicyRecord["subjectType"];
  subjectId: string;
  effect: ResourcePolicyRecord["effect"];
};

type ResourcePolicyGroupInput = {
  subjectType: ResourcePolicyRecord["subjectType"];
  subjectId: string;
  resourceType: ResourcePolicyRecord["resourceType"];
};

type ResourcePolicyReplacementInput = Omit<ResourcePolicyRecord, "id" | "createdAt" | "updatedAt">;

function detailFromError(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败";
}

function detailFromKnowledgeSetCreateError(error: unknown): string {
  const message = detailFromError(error);
  const normalized = message.toLowerCase();
  if (normalized.includes("unique constraint failed") && normalized.includes("slug")) {
    return "资料集 slug 已存在，请更换资料集名称后重试";
  }
  return message;
}

function isNotFoundError(error: unknown): boolean {
  const message = detailFromError(error).toLowerCase();
  return message.includes("不存在") || message.includes("not found");
}

function toTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 10,
    fileSize: 5 * 1024 * 1024
  }
});

function withMultipartFiles(fieldName: string) {
  const middleware = upload.array(fieldName);
  return (req: Request, res: Response, next: NextFunction) => {
    middleware(req, res, (error) => {
      if (error) {
        next(error);
        return;
      }
      next();
    });
  };
}

function normalizeKnowledgeSetSourceType(value: unknown): typeof MANAGED_UPLOAD_SOURCE_TYPE {
  const sourceType = toTrimmedString(value) ?? MANAGED_UPLOAD_SOURCE_TYPE;
  if (sourceType !== MANAGED_UPLOAD_SOURCE_TYPE) {
    throw new Error("filesystem 资料集已下线，仅支持 managed_upload");
  }
  return MANAGED_UPLOAD_SOURCE_TYPE;
}

function normalizeKnowledgeSetName(value: unknown): string {
  const name = toTrimmedString(value);
  if (!name) {
    throw new Error("资料集名称不能为空");
  }
  return name;
}

function slugifyValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function normalizeKnowledgeSetSlug(value: unknown): string | undefined {
  const rawSlug = toTrimmedString(value);
  if (!rawSlug) return undefined;
  const normalized = slugifyValue(rawSlug);
  if (!normalized) {
    throw new Error("资料集 slug 仅支持英文、数字和连字符");
  }
  return normalized;
}

function suggestUniqueSlug(base: string, existingSlugs: Iterable<string>): string {
  const seed = slugifyValue(base) || "knowledge-set";
  const taken = new Set(
    Array.from(existingSlugs)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
  if (!taken.has(seed)) return seed;
  let index = 2;
  let candidate = `${seed}-${index}`;
  while (taken.has(candidate)) {
    index += 1;
    candidate = `${seed}-${index}`;
  }
  return candidate;
}

function resolveCreateKnowledgeSetSlug(input: {
  requestedSlug: unknown;
  name: string;
  existingKnowledgeSets: Array<{ slug?: string } & Record<string, unknown>>;
}): string {
  const existingSlugs = input.existingKnowledgeSets
    .map((knowledgeSet) => toTrimmedString(knowledgeSet.slug))
    .filter((slug): slug is string => Boolean(slug));
  const requestedSlug = normalizeKnowledgeSetSlug(input.requestedSlug);
  if (requestedSlug) {
    const taken = new Set(existingSlugs.map((item) => item.toLowerCase()));
    if (taken.has(requestedSlug)) {
      throw new Error("资料集 slug 已存在，请更换资料集名称后重试");
    }
    return requestedSlug;
  }
  return suggestUniqueSlug(input.name, existingSlugs);
}

function parsePolicyArray(body: unknown, options?: { requireExplicitArray?: boolean }): unknown[] {
  if (!body || typeof body !== "object") {
    if (options?.requireExplicitArray) {
      throw new Error("invalid resource policy payload");
    }
    return [];
  }
  const rawPolicies = (body as { policies?: unknown }).policies;
  if (rawPolicies === undefined) {
    if (options?.requireExplicitArray) {
      throw new Error("invalid resource policy payload");
    }
    return [];
  }
  if (!Array.isArray(rawPolicies)) {
    throw new Error("invalid resource policy payload");
  }
  return rawPolicies;
}

function parseResourcePolicies(body: unknown, options?: { requireExplicitArray?: boolean }): ResourcePolicyInput[] {
  const rawPolicies = parsePolicyArray(body, options);
  return rawPolicies.map((policy, index) => {
    if (!policy || typeof policy !== "object") {
      throw new Error(`invalid resource policy payload at index ${index}`);
    }
    const subjectType = (policy as { subjectType?: ResourcePolicyRecord["subjectType"] }).subjectType;
    const subjectId = String((policy as { subjectId?: unknown }).subjectId ?? "").trim();
    const effect = (policy as { effect?: ResourcePolicyRecord["effect"] }).effect;
    if (!(subjectType === "role" || subjectType === "department" || subjectType === "user")) {
      throw new Error(`invalid resource policy subjectType at index ${index}`);
    }
    if (!(effect === "allow" || effect === "deny")) {
      throw new Error(`invalid resource policy effect at index ${index}`);
    }
    if (!subjectId) {
      throw new Error(`invalid resource policy subjectId at index ${index}`);
    }
    return {
      subjectType,
      subjectId,
      effect
    };
  });
}

function parseDeleteKnowledgeSetItem(body: unknown): { relativePath: string } {
  const relativePath = toTrimmedString(body && typeof body === "object" ? (body as { relativePath?: unknown }).relativePath : undefined);
  if (!relativePath) {
    throw new Error("knowledge set relativePath is required");
  }
  return { relativePath };
}

function parsePatchKnowledgeSetItem(body: unknown): { action: "rename"; relativePath: string; nextRelativePath: string } {
  const action = body && typeof body === "object" ? String((body as { action?: unknown }).action ?? "") : "";
  const relativePath = toTrimmedString(body && typeof body === "object" ? (body as { relativePath?: unknown }).relativePath : undefined);
  const nextRelativePath = toTrimmedString(
    body && typeof body === "object" ? (body as { nextRelativePath?: unknown }).nextRelativePath : undefined
  );
  if (action !== "rename" || !relativePath || !nextRelativePath) {
    throw new Error("knowledge set item patch payload is invalid");
  }
  return { action: "rename", relativePath, nextRelativePath };
}

function resolveKnowledgeSetRoot(
  knowledgeSet: { sourceType?: string; rootPath?: string },
  storage: KnowledgeSetStorage,
  knowledgeSetId: string
): string {
  if (knowledgeSet.sourceType === MANAGED_UPLOAD_SOURCE_TYPE) {
    return storage.resolveReadableMountPath(knowledgeSetId);
  }
  throw new Error("filesystem 资料集已下线，仅支持 managed_upload");
}

function parseReplacePoliciesRequest(body: unknown): {
  policies: ResourcePolicyReplacementInput[];
  groups?: ResourcePolicyGroupInput[];
} {
  const rawPolicies = parsePolicyArray(body, { requireExplicitArray: true });
  const policies = rawPolicies.map((policy, index) => {
    if (!policy || typeof policy !== "object") {
      throw new Error(`invalid resource policy payload at index ${index}`);
    }
    const subjectType = (policy as { subjectType?: ResourcePolicyRecord["subjectType"] }).subjectType;
    const subjectId = String((policy as { subjectId?: unknown }).subjectId ?? "").trim();
    const resourceType = (policy as { resourceType?: ResourcePolicyRecord["resourceType"] }).resourceType;
    const resourceId = String((policy as { resourceId?: unknown }).resourceId ?? "").trim();
    const effect = (policy as { effect?: ResourcePolicyRecord["effect"] }).effect;
    if (!(subjectType === "role" || subjectType === "department" || subjectType === "user")) {
      throw new Error(`invalid resource policy subjectType at index ${index}`);
    }
    if (!(resourceType === "knowledge_set" || resourceType === "agent_mode" || resourceType === "skill_package" || resourceType === "run_profile")) {
      throw new Error(`invalid resource policy resourceType at index ${index}`);
    }
    if (!(effect === "allow" || effect === "deny")) {
      throw new Error(`invalid resource policy effect at index ${index}`);
    }
    if (!subjectId || !resourceId) {
      throw new Error(`invalid resource policy resource identifiers at index ${index}`);
    }
    return {
      organizationId: toTrimmedString((policy as { organizationId?: unknown }).organizationId as string | undefined),
      subjectType,
      subjectId,
      resourceType,
      resourceId,
      effect
    };
  });

  const rawGroups = body && typeof body === "object" ? (body as { groups?: unknown }).groups : undefined;
  if (rawGroups === undefined) {
    return { policies };
  }
  if (!Array.isArray(rawGroups)) {
    throw new Error("invalid resource policy groups payload");
  }
  if (rawGroups.length === 0) {
    throw new Error("invalid resource policy groups payload");
  }
  const groups = rawGroups.map((group, index) => {
    if (!group || typeof group !== "object") {
      throw new Error(`invalid resource policy group at index ${index}`);
    }
    const subjectType = (group as { subjectType?: ResourcePolicyRecord["subjectType"] }).subjectType;
    const subjectId = String((group as { subjectId?: unknown }).subjectId ?? "").trim();
    const resourceType = (group as { resourceType?: ResourcePolicyRecord["resourceType"] }).resourceType;
    if (!(subjectType === "role" || subjectType === "department" || subjectType === "user")) {
      throw new Error(`invalid resource policy group subjectType at index ${index}`);
    }
    if (!(resourceType === "knowledge_set" || resourceType === "agent_mode" || resourceType === "skill_package" || resourceType === "run_profile")) {
      throw new Error(`invalid resource policy group resourceType at index ${index}`);
    }
    if (!subjectId) {
      throw new Error(`invalid resource policy group subjectId at index ${index}`);
    }
    return {
      subjectType,
      subjectId,
      resourceType
    };
  });
  return { policies, groups };
}

function buildScopedResourcePolicyReplacement(
  existingTargetPolicies: ResourcePolicyRecord[],
  resourceType: ResourcePolicyRecord["resourceType"],
  resourceId: string,
  nextPolicies: ResourcePolicyInput[],
  defaultOrganizationId?: string
) {
  const existingTargetPoliciesByGroup = new Map<string, ResourcePolicyRecord>();
  for (const policy of existingTargetPolicies) {
    const groupKey = `${policy.subjectType}:${policy.subjectId}:${resourceType}`;
    existingTargetPoliciesByGroup.set(groupKey, policy);
  }
  return nextPolicies.map((policy) => ({
    organizationId:
      existingTargetPoliciesByGroup.get(`${policy.subjectType}:${policy.subjectId}:${resourceType}`)?.organizationId ??
      defaultOrganizationId,
    subjectType: policy.subjectType,
    subjectId: policy.subjectId,
    resourceType,
    resourceId,
    effect: policy.effect
  }));
}

export function createResourcesAdminRouter(options: {
  knowledgeSets: KnowledgeSetRepositoryLike;
  resourcePolicies: ResourcePolicyRepositoryLike;
  storage: KnowledgeSetStorage;
  requirePermission?: (permissionKey: string) => RequestHandler;
  resourceAccessLogs?: ResourceAccessLogServiceLike;
}): Router {
  const router = Router();
  const requirePermission = options.requirePermission ?? ((_permissionKey: string) => (_req, _res, next) => next());

  router.get("/knowledge-sets", async (_req: Request, res: Response) => {
    const knowledgeSets = await options.knowledgeSets.list();
    res.json({
      knowledgeSets: knowledgeSets.filter((knowledgeSet) => knowledgeSet.sourceType === MANAGED_UPLOAD_SOURCE_TYPE)
    });
  });

  router.post("/knowledge-sets", async (req: Request, res: Response) => {
    try {
      const name = normalizeKnowledgeSetName(req.body?.name);
      const sourceType = normalizeKnowledgeSetSourceType(req.body?.sourceType);
      const existingKnowledgeSets = await options.knowledgeSets.list();
      const slug = resolveCreateKnowledgeSetSlug({
        requestedSlug: req.body?.slug,
        name,
        existingKnowledgeSets
      });
      const knowledgeSet = await options.knowledgeSets.create({
        organizationId: toTrimmedString(req.body?.organizationId),
        name,
        slug,
        description: toTrimmedString(req.body?.description),
        status: toTrimmedString(req.body?.status) ?? "active",
        sourceType,
        rootPath: undefined,
        storageKey: toTrimmedString(req.body?.storageKey)
      });
      res.status(201).json({ knowledgeSet });
    } catch (error) {
      res.status(400).json({ detail: detailFromKnowledgeSetCreateError(error) });
    }
  });

  router.patch("/knowledge-sets/:knowledgeSetId", async (req: Request, res: Response) => {
    try {
      const existing = await options.knowledgeSets.get(req.params.knowledgeSetId);
      if (!existing) {
        res.status(404).json({ detail: "knowledge set 不存在" });
        return;
      }
      const sourceType = normalizeKnowledgeSetSourceType(req.body?.sourceType ?? existing.sourceType);
      const nextName = req.body?.name === undefined ? undefined : normalizeKnowledgeSetName(req.body?.name);
      const nextSlug = req.body?.slug === undefined ? undefined : normalizeKnowledgeSetSlug(req.body?.slug);
      if (req.body?.slug !== undefined && !nextSlug) {
        throw new Error("资料集 slug 不能为空");
      }
      const knowledgeSet = await options.knowledgeSets.update(req.params.knowledgeSetId, {
        organizationId: req.body?.organizationId,
        name: nextName,
        slug: nextSlug,
        description: req.body?.description,
        status: req.body?.status,
        sourceType,
        rootPath: undefined,
        storageKey: req.body?.storageKey
      });
      res.json({ knowledgeSet });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/knowledge-sets/:knowledgeSetId/items", requirePermission("knowledge_set.read"), async (req: Request, res: Response) => {
    try {
      const items = await options.knowledgeSets.listItems(req.params.knowledgeSetId);
      res.json({ items });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.post(
    "/knowledge-sets/:knowledgeSetId/rebuild",
    requirePermission("knowledge_set.reindex"),
    async (req: Request, res: Response) => {
      try {
        const knowledgeSetId = req.params.knowledgeSetId;
        const knowledgeSet = await options.knowledgeSets.get(knowledgeSetId);
        if (!knowledgeSet) {
          res.status(404).json({ detail: "knowledge set 不存在" });
          return;
        }
        const rootPath = resolveKnowledgeSetRoot(knowledgeSet, options.storage, knowledgeSetId);
        const items = await scanDirectory(rootPath);
        await options.knowledgeSets.replaceItems(knowledgeSetId, items);
        if (options.resourceAccessLogs) {
          await options.resourceAccessLogs.record({
            userId: req.currentUser?.id,
            resourceType: "knowledge_set",
            resourceId: knowledgeSetId,
            actionType: "write",
            resultStatus: "success",
            metadata: {
              operation: "rebuild",
              sourceType: knowledgeSet.sourceType,
              itemCount: items.length
            }
          });
        }
        res.json({ items: await options.knowledgeSets.listItems(knowledgeSetId) });
      } catch (error) {
        res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
      }
    }
  );

  router.delete("/knowledge-sets/:knowledgeSetId/items", requirePermission("knowledge_set.file_manage"), async (req: Request, res: Response) => {
    try {
      const knowledgeSetId = req.params.knowledgeSetId;
      const knowledgeSet = await options.knowledgeSets.get(knowledgeSetId);
      if (!knowledgeSet) {
        res.status(404).json({ detail: "knowledge set 不存在" });
        return;
      }
      const { relativePath } = parseDeleteKnowledgeSetItem(req.body);
      const rootPath = resolveKnowledgeSetRoot(knowledgeSet, options.storage, knowledgeSetId);
      await deleteFile(rootPath, relativePath);
      const items = await scanDirectory(rootPath);
      await options.knowledgeSets.replaceItems(knowledgeSetId, items);
      if (options.resourceAccessLogs) {
        await options.resourceAccessLogs.record({
          userId: req.currentUser?.id,
          resourceType: "knowledge_set",
          resourceId: knowledgeSetId,
          actionType: "write",
          resultStatus: "success",
          metadata: {
            operation: "delete",
            relativePath
          }
        });
      }
      res.json({ items: await options.knowledgeSets.listItems(knowledgeSetId) });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.patch("/knowledge-sets/:knowledgeSetId/items", requirePermission("knowledge_set.file_manage"), async (req: Request, res: Response) => {
    try {
      const knowledgeSetId = req.params.knowledgeSetId;
      const knowledgeSet = await options.knowledgeSets.get(knowledgeSetId);
      if (!knowledgeSet) {
        res.status(404).json({ detail: "knowledge set 不存在" });
        return;
      }
      const { relativePath, nextRelativePath } = parsePatchKnowledgeSetItem(req.body);
      const rootPath = resolveKnowledgeSetRoot(knowledgeSet, options.storage, knowledgeSetId);
      await renameFile(rootPath, relativePath, nextRelativePath);
      const items = await scanDirectory(rootPath);
      await options.knowledgeSets.replaceItems(knowledgeSetId, items);
      if (options.resourceAccessLogs) {
        await options.resourceAccessLogs.record({
          userId: req.currentUser?.id,
          resourceType: "knowledge_set",
          resourceId: knowledgeSetId,
          actionType: "write",
          resultStatus: "success",
          metadata: {
            operation: "rename",
            relativePath,
            nextRelativePath
          }
        });
      }
      res.json({ items: await options.knowledgeSets.listItems(knowledgeSetId) });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/knowledge-sets/:knowledgeSetId/files", requirePermission("knowledge_set.upload"), withMultipartFiles("files"), async (req: Request, res: Response) => {
    try {
      const knowledgeSetId = req.params.knowledgeSetId;
      const knowledgeSet = await options.knowledgeSets.get(knowledgeSetId);
      if (!knowledgeSet) {
        res.status(404).json({ detail: "knowledge set 不存在" });
        return;
      }
      if (knowledgeSet.sourceType !== "managed_upload") {
        res.status(400).json({ detail: "only managed_upload knowledge sets support file uploads" });
        return;
      }

      const files = ((req.files as Express.Multer.File[] | undefined) ?? []).map((file) => ({
        name: file.originalname,
        buffer: file.buffer,
        mimeType: toTrimmedString(file.mimetype)
      }));
      if (files.length === 0) {
        res.status(400).json({ detail: "at least one file upload is required" });
        return;
      }
      const result = await options.storage.saveFiles({ knowledgeSetId, files });
      await options.knowledgeSets.replaceItems(knowledgeSetId, result.items);
      if (options.resourceAccessLogs) {
        await options.resourceAccessLogs.record({
          userId: req.currentUser?.id,
          resourceType: "knowledge_set",
          resourceId: knowledgeSetId,
          actionType: "upload",
          resultStatus: "success",
          metadata: {
            fileCount: files.length,
            mountPath: result.mountPath
          }
        });
      }
      res.json({
        mountPath: result.mountPath,
        items: await options.knowledgeSets.listItems(knowledgeSetId)
      });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.post(
    "/knowledge-sets/:knowledgeSetId/archive",
    requirePermission("knowledge_set.upload"),
    express.raw({ type: ["application/octet-stream", "application/zip"], limit: "50mb" }),
    async (req: Request, res: Response) => {
      try {
        const knowledgeSetId = req.params.knowledgeSetId;
        const knowledgeSet = await options.knowledgeSets.get(knowledgeSetId);
        if (!knowledgeSet) {
          res.status(404).json({ detail: "knowledge set 不存在" });
          return;
        }
        if (knowledgeSet.sourceType !== "managed_upload") {
          res.status(400).json({ detail: "only managed_upload knowledge sets support archive uploads" });
          return;
        }

        const result = await options.storage.extractArchive({
          knowledgeSetId,
          archiveName: req.header("X-Archive-Name") || "archive.zip",
          buffer: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
        });
        await options.knowledgeSets.replaceItems(knowledgeSetId, result.items);
        if (options.resourceAccessLogs) {
          await options.resourceAccessLogs.record({
            userId: req.currentUser?.id,
            resourceType: "knowledge_set",
            resourceId: knowledgeSetId,
            actionType: "upload",
            resultStatus: "success",
            metadata: {
              archiveName: req.header("X-Archive-Name") || "archive.zip",
              mountPath: result.mountPath
            }
          });
        }
        res.json({
          mountPath: result.mountPath,
          items: await options.knowledgeSets.listItems(knowledgeSetId)
        });
      } catch (error) {
        res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
      }
    }
  );

  router.get("/resource-policies", requirePermission("resource_policy.read"), async (_req: Request, res: Response) => {
    res.json({ policies: await options.resourcePolicies.listAll() });
  });

  router.put("/resource-policies", requirePermission("resource_policy.write"), async (req: Request, res: Response) => {
    try {
      const { policies, groups } = parseReplacePoliciesRequest(req.body);
      const next = groups
        ? await options.resourcePolicies.replacePoliciesForGroups({ groups, policies })
        : await options.resourcePolicies.replacePolicies(policies);
      res.json({ policies: next });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.get(
    "/resources/knowledge-sets/:knowledgeSetId/policies",
    requirePermission("resource_policy.read"),
    async (req: Request, res: Response) => {
    try {
      const knowledgeSetId = req.params.knowledgeSetId;
      const knowledgeSet = await options.knowledgeSets.get(knowledgeSetId);
      if (!knowledgeSet) {
        res.status(404).json({ detail: "knowledge set 不存在" });
        return;
      }
      const policies = (await options.resourcePolicies.listAll()).filter(
        (policy) => policy.resourceType === "knowledge_set" && policy.resourceId === knowledgeSetId
      );
      res.json({ policies });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
    }
  );

  router.put(
    "/resources/knowledge-sets/:knowledgeSetId/policies",
    requirePermission("resource_policy.write"),
    async (req: Request, res: Response) => {
    try {
      const knowledgeSetId = req.params.knowledgeSetId;
      const knowledgeSet = await options.knowledgeSets.get(knowledgeSetId);
      if (!knowledgeSet) {
        res.status(404).json({ detail: "knowledge set 不存在" });
        return;
      }
      const nextPolicies = parseResourcePolicies(req.body, { requireExplicitArray: true });
      const existingPolicies = (await options.resourcePolicies.listAll()).filter(
        (policy) => policy.resourceType === "knowledge_set" && policy.resourceId === knowledgeSetId
      );
      const policies = buildScopedResourcePolicyReplacement(
        existingPolicies,
        "knowledge_set",
        knowledgeSetId,
        nextPolicies,
        knowledgeSet.organizationId
      );
      res.json({
        policies: await options.resourcePolicies.replacePoliciesForResource({
          resourceType: "knowledge_set",
          resourceId: knowledgeSetId,
          policies
        })
      });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
    }
  );

  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (error instanceof MulterError) {
      res.status(400).json({ detail: error.code === "LIMIT_FILE_SIZE" ? "uploaded file is too large" : "multipart upload exceeds configured limits" });
      return;
    }
    next(error);
  });

  return router;
}
