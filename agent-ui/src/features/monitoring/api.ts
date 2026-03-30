import { api } from "../../lib/api";

import type {
  AlertEventListResponse,
  AlertRuleListResponse,
  CreateAlertRuleInput,
  CreateCostProfileInput,
  CreateQuotaPolicyInput,
  CostProfileListResponse,
  MonitoringOverviewResponse,
  MonitoringRankingsResponse,
  NotificationRecordListResponse,
  QuotaPolicyListResponse,
  ResourceAccessLogResponse,
  UpdateAlertRuleInput,
  UpdateCostProfileInput,
  UpdateQuotaPolicyInput,
  UsageEventResponse
} from "./types";

export async function fetchMonitoringOverview(): Promise<MonitoringOverviewResponse> {
  return api<MonitoringOverviewResponse>("/api/admin/monitoring/overview");
}

export async function fetchMonitoringRankings(): Promise<MonitoringRankingsResponse> {
  return api<MonitoringRankingsResponse>("/api/admin/monitoring/rankings");
}

export async function fetchMonitoringTrends(): Promise<MonitoringOverviewResponse["trends"]> {
  const response = await api<MonitoringOverviewResponse>("/api/admin/monitoring/trends");
  return response.trends;
}

export async function fetchResourceAccessLogs(): Promise<ResourceAccessLogResponse> {
  return api<ResourceAccessLogResponse>("/api/admin/monitoring/resource-access-logs");
}

export async function fetchUsageEvents(): Promise<UsageEventResponse> {
  return api<UsageEventResponse>("/api/admin/monitoring/usage-events");
}

export async function fetchQuotaPolicies(): Promise<QuotaPolicyListResponse> {
  return api<QuotaPolicyListResponse>("/api/admin/quota-policies");
}

export async function createQuotaPolicy(input: CreateQuotaPolicyInput): Promise<{ quotaPolicy: QuotaPolicyListResponse["quotaPolicies"][number] }> {
  return api<{ quotaPolicy: QuotaPolicyListResponse["quotaPolicies"][number] }>("/api/admin/quota-policies", {
    method: "POST",
    json: input
  });
}

export async function updateQuotaPolicy(
  policyId: string,
  input: UpdateQuotaPolicyInput
): Promise<{ quotaPolicy: QuotaPolicyListResponse["quotaPolicies"][number] }> {
  return api<{ quotaPolicy: QuotaPolicyListResponse["quotaPolicies"][number] }>(`/api/admin/quota-policies/${encodeURIComponent(policyId)}`, {
    method: "PATCH",
    json: input
  });
}

export async function fetchAlertRules(): Promise<AlertRuleListResponse> {
  return api<AlertRuleListResponse>("/api/admin/alert-rules");
}

export async function createAlertRule(input: CreateAlertRuleInput): Promise<{ alertRule: AlertRuleListResponse["alertRules"][number] }> {
  return api<{ alertRule: AlertRuleListResponse["alertRules"][number] }>("/api/admin/alert-rules", {
    method: "POST",
    json: input
  });
}

export async function updateAlertRule(
  ruleId: string,
  input: UpdateAlertRuleInput
): Promise<{ alertRule: AlertRuleListResponse["alertRules"][number] }> {
  return api<{ alertRule: AlertRuleListResponse["alertRules"][number] }>(`/api/admin/alert-rules/${encodeURIComponent(ruleId)}`, {
    method: "PATCH",
    json: input
  });
}

export async function fetchAlertEvents(): Promise<AlertEventListResponse> {
  return api<AlertEventListResponse>("/api/admin/alert-events");
}

export async function acknowledgeAlertEvent(eventId: string): Promise<{ alertEvent: AlertEventListResponse["alertEvents"][number] }> {
  return api<{ alertEvent: AlertEventListResponse["alertEvents"][number] }>(
    `/api/admin/alert-events/${encodeURIComponent(eventId)}/acknowledge`,
    {
      method: "POST"
    }
  );
}

export async function fetchNotificationRecords(): Promise<NotificationRecordListResponse> {
  return api<NotificationRecordListResponse>("/api/admin/notification-records");
}

export async function fetchCostProfiles(): Promise<CostProfileListResponse> {
  return api<CostProfileListResponse>("/api/admin/cost-profiles");
}

export async function createCostProfile(
  input: CreateCostProfileInput
): Promise<{ costProfile: CostProfileListResponse["costProfiles"][number] }> {
  return api<{ costProfile: CostProfileListResponse["costProfiles"][number] }>("/api/admin/cost-profiles", {
    method: "POST",
    json: input
  });
}

export async function updateCostProfile(
  profileId: string,
  input: UpdateCostProfileInput
): Promise<{ costProfile: CostProfileListResponse["costProfiles"][number] }> {
  return api<{ costProfile: CostProfileListResponse["costProfiles"][number] }>(
    `/api/admin/cost-profiles/${encodeURIComponent(profileId)}`,
    {
      method: "PATCH",
      json: input
    }
  );
}
