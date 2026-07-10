import type { PortalRuntimeOptionServiceResult } from "./runtime-option-service.js";
import type { CodexModelCatalog } from "../model-config.js";

export type PortalRuntimeOptions = PortalRuntimeOptionServiceResult & { modelCatalog: CodexModelCatalog };

export function toPortalRuntimeOptions(input: PortalRuntimeOptionServiceResult, modelCatalog: CodexModelCatalog): PortalRuntimeOptions {
  return {
    modes: input.modes.map((mode) => ({
      id: mode.id,
      label: mode.label,
      description: mode.description,
      runtimeProfile: mode.runtimeProfile,
      allowDirectorySelection: mode.allowDirectorySelection,
      skillPackages: mode.skillPackages,
      availableSkills: mode.availableSkills,
      instructionSources: mode.instructionSources
    })),
    canUpload: input.canUpload,
    defaults: {
      mode: input.defaults.mode
    },
    modelCatalog
  };
}
