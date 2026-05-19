import { describe, expect, it } from "vitest";

import { PortalRuntimeOptionService } from "./runtime-option-service.js";
import type { NativeCodexSkillRecord } from "../codex-skills/native-codex-skill-service.js";
import type { AgentModeRecord } from "../persistence/agent-mode-repository.js";
import type { RunProfileRecord } from "../persistence/run-profile-repository.js";
import type { SkillPackageRecord } from "../persistence/skill-package-repository.js";

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

function createService(input: {
  modes?: AgentModeRecord[];
  runProfiles?: RunProfileRecord[];
  skillPackages?: SkillPackageRecord[];
  nativeSkills?: NativeCodexSkillRecord[];
  allowedByType?: Record<string, string[]>;
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
    managedSkills: {
      listManagedSkills: async () => []
    },
    policies: {
      filterAllowedResources: async ({ resourceType, candidateIds }: { resourceType: string; candidateIds: string[] }) => {
        const allowed = new Set(allowedByType[resourceType] ?? []);
        return candidateIds.filter((candidateId) => allowed.has(candidateId));
      }
    },
    systemSettings: {
      getCurrentPublished: async () => undefined
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
