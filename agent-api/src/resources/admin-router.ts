import express, { Router, type Request, type Response } from "express";
import multer from "multer";

import type { ResourcePolicyRecord } from "../persistence/resource-policy-repository.js";
import type { KnowledgeSetStorage } from "./storage/knowledge-set-storage.js";

type WorkspaceRepositoryLike = {
  list(): Promise<unknown[]>;
  create(payload: {
    organizationId?: string;
    name: string;
    slug: string;
    description?: string;
    status?: string;
    sourceType: string;
    rootPath?: string;
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
    }
  ): Promise<unknown>;
  get(id: string): Promise<unknown | undefined>;
};

type KnowledgeSetRepositoryLike = {
  list(): Promise<unknown[]>;
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
  get(id: string): Promise<{ id: string } | undefined>;
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
  listWorkspaceBindings(workspaceId: string): Promise<unknown[]>;
  replaceWorkspaceBindings(
    workspaceId: string,
    bindings: Array<{ knowledgeSetId: string; mountType: string }>
  ): Promise<unknown[]>;
};

type ResourcePolicyRepositoryLike = {
  listAll(): Promise<ResourcePolicyRecord[]>;
  replacePolicies(
    policies: Array<Omit<ResourcePolicyRecord, "id" | "createdAt" | "updatedAt">>
  ): Promise<ResourcePolicyRecord[]>;
  replacePoliciesForGroups(input: {
    groups: Array<{
      subjectType: ResourcePolicyRecord["subjectType"];
      subjectId: string;
      resourceType: ResourcePolicyRecord["resourceType"];
    }>;
    policies: Array<Omit<ResourcePolicyRecord, "id" | "createdAt" | "updatedAt">>;
  }): Promise<ResourcePolicyRecord[]>;
};

function detailFromError(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败";
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

const upload = multer({ storage: multer.memoryStorage() });

export function createResourcesAdminRouter(options: {
  workspaces: WorkspaceRepositoryLike;
  knowledgeSets: KnowledgeSetRepositoryLike;
  resourcePolicies: ResourcePolicyRepositoryLike;
  storage: KnowledgeSetStorage;
}): Router {
  const router = Router();

  router.get("/workspaces", async (_req: Request, res: Response) => {
    res.json({ workspaces: await options.workspaces.list() });
  });

  router.post("/workspaces", async (req: Request, res: Response) => {
    try {
      const workspace = await options.workspaces.create({
        organizationId: toTrimmedString(req.body?.organizationId),
        name: String(req.body?.name ?? ""),
        slug: String(req.body?.slug ?? ""),
        description: toTrimmedString(req.body?.description),
        status: toTrimmedString(req.body?.status),
        sourceType: String(req.body?.sourceType ?? ""),
        rootPath: toTrimmedString(req.body?.rootPath)
      });
      res.status(201).json({ workspace });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.patch("/workspaces/:workspaceId", async (req: Request, res: Response) => {
    try {
      const workspace = await options.workspaces.update(req.params.workspaceId, {
        organizationId: req.body?.organizationId,
        name: req.body?.name,
        slug: req.body?.slug,
        description: req.body?.description,
        status: req.body?.status,
        sourceType: req.body?.sourceType,
        rootPath: req.body?.rootPath
      });
      res.json({ workspace });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/knowledge-sets", async (_req: Request, res: Response) => {
    res.json({ knowledgeSets: await options.knowledgeSets.list() });
  });

  router.post("/knowledge-sets", async (req: Request, res: Response) => {
    try {
      const knowledgeSet = await options.knowledgeSets.create({
        organizationId: toTrimmedString(req.body?.organizationId),
        name: String(req.body?.name ?? ""),
        slug: String(req.body?.slug ?? ""),
        description: toTrimmedString(req.body?.description),
        status: toTrimmedString(req.body?.status),
        sourceType: String(req.body?.sourceType ?? ""),
        rootPath: toTrimmedString(req.body?.rootPath),
        storageKey: toTrimmedString(req.body?.storageKey)
      });
      res.status(201).json({ knowledgeSet });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.patch("/knowledge-sets/:knowledgeSetId", async (req: Request, res: Response) => {
    try {
      const knowledgeSet = await options.knowledgeSets.update(req.params.knowledgeSetId, {
        organizationId: req.body?.organizationId,
        name: req.body?.name,
        slug: req.body?.slug,
        description: req.body?.description,
        status: req.body?.status,
        sourceType: req.body?.sourceType,
        rootPath: req.body?.rootPath,
        storageKey: req.body?.storageKey
      });
      res.json({ knowledgeSet });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/knowledge-sets/:knowledgeSetId/items", async (req: Request, res: Response) => {
    try {
      const items = await options.knowledgeSets.listItems(req.params.knowledgeSetId);
      res.json({ items });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/knowledge-sets/:knowledgeSetId/files", upload.array("files"), async (req: Request, res: Response) => {
    try {
      const knowledgeSetId = req.params.knowledgeSetId;
      const knowledgeSet = await options.knowledgeSets.get(knowledgeSetId);
      if (!knowledgeSet) {
        res.status(404).json({ detail: "knowledge set 不存在" });
        return;
      }

      const files = ((req.files as Express.Multer.File[] | undefined) ?? []).map((file) => ({
        name: file.originalname,
        buffer: file.buffer,
        mimeType: toTrimmedString(file.mimetype)
      }));
      const result = await options.storage.saveFiles({ knowledgeSetId, files });
      await options.knowledgeSets.replaceItems(knowledgeSetId, result.items);
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
    express.raw({ type: ["application/octet-stream", "application/zip"], limit: "50mb" }),
    async (req: Request, res: Response) => {
      try {
        const knowledgeSetId = req.params.knowledgeSetId;
        const knowledgeSet = await options.knowledgeSets.get(knowledgeSetId);
        if (!knowledgeSet) {
          res.status(404).json({ detail: "knowledge set 不存在" });
          return;
        }

        const result = await options.storage.extractArchive({
          knowledgeSetId,
          archiveName: req.header("X-Archive-Name") || "archive.zip",
          buffer: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
        });
        await options.knowledgeSets.replaceItems(knowledgeSetId, result.items);
        res.json({
          mountPath: result.mountPath,
          items: await options.knowledgeSets.listItems(knowledgeSetId)
        });
      } catch (error) {
        res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
      }
    }
  );

  router.get("/workspaces/:workspaceId/knowledge-sets", async (req: Request, res: Response) => {
    try {
      const workspace = await options.workspaces.get(req.params.workspaceId);
      if (!workspace) {
        res.status(404).json({ detail: "workspace 不存在" });
        return;
      }
      res.json({ bindings: await options.knowledgeSets.listWorkspaceBindings(req.params.workspaceId) });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.put("/workspaces/:workspaceId/knowledge-sets", async (req: Request, res: Response) => {
    try {
      const bindings = Array.isArray(req.body?.bindings)
        ? req.body.bindings.map((binding: Record<string, unknown>) => ({
            knowledgeSetId: String(binding.knowledgeSetId ?? ""),
            mountType: String(binding.mountType ?? "")
          }))
        : [];
      res.json({
        bindings: await options.knowledgeSets.replaceWorkspaceBindings(req.params.workspaceId, bindings)
      });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/resource-policies", async (_req: Request, res: Response) => {
    res.json({ policies: await options.resourcePolicies.listAll() });
  });

  router.put("/resource-policies", async (req: Request, res: Response) => {
    try {
      const policies = Array.isArray(req.body?.policies)
        ? req.body.policies.map((policy: Record<string, unknown>) => ({
            organizationId: toTrimmedString(policy.organizationId),
            subjectType: policy.subjectType as ResourcePolicyRecord["subjectType"],
            subjectId: String(policy.subjectId ?? ""),
            resourceType: policy.resourceType as ResourcePolicyRecord["resourceType"],
            resourceId: String(policy.resourceId ?? ""),
            effect: policy.effect as ResourcePolicyRecord["effect"]
          }))
        : [];
      const groups = Array.isArray(req.body?.groups)
        ? req.body.groups.map((group: Record<string, unknown>) => ({
            subjectType: group.subjectType as ResourcePolicyRecord["subjectType"],
            subjectId: String(group.subjectId ?? ""),
            resourceType: group.resourceType as ResourcePolicyRecord["resourceType"]
          }))
        : undefined;

      const next = groups
        ? await options.resourcePolicies.replacePoliciesForGroups({ groups, policies })
        : await options.resourcePolicies.replacePolicies(policies);
      res.json({ policies: next });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  return router;
}
