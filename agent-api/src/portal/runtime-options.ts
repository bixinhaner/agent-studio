import type { PortalRuntimeOptionServiceResult } from "./runtime-option-service.js";

export type PortalRuntimeOptions = PortalRuntimeOptionServiceResult;

export function toPortalRuntimeOptions(input: PortalRuntimeOptionServiceResult): PortalRuntimeOptions {
  return {
    modes: input.modes.map((mode) => ({
      id: mode.id,
      label: mode.label,
      description: mode.description,
      runtimeProfile: mode.runtimeProfile,
      allowDirectorySelection: mode.allowDirectorySelection,
      skillPackages: mode.skillPackages,
      workspaces: mode.workspaces,
      instructionSources: mode.instructionSources
    })),
    workspaces: input.workspaces.map((workspace) => ({
      id: workspace.id,
      label: workspace.label,
      isDefault: workspace.isDefault
    })),
    canUpload: input.canUpload,
    defaults: {
      mode: input.defaults.mode,
      workspace: input.defaults.workspace
    }
  };
}
