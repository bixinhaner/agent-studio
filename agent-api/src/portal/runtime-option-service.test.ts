import { describe, expect, it } from "vitest";

import { PortalRuntimeOptionService } from "./runtime-option-service.js";
import type { NativeCodexSkillRecord } from "../codex-skills/native-codex-skill-service.js";
import type { InstalledPluginRecord } from "../codex-plugins/installed-plugin-service.js";
import type { AgentModeRecord } from "../persistence/agent-mode-repository.js";
import type { CodexManagedSkillRecord } from "../persistence/codex-skill-repository.js";
import type { RunProfileRecord } from "../persistence/run-profile-repository.js";
import type { SkillPackageRecord } from "../persistence/skill-package-repository.js";
import type { SkillCatalogEntryRecord } from "../skill-catalog/types.js";

const now = "2026-05-20T00:00:00.000Z";

function runProfile(overrides: Partial<RunProfileRecord> = {}): RunProfileRecord {
  return {
    id: "run-profile-tech",
    organizationId: "org_internal",
    name: "Tech profile",
    slug: "tech-profile",
    description: undefined,
    status: "active",
    defaultModel: "gpt-5.5",
    allowedModels: ["gpt-5.5"],
    defaultReasoningEffort: "high",
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    networkAccessEnabled: true,
    webSearchMode: "live",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function skillPackage(id: string, skillName: string, overrides: Partial<SkillPackageRecord> = {}): SkillPackageRecord {
  return {
    id,
    organizationId: "org_internal",
    name: skillName,
    slug: skillName,
    description: undefined,
    status: "active",
    visibleToUsers: true,
    createdAt: now,
    updatedAt: now,
    items: [
      {
        id: `${id}-item`,
        capabilityKey: skillName,
        description: undefined,
        createdAt: now,
        updatedAt: now,
        runtimeBindings: [
          {
            id: `${id}-binding`,
            runtimeType: "codex",
            bindingType: "codex_skill",
            bindingPayload: { skillName },
            createdAt: now,
            updatedAt: now
          }
        ]
      }
    ],
    ...overrides
  };
}

function agentMode(overrides: Partial<AgentModeRecord> = {}): AgentModeRecord {
  return {
    id: "mode-tech",
    organizationId: "org_internal",
    name: "Tech-support",
    slug: "tech-support",
    description: undefined,
    status: "active",
    visibleToUsers: true,
    runProfileId: "run-profile-tech",
    createdAt: now,
    updatedAt: now,
    skillPackages: [
      { id: "binding-allowed", skillPackageId: "package-allowed", createdAt: now, updatedAt: now },
      { id: "binding-blocked", skillPackageId: "package-blocked", createdAt: now, updatedAt: now }
    ],
    workspaceRules: [],
    instructionSources: [],
    ...overrides
  };
}

function nativeSkill(name: string): NativeCodexSkillRecord {
  return {
    name,
    description: `${name} description`,
    sourcePath: `/skills/${name}`,
    relativePath: name,
    system: false
  };
}

function managedSkill(id: string, skillName: string): CodexManagedSkillRecord {
  return {
    id,
    organizationId: "org_internal",
    scope: "team",
    skillName,
    slug: skillName,
    displayName: skillName,
    description: `${skillName} managed source description`,
    status: "active",
    version: "1.0.0",
    publishedPath: `/managed-skills/${skillName}`,
    createdAt: now,
    updatedAt: now
  };
}

function managedSkillPackage(id: string, skillName: string, managedSkillId: string): SkillPackageRecord {
  const record = skillPackage(id, skillName);
  return {
    ...record,
    items: record.items.map((item) => ({
      ...item,
      runtimeBindings: item.runtimeBindings.map((binding) => ({
        ...binding,
        bindingPayload: { skillName, managedSkillId }
      }))
    }))
  };
}

function catalogEntry(input: {
  id: string;
  sourceType: "native" | "managed" | "plugin";
  sourceRef: string;
  canonicalName: string;
  organizationId?: string;
  published?: boolean;
  displayName: string;
  summary: string;
}): SkillCatalogEntryRecord {
  return {
    id: input.id,
    catalogKey: `${input.sourceType}:${input.sourceRef}`,
    organizationId: input.organizationId,
    sourceType: input.sourceType,
    sourceRef: input.sourceRef,
    canonicalName: input.canonicalName,
    defaultLocale: "zh-CN",
    iconKey: "sparkles",
    sortOrder: 100,
    status: "active",
    publishedAt: input.published ? now : undefined,
    createdAt: now,
    updatedAt: now,
    translations: {
      "zh-CN": {
        displayName: input.displayName,
        summary: input.summary,
        useCases: [],
        usageSteps: [],
        examplePrompts: []
      }
    }
  };
}

function createService(input: {
  modes?: AgentModeRecord[];
  runProfiles?: RunProfileRecord[];
  skillPackages?: SkillPackageRecord[];
  nativeSkills?: NativeCodexSkillRecord[];
  allowedByType?: Record<string, string[]>;
  recentSkillIds?: string[];
  catalogEntries?: SkillCatalogEntryRecord[];
  managedSkills?: CodexManagedSkillRecord[];
  installedPlugins?: InstalledPluginRecord[];
}) {
  const allowedByType = input.allowedByType ?? {};
  return new PortalRuntimeOptionService({
    modes: { list: async () => input.modes ?? [agentMode()] },
    runProfiles: { list: async () => input.runProfiles ?? [runProfile()] },
    skillPackages: {
      list: async () =>
        input.skillPackages ?? [skillPackage("package-allowed", "allowed-skill"), skillPackage("package-blocked", "blocked-skill")]
    },
    nativeCodexSkills: {
      list: async () => input.nativeSkills ?? [nativeSkill("allowed-skill"), nativeSkill("blocked-skill")]
    },
    installedPlugins: {
      list: async () => input.installedPlugins ?? []
    },
    managedSkills: {
      listManagedSkills: async () => input.managedSkills ?? []
    },
    policies: {
      filterAllowedResources: async ({ resourceType, candidateIds }: { resourceType: string; candidateIds: string[] }) => {
        const allowed = new Set(allowedByType[resourceType] ?? []);
        return candidateIds.filter((candidateId) => allowed.has(candidateId));
      }
    },
    systemSettings: {
      getCurrentPublished: async () => undefined
    },
    recentSkills: {
      listRecentSkillIds: async () => input.recentSkillIds ?? []
    },
    skillCatalog: {
      listPublished: async () => input.catalogEntries ?? []
    }
  } as never);
}

describe("PortalRuntimeOptionService", () => {
  it("keeps an authorized agent mode visible while filtering unauthorized skill packages", async () => {
    const service = createService({
      allowedByType: {
        agent_mode: ["mode-tech"],
        run_profile: ["run-profile-tech"],
        skill_package: ["package-allowed"]
      }
    });

    const result = await service.resolve({
      organizationId: "org_internal",
      userId: "user-like",
      roleIds: ["employee"],
      departmentIds: []
    });

    expect(result.modes).toHaveLength(1);
    expect(result.modes[0]?.id).toBe("mode-tech");
    expect(result.modes[0]?.skillPackages).toEqual([{ id: "package-allowed", label: "allowed-skill" }]);
    expect(result.modes[0]?.availableSkills.map((skill) => skill.name)).toEqual(["allowed-skill"]);
    expect(result.modes[0]?.availableSkills[0]).toMatchObject({
      scope: "platform",
      presentation: { displayName: "allowed-skill", summary: "allowed-skill description" }
    });
  });

  it("returns recent skills in stable deduplicated order", async () => {
    const service = createService({
      recentSkillIds: ["allowed-skill", "blocked-skill", "allowed-skill"],
      allowedByType: {
        agent_mode: ["mode-tech"],
        run_profile: ["run-profile-tech"],
        skill_package: ["package-allowed", "package-blocked"]
      }
    });

    const result = await service.resolve({
      organizationId: "org_internal",
      userId: "user-like",
      roleIds: ["employee"],
      departmentIds: []
    });

    expect(result.recentSkillIds).toEqual(["allowed-skill", "blocked-skill"]);
  });

  it("exposes published installed plugins as automatic read-only capabilities", async () => {
    const service = createService({
      installedPlugins: [{
        name: "documents",
        pluginRef: "documents@office",
        marketplace: "office",
        version: "1.2.3",
        sourcePath: "/plugins/documents",
        displayName: "Documents",
        capabilities: ["Interactive", "Write"],
        defaultPrompts: ["Create a memo"],
        skillNames: ["documents"],
        enabled: true,
        readiness: "ready",
        visibleToUsers: true,
        capabilityHealth: [{ id: "local-documents", label: "本地文档", status: "ready" }]
      }],
      catalogEntries: [catalogEntry({
        id: "plugin-documents",
        sourceType: "plugin",
        sourceRef: "documents",
        canonicalName: "documents",
        published: true,
        displayName: "文档制作",
        summary: "创建并检查 Word 文档"
      })],
      allowedByType: {
        agent_mode: ["mode-tech"],
        run_profile: ["run-profile-tech"],
        skill_package: []
      }
    });

    const result = await service.resolve({
      organizationId: "org_internal",
      userId: "user-like",
      roleIds: ["employee"],
      departmentIds: [],
      locale: "zh-CN"
    });

    expect(result.modes[0]?.automaticSkills).toEqual([
      expect.objectContaining({
        id: "plugin:documents",
        name: "documents",
        automatic: true,
        presentation: expect.objectContaining({
          displayName: "文档制作",
          summary: "创建并检查 Word 文档"
        })
      })
    ]);
    expect(result.modes[0]?.availableSkills).toEqual([]);
  });

  it("does not expose a plugin when its secure runtime channels are unavailable", async () => {
    const service = createService({
      installedPlugins: [{
        name: "product-design",
        pluginRef: "product-design@office",
        marketplace: "office",
        version: "1.0.0",
        sourcePath: "/plugins/product-design",
        displayName: "Product Design",
        capabilities: ["Browser", "Sites"],
        defaultPrompts: [],
        skillNames: ["product-design"],
        enabled: true,
        readiness: "unavailable",
        visibleToUsers: false,
        capabilityHealth: [{
          id: "browser-capture",
          label: "浏览器页面采集",
          status: "unavailable",
          detail: "保密运行模式未提供 Browser"
        }]
      }],
      catalogEntries: [catalogEntry({
        id: "plugin-product-design",
        sourceType: "plugin",
        sourceRef: "product-design",
        canonicalName: "product-design",
        published: true,
        displayName: "产品设计",
        summary: "产品设计工作流"
      })],
      allowedByType: {
        agent_mode: ["mode-tech"],
        run_profile: ["run-profile-tech"],
        skill_package: []
      }
    });

    const result = await service.resolve({
      organizationId: "org_internal",
      userId: "user-like",
      roleIds: ["employee"],
      departmentIds: []
    });

    expect(result.modes[0]?.automaticSkills).toEqual([]);
  });

  it("inherits a published native presentation for an unpublished managed catalog placeholder", async () => {
    const skillName = "shared-report";
    const managedSkillId = "managed-shared-report";
    const service = createService({
      skillPackages: [managedSkillPackage("package-allowed", skillName, managedSkillId)],
      managedSkills: [managedSkill(managedSkillId, skillName)],
      nativeSkills: [nativeSkill(skillName)],
      catalogEntries: [
        catalogEntry({
          id: "managed-catalog",
          sourceType: "managed",
          sourceRef: managedSkillId,
          canonicalName: skillName,
          organizationId: "org_internal",
          displayName: skillName,
          summary: "English auto-seeded source copy"
        }),
        catalogEntry({
          id: "native-catalog",
          sourceType: "native",
          sourceRef: skillName,
          canonicalName: skillName,
          published: true,
          displayName: "共享报告",
          summary: "生成团队共享报告"
        })
      ],
      allowedByType: {
        agent_mode: ["mode-tech"],
        run_profile: ["run-profile-tech"],
        skill_package: ["package-allowed"]
      }
    });

    const result = await service.resolve({
      organizationId: "org_internal",
      userId: "user-like",
      roleIds: ["employee"],
      departmentIds: [],
      locale: "zh-CN"
    });

    expect(result.modes[0]?.availableSkills[0]).toMatchObject({
      managedSkillId,
      scope: "team",
      presentation: {
        displayName: "共享报告",
        summary: "生成团队共享报告",
        resolvedLocale: "zh-CN"
      }
    });
  });

  it("keeps an explicitly published managed presentation ahead of the native catalog", async () => {
    const skillName = "shared-report";
    const managedSkillId = "managed-shared-report";
    const service = createService({
      skillPackages: [managedSkillPackage("package-allowed", skillName, managedSkillId)],
      managedSkills: [managedSkill(managedSkillId, skillName)],
      nativeSkills: [nativeSkill(skillName)],
      catalogEntries: [
        catalogEntry({
          id: "managed-catalog",
          sourceType: "managed",
          sourceRef: managedSkillId,
          canonicalName: skillName,
          organizationId: "org_internal",
          published: true,
          displayName: "团队定制报告",
          summary: "使用团队自定义口径生成报告"
        }),
        catalogEntry({
          id: "native-catalog",
          sourceType: "native",
          sourceRef: skillName,
          canonicalName: skillName,
          published: true,
          displayName: "平台共享报告",
          summary: "平台默认介绍"
        })
      ],
      allowedByType: {
        agent_mode: ["mode-tech"],
        run_profile: ["run-profile-tech"],
        skill_package: ["package-allowed"]
      }
    });

    const result = await service.resolve({
      organizationId: "org_internal",
      userId: "user-like",
      roleIds: ["employee"],
      departmentIds: [],
      locale: "zh-CN"
    });

    expect(result.modes[0]?.availableSkills[0]?.presentation).toMatchObject({
      displayName: "团队定制报告",
      summary: "使用团队自定义口径生成报告"
    });
  });

  it("still returns the agent mode when none of its skill packages are authorized", async () => {
    const service = createService({
      allowedByType: {
        agent_mode: ["mode-tech"],
        run_profile: ["run-profile-tech"],
        skill_package: []
      }
    });

    const result = await service.resolve({
      organizationId: "org_internal",
      userId: "user-like",
      roleIds: ["employee"],
      departmentIds: []
    });

    expect(result.modes).toHaveLength(1);
    expect(result.modes[0]?.skillPackages).toEqual([]);
    expect(result.modes[0]?.availableSkills).toEqual([]);
  });

  it("continues to hide the agent mode when the run profile is not authorized", async () => {
    const service = createService({
      allowedByType: {
        agent_mode: ["mode-tech"],
        run_profile: [],
        skill_package: ["package-allowed", "package-blocked"]
      }
    });

    const result = await service.resolve({
      organizationId: "org_internal",
      userId: "user-like",
      roleIds: ["employee"],
      departmentIds: []
    });

    expect(result.modes).toEqual([]);
  });
});
