import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { REASONING_EFFORT_VALUES } from "../model-config.js";
import { getDbClient } from "../db/client.js";
import type { ResourcePolicyResourceType } from "../persistence/resource-policy-repository.js";
import {
  APPROVAL_POLICY_VALUES,
  SANDBOX_MODE_VALUES,
  WEB_SEARCH_MODE_VALUES
} from "../integrations/zendesk/types.js";
import { SystemSettingsRepository } from "../system-settings/repository.js";
import { createDefaultSystemSettingsPayload, type SystemSettingsSafety, type SystemSettingsVersionRecord } from "../system-settings/types.js";

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

type RunProfileWritableRecord = {
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
};

type SystemSettingsReaderLike = {
  getCurrentPublished(): Promise<SystemSettingsVersionRecord | undefined>;
};

const stringListSchema = z.array(z.string().trim().min(1));
const statusSchema = z.enum(["active", "disabled"]);
const runtimeTypeSchema = z.enum(["codex", "claude_code"]);
const runtimeBindingTypeSchema = z.enum(["config_fragment", "prompt_hint"]);
const directoryScopeSchema = z.enum([
  "workspace_only",
  "descendants_only",
  "authorized_workspace_and_knowledge_set"
]);
const instructionSourceTypeSchema = z.enum(["inline_text", "knowledge_set_document", "workspace_agents_md"]);
const policySubjectTypeSchema = z.enum(["role", "department", "user"]);
const policyEffectSchema = z.enum(["allow", "deny"]);
const copySchema = z.object({
  name: z.string().trim().min(1),
  slug: z.string().trim().min(1)
});
const capabilityPoliciesReplaceSchema = z.object({
  policies: z.array(
    z.object({
      subjectType: policySubjectTypeSchema,
      subjectId: z.string().trim().min(1),
      effect: policyEffectSchema
    })
  )
});

function clampSandboxMode(sandboxMode: string, safety: SystemSettingsSafety): string {
  if (!safety.allowFilesystemMutations) {
    return "read-only";
  }
  if (sandboxMode === "danger-full-access" && !safety.allowDangerFullAccess) {
    return "workspace-write";
  }
  return sandboxMode;
}

function clampNetworkAccess(networkAccessEnabled: boolean | undefined, safety: SystemSettingsSafety): boolean | undefined {
  if (networkAccessEnabled === undefined) {
    return undefined;
  }
  return safety.allowNetworkAccess ? networkAccessEnabled : false;
}

function clampWebSearchMode(webSearchMode: string, safety: SystemSettingsSafety): string {
  if (!safety.allowLiveWebSearch && webSearchMode === "live") {
    return "cached";
  }
  return webSearchMode;
}

function clampRunProfileInput(input: RunProfileWritableRecord, safety: SystemSettingsSafety): RunProfileWritableRecord {
  return {
    ...input,
    sandboxMode: clampSandboxMode(input.sandboxMode, safety),
    networkAccessEnabled: clampNetworkAccess(input.networkAccessEnabled, safety),
    webSearchMode: clampWebSearchMode(input.webSearchMode, safety)
  };
}

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

const workspaceRuleSchema = z.object({
  workspaceId: z.string().trim().min(1),
  isDefault: z.boolean().optional(),
  allowDirectorySelection: z.boolean().optional(),
  directoryScope: directoryScopeSchema,
  loadWorkspaceAgentsMd: z.boolean().optional()
});

const agentModeWorkspaceRulesReplaceSchema = z
  .object({
    workspaces: z.array(workspaceRuleSchema).optional(),
    workspaceRules: z.array(workspaceRuleSchema).optional()
  })
  .superRefine((value, ctx) => {
    const workspaces = value.workspaces ?? value.workspaceRules;
    if (!workspaces) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workspaces"],
        message: "Required"
      });
    }
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

type ResourcePolicyRepositoryLike = {
  listAll(): Promise<
    Array<{
      id?: string;
      organizationId?: string;
      subjectType: "role" | "department" | "user";
      subjectId: string;
      resourceType: ResourcePolicyResourceType;
      resourceId: string;
      effect: "allow" | "deny";
      createdAt?: string;
      updatedAt?: string;
    }>
  >;
  replacePoliciesForResource(input: {
    resourceType: ResourcePolicyResourceType;
    resourceId: string;
    policies: Array<{
      organizationId?: string;
      subjectType: "role" | "department" | "user";
      subjectId: string;
      resourceType: ResourcePolicyResourceType;
      resourceId: string;
      effect: "allow" | "deny";
    }>;
  }): Promise<unknown[]>;
};

function withWorkspaceAlias<T extends { workspaceRules?: unknown }>(record: T): T & { workspaces: unknown } {
  return {
    ...record,
    workspaces: record.workspaceRules ?? []
  };
}

export function createModeAdminRouter(options: {
  runProfiles: RunProfileRepositoryLike;
  skillPackages: SkillPackageRepositoryLike;
  agentModes: AgentModeRepositoryLike;
  resourcePolicies?: ResourcePolicyRepositoryLike;
  systemSettings?: SystemSettingsReaderLike;
}): Router {
  const router = Router();
  let systemSettingsRepository: SystemSettingsRepository | undefined;

  function requireResourcePolicies(): ResourcePolicyRepositoryLike {
    if (!options.resourcePolicies) {
      throw new Error("resource policies 未配置");
    }
    return options.resourcePolicies;
  }

  async function listPoliciesForResource(
    resourceType: "agent_mode" | "skill_package" | "run_profile",
    resourceId: string
  ) {
    return (await requireResourcePolicies().listAll()).filter(
      (policy) => policy.resourceType === resourceType && policy.resourceId === resourceId
    );
  }

  async function replacePoliciesForResource(
    resourceType: "agent_mode" | "skill_package" | "run_profile",
    resourceId: string,
    organizationId: string | undefined,
    policies: Array<{ subjectType: "role" | "department" | "user"; subjectId: string; effect: "allow" | "deny" }>
  ) {
    return requireResourcePolicies().replacePoliciesForResource({
      resourceType,
      resourceId,
      policies: policies.map((policy) => ({
        organizationId,
        subjectType: policy.subjectType,
        subjectId: policy.subjectId,
        resourceType,
        resourceId,
        effect: policy.effect
      }))
    });
  }

  async function resolvePublishedSafetyLimits(): Promise<SystemSettingsSafety | undefined> {
    if (options.systemSettings) {
      const published = await options.systemSettings.getCurrentPublished();
      return published?.payload.safety ?? createDefaultSystemSettingsPayload().safety;
    }

    if (process.env.NODE_ENV === "test" || !process.env.DATABASE_URL) {
      return undefined;
    }

    systemSettingsRepository ??= new SystemSettingsRepository(getDbClient() as never);
    const published = await systemSettingsRepository.getCurrentPublished();
    return published?.payload.safety ?? createDefaultSystemSettingsPayload().safety;
  }

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
      const safetyLimits = await resolvePublishedSafetyLimits();
      const runProfile = await options.runProfiles.create(
        safetyLimits ? clampRunProfileInput(parsed.data, safetyLimits) : parsed.data
      );
      res.status(201).json({ runProfile });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/run-profiles/:id/copy", async (req: Request, res: Response) => {
    const parsed = copySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const existing = (await options.runProfiles.get(req.params.id)) as
        | RunProfileWritableRecord
        | undefined;
      if (!existing) {
        res.status(404).json({ detail: "run profile 不存在" });
        return;
      }
      const safetyLimits = await resolvePublishedSafetyLimits();
      const runProfile = await options.runProfiles.create(
        safetyLimits
          ? clampRunProfileInput(
              {
                organizationId: existing.organizationId,
                name: parsed.data.name,
                slug: parsed.data.slug,
                description: existing.description,
                status: "disabled",
                defaultModel: existing.defaultModel,
                allowedModels: existing.allowedModels,
                defaultReasoningEffort: existing.defaultReasoningEffort,
                sandboxMode: existing.sandboxMode,
                approvalPolicy: existing.approvalPolicy,
                networkAccessEnabled: existing.networkAccessEnabled,
                webSearchMode: existing.webSearchMode
              },
              safetyLimits
            )
          : {
              organizationId: existing.organizationId,
              name: parsed.data.name,
              slug: parsed.data.slug,
              description: existing.description,
              status: "disabled",
              defaultModel: existing.defaultModel,
              allowedModels: existing.allowedModels,
              defaultReasoningEffort: existing.defaultReasoningEffort,
              sandboxMode: existing.sandboxMode,
              approvalPolicy: existing.approvalPolicy,
              networkAccessEnabled: existing.networkAccessEnabled,
              webSearchMode: existing.webSearchMode
            }
      );
      res.status(201).json({ runProfile });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
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
      const safetyLimits = await resolvePublishedSafetyLimits();
      const runProfile = await options.runProfiles.update(
        req.params.id,
        safetyLimits
          ? clampRunProfileInput({ ...(existing as RunProfileWritableRecord), ...parsed.data }, safetyLimits)
          : parsed.data
      );
      res.json({ runProfile });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/resources/run-profiles/:id/policies", async (req: Request, res: Response) => {
    try {
      const runProfile = (await options.runProfiles.get(req.params.id)) as { id: string } | undefined;
      if (!runProfile) {
        res.status(404).json({ detail: "run profile 不存在" });
        return;
      }
      res.json({ policies: await listPoliciesForResource("run_profile", req.params.id) });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.put("/resources/run-profiles/:id/policies", async (req: Request, res: Response) => {
    const parsed = capabilityPoliciesReplaceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const runProfile = (await options.runProfiles.get(req.params.id)) as { organizationId?: string } | undefined;
      if (!runProfile) {
        res.status(404).json({ detail: "run profile 不存在" });
        return;
      }
      res.json({
        policies: await replacePoliciesForResource("run_profile", req.params.id, runProfile.organizationId, parsed.data.policies)
      });
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

  router.post("/skill-packages/:id/copy", async (req: Request, res: Response) => {
    const parsed = copySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const existing = (await options.skillPackages.get(req.params.id)) as
        | {
            organizationId?: string;
            description?: string;
            items?: Array<{
              capabilityKey: string;
              description?: string;
              runtimeBindings: Array<{
                runtimeType: string;
                bindingType: string;
                bindingPayload: unknown;
              }>;
            }>;
          }
        | undefined;
      if (!existing) {
        res.status(404).json({ detail: "skill package 不存在" });
        return;
      }
      const created = (await options.skillPackages.create({
        organizationId: existing.organizationId,
        name: parsed.data.name,
        slug: parsed.data.slug,
        description: existing.description,
        status: "disabled",
        visibleToUsers: false
      })) as { id: string };
      const items = (existing.items ?? []).map((item) => ({
        capabilityKey: item.capabilityKey,
        description: item.description,
        runtimeBindings: item.runtimeBindings.map((binding) => ({
          runtimeType: binding.runtimeType,
          bindingType: binding.bindingType,
          bindingPayload: binding.bindingPayload
        }))
      }));
      const skillPackage =
        items.length > 0 ? await options.skillPackages.replaceItems(created.id, items) : await options.skillPackages.get(created.id);
      res.status(201).json({ skillPackage });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
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

  router.get("/resources/skill-packages/:id/policies", async (req: Request, res: Response) => {
    try {
      const skillPackage = await options.skillPackages.get(req.params.id);
      if (!skillPackage) {
        res.status(404).json({ detail: "skill package 不存在" });
        return;
      }
      res.json({ policies: await listPoliciesForResource("skill_package", req.params.id) });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.put("/resources/skill-packages/:id/policies", async (req: Request, res: Response) => {
    const parsed = capabilityPoliciesReplaceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const skillPackage = (await options.skillPackages.get(req.params.id)) as { organizationId?: string } | undefined;
      if (!skillPackage) {
        res.status(404).json({ detail: "skill package 不存在" });
        return;
      }
      res.json({
        policies: await replacePoliciesForResource("skill_package", req.params.id, skillPackage.organizationId, parsed.data.policies)
      });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
    }
  });

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

  router.post("/agent-modes/:id/copy", async (req: Request, res: Response) => {
    const parsed = copySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const existing = (await options.agentModes.get(req.params.id)) as
        | {
            organizationId?: string;
            description?: string;
            runProfileId: string;
            skillPackages?: Array<{ skillPackageId: string }>;
            workspaceRules?: Array<{
              workspaceId: string;
              isDefault?: boolean;
              allowDirectorySelection?: boolean;
              directoryScope: string;
              loadWorkspaceAgentsMd?: boolean;
            }>;
            instructionSources?: Array<{
              sourceType: string;
              sourceRef: string;
              sortOrder?: number;
            }>;
          }
        | undefined;
      if (!existing) {
        res.status(404).json({ detail: "agent mode 不存在" });
        return;
      }
      const created = (await options.agentModes.create({
        organizationId: existing.organizationId,
        name: parsed.data.name,
        slug: parsed.data.slug,
        description: existing.description,
        status: "disabled",
        visibleToUsers: false,
        runProfileId: existing.runProfileId
      })) as { id: string };

      if ((existing.skillPackages ?? []).length > 0) {
        await options.agentModes.replaceSkillPackages(
          created.id,
          existing.skillPackages!.map((item) => item.skillPackageId)
        );
      }
      if ((existing.workspaceRules ?? []).length > 0) {
        await options.agentModes.replaceWorkspaceRules(created.id, existing.workspaceRules!);
      }
      if ((existing.instructionSources ?? []).length > 0) {
        await options.agentModes.replaceInstructionSources(created.id, existing.instructionSources!);
      }
      const agentMode = withWorkspaceAlias((await options.agentModes.get(created.id)) as { workspaceRules?: unknown });
      res.status(201).json({ agentMode });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
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
      const workspaceRules = parsed.data.workspaces ?? parsed.data.workspaceRules ?? [];
      const agentMode = await options.agentModes.replaceWorkspaceRules(req.params.id, workspaceRules);
      res.json({ agentMode: withWorkspaceAlias(agentMode as { workspaceRules?: unknown }) });
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
      res.json({ agentMode: withWorkspaceAlias(agentMode as { workspaceRules?: unknown }) });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/resources/agent-modes/:id/policies", async (req: Request, res: Response) => {
    try {
      const agentMode = await options.agentModes.get(req.params.id);
      if (!agentMode) {
        res.status(404).json({ detail: "agent mode 不存在" });
        return;
      }
      res.json({ policies: await listPoliciesForResource("agent_mode", req.params.id) });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.put("/resources/agent-modes/:id/policies", async (req: Request, res: Response) => {
    const parsed = capabilityPoliciesReplaceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const agentMode = (await options.agentModes.get(req.params.id)) as { organizationId?: string } | undefined;
      if (!agentMode) {
        res.status(404).json({ detail: "agent mode 不存在" });
        return;
      }
      res.json({
        policies: await replacePoliciesForResource("agent_mode", req.params.id, agentMode.organizationId, parsed.data.policies)
      });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
    }
  });

  return router;
}
