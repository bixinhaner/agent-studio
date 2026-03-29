export type RuntimeProfileSnapshot = {
  id?: string;
  name?: string;
  slug?: string;
  description?: string;
  status?: string;
  defaultModel: string;
  allowedModels: string[];
  defaultReasoningEffort: string;
  sandboxMode: string;
  approvalPolicy: string;
  networkAccessEnabled: boolean;
  webSearchMode: string;
};

export type RuntimeModeSnapshot = {
  id: string;
  label: string;
  description?: string;
  runtimeProfile: RuntimeProfileSnapshot;
  allowDirectorySelection: boolean;
  skillPackages: Array<{ id: string; label: string }>;
  workspaces: Array<{
    id: string;
    label: string;
    isDefault: boolean;
    allowDirectorySelection: boolean;
    directoryScope: string;
    loadWorkspaceAgentsMd: boolean;
  }>;
  instructionSources: Array<{
    sourceType: string;
    sourceRef: string;
    sortOrder: number;
  }>;
};

export type PortalRuntimeOptions = {
  modes: RuntimeModeSnapshot[];
  workspaces: Array<{
    id: string;
    label: string;
    isDefault: boolean;
  }>;
  canUpload: boolean;
  defaults: {
    mode: string;
    workspace: string;
  };
};
