import { api } from "../../lib/api";

import type {
  CreateIntegrationInstanceInput,
  IntegrationBindingsResponse,
  IntegrationBindingInput,
  IntegrationDetail,
  IntegrationListResponse,
  IntegrationPoliciesResponse,
  IntegrationPolicyInput,
  IntegrationType,
  IntegrationValidationResult,
  UpdateIntegrationInstanceInput
} from "./types";

function integrationPath(instanceId: string) {
  return `/api/admin/integrations/${encodeURIComponent(instanceId)}`;
}

export async function fetchIntegrationInstances(type: IntegrationType): Promise<IntegrationListResponse> {
  return api<IntegrationListResponse>(`/api/admin/integrations?type=${encodeURIComponent(type)}`);
}

export async function createIntegrationInstance(input: CreateIntegrationInstanceInput): Promise<IntegrationDetail> {
  return api<IntegrationDetail>("/api/admin/integrations", {
    method: "POST",
    json: input
  });
}

export async function fetchIntegrationDetail(instanceId: string): Promise<IntegrationDetail> {
  return api<IntegrationDetail>(integrationPath(instanceId));
}

export async function updateIntegrationInstance(
  instanceId: string,
  input: UpdateIntegrationInstanceInput
): Promise<IntegrationDetail> {
  return api<IntegrationDetail>(integrationPath(instanceId), {
    method: "PATCH",
    json: input
  });
}

export async function validateIntegrationInstance(instanceId: string): Promise<IntegrationValidationResult> {
  return api<IntegrationValidationResult>(`${integrationPath(instanceId)}/validate`, {
    method: "POST"
  });
}

export async function fetchIntegrationBindings(instanceId: string): Promise<IntegrationBindingsResponse> {
  return api<IntegrationBindingsResponse>(`${integrationPath(instanceId)}/bindings`);
}

export async function putIntegrationBindings(
  instanceId: string,
  bindings: IntegrationBindingInput[]
): Promise<IntegrationBindingsResponse> {
  return api<IntegrationBindingsResponse>(`${integrationPath(instanceId)}/bindings`, {
    method: "PUT",
    json: { bindings }
  });
}

export async function fetchIntegrationPolicies(instanceId: string): Promise<IntegrationPoliciesResponse> {
  return api<IntegrationPoliciesResponse>(`${integrationPath(instanceId)}/policies`);
}

export async function putIntegrationPolicies(
  instanceId: string,
  policies: IntegrationPolicyInput[]
): Promise<IntegrationPoliciesResponse> {
  return api<IntegrationPoliciesResponse>(`${integrationPath(instanceId)}/policies`, {
    method: "PUT",
    json: { policies }
  });
}
