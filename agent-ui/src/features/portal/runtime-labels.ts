type ModeOption = {
  id: string;
  label: string;
};

type WorkspaceOption = {
  id: string;
  label: string;
  isDefault: boolean;
};

function fallbackModeLabel(modeId: string): string {
  if (modeId === "review") return "Review Assistant";
  if (modeId === "standard") return "General Assistant";
  return "Controlled Assistant";
}

export function resolveModeOptions(options: ModeOption[], currentMode: string): ModeOption[] {
  if (options.length > 0) return options;
  return [{ id: currentMode, label: fallbackModeLabel(currentMode) }];
}

export function resolveModeLabel(options: ModeOption[], currentMode: string): string {
  const selected = options.find((option) => option.id === currentMode);
  if (selected?.label) return selected.label;
  return resolveModeOptions(options, currentMode)[0]?.label || fallbackModeLabel(currentMode);
}

export function resolveWorkspaceOptions(options: WorkspaceOption[], currentWorkspace: string): WorkspaceOption[] {
  if (options.length > 0) return options;
  return [{ id: currentWorkspace, label: "Default workspace", isDefault: true }];
}

export function resolveWorkspaceLabel(options: WorkspaceOption[], currentWorkspace: string): string {
  const selected = options.find((option) => option.id === currentWorkspace);
  if (selected?.label) return selected.label;
  return resolveWorkspaceOptions(options, currentWorkspace)[0]?.label || "Default workspace";
}
