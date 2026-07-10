export type OperationsInsightsFilters = {
  days: number;
  timeZone: string;
  organizationId?: string;
  model?: string;
  path?: string;
  entry?: string;
  query?: string;
  sessionPage: number;
  sessionPageSize: number;
  sessionSortKey?: string;
  sessionSortDirection?: "asc" | "desc";
};

export type OperationsInsightsSummary = {
  totalOrganizations: number;
  totalUsers: number;
  totalSessions: number;
  totalRequests: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: string;
  internalCost: string;
  incompleteCostRequestCount: number;
  avgRequestsPerSession: number;
  avgTokensPerSession: number;
  avgInternalCostPerSession: string;
  avgTokensPerRequest: number;
  avgInternalCostPerRequest: string;
  cacheShare: number;
};

export type OperationsInsightsTrendPoint = {
  day: string;
  organizationCount: number;
  userCount: number;
  sessionCount: number;
  requestCount: number;
  totalTokens: number;
  estimatedCost: string;
  internalCost: string;
};

export type OperationsInsightsBreakdownRow = {
  key: string;
  label: string;
  organizationCount: number;
  userCount: number;
  sessionCount: number;
  requestCount: number;
  totalTokens: number;
  estimatedCost: string;
  internalCost: string;
  shareOfInternalCost: number;
};

export type OperationsInsightsOrganizationRow = {
  organizationId: string;
  organizationName: string;
  organizationSlug?: string;
  organizationType?: string;
  userCount: number;
  sessionCount: number;
  requestCount: number;
  totalTokens: number;
  estimatedCost: string;
  internalCost: string;
  avgTokensPerSession: number;
  avgInternalCostPerSession: string;
  cacheShare: number;
  topModel: string;
  topPath: string;
  lastActiveAt: string;
};

export type OperationsInsightsUserRow = {
  userId: string;
  userName: string;
  userEmail?: string;
  organizationId?: string;
  organizationName?: string;
  departmentName?: string;
  sessionCount: number;
  requestCount: number;
  totalTokens: number;
  estimatedCost: string;
  internalCost: string;
  avgTokensPerSession: number;
  avgInternalCostPerSession: string;
  cacheShare: number;
  topModel: string;
  topPath: string;
  lastActiveAt: string;
};

export type OperationsInsightsSessionRow = {
  sessionId: string;
  threadId?: string;
  organizationId?: string;
  organizationName?: string;
  userId?: string;
  userName: string;
  userEmail?: string;
  departmentName?: string;
  model: string;
  entryLabel: string;
  pathKey: string;
  pathLabel: string;
  requestCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: string;
  internalCost: string;
  avgTokensPerRequest: number;
  cacheShare: number;
  firstActiveAt: string;
  lastActiveAt: string;
};

export type OperationsInsightsResponse = {
  filters: OperationsInsightsFilters;
  window: {
    from: string;
    to: string;
    timeZone: string;
  };
  options: {
    organizations: Array<{ value: string; label: string }>;
    models: Array<{ value: string; label: string }>;
    paths: Array<{ value: string; label: string }>;
    entries: Array<{ value: string; label: string }>;
  };
  summary: OperationsInsightsSummary;
  trends: OperationsInsightsTrendPoint[];
  breakdowns: {
    paths: OperationsInsightsBreakdownRow[];
    models: OperationsInsightsBreakdownRow[];
    entries: OperationsInsightsBreakdownRow[];
  };
  organizations: OperationsInsightsOrganizationRow[];
  users: OperationsInsightsUserRow[];
  sessions: {
    items: OperationsInsightsSessionRow[];
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
};

export type QuotaPolicyRecord = {
  id: string;
  scopeType: "platform" | "department";
  scopeId: string;
  featureType: string | null;
  model: string | null;
  metricType: "request_count" | "total_tokens" | "estimated_cost" | "internal_cost";
  windowType: "daily";
  thresholdValue: string;
  enforcementMode: "alert_only" | "soft_block";
  isActive: boolean;
};

export type QuotaPolicyListResponse = {
  quotaPolicies: QuotaPolicyRecord[];
};

export type CreateQuotaPolicyInput = {
  scopeType: "platform" | "department";
  scopeId: string;
  featureType?: string | null;
  model?: string | null;
  metricType: "request_count" | "total_tokens" | "estimated_cost" | "internal_cost";
  thresholdValue: string | number;
  enforcementMode?: "alert_only" | "soft_block";
  isActive?: boolean;
};

export type UpdateQuotaPolicyInput = {
  thresholdValue?: string | number;
  enforcementMode?: "alert_only" | "soft_block";
  isActive?: boolean;
};

export type AlertRuleRecord = {
  id: string;
  scopeType: "platform" | "department";
  scopeId: string;
  ruleType: "quota_threshold" | "security_event";
  name: string;
  description: string | null;
  conditions: unknown;
  channels: string[];
  isActive: boolean;
};

export type AlertRuleListResponse = {
  alertRules: AlertRuleRecord[];
};

export type CreateAlertRuleInput = {
  scopeType: "platform" | "department";
  scopeId: string;
  ruleType: "quota_threshold" | "security_event";
  name: string;
  description?: string | null;
  conditions: unknown;
  channels?: string[];
  isActive?: boolean;
};

export type UpdateAlertRuleInput = {
  name?: string;
  description?: string | null;
  conditions?: unknown;
  channels?: string[];
  isActive?: boolean;
};

export type AlertEventRecord = {
  id: string;
  alertRuleId: string | null;
  scopeType: "platform" | "department";
  scopeId: string;
  severity: string;
  status: "open" | "acknowledged" | "resolved";
  title: string;
  detail: string;
  payload: unknown;
  createdAt: string;
  updatedAt?: string;
};

export type AlertEventListResponse = {
  alertEvents: AlertEventRecord[];
};

export type NotificationRecord = {
  id: string;
  channelType: string;
  targetRef: string;
  eventType: string;
  status: string;
  payload: unknown;
  errorMessage: string | null;
  createdAt: string;
  updatedAt?: string;
};

export type NotificationRecordListResponse = {
  notificationRecords: NotificationRecord[];
};

export type CostProfileRecord = {
  id: string;
  organizationId?: string | null;
  model: string;
  inputTokenPrice: string;
  cachedInputTokenPrice: string;
  cacheWriteTokenPrice: string;
  outputTokenPrice: string;
  longContextThresholdTokens?: number;
  longContextInputMultiplier?: string;
  longContextOutputMultiplier?: string;
  internalCostMultiplier: string;
  isActive: boolean;
};

export type CostProfileListResponse = {
  costProfiles: CostProfileRecord[];
};

export type CreateCostProfileInput = {
  model: string;
  inputTokenPrice: string | number;
  cachedInputTokenPrice: string | number;
  cacheWriteTokenPrice?: string | number;
  outputTokenPrice: string | number;
  longContextThresholdTokens?: string | number;
  longContextInputMultiplier?: string | number;
  longContextOutputMultiplier?: string | number;
  internalCostMultiplier?: string | number;
  isActive?: boolean;
};

export type UpdateCostProfileInput = {
  inputTokenPrice?: string | number;
  cachedInputTokenPrice?: string | number;
  cacheWriteTokenPrice?: string | number;
  outputTokenPrice?: string | number;
  longContextThresholdTokens?: string | number | null;
  longContextInputMultiplier?: string | number;
  longContextOutputMultiplier?: string | number;
  internalCostMultiplier?: string | number;
  isActive?: boolean;
};

export function formatLocalDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}
