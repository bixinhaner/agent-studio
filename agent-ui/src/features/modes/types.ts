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
  availableSkills: Array<{
    id: string;
    name: string;
    label: string;
    description?: string;
    system: boolean;
    activationPrompt?: string;
    managedSkillId?: string;
    scope?: string;
    sourcePath?: string;
  }>;
  instructionSources: Array<{
    sourceType: string;
    sourceRef: string;
    sortOrder: number;
  }>;
};

export type PortalRuntimeOptions = {
  modes: RuntimeModeSnapshot[];
  canUpload: boolean;
  defaults: {
    mode: string;
  };
};
