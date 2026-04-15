import type { DepartmentRecord } from "../persistence/department-repository.js";
import type { OrganizationRecord } from "../persistence/organization-repository.js";
import type { SessionRecord } from "../persistence/session-repository.js";
import type { AuthenticatedUser } from "../persistence/user-repository.js";
import type { UsageEventRecord } from "../persistence/usage-event-repository.js";

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
};

export type OperationsInsightsSummary = {
  totalOrganizations: number;
  totalUsers: number;
  totalSessions: number;
  totalRequests: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: string;
  internalCost: string;
  avgRequestsPerSession: number;
  avgTokensPerSession: number;
  avgInternalCostPerSession: string;
  avgTokensPerRequest: number;
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

export type BuildOperationsInsightsInput = {
  usageEvents: UsageEventRecord[];
  sessionsById: Map<string, SessionRecord>;
  organizationsById: Map<string, OrganizationRecord>;
  usersById: Map<string, AuthenticatedUser>;
  departmentsById: Map<string, DepartmentRecord | null>;
  filters: OperationsInsightsFilters;
  now?: Date;
};

type LabeledEntity = {
  key: string;
  label: string;
};

type NormalizedEvent = {
  id: string;
  createdAt: string;
  createdAtMs: number;
  day: string;
  organizationId?: string;
  organizationName?: string;
  organizationSlug?: string;
  organizationType?: string;
  userId?: string;
  userName: string;
  userEmail?: string;
  departmentId?: string;
  departmentName?: string;
  sessionId: string;
  threadId?: string;
  model: string;
  entryKey: string;
  entryLabel: string;
  pathKey: string;
  pathLabel: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  internalCost: number;
  resultStatus: string;
};

type AggregateState = {
  requestCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  internalCost: number;
  sessionIds: Set<string>;
  userIds: Set<string>;
  organizationIds: Set<string>;
};

type SessionAggregateState = {
  sessionId: string;
  threadId?: string;
  organizationId?: string;
  organizationName?: string;
  userId?: string;
  userName: string;
  userEmail?: string;
  departmentName?: string;
  model: string;
  entryKey: string;
  entryLabel: string;
  pathKey: string;
  pathLabel: string;
  requestCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  internalCost: number;
  firstActiveAt: string;
  firstActiveAtMs: number;
  lastActiveAt: string;
  lastActiveAtMs: number;
};

type OrganizationAggregateState = {
  organizationId: string;
  organizationName: string;
  organizationSlug?: string;
  organizationType?: string;
  requestCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  internalCost: number;
  sessionIds: Set<string>;
  userIds: Set<string>;
  lastActiveAt: string;
  lastActiveAtMs: number;
  modelCounts: Map<string, number>;
  pathCounts: Map<string, number>;
};

type UserAggregateState = {
  userId: string;
  userName: string;
  userEmail?: string;
  organizationId?: string;
  organizationName?: string;
  departmentName?: string;
  requestCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  internalCost: number;
  sessionIds: Set<string>;
  lastActiveAt: string;
  lastActiveAtMs: number;
  modelCounts: Map<string, number>;
  pathCounts: Map<string, number>;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatDecimal(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6) : "0.000000";
}

function formatRatio(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Number(value.toFixed(4));
}

function formatAverage(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Number(value.toFixed(2));
}

function toIsoString(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function toDateKeyInTimeZone(value: string | Date, timeZone: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    const parts = formatter.formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value ?? "0000";
    const month = parts.find((part) => part.type === "month")?.value ?? "01";
    const day = parts.find((part) => part.type === "day")?.value ?? "01";
    return `${year}-${month}-${day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function fallbackUserName(userId?: string, user?: AuthenticatedUser): string {
  const direct = trimOrUndefined(user?.displayName) || trimOrUndefined(user?.email);
  if (direct) return direct;
  return userId || "未关联用户";
}

function pathFromSession(session?: SessionRecord): LabeledEntity | undefined {
  const snapshot = session?.providerSnapshot;
  if (!snapshot) return undefined;
  if (snapshot.source === "local_auth") {
    return {
      key: `local_auth:${snapshot.kind}`,
      label: "AI 助手工作台 · 服务器本地登录态"
    };
  }

  const kindLabel =
    snapshot.kind === "azure_openai"
      ? "Azure OpenAI"
      : snapshot.kind === "openai_api"
        ? "OpenAI API"
        : "服务器本地登录态";
  const suffix = trimOrUndefined(snapshot.integrationSlug) ? ` · ${snapshot.integrationSlug}` : "";
  return {
    key: `integration:${snapshot.kind}:${trimOrUndefined(snapshot.integrationSlug) ?? "managed"}`,
    label: `AI 助手工作台 · 管理台集成 · ${kindLabel}${suffix}`
  };
}

function entryFromEvent(record: UsageEventRecord): LabeledEntity {
  const metadata = asRecord(record.metadata);
  const source = trimOrUndefined(typeof metadata?.source === "string" ? metadata.source : undefined);
  if (source === "chat_stream") {
    return { key: "chat_stream", label: "AI 助手工作台" };
  }
  if (source === "openai_compatible_api" || record.featureType === "external_openai_api") {
    return { key: "external_openai_api", label: "外部 OpenAI API" };
  }
  return {
    key: trimOrUndefined(record.featureType) ?? "unknown",
    label: trimOrUndefined(record.featureType) ?? "未知入口"
  };
}

function pathFromEvent(record: UsageEventRecord): LabeledEntity {
  const metadata = asRecord(record.metadata);
  const source = trimOrUndefined(typeof metadata?.source === "string" ? metadata.source : undefined);
  if (source === "openai_compatible_api" || record.featureType === "external_openai_api") {
    const slug = trimOrUndefined(typeof metadata?.integrationSlug === "string" ? metadata.integrationSlug : undefined);
    return {
      key: slug ? `external_openai_api:${slug}` : "external_openai_api",
      label: slug ? `外部 OpenAI API · ${slug}` : "外部 OpenAI API"
    };
  }
  const entry = entryFromEvent(record);
  return {
    key: entry.key,
    label: entry.label
  };
}

function dominantLabel(counts: Map<string, number>, fallback = "—"): string {
  let topLabel = fallback;
  let topCount = -1;
  for (const [label, count] of counts.entries()) {
    if (count > topCount || (count === topCount && label.localeCompare(topLabel, "zh-CN") < 0)) {
      topLabel = label;
      topCount = count;
    }
  }
  return topLabel;
}

function matchesQuery(record: NormalizedEvent, query: string): boolean {
  const haystacks = [
    record.organizationName,
    record.organizationSlug,
    record.userName,
    record.userEmail,
    record.departmentName,
    record.sessionId,
    record.threadId,
    record.model,
    record.entryLabel,
    record.pathLabel
  ]
    .map((item) => (item || "").toLowerCase())
    .filter(Boolean);
  return haystacks.some((item) => item.includes(query));
}

function normalizeEvents(input: BuildOperationsInsightsInput): NormalizedEvent[] {
  const now = input.now ?? new Date();
  const cutoffMs = now.getTime() - input.filters.days * 24 * 60 * 60 * 1000;
  const normalized: NormalizedEvent[] = [];

  for (const record of input.usageEvents) {
    const createdAt = toIsoString(record.createdAt);
    const createdAtMs = new Date(createdAt).getTime();
    if (!Number.isFinite(createdAtMs) || createdAtMs < cutoffMs) {
      continue;
    }

    if (input.filters.organizationId && trimOrUndefined(record.organizationId) !== input.filters.organizationId) {
      continue;
    }
    if (input.filters.model && record.model !== input.filters.model) {
      continue;
    }

    const session = trimOrUndefined(record.sessionId) ? input.sessionsById.get(record.sessionId!) : undefined;
    const organizationId = trimOrUndefined(record.organizationId);
    const organization = organizationId ? input.organizationsById.get(organizationId) : undefined;
    const userId = trimOrUndefined(record.userId);
    const user = userId ? input.usersById.get(userId) : undefined;
    const departmentId = trimOrUndefined(record.departmentIdSnapshot);
    const department = departmentId ? input.departmentsById.get(departmentId) ?? undefined : undefined;
    const entry = entryFromEvent(record);
    const path = pathFromSession(session) ?? pathFromEvent(record);
    const totalTokens = record.inputTokens + record.cachedInputTokens + record.outputTokens;

    const item: NormalizedEvent = {
      id: record.id,
      createdAt,
      createdAtMs,
      day: toDateKeyInTimeZone(createdAt, input.filters.timeZone),
      organizationId,
      organizationName: organization?.name ?? organizationId,
      organizationSlug: organization?.slug,
      organizationType: organization?.type,
      userId,
      userName: fallbackUserName(userId, user),
      userEmail: trimOrUndefined(user?.email),
      departmentId,
      departmentName: department?.name ?? departmentId,
      sessionId: trimOrUndefined(record.sessionId) ?? `event:${record.id}`,
      threadId: trimOrUndefined(record.threadId) ?? trimOrUndefined(session?.threadId),
      model: record.model,
      entryKey: entry.key,
      entryLabel: entry.label,
      pathKey: path.key,
      pathLabel: path.label,
      inputTokens: record.inputTokens,
      cachedInputTokens: record.cachedInputTokens,
      outputTokens: record.outputTokens,
      totalTokens,
      estimatedCost: toNumber(record.estimatedCost),
      internalCost: toNumber(record.internalCost),
      resultStatus: record.resultStatus
    };

    if (input.filters.path && item.pathKey !== input.filters.path) {
      continue;
    }
    if (input.filters.entry && item.entryKey !== input.filters.entry) {
      continue;
    }
    if (input.filters.query && !matchesQuery(item, input.filters.query.toLowerCase())) {
      continue;
    }

    normalized.push(item);
  }

  return normalized.sort((left, right) => right.createdAtMs - left.createdAtMs);
}

function ensureAggregateState(target: Map<string, AggregateState>, key: string): AggregateState {
  const existing = target.get(key);
  if (existing) return existing;
  const created: AggregateState = {
    requestCount: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    internalCost: 0,
    sessionIds: new Set<string>(),
    userIds: new Set<string>(),
    organizationIds: new Set<string>()
  };
  target.set(key, created);
  return created;
}

function applyToAggregate(target: AggregateState, record: NormalizedEvent): void {
  target.requestCount += 1;
  target.inputTokens += record.inputTokens;
  target.cachedInputTokens += record.cachedInputTokens;
  target.outputTokens += record.outputTokens;
  target.totalTokens += record.totalTokens;
  target.estimatedCost += record.estimatedCost;
  target.internalCost += record.internalCost;
  target.sessionIds.add(record.sessionId);
  if (record.userId) target.userIds.add(record.userId);
  if (record.organizationId) target.organizationIds.add(record.organizationId);
}

export function buildOperationsInsights(input: BuildOperationsInsightsInput): OperationsInsightsResponse {
  const filtered = normalizeEvents(input);
  const now = input.now ?? new Date();
  const summaryRequestCount = filtered.length;
  const sessionBuckets = new Map<string, SessionAggregateState>();
  const organizationBuckets = new Map<string, OrganizationAggregateState>();
  const userBuckets = new Map<string, UserAggregateState>();
  const pathBuckets = new Map<string, AggregateState>();
  const modelBuckets = new Map<string, AggregateState>();
  const entryBuckets = new Map<string, AggregateState>();
  const trendBuckets = new Map<
    string,
    {
      day: string;
      requestCount: number;
      sessionIds: Set<string>;
      userIds: Set<string>;
      organizationIds: Set<string>;
      totalTokens: number;
      estimatedCost: number;
      internalCost: number;
    }
  >();

  const pathLabels = new Map<string, string>();
  const modelLabels = new Map<string, string>();
  const entryLabels = new Map<string, string>();

  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  let estimatedCost = 0;
  let internalCost = 0;

  for (const record of filtered) {
    inputTokens += record.inputTokens;
    cachedInputTokens += record.cachedInputTokens;
    outputTokens += record.outputTokens;
    estimatedCost += record.estimatedCost;
    internalCost += record.internalCost;

    pathLabels.set(record.pathKey, record.pathLabel);
    modelLabels.set(record.model, record.model);
    entryLabels.set(record.entryKey, record.entryLabel);

    applyToAggregate(ensureAggregateState(pathBuckets, record.pathKey), record);
    applyToAggregate(ensureAggregateState(modelBuckets, record.model), record);
    applyToAggregate(ensureAggregateState(entryBuckets, record.entryKey), record);

    const sessionExisting = sessionBuckets.get(record.sessionId);
    if (sessionExisting) {
      sessionExisting.requestCount += 1;
      sessionExisting.inputTokens += record.inputTokens;
      sessionExisting.cachedInputTokens += record.cachedInputTokens;
      sessionExisting.outputTokens += record.outputTokens;
      sessionExisting.totalTokens += record.totalTokens;
      sessionExisting.estimatedCost += record.estimatedCost;
      sessionExisting.internalCost += record.internalCost;
      if (record.createdAtMs < sessionExisting.firstActiveAtMs) {
        sessionExisting.firstActiveAt = record.createdAt;
        sessionExisting.firstActiveAtMs = record.createdAtMs;
      }
      if (record.createdAtMs > sessionExisting.lastActiveAtMs) {
        sessionExisting.lastActiveAt = record.createdAt;
        sessionExisting.lastActiveAtMs = record.createdAtMs;
      }
    } else {
      sessionBuckets.set(record.sessionId, {
        sessionId: record.sessionId,
        threadId: record.threadId,
        organizationId: record.organizationId,
        organizationName: record.organizationName,
        userId: record.userId,
        userName: record.userName,
        userEmail: record.userEmail,
        departmentName: record.departmentName,
        model: record.model,
        entryKey: record.entryKey,
        entryLabel: record.entryLabel,
        pathKey: record.pathKey,
        pathLabel: record.pathLabel,
        requestCount: 1,
        inputTokens: record.inputTokens,
        cachedInputTokens: record.cachedInputTokens,
        outputTokens: record.outputTokens,
        totalTokens: record.totalTokens,
        estimatedCost: record.estimatedCost,
        internalCost: record.internalCost,
        firstActiveAt: record.createdAt,
        firstActiveAtMs: record.createdAtMs,
        lastActiveAt: record.createdAt,
        lastActiveAtMs: record.createdAtMs
      });
    }

    if (record.organizationId) {
      const existing = organizationBuckets.get(record.organizationId);
      if (existing) {
        existing.requestCount += 1;
        existing.inputTokens += record.inputTokens;
        existing.cachedInputTokens += record.cachedInputTokens;
        existing.outputTokens += record.outputTokens;
        existing.totalTokens += record.totalTokens;
        existing.estimatedCost += record.estimatedCost;
        existing.internalCost += record.internalCost;
        existing.sessionIds.add(record.sessionId);
        if (record.userId) existing.userIds.add(record.userId);
        existing.modelCounts.set(record.model, (existing.modelCounts.get(record.model) ?? 0) + 1);
        existing.pathCounts.set(record.pathLabel, (existing.pathCounts.get(record.pathLabel) ?? 0) + 1);
        if (record.createdAtMs > existing.lastActiveAtMs) {
          existing.lastActiveAt = record.createdAt;
          existing.lastActiveAtMs = record.createdAtMs;
        }
      } else {
        organizationBuckets.set(record.organizationId, {
          organizationId: record.organizationId,
          organizationName: record.organizationName ?? record.organizationId,
          organizationSlug: record.organizationSlug,
          organizationType: record.organizationType,
          requestCount: 1,
          inputTokens: record.inputTokens,
          cachedInputTokens: record.cachedInputTokens,
          outputTokens: record.outputTokens,
          totalTokens: record.totalTokens,
          estimatedCost: record.estimatedCost,
          internalCost: record.internalCost,
          sessionIds: new Set<string>([record.sessionId]),
          userIds: new Set<string>(record.userId ? [record.userId] : []),
          lastActiveAt: record.createdAt,
          lastActiveAtMs: record.createdAtMs,
          modelCounts: new Map<string, number>([[record.model, 1]]),
          pathCounts: new Map<string, number>([[record.pathLabel, 1]])
        });
      }
    }

    if (record.userId) {
      const existing = userBuckets.get(record.userId);
      if (existing) {
        existing.requestCount += 1;
        existing.inputTokens += record.inputTokens;
        existing.cachedInputTokens += record.cachedInputTokens;
        existing.outputTokens += record.outputTokens;
        existing.totalTokens += record.totalTokens;
        existing.estimatedCost += record.estimatedCost;
        existing.internalCost += record.internalCost;
        existing.sessionIds.add(record.sessionId);
        existing.modelCounts.set(record.model, (existing.modelCounts.get(record.model) ?? 0) + 1);
        existing.pathCounts.set(record.pathLabel, (existing.pathCounts.get(record.pathLabel) ?? 0) + 1);
        if (record.createdAtMs > existing.lastActiveAtMs) {
          existing.lastActiveAt = record.createdAt;
          existing.lastActiveAtMs = record.createdAtMs;
        }
      } else {
        userBuckets.set(record.userId, {
          userId: record.userId,
          userName: record.userName,
          userEmail: record.userEmail,
          organizationId: record.organizationId,
          organizationName: record.organizationName,
          departmentName: record.departmentName,
          requestCount: 1,
          inputTokens: record.inputTokens,
          cachedInputTokens: record.cachedInputTokens,
          outputTokens: record.outputTokens,
          totalTokens: record.totalTokens,
          estimatedCost: record.estimatedCost,
          internalCost: record.internalCost,
          sessionIds: new Set<string>([record.sessionId]),
          lastActiveAt: record.createdAt,
          lastActiveAtMs: record.createdAtMs,
          modelCounts: new Map<string, number>([[record.model, 1]]),
          pathCounts: new Map<string, number>([[record.pathLabel, 1]])
        });
      }
    }

    const trend = trendBuckets.get(record.day);
    if (trend) {
      trend.requestCount += 1;
      trend.totalTokens += record.totalTokens;
      trend.estimatedCost += record.estimatedCost;
      trend.internalCost += record.internalCost;
      trend.sessionIds.add(record.sessionId);
      if (record.userId) trend.userIds.add(record.userId);
      if (record.organizationId) trend.organizationIds.add(record.organizationId);
    } else {
      trendBuckets.set(record.day, {
        day: record.day,
        requestCount: 1,
        sessionIds: new Set<string>([record.sessionId]),
        userIds: new Set<string>(record.userId ? [record.userId] : []),
        organizationIds: new Set<string>(record.organizationId ? [record.organizationId] : []),
        totalTokens: record.totalTokens,
        estimatedCost: record.estimatedCost,
        internalCost: record.internalCost
      });
    }
  }

  const totalTokens = inputTokens + cachedInputTokens + outputTokens;
  const totalSessions = sessionBuckets.size;
  const totalUsers = userBuckets.size;
  const totalOrganizations = organizationBuckets.size;
  const pathRows = [...pathBuckets.entries()]
    .map(([key, value]) => ({
      key,
      label: pathLabels.get(key) ?? key,
      organizationCount: value.organizationIds.size,
      userCount: value.userIds.size,
      sessionCount: value.sessionIds.size,
      requestCount: value.requestCount,
      totalTokens: value.totalTokens,
      estimatedCost: formatDecimal(value.estimatedCost),
      internalCost: formatDecimal(value.internalCost),
      shareOfInternalCost: internalCost > 0 ? formatRatio(value.internalCost / internalCost) : 0
    }))
    .sort((left, right) =>
      toNumber(right.internalCost) - toNumber(left.internalCost) ||
      right.requestCount - left.requestCount ||
      left.label.localeCompare(right.label, "zh-CN")
    );
  const modelRows = [...modelBuckets.entries()]
    .map(([key, value]) => ({
      key,
      label: modelLabels.get(key) ?? key,
      organizationCount: value.organizationIds.size,
      userCount: value.userIds.size,
      sessionCount: value.sessionIds.size,
      requestCount: value.requestCount,
      totalTokens: value.totalTokens,
      estimatedCost: formatDecimal(value.estimatedCost),
      internalCost: formatDecimal(value.internalCost),
      shareOfInternalCost: internalCost > 0 ? formatRatio(value.internalCost / internalCost) : 0
    }))
    .sort((left, right) =>
      toNumber(right.internalCost) - toNumber(left.internalCost) ||
      right.requestCount - left.requestCount ||
      left.label.localeCompare(right.label, "zh-CN")
    );
  const entryRows = [...entryBuckets.entries()]
    .map(([key, value]) => ({
      key,
      label: entryLabels.get(key) ?? key,
      organizationCount: value.organizationIds.size,
      userCount: value.userIds.size,
      sessionCount: value.sessionIds.size,
      requestCount: value.requestCount,
      totalTokens: value.totalTokens,
      estimatedCost: formatDecimal(value.estimatedCost),
      internalCost: formatDecimal(value.internalCost),
      shareOfInternalCost: internalCost > 0 ? formatRatio(value.internalCost / internalCost) : 0
    }))
    .sort((left, right) =>
      toNumber(right.internalCost) - toNumber(left.internalCost) ||
      right.requestCount - left.requestCount ||
      left.label.localeCompare(right.label, "zh-CN")
    );

  const organizationRows = [...organizationBuckets.values()]
    .map((bucket) => ({
      organizationId: bucket.organizationId,
      organizationName: bucket.organizationName,
      organizationSlug: bucket.organizationSlug,
      organizationType: bucket.organizationType,
      userCount: bucket.userIds.size,
      sessionCount: bucket.sessionIds.size,
      requestCount: bucket.requestCount,
      totalTokens: bucket.totalTokens,
      estimatedCost: formatDecimal(bucket.estimatedCost),
      internalCost: formatDecimal(bucket.internalCost),
      avgTokensPerSession: formatAverage(bucket.sessionIds.size ? bucket.totalTokens / bucket.sessionIds.size : 0),
      avgInternalCostPerSession: formatDecimal(bucket.sessionIds.size ? bucket.internalCost / bucket.sessionIds.size : 0),
      cacheShare: formatRatio(
        bucket.inputTokens + bucket.cachedInputTokens > 0
          ? bucket.cachedInputTokens / (bucket.inputTokens + bucket.cachedInputTokens)
          : 0
      ),
      topModel: dominantLabel(bucket.modelCounts),
      topPath: dominantLabel(bucket.pathCounts),
      lastActiveAt: bucket.lastActiveAt
    }))
    .sort((left, right) =>
      toNumber(right.internalCost) - toNumber(left.internalCost) ||
      right.sessionCount - left.sessionCount ||
      left.organizationName.localeCompare(right.organizationName, "zh-CN")
    );

  const userRows = [...userBuckets.values()]
    .map((bucket) => ({
      userId: bucket.userId,
      userName: bucket.userName,
      userEmail: bucket.userEmail,
      organizationId: bucket.organizationId,
      organizationName: bucket.organizationName,
      departmentName: bucket.departmentName,
      sessionCount: bucket.sessionIds.size,
      requestCount: bucket.requestCount,
      totalTokens: bucket.totalTokens,
      estimatedCost: formatDecimal(bucket.estimatedCost),
      internalCost: formatDecimal(bucket.internalCost),
      avgTokensPerSession: formatAverage(bucket.sessionIds.size ? bucket.totalTokens / bucket.sessionIds.size : 0),
      avgInternalCostPerSession: formatDecimal(bucket.sessionIds.size ? bucket.internalCost / bucket.sessionIds.size : 0),
      cacheShare: formatRatio(
        bucket.inputTokens + bucket.cachedInputTokens > 0
          ? bucket.cachedInputTokens / (bucket.inputTokens + bucket.cachedInputTokens)
          : 0
      ),
      topModel: dominantLabel(bucket.modelCounts),
      topPath: dominantLabel(bucket.pathCounts),
      lastActiveAt: bucket.lastActiveAt
    }))
    .sort((left, right) =>
      toNumber(right.internalCost) - toNumber(left.internalCost) ||
      right.sessionCount - left.sessionCount ||
      left.userName.localeCompare(right.userName, "zh-CN")
    );

  const sessionRows = [...sessionBuckets.values()]
    .map((bucket) => ({
      sessionId: bucket.sessionId,
      threadId: bucket.threadId,
      organizationId: bucket.organizationId,
      organizationName: bucket.organizationName,
      userId: bucket.userId,
      userName: bucket.userName,
      userEmail: bucket.userEmail,
      departmentName: bucket.departmentName,
      model: bucket.model,
      entryLabel: bucket.entryLabel,
      pathKey: bucket.pathKey,
      pathLabel: bucket.pathLabel,
      requestCount: bucket.requestCount,
      inputTokens: bucket.inputTokens,
      cachedInputTokens: bucket.cachedInputTokens,
      outputTokens: bucket.outputTokens,
      totalTokens: bucket.totalTokens,
      estimatedCost: formatDecimal(bucket.estimatedCost),
      internalCost: formatDecimal(bucket.internalCost),
      avgTokensPerRequest: formatAverage(bucket.requestCount ? bucket.totalTokens / bucket.requestCount : 0),
      cacheShare: formatRatio(
        bucket.inputTokens + bucket.cachedInputTokens > 0
          ? bucket.cachedInputTokens / (bucket.inputTokens + bucket.cachedInputTokens)
          : 0
      ),
      firstActiveAt: bucket.firstActiveAt,
      lastActiveAt: bucket.lastActiveAt
    }))
    .sort((left, right) => new Date(right.lastActiveAt).getTime() - new Date(left.lastActiveAt).getTime());

  const totalPages = Math.max(1, Math.ceil(sessionRows.length / input.filters.sessionPageSize));
  const safePage = Math.min(Math.max(1, input.filters.sessionPage), totalPages);
  const start = (safePage - 1) * input.filters.sessionPageSize;
  const pagedSessions = sessionRows.slice(start, start + input.filters.sessionPageSize);

  const trends = [...trendBuckets.values()]
    .map((bucket) => ({
      day: bucket.day,
      organizationCount: bucket.organizationIds.size,
      userCount: bucket.userIds.size,
      sessionCount: bucket.sessionIds.size,
      requestCount: bucket.requestCount,
      totalTokens: bucket.totalTokens,
      estimatedCost: formatDecimal(bucket.estimatedCost),
      internalCost: formatDecimal(bucket.internalCost)
    }))
    .sort((left, right) => left.day.localeCompare(right.day));

  const options = {
    organizations: organizationRows.map((item) => ({
      value: item.organizationId,
      label: item.organizationSlug ? `${item.organizationName} (${item.organizationSlug})` : item.organizationName
    })),
    models: modelRows.map((item) => ({ value: item.key, label: item.label })),
    paths: pathRows.map((item) => ({ value: item.key, label: item.label })),
    entries: entryRows.map((item) => ({ value: item.key, label: item.label }))
  };

  return {
    filters: {
      ...input.filters,
      sessionPage: safePage
    },
    window: {
      from: new Date(now.getTime() - input.filters.days * 24 * 60 * 60 * 1000).toISOString(),
      to: now.toISOString(),
      timeZone: input.filters.timeZone
    },
    options,
    summary: {
      totalOrganizations,
      totalUsers,
      totalSessions,
      totalRequests: summaryRequestCount,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      totalTokens,
      estimatedCost: formatDecimal(estimatedCost),
      internalCost: formatDecimal(internalCost),
      avgRequestsPerSession: formatAverage(totalSessions ? summaryRequestCount / totalSessions : 0),
      avgTokensPerSession: formatAverage(totalSessions ? totalTokens / totalSessions : 0),
      avgInternalCostPerSession: formatDecimal(totalSessions ? internalCost / totalSessions : 0),
      avgTokensPerRequest: formatAverage(summaryRequestCount ? totalTokens / summaryRequestCount : 0),
      cacheShare: formatRatio(inputTokens + cachedInputTokens > 0 ? cachedInputTokens / (inputTokens + cachedInputTokens) : 0)
    },
    trends,
    breakdowns: {
      paths: pathRows,
      models: modelRows,
      entries: entryRows
    },
    organizations: organizationRows,
    users: userRows,
    sessions: {
      items: pagedSessions,
      page: safePage,
      pageSize: input.filters.sessionPageSize,
      totalItems: sessionRows.length,
      totalPages
    }
  };
}
