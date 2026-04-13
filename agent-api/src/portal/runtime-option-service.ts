import { type AgentModeRecord } from "../persistence/agent-mode-repository.js";
import { type RunProfileRecord } from "../persistence/run-profile-repository.js";
import { type SkillPackageRecord } from "../persistence/skill-package-repository.js";
import { type PolicyService } from "../resources/policy-service.js";
import { getDbClient } from "../db/client.js";
import { SystemSettingsRepository } from "../system-settings/repository.js";
import { type SystemSettingsSafety, type SystemSettingsVersionRecord } from "../system-settings/types.js";

export type PortalRuntimeOptionRunProfile = {
  id: string;
  name: string;
  slug: string;
  description?: string;
  status: string;
  defaultModel: string;
  allowedModels: string[];
  defaultReasoningEffort: string;
  sandboxMode: string;
  approvalPolicy: string;
  networkAccessEnabled: boolean;
  webSearchMode: string;
};

export type PortalRuntimeOptionSkillPackage = {
  id: string;
  label: string;
};

export type PortalRuntimeOptionMode = {
  id: string;
  label: string;
  description?: string;
  runtimeProfile: PortalRuntimeOptionRunProfile;
  allowDirectorySelection: boolean;
  skillPackages: PortalRuntimeOptionSkillPackage[];
  instructionSources: Array<{
    sourceType: string;
    sourceRef: string;
    sortOrder: number;
  }>;
};

export type PortalRuntimeOptionServiceResult = {
  modes: PortalRuntimeOptionMode[];
  canUpload: boolean;
  defaults: {
    mode: string;
  };
};

type ListRepository<T> = {
  list(): Promise<T[]>;
};

type RuntimeOptionServiceDependencies = {
  modes: ListRepository<AgentModeRecord>;
  runProfiles: ListRepository<RunProfileRecord>;
  skillPackages: ListRepository<SkillPackageRecord>;
  policies: PolicyService;
  systemSettings?: {
    getCurrentPublished(): Promise<SystemSettingsVersionRecord | undefined>;
  };
};

type RuntimeOptionRequest = {
  organizationId?: string;
  userId: string;
  roleIds: string[];
  departmentIds: string[];
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function isActive(status: string | undefined): boolean {
  return trimOrUndefined(status) === "active";
}

function matchesOrganization(recordOrganizationId: string | undefined, organizationId: string | undefined): boolean {
  const normalizedRecordOrganizationId = trimOrUndefined(recordOrganizationId);
  const normalizedOrganizationId = trimOrUndefined(organizationId);
  if (normalizedRecordOrganizationId && normalizedOrganizationId) {
    return normalizedRecordOrganizationId === normalizedOrganizationId;
  }
  return !normalizedRecordOrganizationId;
}

function toRunProfileSnapshot(runProfile: RunProfileRecord, safety?: SystemSettingsSafety): PortalRuntimeOptionRunProfile {
  const sandboxMode = safety ? clampSandboxMode(runProfile.sandboxMode, safety) : runProfile.sandboxMode;
  const networkAccessEnabled = safety ? clampNetworkAccess(runProfile.networkAccessEnabled, safety) : runProfile.networkAccessEnabled;
  const webSearchMode = safety ? clampWebSearchMode(runProfile.webSearchMode, safety) : runProfile.webSearchMode;
  return {
    id: runProfile.id,
    name: runProfile.name,
    slug: runProfile.slug,
    description: trimOrUndefined(runProfile.description),
    status: runProfile.status,
    defaultModel: runProfile.defaultModel,
    allowedModels: [...runProfile.allowedModels],
    defaultReasoningEffort: runProfile.defaultReasoningEffort,
    sandboxMode,
    approvalPolicy: runProfile.approvalPolicy,
    networkAccessEnabled,
    webSearchMode
  };
}

function clampSandboxMode(sandboxMode: string, safety: SystemSettingsSafety): string {
  if (!safety.allowFilesystemMutations) {
    return "read-only";
  }
  if (sandboxMode === "danger-full-access" && !safety.allowDangerFullAccess) {
    return "workspace-write";
  }
  return sandboxMode;
}

function clampNetworkAccess(networkAccessEnabled: boolean, safety: SystemSettingsSafety): boolean {
  return safety.allowNetworkAccess ? networkAccessEnabled : false;
}

function clampWebSearchMode(webSearchMode: string, safety: SystemSettingsSafety): string {
  if (!safety.allowLiveWebSearch && webSearchMode === "live") {
    return "cached";
  }
  return webSearchMode;
}

export class PortalRuntimeOptionService {
  private systemSettingsRepository?: SystemSettingsRepository;

  constructor(private readonly deps: RuntimeOptionServiceDependencies) {}

  async resolve(input: RuntimeOptionRequest): Promise<PortalRuntimeOptionServiceResult> {
    const [modeRows, runProfileRows, skillPackageRows] = await Promise.all([
      this.deps.modes.list(),
      this.deps.runProfiles.list(),
      this.deps.skillPackages.list()
    ]);

    const activeVisibleModeRows = modeRows.filter(
      (mode) => isActive(mode.status) && mode.visibleToUsers && matchesOrganization(mode.organizationId, input.organizationId)
    );
    const allowedModeIds = new Set(
      await this.deps.policies.filterAllowedResources({
        organizationId: input.organizationId,
        userId: input.userId,
        roleIds: input.roleIds,
        departmentIds: input.departmentIds,
        resourceType: "agent_mode",
        candidateIds: activeVisibleModeRows.map((mode) => mode.id)
      })
    );

    const runProfileMap = new Map(runProfileRows.map((runProfile) => [runProfile.id, runProfile] as const));
    const skillPackageMap = new Map(skillPackageRows.map((skillPackage) => [skillPackage.id, skillPackage] as const));
    const safetyLimits = await this.resolvePublishedSafetyLimits();

    const resolvedModes = [];
    for (const mode of activeVisibleModeRows) {
      if (!allowedModeIds.has(mode.id)) {
        continue;
      }

      const runProfile = runProfileMap.get(mode.runProfileId);
      if (!runProfile || !isActive(runProfile.status) || !matchesOrganization(runProfile.organizationId, input.organizationId)) {
        continue;
      }

      const authorizedRunProfileIds = new Set(
        await this.deps.policies.filterAllowedResources({
          organizationId: input.organizationId,
          userId: input.userId,
          roleIds: input.roleIds,
          departmentIds: input.departmentIds,
          resourceType: "run_profile",
          candidateIds: [runProfile.id]
        })
      );
      if (!authorizedRunProfileIds.has(runProfile.id)) {
        continue;
      }

      const dependentSkillPackages = [];
      let valid = true;
      for (const binding of mode.skillPackages) {
        const skillPackage = skillPackageMap.get(binding.skillPackageId);
        if (
          !skillPackage ||
          !isActive(skillPackage.status) ||
          !skillPackage.visibleToUsers ||
          !matchesOrganization(skillPackage.organizationId, input.organizationId)
        ) {
          valid = false;
          break;
        }

        const authorizedSkillPackageIds = new Set(
          await this.deps.policies.filterAllowedResources({
            organizationId: input.organizationId,
            userId: input.userId,
            roleIds: input.roleIds,
            departmentIds: input.departmentIds,
            resourceType: "skill_package",
            candidateIds: [skillPackage.id]
          })
        );
        if (!authorizedSkillPackageIds.has(skillPackage.id)) {
          valid = false;
          break;
        }

        dependentSkillPackages.push({
          id: skillPackage.id,
          label: skillPackage.name
        });
      }

      if (!valid) {
        continue;
      }

      resolvedModes.push({
        id: mode.id,
        label: mode.name,
        description: trimOrUndefined(mode.description),
        runtimeProfile: toRunProfileSnapshot(runProfile, safetyLimits),
        allowDirectorySelection: false,
        skillPackages: dependentSkillPackages,
        instructionSources: mode.instructionSources.map((source) => ({
          sourceType: source.sourceType,
          sourceRef: source.sourceRef,
          sortOrder: source.sortOrder
        }))
      });
    }

    const selectedMode = resolvedModes[0];

    return {
      modes: resolvedModes,
      canUpload: true,
      defaults: {
        mode: selectedMode?.id ?? ""
      }
    };
  }

  private async resolvePublishedSafetyLimits(): Promise<SystemSettingsSafety | undefined> {
    if (this.deps.systemSettings) {
      const published = await this.deps.systemSettings.getCurrentPublished();
      return published?.payload.safety;
    }

    if (process.env.NODE_ENV === "test" || !process.env.DATABASE_URL) {
      return undefined;
    }

    this.systemSettingsRepository ??= new SystemSettingsRepository(getDbClient() as never);
    const published = await this.systemSettingsRepository.getCurrentPublished();
    return published?.payload.safety;
  }
}
