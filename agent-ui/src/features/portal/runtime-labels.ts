type ModeOption = {
  id: string;
  label: string;
};

type WorkspaceOption = {
  id: string;
  label: string;
  isDefault: boolean;
};

export function resolveModeOptions(options: ModeOption[], _currentMode: string): ModeOption[] {
  if (options.length > 0) return options;
  return [];
}

export function resolveModeLabel(options: ModeOption[], currentMode: string): string {
  const selected = options.find((option) => option.id === currentMode);
  if (selected?.label) return selected.label;
  return "";
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
