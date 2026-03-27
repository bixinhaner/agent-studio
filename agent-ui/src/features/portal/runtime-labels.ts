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
  if (modeId === "review") return "复核助手";
  if (modeId === "standard") return "通用助手";
  return "受控助手";
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
  return [{ id: currentWorkspace, label: "默认工作区", isDefault: true }];
}

export function resolveWorkspaceLabel(options: WorkspaceOption[], currentWorkspace: string): string {
  const selected = options.find((option) => option.id === currentWorkspace);
  if (selected?.label) return selected.label;
  return resolveWorkspaceOptions(options, currentWorkspace)[0]?.label || "默认工作区";
}
