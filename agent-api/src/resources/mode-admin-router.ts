import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { REASONING_EFFORT_VALUES, validateModelCapabilitySelection } from "../model-config.js";
import { getDbClient } from "../db/client.js";
import type { ResourcePolicyResourceType } from "../persistence/resource-policy-repository.js";
import {
  APPROVAL_POLICY_VALUES,
  SANDBOX_MODE_VALUES,
  WEB_SEARCH_MODE_VALUES
} from "../integrations/zendesk/types.js";
import { listWorkspaceAgentsMdTemplates } from "../agent-mode/workspace-agents-md.js";
import { SystemSettingsRepository } from "../system-settings/repository.js";
import { type SystemSettingsSafety, type SystemSettingsVersionRecord } from "../system-settings/types.js";
import type { NativeCodexSkillRecord } from "../codex-skills/native-codex-skill-service.js";
import type { CodexModelCatalogService } from "../codex-model-catalog.js";

function detailFromError(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败";
}

function detailFromCreateConflict(error: unknown, resourceLabel: string): string {
  const message = detailFromError(error);
  const normalized = message.toLowerCase();
  if (normalized.includes("unique constraint failed") && normalized.includes("slug")) {
    return `${resourceLabel} slug 已存在，请更换一个新的 slug`;
  }
  return message;
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
const runtimeBindingTypeSchema = z.enum(["config_fragment", "prompt_hint", "codex_skill"]);
const instructionSourceTypeSchema = z.literal("workspace_agents_md");
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

function buildRunProfileSafetyViolationDetail(input: RunProfileWritableRecord, safety: SystemSettingsSafety): string | undefined {
  if (!safety.allowFilesystemMutations && input.sandboxMode !== "read-only") {
    return "run profile exceeds published system settings limits";
  }
  if (!safety.allowDangerFullAccess && input.sandboxMode === "danger-full-access") {
    return "run profile exceeds published system settings limits";
  }
  if (!safety.allowNetworkAccess && input.networkAccessEnabled === true) {
    return "run profile exceeds published system settings limits";
  }
  if (!safety.allowLiveWebSearch && input.webSearchMode === "live") {
    return "run profile exceeds published system settings limits";
  }
  return undefined;
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

const agentModeInstructionSourcesReplaceSchema = z.object({
  instructionSources: z.array(
    z.object({
      sourceType: instructionSourceTypeSchema,
      sourceRef: z.string().trim().min(1),
      sortOrder: z.number().int().optional()
    })
  ).length(1, "instructionSources 仅支持 1 条 workspace_agents_md")
});

const agentModeConfigurationSchema = z.object({
  agentMode: agentModeCreateSchema,
  skillPackageIds: stringListSchema,
  instructionSources: agentModeInstructionSourcesReplaceSchema.shape.instructionSources
});

const agentModeConfigurationUpdateSchema = z.object({
  agentMode: agentModeUpdateSchema,
  skillPackageIds: stringListSchema,
  instructionSources: agentModeInstructionSourcesReplaceSchema.shape.instructionSources
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
  replaceInstructionSources(
    id: string,
    instructionSources: Array<{
      sourceType: string;
      sourceRef: string;
      sortOrder?: number;
    }>
  ): Promise<unknown>;
  createConfigured(input: {
    agentMode: {
      organizationId?: string;
      name: string;
      slug: string;
      description?: string;
      status?: string;
      visibleToUsers?: boolean;
      runProfileId: string;
    };
    skillPackageIds: string[];
    instructionSources: Array<{ sourceType: string; sourceRef: string; sortOrder?: number }>;
  }): Promise<unknown>;
  updateConfigured(
    id: string,
    input: {
      agentMode: {
        organizationId?: string;
        name?: string;
        slug?: string;
        description?: string;
        status?: string;
        visibleToUsers?: boolean;
        runProfileId?: string;
      };
      skillPackageIds: string[];
      instructionSources: Array<{ sourceType: string; sourceRef: string; sortOrder?: number }>;
    }
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

export function createModeAdminRouter(options: {
  runProfiles: RunProfileRepositoryLike;
  skillPackages: SkillPackageRepositoryLike;
  agentModes: AgentModeRepositoryLike;
  resourcePolicies?: ResourcePolicyRepositoryLike;
  systemSettings?: SystemSettingsReaderLike;
  nativeCodexSkills?: {
    list(): Promise<NativeCodexSkillRecord[]>;
    readSkillContent(name: string): Promise<{ skill: NativeCodexSkillRecord; content: string }>;
    getBaseHome(): string;
    getSkillsRoot(): string;
  };
  modelCatalog?: Pick<CodexModelCatalogService, "getCatalog">;
}): Router {
  const router = Router();
  let systemSettingsRepository: SystemSettingsRepository | undefined;

  function belongsToCurrentOrganization(req: Request, record: { organizationId?: string }): boolean {
    const recordOrganizationId = record.organizationId?.trim();
    const currentOrganizationId = req.currentOrganization?.id?.trim();
    return !recordOrganizationId || recordOrganizationId === currentOrganizationId;
  }

  function withCurrentOrganization<T extends { organizationId?: string }>(req: Request, input: T): T {
    return { ...input, organizationId: req.currentOrganization?.id };
  }

  function assertCurrentOrganization(req: Request, record: { organizationId?: string } | undefined, label: string) {
    if (!record || !belongsToCurrentOrganization(req, record)) {
      throw new Error(`${label} 不存在`);
    }
  }

  async function inspectAgentConfiguration(
    req: Request,
    input: {
      name: string;
      status?: string;
      visibleToUsers?: boolean;
      runProfileId: string;
      skillPackageIds: string[];
      instructionSources: Array<{ sourceType: string; sourceRef: string; sortOrder?: number }>;
    }
  ) {
    const checks: Array<{ key: string; label: string; pass: boolean; detail: string }> = [];
    checks.push({ key: "identity", label: "基础信息完整", pass: Boolean(input.name.trim()), detail: input.name.trim() ? "名称已设置" : "名称不能为空" });

    const runProfile = (await options.runProfiles.get(input.runProfileId)) as
      | { organizationId?: string; status?: string; name?: string; defaultModel?: string }
      | undefined;
    const runProfileAvailable = Boolean(
      runProfile && belongsToCurrentOrganization(req, runProfile) && runProfile.status === "active"
    );
    checks.push({
      key: "run_profile",
      label: "运行策略可用",
      pass: runProfileAvailable,
      detail: runProfileAvailable
        ? `${runProfile?.name || input.runProfileId} · ${runProfile?.defaultModel || "模型已配置"}`
        : "运行策略不存在、已停用或不属于当前组织"
    });

    const packageRecords = await Promise.all(
      input.skillPackageIds.map((id) => options.skillPackages.get(id) as Promise<
        | { id: string; organizationId?: string; name?: string; status?: string; visibleToUsers?: boolean; items?: unknown[] }
        | undefined
      >)
    );
    const invalidPackages = packageRecords.filter((item) =>
      !item ||
      !belongsToCurrentOrganization(req, item) ||
      item.status !== "active" ||
      (input.visibleToUsers !== false && !item.visibleToUsers)
    );
    checks.push({
      key: "skill_packages",
      label: "技能包运行时可用",
      pass: invalidPackages.length === 0,
      detail: invalidPackages.length === 0
        ? input.skillPackageIds.length > 0
          ? `${input.skillPackageIds.length} 个技能包满足状态、可见范围和组织边界`
          : "未绑定技能包（可选）"
        : `${invalidPackages.length} 个技能包不会进入当前智能体的用户运行时`
    });

    const instructionValid = input.instructionSources.length === 1 && Boolean(input.instructionSources[0]?.sourceRef.trim());
    checks.push({
      key: "instructions",
      label: "角色指令可解析",
      pass: instructionValid,
      detail: instructionValid ? "workspace_agents_md 已配置" : "必须配置一条有效的 workspace_agents_md"
    });
    return { valid: checks.every((item) => item.pass), checks };
  }

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
      return published?.payload.safety;
    }

    if (process.env.NODE_ENV === "test" || !process.env.DATABASE_URL) {
      return undefined;
    }

    systemSettingsRepository ??= new SystemSettingsRepository(getDbClient() as never);
    const published = await systemSettingsRepository.getCurrentPublished();
    return published?.payload.safety;
  }

  async function validateRunProfileModel(input: RunProfileWritableRecord): Promise<string | undefined> {
    if (!options.modelCatalog) return undefined;
    return validateModelCapabilitySelection({
      catalog: await options.modelCatalog.getCatalog(),
      defaultModel: input.defaultModel,
      allowedModels: input.allowedModels,
      defaultReasoningEffort: input.defaultReasoningEffort
    });
  }

  router.get("/run-profiles", async (req: Request, res: Response) => {
    const runProfiles = (await options.runProfiles.list()) as Array<{ organizationId?: string }>;
    res.json({ runProfiles: runProfiles.filter((item) => belongsToCurrentOrganization(req, item)) });
  });

  router.get("/model-catalog", async (req: Request, res: Response) => {
    if (!options.modelCatalog) {
      res.status(503).json({ detail: "Codex 模型目录未配置" });
      return;
    }
    res.json(await options.modelCatalog.getCatalog({ refresh: req.query.refresh === "1" }));
  });

  router.post("/run-profiles", async (req: Request, res: Response) => {
    const parsed = runProfileCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const modelViolation = await validateRunProfileModel(parsed.data);
      if (modelViolation) {
        res.status(400).json({ detail: modelViolation });
        return;
      }
      const safetyLimits = await resolvePublishedSafetyLimits();
      if (safetyLimits) {
        const violation = buildRunProfileSafetyViolationDetail(parsed.data, safetyLimits);
        if (violation) {
          res.status(400).json({ detail: violation });
          return;
        }
      }
      const runProfile = await options.runProfiles.create(withCurrentOrganization(req, parsed.data));
      res.status(201).json({ runProfile });
    } catch (error) {
      res.status(400).json({ detail: detailFromCreateConflict(error, "run profile") });
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
      assertCurrentOrganization(req, existing, "run profile");
      const safetyLimits = await resolvePublishedSafetyLimits();
      const nextInput: RunProfileWritableRecord = {
        ...(existing as RunProfileWritableRecord),
        ...parsed.data
      };
      const modelViolation = await validateRunProfileModel(nextInput);
      if (modelViolation) {
        res.status(400).json({ detail: modelViolation });
        return;
      }
      if (safetyLimits) {
        const violation = buildRunProfileSafetyViolationDetail(nextInput, safetyLimits);
        if (violation) {
          res.status(400).json({ detail: violation });
          return;
        }
      }
      const runProfile = await options.runProfiles.create(
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
        }
      );
      res.status(201).json({ runProfile });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromCreateConflict(error, "run profile") });
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
      assertCurrentOrganization(req, existing as { organizationId?: string }, "run profile");
      const safetyLimits = await resolvePublishedSafetyLimits();
      const nextInput: RunProfileWritableRecord = {
        ...(existing as RunProfileWritableRecord),
        ...parsed.data
      };
      const modelViolation = await validateRunProfileModel(nextInput);
      if (modelViolation) {
        res.status(400).json({ detail: modelViolation });
        return;
      }
      if (safetyLimits) {
        const violation = buildRunProfileSafetyViolationDetail(nextInput, safetyLimits);
        if (violation) {
          res.status(400).json({ detail: violation });
          return;
        }
      }
      const runProfile = await options.runProfiles.update(req.params.id, {
        ...parsed.data,
        organizationId: (existing as { organizationId?: string }).organizationId
      });
      res.json({ runProfile });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/resources/run-profiles/:id/policies", async (req: Request, res: Response) => {
    try {
      const runProfile = (await options.runProfiles.get(req.params.id)) as { id: string } | undefined;
      assertCurrentOrganization(req, runProfile as ({ id: string; organizationId?: string } | undefined), "run profile");
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
      assertCurrentOrganization(req, runProfile, "run profile");
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

  router.get("/skill-packages", async (req: Request, res: Response) => {
    const skillPackages = (await options.skillPackages.list()) as Array<{ organizationId?: string }>;
    res.json({ skillPackages: skillPackages.filter((item) => belongsToCurrentOrganization(req, item)) });
  });

  router.get("/codex-skills", async (_req: Request, res: Response) => {
    if (!options.nativeCodexSkills) {
      res.json({ skills: [], codexHome: "", skillsRoot: "" });
      return;
    }
    try {
      res.json({
        skills: await options.nativeCodexSkills.list(),
        codexHome: options.nativeCodexSkills.getBaseHome(),
        skillsRoot: options.nativeCodexSkills.getSkillsRoot()
      });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/codex-skills/:name/content", async (req: Request, res: Response) => {
    if (!options.nativeCodexSkills) {
      res.status(404).json({ detail: "Codex Skill 服务未配置" });
      return;
    }
    try {
      res.json(await options.nativeCodexSkills.readSkillContent(req.params.name));
    } catch (error) {
      res.status(404).json({ detail: detailFromError(error) });
    }
  });

  router.post("/skill-packages", async (req: Request, res: Response) => {
    const parsed = skillPackageCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const skillPackage = await options.skillPackages.create(withCurrentOrganization(req, parsed.data));
      res.status(201).json({ skillPackage });
    } catch (error) {
      res.status(400).json({ detail: detailFromCreateConflict(error, "skill package") });
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
      assertCurrentOrganization(req, existing, "skill package");
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
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromCreateConflict(error, "skill package") });
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
      assertCurrentOrganization(req, existing as { organizationId?: string }, "skill package");
      const skillPackage = await options.skillPackages.update(req.params.id, {
        ...parsed.data,
        organizationId: (existing as { organizationId?: string }).organizationId
      });
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
      assertCurrentOrganization(req, skillPackage as { organizationId?: string }, "skill package");
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
      const existing = await options.skillPackages.get(req.params.id);
      assertCurrentOrganization(req, existing as ({ organizationId?: string } | undefined), "skill package");
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
      assertCurrentOrganization(req, skillPackage as { organizationId?: string }, "skill package");
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
      assertCurrentOrganization(req, skillPackage, "skill package");
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

  router.get("/agent-modes", async (req: Request, res: Response) => {
    const agentModes = (await options.agentModes.list()) as Array<{ organizationId?: string }>;
    res.json({ agentModes: agentModes.filter((item) => belongsToCurrentOrganization(req, item)) });
  });

  router.get("/agent-modes/workspace-agents-templates", async (_req: Request, res: Response) => {
    try {
      const templates = await listWorkspaceAgentsMdTemplates();
      res.json({
        templates: templates.map((template) => ({
          id: template.id,
          label: template.label,
          sourcePath: template.sourcePath,
          content: template.content,
          updatedAt: template.updatedAt
        }))
      });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/agent-modes/validate-configuration", async (req: Request, res: Response) => {
    const parsed = agentModeConfigurationSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      res.json(await inspectAgentConfiguration(req, {
        ...parsed.data.agentMode,
        skillPackageIds: parsed.data.skillPackageIds,
        instructionSources: parsed.data.instructionSources
      }));
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/agent-modes/configured", async (req: Request, res: Response) => {
    const parsed = agentModeConfigurationSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const inspection = await inspectAgentConfiguration(req, {
        ...parsed.data.agentMode,
        skillPackageIds: parsed.data.skillPackageIds,
        instructionSources: parsed.data.instructionSources
      });
      if (!inspection.valid) {
        res.status(400).json({ detail: inspection.checks.filter((item) => !item.pass).map((item) => item.detail).join("；") });
        return;
      }
      const agentMode = await options.agentModes.createConfigured({
        agentMode: withCurrentOrganization(req, parsed.data.agentMode),
        skillPackageIds: [...new Set(parsed.data.skillPackageIds)],
        instructionSources: parsed.data.instructionSources
      });
      res.status(201).json({ agentMode });
    } catch (error) {
      res.status(400).json({ detail: detailFromCreateConflict(error, "agent mode") });
    }
  });

  router.post("/agent-modes", async (req: Request, res: Response) => {
    const parsed = agentModeCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const agentMode = await options.agentModes.create(withCurrentOrganization(req, parsed.data));
      res.status(201).json({ agentMode });
    } catch (error) {
      res.status(400).json({ detail: detailFromCreateConflict(error, "agent mode") });
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
      assertCurrentOrganization(req, existing, "agent mode");
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
      if ((existing.instructionSources ?? []).length > 0) {
        await options.agentModes.replaceInstructionSources(created.id, existing.instructionSources!);
      }
      const agentMode = await options.agentModes.get(created.id);
      res.status(201).json({ agentMode });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromCreateConflict(error, "agent mode") });
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
      assertCurrentOrganization(req, existing as { organizationId?: string }, "agent mode");
      const agentMode = await options.agentModes.update(req.params.id, {
        ...parsed.data,
        organizationId: (existing as { organizationId?: string }).organizationId
      });
      res.json({ agentMode });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.put("/agent-modes/:id/configuration", async (req: Request, res: Response) => {
    const parsed = agentModeConfigurationUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const existing = (await options.agentModes.get(req.params.id)) as
        | { organizationId?: string; name?: string; status?: string; visibleToUsers?: boolean; runProfileId?: string }
        | undefined;
      assertCurrentOrganization(req, existing, "agent mode");
      const proposed = {
        name: parsed.data.agentMode.name ?? existing?.name ?? "",
        status: parsed.data.agentMode.status ?? existing?.status,
        visibleToUsers: parsed.data.agentMode.visibleToUsers ?? existing?.visibleToUsers,
        runProfileId: parsed.data.agentMode.runProfileId ?? existing?.runProfileId ?? "",
        skillPackageIds: parsed.data.skillPackageIds,
        instructionSources: parsed.data.instructionSources
      };
      const inspection = await inspectAgentConfiguration(req, proposed);
      if (!inspection.valid) {
        res.status(400).json({ detail: inspection.checks.filter((item) => !item.pass).map((item) => item.detail).join("；") });
        return;
      }
      const agentMode = await options.agentModes.updateConfigured(req.params.id, {
        agentMode: { ...parsed.data.agentMode, organizationId: existing?.organizationId },
        skillPackageIds: [...new Set(parsed.data.skillPackageIds)],
        instructionSources: parsed.data.instructionSources
      });
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
      const existing = await options.agentModes.get(req.params.id);
      assertCurrentOrganization(req, existing as ({ organizationId?: string } | undefined), "agent mode");
      const agentMode = await options.agentModes.replaceSkillPackages(req.params.id, parsed.data.skillPackageIds);
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
      const existing = await options.agentModes.get(req.params.id);
      assertCurrentOrganization(req, existing as ({ organizationId?: string } | undefined), "agent mode");
      const agentMode = await options.agentModes.replaceInstructionSources(req.params.id, parsed.data.instructionSources);
      res.json({ agentMode });
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
      assertCurrentOrganization(req, agentMode as { organizationId?: string }, "agent mode");
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
      assertCurrentOrganization(req, agentMode, "agent mode");
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
