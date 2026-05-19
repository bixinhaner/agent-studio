import { api } from "../../lib/api";

import type {
  CreateIntegrationInstanceInput,
  DingTalkBotConversationsResponse,
  DingTalkBotStatusResponse,
  ExternalApiUsageResponse,
  IntegrationBindingsResponse,
  IntegrationBindingInput,
  IntegrationDetail,
  IntegrationListResponse,
  IntegrationPoliciesResponse,
  IntegrationPolicyInput,
  IntegrationType,
  IntegrationZendeskRunResult,
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

export async function runZendeskIntegrationTicket(
  instanceId: string,
  ticketId: string | number
): Promise<IntegrationZendeskRunResult> {
  return api<IntegrationZendeskRunResult>(`${integrationPath(instanceId)}/zendesk/run`, {
    method: "POST",
    json: { ticket_id: ticketId }
  });
}

export async function fetchDingTalkBotStatus(instanceId: string): Promise<DingTalkBotStatusResponse> {
  return api<DingTalkBotStatusResponse>(`${integrationPath(instanceId)}/dingtalk-bot/status`);
}

export async function restartDingTalkBot(instanceId: string): Promise<DingTalkBotStatusResponse> {
  return api<DingTalkBotStatusResponse>(`${integrationPath(instanceId)}/dingtalk-bot/restart`, {
    method: "POST"
  });
}

export async function fetchDingTalkBotConversations(
  instanceId: string,
  params?: { take?: number }
): Promise<DingTalkBotConversationsResponse> {
  const search = new URLSearchParams();
  if (params?.take) search.set("take", String(params.take));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return api<DingTalkBotConversationsResponse>(`${integrationPath(instanceId)}/dingtalk-bot/conversations${suffix}`);
}

export async function fetchExternalApiUsage(
  instanceId: string,
  params?: { days?: number; take?: number }
): Promise<ExternalApiUsageResponse> {
  const search = new URLSearchParams();
  if (params?.days) search.set("days", String(params.days));
  if (params?.take) search.set("take", String(params.take));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return api<ExternalApiUsageResponse>(`${integrationPath(instanceId)}/external-api-usage${suffix}`);
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
