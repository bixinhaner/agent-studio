import type { RuntimeModelCatalog } from "../../lib/model-config";

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
    automatic?: boolean;
    managedSkillId?: string;
    scope?: string;
    presentation: {
      displayName: string;
      summary: string;
      useCases: string[];
      usageSteps: string[];
      examplePrompts: string[];
      dataScope?: string;
      iconKey: string;
      sortOrder: number;
      shortcutKey?: string;
      requestedLocale: string;
      resolvedLocale: string;
      fallbackLocale?: string;
    };
  }>;
  automaticSkills: RuntimeModeSnapshot["availableSkills"];
  instructionSources: Array<{
    sourceType: string;
    sourceRef: string;
    sortOrder: number;
  }>;
};

export type PortalRuntimeOptions = {
  modes: RuntimeModeSnapshot[];
  recentSkillIds: string[];
  canUpload: boolean;
  defaults: {
    mode: string;
  };
  modelCatalog: RuntimeModelCatalog;
};
