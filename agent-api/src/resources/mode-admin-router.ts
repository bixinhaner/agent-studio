import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { REASONING_EFFORT_VALUES } from "../model-config.js";
import {
  APPROVAL_POLICY_VALUES,
  SANDBOX_MODE_VALUES,
  WEB_SEARCH_MODE_VALUES
} from "../integrations/zendesk/types.js";

function detailFromError(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败";
}

function isNotFoundError(error: unknown): boolean {
  const message = detailFromError(error).toLowerCase();
  return message.includes("不存在") || message.includes("not found");
}

function sendValidationError(res: Response, error: z.ZodError): void {
  res.status(400).json({
    detail: error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ")
  });
}

const stringListSchema = z.array(z.string().trim().min(1));
const statusSchema = z.enum(["active", "inactive"]);
const runtimeTypeSchema = z.enum(["codex", "claude_code"]);
const runtimeBindingTypeSchema = z.enum(["config_fragment", "prompt_hint"]);
const directoryScopeSchema = z.enum(["workspace_only", "descendants_only"]);
const instructionSourceTypeSchema = z.enum(["inline_text", "knowledge_set_document"]);

const runProfileCreateSchema = z.object({
  organizationId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1),
  slug: z.string().trim().min(1),
  description: z.string().trim().optional(),
  status: statusSchema.optional(),
  defaultModel: z.string().trim().min(1),
  allowedModels: stringListSchema,
  defaultReasoningEffort: z.enum(REASONING_EFFORT_VALUES),
  sandboxMode: z.enum(SANDBOX_MODE_VALUES),
  approvalPolicy: z.enum(APPROVAL_POLICY_VALUES),
  networkAccessEnabled: z.boolean().optional(),
  webSearchMode: z.enum(WEB_SEARCH_MODE_VALUES)
});

const runProfileUpdateSchema = runProfileCreateSchema.partial().extend({
  organizationId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  slug: z.string().trim().min(1).optional(),
  description: z.string().trim().optional(),
  status: statusSchema.optional(),
  defaultModel: z.string().trim().min(1).optional(),
  allowedModels: stringListSchema.optional(),
  defaultReasoningEffort: z.enum(REASONING_EFFORT_VALUES).optional(),
  sandboxMode: z.enum(SANDBOX_MODE_VALUES).optional(),
  approvalPolicy: z.enum(APPROVAL_POLICY_VALUES).optional(),
  networkAccessEnabled: z.boolean().optional(),
  webSearchMode: z.enum(WEB_SEARCH_MODE_VALUES).optional()
});

const skillPackageCreateSchema = z.object({
  organizationId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1),
  slug: z.string().trim().min(1),
  description: z.string().trim().optional(),
  status: statusSchema.optional(),
  visibleToUsers: z.boolean().optional()
});

const skillPackageUpdateSchema = skillPackageCreateSchema.partial().extend({
  organizationId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  slug: z.string().trim().min(1).optional(),
  description: z.string().trim().optional(),
  status: statusSchema.optional(),
  visibleToUsers: z.boolean().optional()
});

const skillPackageItemSchema = z.object({
  capabilityKey: z.string().trim().min(1),
  description: z.string().trim().optional(),
  runtimeBindings: z.array(
    z.object({
      runtimeType: runtimeTypeSchema,
      bindingType: runtimeBindingTypeSchema,
      bindingPayload: z.unknown()
    })
  )
});

const skillPackageItemsReplaceSchema = z.object({
  items: z.array(skillPackageItemSchema)
});

const agentModeCreateSchema = z.object({
  organizationId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1),
  slug: z.string().trim().min(1),
  description: z.string().trim().optional(),
  status: statusSchema.optional(),
  visibleToUsers: z.boolean().optional(),
  runProfileId: z.string().trim().min(1)
});

const agentModeUpdateSchema = agentModeCreateSchema.partial().extend({
  organizationId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  slug: z.string().trim().min(1).optional(),
  description: z.string().trim().optional(),
  status: statusSchema.optional(),
  visibleToUsers: z.boolean().optional(),
  runProfileId: z.string().trim().min(1).optional()
});

const agentModeSkillPackagesReplaceSchema = z.object({
  skillPackageIds: stringListSchema
});

const agentModeWorkspaceRulesReplaceSchema = z.object({
  workspaceRules: z.array(
    z.object({
      workspaceId: z.string().trim().min(1),
      isDefault: z.boolean().optional(),
      allowDirectorySelection: z.boolean().optional(),
      directoryScope: directoryScopeSchema,
      loadWorkspaceAgentsMd: z.boolean().optional()
    })
  )
});

const agentModeInstructionSourcesReplaceSchema = z.object({
  instructionSources: z.array(
    z.object({
      sourceType: instructionSourceTypeSchema,
      sourceRef: z.string().trim().min(1),
      sortOrder: z.number().int().optional()
    })
  )
});

type RunProfileRepositoryLike = {
  list(): Promise<unknown[]>;
  create(payload: {
    organizationId?: string;
    name: string;
    slug: string;
    description?: string;
    status?: string;
    defaultModel: string;
    allowedModels: string[];
    defaultReasoningEffort: string;
    sandboxMode: string;
    approvalPolicy: string;
    networkAccessEnabled?: boolean;
    webSearchMode: string;
  }): Promise<unknown>;
  get(id: string): Promise<unknown | undefined>;
  update(
    id: string,
    payload: {
      organizationId?: string;
      name?: string;
      slug?: string;
      description?: string;
      status?: string;
      defaultModel?: string;
      allowedModels?: string[];
      defaultReasoningEffort?: string;
      sandboxMode?: string;
      approvalPolicy?: string;
      networkAccessEnabled?: boolean;
      webSearchMode?: string;
    }
  ): Promise<unknown>;
};

type SkillPackageRepositoryLike = {
  list(): Promise<unknown[]>;
  create(payload: {
    organizationId?: string;
    name: string;
    slug: string;
    description?: string;
    status?: string;
    visibleToUsers?: boolean;
  }): Promise<unknown>;
  get(id: string): Promise<{ id: string; items?: unknown[] } | undefined>;
  update(
    id: string,
    payload: {
      organizationId?: string;
      name?: string;
      slug?: string;
      description?: string;
      status?: string;
      visibleToUsers?: boolean;
    }
  ): Promise<unknown>;
  replaceItems(
    id: string,
    items: Array<{
      capabilityKey: string;
      description?: string;
      runtimeBindings: Array<{
        runtimeType: string;
        bindingType: string;
        bindingPayload: unknown;
      }>;
    }>
  ): Promise<unknown>;
};

type AgentModeRepositoryLike = {
  list(): Promise<unknown[]>;
  create(payload: {
    organizationId?: string;
    name: string;
    slug: string;
    description?: string;
    status?: string;
    visibleToUsers?: boolean;
    runProfileId: string;
  }): Promise<unknown>;
  get(id: string): Promise<unknown | undefined>;
  update(
    id: string,
    payload: {
      organizationId?: string;
      name?: string;
      slug?: string;
      description?: string;
      status?: string;
      visibleToUsers?: boolean;
      runProfileId?: string;
    }
  ): Promise<unknown>;
  replaceSkillPackages(id: string, skillPackageIds: string[]): Promise<unknown>;
  replaceWorkspaceRules(
    id: string,
    workspaceRules: Array<{
      workspaceId: string;
      isDefault?: boolean;
      allowDirectorySelection?: boolean;
      directoryScope: string;
      loadWorkspaceAgentsMd?: boolean;
    }>
  ): Promise<unknown>;
  replaceInstructionSources(
    id: string,
    instructionSources: Array<{
      sourceType: string;
      sourceRef: string;
      sortOrder?: number;
    }>
  ): Promise<unknown>;
};

export function createModeAdminRouter(options: {
  runProfiles: RunProfileRepositoryLike;
  skillPackages: SkillPackageRepositoryLike;
  agentModes: AgentModeRepositoryLike;
}): Router {
  const router = Router();

  router.get("/run-profiles", async (_req: Request, res: Response) => {
    res.json({ runProfiles: await options.runProfiles.list() });
  });

  router.post("/run-profiles", async (req: Request, res: Response) => {
    const parsed = runProfileCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const runProfile = await options.runProfiles.create(parsed.data);
      res.status(201).json({ runProfile });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.patch("/run-profiles/:id", async (req: Request, res: Response) => {
    const parsed = runProfileUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const existing = await options.runProfiles.get(req.params.id);
      if (!existing) {
        res.status(404).json({ detail: "run profile 不存在" });
        return;
      }
      const runProfile = await options.runProfiles.update(req.params.id, parsed.data);
      res.json({ runProfile });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/skill-packages", async (_req: Request, res: Response) => {
    res.json({ skillPackages: await options.skillPackages.list() });
  });

  router.post("/skill-packages", async (req: Request, res: Response) => {
    const parsed = skillPackageCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const skillPackage = await options.skillPackages.create(parsed.data);
      res.status(201).json({ skillPackage });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.patch("/skill-packages/:id", async (req: Request, res: Response) => {
    const parsed = skillPackageUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const existing = await options.skillPackages.get(req.params.id);
      if (!existing) {
        res.status(404).json({ detail: "skill package 不存在" });
        return;
      }
      const skillPackage = await options.skillPackages.update(req.params.id, parsed.data);
      res.json({ skillPackage });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/skill-packages/:id/items", async (req: Request, res: Response) => {
    try {
      const skillPackage = await options.skillPackages.get(req.params.id);
      if (!skillPackage) {
        res.status(404).json({ detail: "skill package 不存在" });
        return;
      }
      res.json({ items: skillPackage.items ?? [] });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
    }
  });

  const replaceSkillPackageItems = async (req: Request, res: Response) => {
    const parsed = skillPackageItemsReplaceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const items = parsed.data.items.map((item) => ({
        capabilityKey: item.capabilityKey,
        description: item.description,
        runtimeBindings: item.runtimeBindings.map((binding) => ({
          runtimeType: binding.runtimeType,
          bindingType: binding.bindingType,
          bindingPayload: binding.bindingPayload
        }))
      }));
      const skillPackage = await options.skillPackages.replaceItems(req.params.id, items);
      res.json({ skillPackage });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
    }
  };

  router.put("/skill-packages/:id/items", replaceSkillPackageItems);
  router.put("/skill-packages/:id/runtime-bindings", replaceSkillPackageItems);

  router.get("/agent-modes", async (_req: Request, res: Response) => {
    res.json({ agentModes: await options.agentModes.list() });
  });

  router.post("/agent-modes", async (req: Request, res: Response) => {
    const parsed = agentModeCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const agentMode = await options.agentModes.create(parsed.data);
      res.status(201).json({ agentMode });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.patch("/agent-modes/:id", async (req: Request, res: Response) => {
    const parsed = agentModeUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const existing = await options.agentModes.get(req.params.id);
      if (!existing) {
        res.status(404).json({ detail: "agent mode 不存在" });
        return;
      }
      const agentMode = await options.agentModes.update(req.params.id, parsed.data);
      res.json({ agentMode });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.put("/agent-modes/:id/skill-packages", async (req: Request, res: Response) => {
    const parsed = agentModeSkillPackagesReplaceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const agentMode = await options.agentModes.replaceSkillPackages(req.params.id, parsed.data.skillPackageIds);
      res.json({ agentMode });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.put("/agent-modes/:id/workspaces", async (req: Request, res: Response) => {
    const parsed = agentModeWorkspaceRulesReplaceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const agentMode = await options.agentModes.replaceWorkspaceRules(req.params.id, parsed.data.workspaceRules);
      res.json({ agentMode });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.put("/agent-modes/:id/instruction-sources", async (req: Request, res: Response) => {
    const parsed = agentModeInstructionSourcesReplaceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const agentMode = await options.agentModes.replaceInstructionSources(req.params.id, parsed.data.instructionSources);
      res.json({ agentMode });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
    }
  });

  return router;
}
