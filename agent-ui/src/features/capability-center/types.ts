export type CapabilityCenterTab = "agent_mode" | "skill_package" | "run_profile";
export type CapabilityStatusFilter = "all" | "active" | "disabled";
export type CapabilityVisibilityFilter = "all" | "visible" | "hidden";
export type CapabilityResourceType = "agent_mode" | "skill_package" | "run_profile";
export type CapabilityResourceTypeLabel = "Agent Modes" | "Skill Packages" | "Run Profiles";

export type CapabilityResourceTab = {
  id: CapabilityCenterTab;
  label: CapabilityResourceTypeLabel;
};

export type ResourcePolicySubjectType = "role" | "department" | "user";
export type ResourcePolicyEffect = "allow" | "deny";

export type ResourcePolicyRecord = {
  id?: string;
  organizationId?: string;
  subjectType: ResourcePolicySubjectType;
  subjectId: string;
  resourceType: CapabilityResourceType;
  resourceId: string;
  effect: ResourcePolicyEffect;
  createdAt?: string;
  updatedAt?: string;
};

export type CapabilityPoliciesResponse = {
  policies: ResourcePolicyRecord[];
};

export type CapabilityPolicyInput = {
  subjectType: ResourcePolicySubjectType;
  subjectId: string;
  effect: ResourcePolicyEffect;
};

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type ApprovalPolicy = "never" | "on-request" | "on-failure" | "untrusted";
export type WebSearchMode = "disabled" | "cached" | "live";
export type DirectoryScope = "workspace_only" | "descendants_only" | "authorized_workspace_and_knowledge_set";
export type InstructionSourceType = "workspace_agents_md";
export type RuntimeBindingType = "config_fragment" | "prompt_hint";
export type RuntimeType = "codex" | "claude_code";

export type RunProfileRecord = {
  id: string;
  organizationId?: string;
  name: string;
  slug: string;
  description?: string;
  status: string;
  defaultModel: string;
  allowedModels: string[];
  defaultReasoningEffort: ReasoningEffort;
  sandboxMode: SandboxMode;
  approvalPolicy: ApprovalPolicy;
  networkAccessEnabled: boolean;
  webSearchMode: WebSearchMode;
  createdAt: string;
  updatedAt: string;
};

export type RunProfileListResponse = {
  runProfiles: RunProfileRecord[];
};

export type RunProfileResponse = {
  runProfile: RunProfileRecord;
};

export type CreateRunProfileInput = {
  organizationId?: string;
  name: string;
  slug: string;
  description?: string;
  status?: string;
  defaultModel: string;
  allowedModels: string[];
  defaultReasoningEffort: ReasoningEffort;
  sandboxMode: SandboxMode;
  approvalPolicy: ApprovalPolicy;
  networkAccessEnabled?: boolean;
  webSearchMode: WebSearchMode;
};

export type UpdateRunProfileInput = Partial<CreateRunProfileInput>;
export type CopyRunProfileInput = {
  name: string;
  slug: string;
};

export type SkillPackageRuntimeBindingRecord = {
  id: string;
  runtimeType: RuntimeType;
  bindingType: RuntimeBindingType;
  bindingPayload: unknown;
  createdAt: string;
  updatedAt: string;
};

export type SkillPackageItemRecord = {
  id: string;
  capabilityKey: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  runtimeBindings: SkillPackageRuntimeBindingRecord[];
};

export type SkillPackageRecord = {
  id: string;
  organizationId?: string;
  name: string;
  slug: string;
  description?: string;
  status: string;
  visibleToUsers: boolean;
  createdAt: string;
  updatedAt: string;
  items: SkillPackageItemRecord[];
};

export type SkillPackageListResponse = {
  skillPackages: SkillPackageRecord[];
};

export type SkillPackageResponse = {
  skillPackage: SkillPackageRecord;
};

export type CreateSkillPackageInput = {
  organizationId?: string;
  name: string;
  slug: string;
  description?: string;
  status?: string;
  visibleToUsers?: boolean;
};

export type UpdateSkillPackageInput = Partial<CreateSkillPackageInput>;
export type CopySkillPackageInput = {
  name: string;
  slug: string;
};

export type SkillPackageRuntimeBindingInput = {
  runtimeType: RuntimeType;
  bindingType: RuntimeBindingType;
  bindingPayload: unknown;
};

export type SkillPackageItemInput = {
  capabilityKey: string;
  description?: string;
  runtimeBindings: SkillPackageRuntimeBindingInput[];
};

export type AgentModeSkillPackageRecord = {
  id: string;
  skillPackageId: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentModeWorkspaceRuleRecord = {
  id: string;
  workspaceId: string;
  isDefault: boolean;
  allowDirectorySelection: boolean;
  directoryScope: DirectoryScope;
  loadWorkspaceAgentsMd: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AgentModeInstructionSourceRecord = {
  id: string;
  sourceType: InstructionSourceType;
  sourceRef: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type AgentModeRecord = {
  id: string;
  organizationId?: string;
  name: string;
  slug: string;
  description?: string;
  status: string;
  visibleToUsers: boolean;
  runProfileId: string;
  createdAt: string;
  updatedAt: string;
  skillPackages: AgentModeSkillPackageRecord[];
  workspaceRules: AgentModeWorkspaceRuleRecord[];
  workspaces?: AgentModeWorkspaceRuleRecord[];
  instructionSources: AgentModeInstructionSourceRecord[];
};

export type AgentModeListResponse = {
  agentModes: AgentModeRecord[];
};

export type AgentModeResponse = {
  agentMode: AgentModeRecord;
};

export type CreateAgentModeInput = {
  organizationId?: string;
  name: string;
  slug: string;
  description?: string;
  status?: string;
  visibleToUsers?: boolean;
  runProfileId: string;
};

export type UpdateAgentModeInput = Partial<CreateAgentModeInput>;
export type CopyAgentModeInput = {
  name: string;
  slug: string;
};

export type AgentModeWorkspaceRuleInput = {
  workspaceId: string;
  isDefault?: boolean;
  allowDirectorySelection?: boolean;
  directoryScope: DirectoryScope;
  loadWorkspaceAgentsMd?: boolean;
};

export type AgentModeInstructionSourceInput = {
  sourceType: InstructionSourceType;
  sourceRef: string;
  sortOrder?: number;
};

export type WorkspaceAgentsTemplateRecord = {
  id: string;
  label: string;
  sourcePath: string;
  content: string;
  updatedAt: string;
};

export type WorkspaceAgentsTemplateListResponse = {
  templates: WorkspaceAgentsTemplateRecord[];
};
