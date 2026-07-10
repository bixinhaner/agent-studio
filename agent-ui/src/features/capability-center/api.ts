import { api } from "../../lib/api";
import type { RuntimeModelCatalog } from "../../lib/model-config";

import type {
  AgentModeInstructionSourceInput,
  AgentModeListResponse,
  AgentModeResponse,
  CapabilityPoliciesResponse,
  CapabilityPolicyInput,
  CapabilityResourceType,
  CopyAgentModeInput,
  CopyRunProfileInput,
  CopySkillPackageInput,
  CreateAgentModeInput,
  CreateRunProfileInput,
  CreateSkillPackageInput,
  NativeCodexSkillListResponse,
  RunProfileListResponse,
  RunProfileResponse,
  SkillPackageItemInput,
  SkillPackageListResponse,
  SkillPackageResponse,
  UpdateAgentModeInput,
  UpdateRunProfileInput,
  UpdateSkillPackageInput,
  WorkspaceAgentsTemplateListResponse
} from "./types";

const CAPABILITY_RESOURCE_SEGMENTS: Record<CapabilityResourceType, string> = {
  agent_mode: "agent-modes",
  skill_package: "skill-packages",
  run_profile: "run-profiles"
};

function capabilityPolicyPath(resourceType: CapabilityResourceType, resourceId: string) {
  return `/api/admin/resources/${CAPABILITY_RESOURCE_SEGMENTS[resourceType]}/${encodeURIComponent(resourceId)}/policies`;
}

export async function fetchRunProfiles(): Promise<RunProfileListResponse> {
  return api<RunProfileListResponse>("/api/admin/run-profiles");
}

export async function fetchRuntimeModelCatalog(refresh = false): Promise<RuntimeModelCatalog> {
  return api<RuntimeModelCatalog>(`/api/admin/model-catalog${refresh ? "?refresh=1" : ""}`);
}

export async function createRunProfile(input: CreateRunProfileInput): Promise<RunProfileResponse> {
  return api<RunProfileResponse>("/api/admin/run-profiles", { method: "POST", json: input });
}

export async function updateRunProfile(id: string, input: UpdateRunProfileInput): Promise<RunProfileResponse> {
  return api<RunProfileResponse>(`/api/admin/run-profiles/${encodeURIComponent(id)}`, { method: "PATCH", json: input });
}

export async function copyRunProfile(id: string, input: CopyRunProfileInput): Promise<RunProfileResponse> {
  return api<RunProfileResponse>(`/api/admin/run-profiles/${encodeURIComponent(id)}/copy`, { method: "POST", json: input });
}

export async function fetchSkillPackages(): Promise<SkillPackageListResponse> {
  return api<SkillPackageListResponse>("/api/admin/skill-packages");
}

export async function fetchNativeCodexSkills(): Promise<NativeCodexSkillListResponse> {
  return api<NativeCodexSkillListResponse>("/api/admin/codex-skills");
}

export async function createSkillPackage(input: CreateSkillPackageInput): Promise<SkillPackageResponse> {
  return api<SkillPackageResponse>("/api/admin/skill-packages", { method: "POST", json: input });
}

export async function updateSkillPackage(id: string, input: UpdateSkillPackageInput): Promise<SkillPackageResponse> {
  return api<SkillPackageResponse>(`/api/admin/skill-packages/${encodeURIComponent(id)}`, { method: "PATCH", json: input });
}

export async function copySkillPackage(id: string, input: CopySkillPackageInput): Promise<SkillPackageResponse> {
  return api<SkillPackageResponse>(`/api/admin/skill-packages/${encodeURIComponent(id)}/copy`, { method: "POST", json: input });
}

export async function putSkillPackageItems(id: string, items: SkillPackageItemInput[]): Promise<SkillPackageResponse> {
  return api<SkillPackageResponse>(`/api/admin/skill-packages/${encodeURIComponent(id)}/items`, {
    method: "PUT",
    json: { items }
  });
}

export async function putSkillPackageRuntimeBindings(id: string, items: SkillPackageItemInput[]): Promise<SkillPackageResponse> {
  return api<SkillPackageResponse>(`/api/admin/skill-packages/${encodeURIComponent(id)}/runtime-bindings`, {
    method: "PUT",
    json: { items }
  });
}

export async function fetchAgentModes(): Promise<AgentModeListResponse> {
  return api<AgentModeListResponse>("/api/admin/agent-modes");
}

export async function createAgentMode(input: CreateAgentModeInput): Promise<AgentModeResponse> {
  return api<AgentModeResponse>("/api/admin/agent-modes", { method: "POST", json: input });
}

export async function updateAgentMode(id: string, input: UpdateAgentModeInput): Promise<AgentModeResponse> {
  return api<AgentModeResponse>(`/api/admin/agent-modes/${encodeURIComponent(id)}`, { method: "PATCH", json: input });
}

export async function copyAgentMode(id: string, input: CopyAgentModeInput): Promise<AgentModeResponse> {
  return api<AgentModeResponse>(`/api/admin/agent-modes/${encodeURIComponent(id)}/copy`, { method: "POST", json: input });
}

export async function putAgentModeSkillPackages(id: string, skillPackageIds: string[]): Promise<AgentModeResponse> {
  return api<AgentModeResponse>(`/api/admin/agent-modes/${encodeURIComponent(id)}/skill-packages`, {
    method: "PUT",
    json: { skillPackageIds }
  });
}

export async function putAgentModeInstructionSources(
  id: string,
  instructionSources: AgentModeInstructionSourceInput[]
): Promise<AgentModeResponse> {
  return api<AgentModeResponse>(`/api/admin/agent-modes/${encodeURIComponent(id)}/instruction-sources`, {
    method: "PUT",
    json: { instructionSources }
  });
}

export async function fetchWorkspaceAgentsTemplates(): Promise<WorkspaceAgentsTemplateListResponse> {
  return api<WorkspaceAgentsTemplateListResponse>("/api/admin/agent-modes/workspace-agents-templates");
}

export async function fetchCapabilityPolicies(resourceType: CapabilityResourceType, resourceId: string): Promise<CapabilityPoliciesResponse> {
  return api<CapabilityPoliciesResponse>(capabilityPolicyPath(resourceType, resourceId));
}

export async function putCapabilityPolicies(
  resourceType: CapabilityResourceType,
  resourceId: string,
  policies: CapabilityPolicyInput[]
): Promise<CapabilityPoliciesResponse> {
  return api<CapabilityPoliciesResponse>(capabilityPolicyPath(resourceType, resourceId), {
    method: "PUT",
    json: { policies }
  });
}
