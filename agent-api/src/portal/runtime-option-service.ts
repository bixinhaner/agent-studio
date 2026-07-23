import { type AgentModeRecord } from "../persistence/agent-mode-repository.js";
import type { CodexManagedSkillRecord } from "../persistence/codex-skill-repository.js";
import { type RunProfileRecord } from "../persistence/run-profile-repository.js";
import { type SkillPackageRecord } from "../persistence/skill-package-repository.js";
import { type PolicyService } from "../resources/policy-service.js";
import { getDbClient } from "../db/client.js";
import { SystemSettingsRepository } from "../system-settings/repository.js";
import { type SystemSettingsSafety, type SystemSettingsVersionRecord } from "../system-settings/types.js";
import type { NativeCodexSkillRecord } from "../codex-skills/native-codex-skill-service.js";
import type { InstalledPluginRecord } from "../codex-plugins/installed-plugin-service.js";
import { resolveSkillCatalogPresentation, selectCatalogEntry } from "../skill-catalog/service.js";
import type { SkillCatalogEntryRecord } from "../skill-catalog/types.js";
import type { PortalSkillPresentation } from "./skill-presentation.js";

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

export type PortalRuntimeOptionSkill = {
  id: string;
  name: string;
  label: string;
  description?: string;
  system: boolean;
  activationPrompt?: string;
  managedSkillId?: string;
  scope?: string;
  sourcePath?: string;
  automatic?: boolean;
  presentation: PortalSkillPresentation;
};

export type PortalRuntimeOptionMode = {
  id: string;
  label: string;
  description?: string;
  runtimeProfile: PortalRuntimeOptionRunProfile;
  allowDirectorySelection: boolean;
  skillPackages: PortalRuntimeOptionSkillPackage[];
  availableSkills: PortalRuntimeOptionSkill[];
  automaticSkills: PortalRuntimeOptionSkill[];
  instructionSources: Array<{
    sourceType: string;
    sourceRef: string;
    sortOrder: number;
  }>;
};

export type PortalRuntimeOptionServiceResult = {
  modes: PortalRuntimeOptionMode[];
  recentSkillIds: string[];
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
  nativeCodexSkills?: ListRepository<NativeCodexSkillRecord>;
  installedPlugins?: ListRepository<InstalledPluginRecord>;
  managedSkills?: {
    listManagedSkills(input?: {
      organizationId?: string;
      status?: string;
      scope?: string;
      ownerUserId?: string;
      skillName?: string;
    }): Promise<CodexManagedSkillRecord[]>;
  };
  policies: PolicyService;
  systemSettings?: {
    getCurrentPublished(): Promise<SystemSettingsVersionRecord | undefined>;
  };
  recentSkills?: {
    listRecentSkillIds(input: { organizationId?: string; userId: string; take: number }): Promise<string[]>;
  };
  skillCatalog?: {
    listPublished(input: { organizationId?: string }): Promise<SkillCatalogEntryRecord[]>;
  };
};

type RuntimeOptionRequest = {
  organizationId?: string;
  userId: string;
  roleIds: string[];
  departmentIds: string[];
  locale?: string;
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function skillNameFromBindingPayload(value: unknown): string | undefined {
  const payload = asRecord(value);
  if (!payload) return undefined;
  const skillName = payload.skillName ?? payload.name;
  return typeof skillName === "string" ? trimOrUndefined(skillName) : undefined;
}

function skillActivationPromptFromBindingPayload(value: unknown): string | undefined {
  const payload = asRecord(value);
  if (!payload) return undefined;
  const prompt = payload.activationPrompt ?? payload.defaultPrompt ?? payload.prompt;
  return typeof prompt === "string" ? trimOrUndefined(prompt) : undefined;
}

type CodexSkillBinding = {
  name: string;
  activationPrompt?: string;
  managedSkillId?: string;
};

function selectionIdForManagedSkill(managedSkillId: string): string {
  return `managed:${managedSkillId}`;
}

function skillNameKey(value: string): string {
  return value.trim().toLowerCase();
}

function collectCodexSkillBindings(skillPackage: SkillPackageRecord): CodexSkillBinding[] {
  const bindings: CodexSkillBinding[] = [];
  for (const item of skillPackage.items ?? []) {
    for (const binding of item.runtimeBindings ?? []) {
      if (binding.runtimeType !== "codex" || binding.bindingType !== "codex_skill") continue;
      const payload = asRecord(binding.bindingPayload);
      const skillName = skillNameFromBindingPayload(binding.bindingPayload);
      if (!skillName) continue;
      const activationPrompt = skillActivationPromptFromBindingPayload(binding.bindingPayload);
      const managedSkillId =
        typeof payload?.managedSkillId === "string" ? trimOrUndefined(payload.managedSkillId) : undefined;
      const existing = bindings.find(
        (item) =>
          (managedSkillId && item.managedSkillId === managedSkillId) ||
          (!managedSkillId && !item.managedSkillId && item.name === skillName)
      );
      if (existing) {
        existing.activationPrompt ??= activationPrompt;
      } else {
        bindings.push({
          name: skillName,
          activationPrompt,
          managedSkillId
        });
      }
    }
  }
  return bindings;
}

function toManagedRuntimeSkill(
  managedSkill: CodexManagedSkillRecord,
  catalogEntries: SkillCatalogEntryRecord[],
  locale: string | undefined,
  activationPrompt?: string,
): PortalRuntimeOptionSkill {
  const managedCatalogEntry = selectCatalogEntry({
    entries: catalogEntries,
    organizationId: managedSkill.organizationId,
    sourceType: "managed",
    sourceRef: managedSkill.id
  });
  const inheritedNativeCatalogEntry = catalogEntries.find(
    (entry) =>
      entry.status === "active" &&
      entry.sourceType === "native" &&
      Boolean(entry.publishedAt) &&
      skillNameKey(entry.canonicalName) === skillNameKey(managedSkill.skillName)
  );
  const catalogEntry = managedCatalogEntry?.publishedAt
    ? managedCatalogEntry
    : inheritedNativeCatalogEntry ?? managedCatalogEntry;
  const presentation = resolveSkillCatalogPresentation({
    entry: catalogEntry,
    requestedLocale: locale,
    canonicalName: managedSkill.skillName,
    sourceDescription: managedSkill.description
  });
  return {
    id: selectionIdForManagedSkill(managedSkill.id),
    name: managedSkill.skillName,
    label: presentation.displayName,
    description: trimOrUndefined(managedSkill.description),
    system: false,
    activationPrompt,
    managedSkillId: managedSkill.id,
    scope: managedSkill.scope === "private" ? "private" : "team",
    sourcePath: managedSkill.publishedPath,
    presentation
  };
}

function toNativeRuntimeSkill(
  skill: NativeCodexSkillRecord,
  catalogEntries: SkillCatalogEntryRecord[],
  locale: string | undefined,
  activationPrompt?: string,
): PortalRuntimeOptionSkill {
  const presentation = resolveSkillCatalogPresentation({
    entry: selectCatalogEntry({
      entries: catalogEntries,
      sourceType: "native",
      sourceRef: skill.name
    }),
    requestedLocale: locale,
    canonicalName: skill.name,
    sourceDescription: skill.description
  });
  return {
    id: skill.name,
    name: skill.name,
    label: presentation.displayName,
    description: trimOrUndefined(skill.description),
    system: skill.system,
    activationPrompt,
    scope: "platform",
    presentation
  };
}

function toAutomaticPluginRuntimeSkill(
  plugin: InstalledPluginRecord,
  catalogEntries: SkillCatalogEntryRecord[],
  locale: string | undefined
): PortalRuntimeOptionSkill | undefined {
  const catalogEntry = selectCatalogEntry({
    entries: catalogEntries,
    sourceType: "plugin",
    sourceRef: plugin.name
  });
  if (!catalogEntry?.publishedAt || catalogEntry.status !== "active") return undefined;
  const presentation = resolveSkillCatalogPresentation({
    entry: catalogEntry,
    requestedLocale: locale,
    canonicalName: plugin.name,
    sourceDescription: plugin.longDescription ?? plugin.description
  });
  return {
    id: `plugin:${plugin.name}`,
    name: plugin.name,
    label: presentation.displayName,
    description: trimOrUndefined(plugin.description),
    system: true,
    automatic: true,
    scope: "platform",
    presentation
  };
}

export class PortalRuntimeOptionService {
  private systemSettingsRepository?: SystemSettingsRepository;

  constructor(private readonly deps: RuntimeOptionServiceDependencies) {}

  async resolve(input: RuntimeOptionRequest): Promise<PortalRuntimeOptionServiceResult> {
    const [modeRows, runProfileRows, skillPackageRows, nativeSkillRows, managedSkillRows, installedPlugins, recentSkillIds, catalogEntries] = await Promise.all([
      this.deps.modes.list(),
      this.deps.runProfiles.list(),
      this.deps.skillPackages.list(),
      this.deps.nativeCodexSkills?.list() ?? Promise.resolve([]),
      this.deps.managedSkills?.listManagedSkills({ organizationId: input.organizationId }) ?? Promise.resolve([]),
      this.deps.installedPlugins?.list() ?? Promise.resolve([]),
      this.deps.recentSkills?.listRecentSkillIds({ organizationId: input.organizationId, userId: input.userId, take: 30 }) ??
        Promise.resolve([]),
      this.deps.skillCatalog?.listPublished({ organizationId: input.organizationId }) ?? Promise.resolve([])
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
    const nativeSkillMap = new Map(nativeSkillRows.map((skill) => [skill.name, skill] as const));
    const managedSkillMap = new Map(managedSkillRows.map((skill) => [skill.id, skill] as const));
    const activePrivateSkills = managedSkillRows.filter(
      (skill) => skill.status === "active" && skill.scope === "private" && skill.ownerUserId === input.userId
    );
    const activePrivateSkillNames = new Set(activePrivateSkills.map((skill) => skillNameKey(skill.skillName)));
    const safetyLimits = await this.resolvePublishedSafetyLimits();
    const automaticSkills = installedPlugins
      .map((plugin) => toAutomaticPluginRuntimeSkill(plugin, catalogEntries, input.locale))
      .filter((skill): skill is PortalRuntimeOptionSkill => Boolean(skill))
      .sort((left, right) => left.presentation.sortOrder - right.presentation.sortOrder || left.label.localeCompare(right.label));

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
      const availableSkills: PortalRuntimeOptionSkill[] = [];
      const availableSkillIds = new Set<string>();
      const availableSkillNames = new Set<string>();
      for (const binding of mode.skillPackages) {
        const skillPackage = skillPackageMap.get(binding.skillPackageId);
        if (
          !skillPackage ||
          !isActive(skillPackage.status) ||
          !skillPackage.visibleToUsers ||
          !matchesOrganization(skillPackage.organizationId, input.organizationId)
        ) {
          continue;
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
          continue;
        }

        dependentSkillPackages.push({
          id: skillPackage.id,
          label: skillPackage.name
        });

        for (const skillBinding of collectCodexSkillBindings(skillPackage)) {
          if (skillBinding.managedSkillId) {
            const managedSkill = managedSkillMap.get(skillBinding.managedSkillId);
            if (!managedSkill || managedSkill.status !== "active") continue;
            const nameKey = skillNameKey(managedSkill.skillName);
            if (managedSkill.scope !== "private" && activePrivateSkillNames.has(nameKey)) {
              continue;
            }
            const runtimeSkill = toManagedRuntimeSkill(
              managedSkill,
              catalogEntries,
              input.locale,
              skillBinding.activationPrompt
            );
            if (!availableSkillIds.has(runtimeSkill.id)) {
              availableSkillIds.add(runtimeSkill.id);
              availableSkillNames.add(nameKey);
              availableSkills.push(runtimeSkill);
            }
            continue;
          }

          const nativeSkill = nativeSkillMap.get(skillBinding.name);
          if (!nativeSkill) continue;
          const runtimeSkill = toNativeRuntimeSkill(nativeSkill, catalogEntries, input.locale, skillBinding.activationPrompt);
          if (!availableSkillIds.has(runtimeSkill.id)) {
            availableSkillIds.add(runtimeSkill.id);
            availableSkillNames.add(skillNameKey(runtimeSkill.name));
            availableSkills.push(runtimeSkill);
          }
        }
      }

      for (const privateSkill of activePrivateSkills) {
        const runtimeSkill = toManagedRuntimeSkill(privateSkill, catalogEntries, input.locale);
        const nameKey = skillNameKey(runtimeSkill.name);
        if (!availableSkillIds.has(runtimeSkill.id) && !availableSkillNames.has(nameKey)) {
          availableSkillIds.add(runtimeSkill.id);
          availableSkillNames.add(nameKey);
          availableSkills.push(runtimeSkill);
        }
      }

      resolvedModes.push({
        id: mode.id,
        label: mode.name,
        description: trimOrUndefined(mode.description),
        runtimeProfile: toRunProfileSnapshot(runProfile, safetyLimits),
        allowDirectorySelection: false,
        skillPackages: dependentSkillPackages,
        availableSkills: availableSkills.sort(
          (left, right) => left.presentation.sortOrder - right.presentation.sortOrder || left.label.localeCompare(right.label)
        ),
        automaticSkills,
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
      recentSkillIds: Array.from(new Set(recentSkillIds)),
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
