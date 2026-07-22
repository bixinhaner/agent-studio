import type {
  PortalRuntimeOptionMode,
  PortalRuntimeOptionServiceResult,
  PortalRuntimeOptionSkill
} from "./runtime-option-service.js";
import type { CodexModelCatalog } from "../model-config.js";

export type PortalRuntimeOptionPublicSkill = Omit<PortalRuntimeOptionSkill, "activationPrompt" | "sourcePath">;
export type PortalRuntimeOptionPublicMode = Omit<PortalRuntimeOptionMode, "availableSkills"> & {
  availableSkills: PortalRuntimeOptionPublicSkill[];
};

export type PortalRuntimeOptions = Omit<PortalRuntimeOptionServiceResult, "modes"> & {
  modes: PortalRuntimeOptionPublicMode[];
  modelCatalog: CodexModelCatalog;
};

export function toPortalRuntimeOptions(input: PortalRuntimeOptionServiceResult, modelCatalog: CodexModelCatalog): PortalRuntimeOptions {
  return {
    modes: input.modes.map((mode) => ({
      id: mode.id,
      label: mode.label,
      description: mode.description,
      runtimeProfile: mode.runtimeProfile,
      allowDirectorySelection: mode.allowDirectorySelection,
      skillPackages: mode.skillPackages,
      availableSkills: mode.availableSkills.map(({ activationPrompt: _activationPrompt, sourcePath: _sourcePath, ...skill }) => skill),
      instructionSources: mode.instructionSources
    })),
    canUpload: input.canUpload,
    recentSkillIds: input.recentSkillIds,
    defaults: {
      mode: input.defaults.mode
    },
    modelCatalog
  };
}
