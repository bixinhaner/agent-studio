import { api } from "../../../lib/api";

export type ScheduleFrequency = "daily" | "weekdays" | "weekly" | "monthly";
export type ScheduledTaskRunStatus = "running" | "succeeded" | "failed";

export type ScheduledTaskRun = {
  id: string;
  task_id: string;
  trigger: "schedule" | "manual";
  status: ScheduledTaskRunStatus;
  thread_id: string | null;
  scheduled_for: string | null;
  started_at: string;
  finished_at: string | null;
  answer_preview: string | null;
  artifact_count: number;
  error: string | null;
  notify_status: string | null;
};

export type ScheduledTask = {
  id: string;
  title: string;
  prompt: string;
  frequency: ScheduleFrequency;
  weekdays: number[];
  day_of_month: number | null;
  time_of_day: string;
  timezone: string;
  locale: string;
  mode_id: string | null;
  model: string | null;
  reasoning_effort: string | null;
  skill_ids: string[];
  folder_id: string | null;
  enabled: boolean;
  notify_dingtalk: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_run_status: ScheduledTaskRunStatus | null;
  last_thread_id: string | null;
  consecutive_failures: number;
  created_at: string;
  runs?: ScheduledTaskRun[];
};

export type ScheduledTaskInput = {
  title: string;
  prompt: string;
  frequency: ScheduleFrequency;
  weekdays?: number[];
  day_of_month?: number | null;
  time_of_day: string;
  timezone?: string;
  locale?: "en" | "zh-CN";
  mode_id?: string | null;
  model?: string | null;
  reasoning_effort?: string | null;
  run_config?: Record<string, unknown>;
  skill_ids?: string[];
  folder_id?: string | null;
  source_thread_id?: string | null;
  notify_dingtalk?: boolean;
  enabled?: boolean;
};

export function listScheduledTasks() {
  return api<{ tasks: ScheduledTask[]; dingtalk_available: boolean }>("/api/portal/scheduled-tasks");
}

export function getScheduledTask(id: string) {
  return api<{ task: ScheduledTask }>(`/api/portal/scheduled-tasks/${encodeURIComponent(id)}`);
}

export function createScheduledTask(input: ScheduledTaskInput) {
  return api<{ task: ScheduledTask }>("/api/portal/scheduled-tasks", { method: "POST", json: input });
}

export function updateScheduledTask(id: string, input: Partial<ScheduledTaskInput>) {
  return api<{ task: ScheduledTask }>(`/api/portal/scheduled-tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    json: input
  });
}

export function deleteScheduledTask(id: string) {
  return api<{ ok: true }>(`/api/portal/scheduled-tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function runScheduledTaskNow(id: string) {
  return api<{ run: ScheduledTaskRun }>(`/api/portal/scheduled-tasks/${encodeURIComponent(id)}/run`, { method: "POST" });
}

export type SubscriptionSeverity = "info" | "low" | "medium" | "high" | "critical";

export type NotificationSubscription = {
  id: string;
  target_type: "user" | "department" | "role";
  target_id: string;
  target_name: string | null;
  scenario_key: string | null;
  connector_id: string | null;
  min_severity: SubscriptionSeverity;
  delivery_mode: "realtime" | "digest";
  digest_time: string | null;
  timezone: string;
  enabled: boolean;
  last_delivered_at: string | null;
  last_error: string | null;
  created_at: string;
};

export type SubscriptionOverview = {
  subscriptions: NotificationSubscription[];
  can_manage_shared: boolean;
  dingtalk_bound: boolean;
  dingtalk_available: boolean;
  scenarios: Array<{ key: string; name_zh: string; name_en: string }>;
  connectors: Array<{ id: string; name: string; finding_count_30d: number }>;
};

export type SubscriptionInput = {
  target_type?: "user" | "department" | "role";
  target_id?: string;
  scenario_key?: string | null;
  connector_id?: string | null;
  min_severity?: SubscriptionSeverity;
  delivery_mode?: "realtime" | "digest";
  digest_time?: string | null;
  timezone?: string;
  enabled?: boolean;
};

export function listSubscriptions() {
  return api<SubscriptionOverview>("/api/portal/notification-subscriptions");
}

export function searchSubscriptionTargets(q: string) {
  return api<{ departments: Array<{ id: string; name: string }>; roles: Array<{ id: string; name: string }> }>(
    `/api/portal/notification-subscriptions/targets?q=${encodeURIComponent(q)}`
  );
}

export function createSubscription(input: SubscriptionInput) {
  return api<{ subscription: NotificationSubscription }>("/api/portal/notification-subscriptions", {
    method: "POST",
    json: input
  });
}

export function updateSubscription(id: string, input: SubscriptionInput) {
  return api<{ subscription: NotificationSubscription }>(
    `/api/portal/notification-subscriptions/${encodeURIComponent(id)}`,
    { method: "PATCH", json: input }
  );
}

export function deleteSubscription(id: string) {
  return api<{ ok: true }>(`/api/portal/notification-subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function testSubscription(id: string) {
  return api<{ result: string }>(`/api/portal/notification-subscriptions/${encodeURIComponent(id)}/test`, {
    method: "POST"
  });
}

export type PortalMemoryCategory = "preference" | "background" | "habit";

export type PortalMemoryItem = {
  id: string;
  text: string;
  category: PortalMemoryCategory;
  source: "learned" | "user";
  updated_at: string | null;
};

export type PortalMemoryScope = {
  /** Stable per assistant (`org~agent-<mode>`), regardless of tool configuration changes. */
  id: string;
  organization_key?: string | null;
  agent_segment: string;
  mode_id: string | null;
  updated_at: string | null;
  items: PortalMemoryItem[];
};

export function listMemories() {
  return api<{ enabled: boolean; scopes: PortalMemoryScope[] }>("/api/portal/memory");
}

export function addMemory(input: { scope_id: string; text: string; category: PortalMemoryCategory }) {
  return api<{ scope_id: string; item: PortalMemoryItem }>("/api/portal/memory", { method: "POST", json: input });
}

export function updateMemory(scopeId: string, itemId: string, input: { text?: string; category?: PortalMemoryCategory }) {
  return api<{ item: PortalMemoryItem }>(
    `/api/portal/memory/${encodeURIComponent(scopeId)}/${encodeURIComponent(itemId)}`,
    { method: "PATCH", json: input }
  );
}

export function deleteMemory(scopeId: string, itemId: string) {
  return api<{ ok: true }>(`/api/portal/memory/${encodeURIComponent(scopeId)}/${encodeURIComponent(itemId)}`, {
    method: "DELETE"
  });
}

export type PortalHomeProfile = {
  audience: "internal" | "external";
  department_name: string | null;
  position: string | null;
  role_key: string;
};

export function fetchHomeProfile() {
  return api<PortalHomeProfile>("/api/portal/home-profile");
}

export type PortalPreferencePatch = {
  onboarding_completed?: boolean;
  theme?: "light" | "dark" | "system";
  locale?: "en" | "zh-CN";
};

export function updatePortalPreferences(patch: PortalPreferencePatch) {
  return api<unknown>("/api/auth/portal-preferences", { method: "PATCH", json: { portal_preferences: patch } });
}

export type PersonalUsagePeriod = "7d" | "30d" | "month" | "last_month";
export type PersonalUsageChannel = "portal" | "dingtalk" | "scheduled" | "api" | "other";
export type PersonalUsageOutputType = "document" | "spreadsheet" | "presentation" | "image" | "other";

export type PersonalUsageSummary = {
  period: PersonalUsagePeriod;
  timezone: string;
  range: { from: string; to: string; days: number };
  totals: {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    turns: number;
    failed_turns: number;
    tasks: number;
    output_files: number;
  };
  previous: { total_tokens: number; turns: number } | null;
  daily: Array<{ date: string; input_tokens: number; cached_input_tokens: number; output_tokens: number; total_tokens: number; turns: number }>;
  by_channel: Array<{ key: PersonalUsageChannel; total_tokens: number; turns: number }>;
  by_model: Array<{ model: string; total_tokens: number; turns: number }>;
  outputs_by_type: Array<{ type: PersonalUsageOutputType; count: number }>;
  truncated: boolean;
};

export function fetchPersonalUsage(period: PersonalUsagePeriod, timezone: string) {
  const params = new URLSearchParams({ period, tz: timezone });
  return api<PersonalUsageSummary>(`/api/portal/me/usage?${params.toString()}`);
}

export type UsageRankEntry = { rank: number | null; size: number; active: number };

export type UsageRanking = {
  period: PersonalUsagePeriod;
  timezone: string;
  total_tokens: number;
  department: (UsageRankEntry & { id: string; name: string }) | null;
  company: UsageRankEntry;
  team: { available: boolean; size: number };
};

export type TeamRelation = "direct" | "indirect" | "department" | "self";

export type TeamUsageMember = {
  user_id: string;
  name: string;
  title: string | null;
  department: string | null;
  relation: TeamRelation;
  /** Listed via a secondary department membership only; not counted in totals. */
  secondary: boolean;
  total_tokens: number;
  turns: number;
  tasks: number;
  last_active_at: string | null;
};

export type TeamDepartmentNode = {
  id: string;
  name: string;
  parent_id: string | null;
  /** People counted here (each person counts in exactly one department). */
  member_ids: string[];
  /** People who also belong here but count elsewhere ("兼"). */
  secondary_ids: string[];
  members: number;
  active_members: number;
  total_tokens: number;
  turns: number;
  tasks: number;
};

export type TeamUsageSummary = {
  period: PersonalUsagePeriod;
  timezone: string;
  totals: { members: number; active_members: number; total_tokens: number; turns: number; tasks: number };
  members: TeamUsageMember[];
  departments: TeamDepartmentNode[];
};

export type TeamMemberUsage = {
  member: { user_id: string; name: string; title: string | null; department: string | null; relation: TeamRelation };
  usage: PersonalUsageSummary;
};

function usageParams(period: PersonalUsagePeriod, timezone: string) {
  return new URLSearchParams({ period, tz: timezone }).toString();
}

export function fetchUsageRanking(period: PersonalUsagePeriod, timezone: string) {
  return api<UsageRanking>(`/api/portal/me/usage/ranking?${usageParams(period, timezone)}`);
}

export function fetchTeamUsage(period: PersonalUsagePeriod, timezone: string) {
  return api<TeamUsageSummary>(`/api/portal/me/team-usage?${usageParams(period, timezone)}`);
}

export function fetchTeamMemberUsage(userId: string, period: PersonalUsagePeriod, timezone: string) {
  return api<TeamMemberUsage>(`/api/portal/me/team-usage/${encodeURIComponent(userId)}?${usageParams(period, timezone)}`);
}
