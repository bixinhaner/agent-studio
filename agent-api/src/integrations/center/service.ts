import { IntegrationInstanceRepository, type IntegrationInstanceRepositoryDb, type IntegrationValidationRecord } from "../../persistence/integration-instance-repository.js";
import type { UsageEventRecord } from "../../persistence/usage-event-repository.js";
import type { UsageLedgerService } from "../../operations/usage-ledger-service.js";
import { usageTotalTokens } from "../../operations/usage-metrics.js";
import {
  createEmptyPolicySummary,
  collectSecretLikeConfigKeys,
  integrationPolicyResourceType,
  type IntegrationDetail,
  type IntegrationInstanceBaseInput,
  type IntegrationInstanceUpdateInput,
  type IntegrationBindingInput,
  type IntegrationBindingsResult,
  type IntegrationListItem,
  type IntegrationPoliciesResult,
  type IntegrationPolicyInput,
  type IntegrationPolicySummary,
  type IntegrationTriggerType,
  type IntegrationZendeskAiReviewEmailReminderResult,
  type IntegrationValidationItem,
  type IntegrationZendeskCacheCleanupResult,
  type IntegrationZendeskGroupsResult,
  type IntegrationZendeskRunResult,
  type IntegrationValidationResult,
  sanitizeIntegrationConfigForRead
} from "./types.js";
import type { PolicyService } from "../../resources/policy-service.js";
import { CrestCrmIntegrationAdapter } from "./crest-crm-adapter.js";
import { DingTalkIntegrationAdapter, type IntegrationValidationOutcome } from "./dingtalk-adapter.js";
import { OpenAICodexIntegrationAdapter } from "./openai-codex-adapter.js";
import { OpenAICompatibleApiIntegrationAdapter } from "./openai-compatible-api-adapter.js";
import type { ZendeskOverview } from "../zendesk/types.js";
import type {
  ZendeskAiReviewEmailReminderManualMode,
  ZendeskAiReviewEmailReminderSendResult,
  ZendeskAiReviewEmailReminderInstance
} from "../zendesk/ai-review-email-reminder-service.js";

const EXTERNAL_OPENAI_API_TYPE = "openai_compatible_api";

type PolicyRecord = {
  id: string;
  subjectType: "role" | "department" | "user";
  subjectId: string;
  resourceType: string;
  resourceId: string;
  effect: "allow" | "deny";
  organizationId?: string | null;
  createdAt: string;
  updatedAt: string;
};

type IntegrationPolicyStore = {
  listAll(): Promise<PolicyRecord[]>;
  replacePoliciesForResource(input: {
    resourceType: string;
    resourceId: string;
    policies: Array<{
      organizationId?: string;
      subjectType: "role" | "department" | "user";
      subjectId: string;
      resourceType: string;
      resourceId: string;
      effect: "allow" | "deny";
    }>;
  }): Promise<PolicyRecord[]>;
};

type AccessResolver = {
  getRoleIdsForUser(userId: string): Promise<string[]>;
  getDepartmentIdsForUser(userId: string): Promise<string[]>;
};

type IntegrationCenterTx = IntegrationInstanceRepositoryDb & {
  resourcePolicy: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
};

export type IntegrationCenterDb = Omit<IntegrationInstanceRepositoryDb, "$transaction"> & {
  $transaction<T>(callback: (tx: IntegrationCenterTx) => Promise<T>): Promise<T>;
};

type ValidationAdapter = {
  validate(config: Record<string, unknown>): Promise<IntegrationValidationOutcome>;
};

export type IntegrationCenterService = {
  listInstances(input: { currentUserId: string; type?: string }): Promise<{ items: IntegrationListItem[] }>;
  findInstanceBySlug(input: { currentUserId: string; type?: string; slug: string }): Promise<IntegrationListItem | null>;
  getInstanceDetail(input: { currentUserId: string; instanceId: string }): Promise<IntegrationDetail>;
  saveInstance(input: {
    currentUserId: string;
    instanceId?: string;
    payload: IntegrationInstanceBaseInput | IntegrationInstanceUpdateInput;
  }): Promise<IntegrationDetail>;
  validateInstance(input: { currentUserId: string; instanceId: string }): Promise<IntegrationValidationResult>;
  runZendeskTicket(input: {
    currentUserId: string;
    instanceId: string;
    ticketId: string | number;
  }): Promise<IntegrationZendeskRunResult>;
  listZendeskGroups(input: {
    currentUserId: string;
    instanceId: string;
  }): Promise<IntegrationZendeskGroupsResult>;
  previewZendeskCacheCleanup(input: {
    currentUserId: string;
    instanceId: string;
    retentionDays?: number;
    limit?: number;
  }): Promise<IntegrationZendeskCacheCleanupResult>;
  runZendeskCacheCleanup(input: {
    currentUserId: string;
    instanceId: string;
    retentionDays?: number;
    limit?: number;
  }): Promise<IntegrationZendeskCacheCleanupResult>;
  sendZendeskAiReviewEmailReminder(input: {
    currentUserId: string;
    currentUserEmail?: string;
    instanceId: string;
    mode: ZendeskAiReviewEmailReminderManualMode;
    testEmail?: string;
  }): Promise<IntegrationZendeskAiReviewEmailReminderResult>;
  listValidationHistory(input: { currentUserId: string; instanceId: string }): Promise<{ items: IntegrationValidationItem[] }>;
  getExternalApiUsage(input: {
    currentUserId: string;
    instanceId: string;
    days?: number;
    take?: number;
  }): Promise<{
    summary: {
      windowDays: number;
      totalRequests: number;
      successCount: number;
      failureCount: number;
      successRate: number;
      deliverySuccessCount: number;
      deliveryFailureCount: number;
      deliverySuccessRate: number;
      generatedUndeliveredCount: number;
      streamCount: number;
      streamRate: number;
      totalInputTokens: number;
      totalCachedInputTokens: number;
      totalOutputTokens: number;
      totalTokens: number;
      averageTokensPerRequest: number;
      averageReadyMs: number;
      p95ReadyMs: number;
      averageResponseMs: number;
      p95ResponseMs: number;
      totalEstimatedCost: string;
      totalInternalCost: string;
      lastRequestedAt?: string;
      lastDeliveredAt?: string;
    };
    trends: Array<{
      date: string;
      requestCount: number;
      successCount: number;
      failureCount: number;
      deliverySuccessCount: number;
      deliveryFailureCount: number;
      totalTokens: number;
      estimatedCost: string;
      internalCost: string;
    }>;
    breakdowns: {
      byModel: Array<{
        key: string;
        label: string;
        requestCount: number;
        successCount: number;
        failureCount: number;
        totalTokens: number;
        estimatedCost: string;
        internalCost: string;
      }>;
      byStatus: Array<{
        key: string;
        label: string;
        requestCount: number;
        successCount: number;
        failureCount: number;
        totalTokens: number;
        estimatedCost: string;
        internalCost: string;
      }>;
      byDelivery: Array<{
        key: string;
        label: string;
        requestCount: number;
        successCount: number;
        failureCount: number;
        totalTokens: number;
        estimatedCost: string;
        internalCost: string;
      }>;
      byTransport: Array<{
        key: string;
        label: string;
        requestCount: number;
        successCount: number;
        failureCount: number;
        totalTokens: number;
        estimatedCost: string;
        internalCost: string;
      }>;
    };
    records: Array<{
      id: string;
      sessionId?: string;
      model: string;
      requestedModel?: string;
      requestedReasoningEffort?: string;
      stream: boolean;
      messageCount: number;
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      totalTokens: number;
      estimatedCost: string;
      internalCost: string;
      resultStatus: string;
      deliveryStatus: string;
      responseMode: string;
      errorMessage?: string;
      agentModeId?: string;
      knowledgeSetIds: string[];
      requestAborted: boolean;
      responseFinished: boolean;
      responseClosedBeforeFinish: boolean;
      responseStatusCode?: number;
      responseStartedAt?: string;
      responseReadyAt?: string;
      responseCompletedAt?: string;
      responseStartedMs?: number;
      responseReadyMs?: number;
      responseCompletedMs?: number;
      outputChars: number;
      createdAt: string;
    }>;
  }>;
  listBindings(input: { currentUserId: string; instanceId: string }): Promise<IntegrationBindingsResult>;
  getPolicies(input: { currentUserId: string; instanceId: string }): Promise<IntegrationPoliciesResult>;
  replaceBindings(input: {
    currentUserId: string;
    instanceId: string;
    bindings: IntegrationBindingInput[];
  }): Promise<IntegrationBindingsResult>;
  replacePolicies(input: {
    currentUserId: string;
    instanceId: string;
    policies: IntegrationPolicyInput[];
    organizationId?: string;
  }): Promise<IntegrationPoliciesResult>;
};

function isForbiddenError(error: unknown): boolean {
  const message = detailFromError(error).toLowerCase();
  return message.includes("access denied") || message.includes("forbidden") || message.includes("not authorized");
}

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function detailFromError(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败";
}

function isNotFoundError(error: unknown): boolean {
  const message = detailFromError(error).toLowerCase();
  return message.includes("not found") || message.includes("不存在");
}

function toPolicySummary(items: IntegrationPolicyInput[]): IntegrationPolicySummary {
  const summary = createEmptyPolicySummary();
  for (const item of items) {
    const key = `${item.subjectType}s` as "roles" | "departments" | "users";
    summary[item.effect][key].push(item.subjectId);
  }
  for (const bucket of [summary.allow.roles, summary.allow.departments, summary.allow.users, summary.deny.roles, summary.deny.departments, summary.deny.users]) {
    bucket.sort((left, right) => left.localeCompare(right));
  }
  return summary;
}

function mapValidation(record: IntegrationValidationRecord): IntegrationValidationItem {
  return {
    id: record.id,
    triggerType: record.triggerType,
    status: record.status,
    summary: record.summary,
    detail: record.detail,
    triggeredByUserId: record.triggeredByUserId,
    createdAt: record.createdAt
  };
}

function mapBindingsResult(
  items: Array<{
    id: string;
    targetType: string;
    targetId: string;
    bindingType: string;
    bindingPayload: unknown;
    createdAt: string;
    updatedAt: string;
  }>
): IntegrationBindingsResult {
  return {
    items: items.map((item) => ({ ...item }))
  };
}

function normalizeConfigValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function mergeSecretState(existing: unknown, patch: unknown): Record<string, unknown> {
  return {
    ...normalizeConfigValue(existing),
    ...normalizeConfigValue(patch)
  };
}

function assertConfigIsSafe(config: unknown): Record<string, unknown> {
  const normalized = normalizeConfigValue(config);
  const secretLikeKeys = collectSecretLikeConfigKeys(normalized);
  if (secretLikeKeys.length > 0) {
    throw new Error(`config must not contain secret-like keys: ${[...new Set(secretLikeKeys)].join(", ")}`);
  }
  return normalized;
}

function normalizeValidationSummary(type: string, config: Record<string, unknown>): IntegrationValidationOutcome {
  const keys = Object.keys(config).sort();
  if (keys.length === 0) {
    return {
      status: "failed",
      summary: `${type} configuration is empty`,
      detail: { missing: ["config"] }
    };
  }
  return {
    status: "success",
    summary: `${type} configuration validated`,
    detail: { configKeys: keys }
  };
}

function normalizePolicyInput(input: {
  policies?: IntegrationPolicyInput[];
  roleAllowIds?: string[];
  roleDenyIds?: string[];
  departmentAllowIds?: string[];
  departmentDenyIds?: string[];
  userAllowIds?: string[];
  userDenyIds?: string[];
}): IntegrationPolicyInput[] {
  if (Array.isArray(input.policies) && input.policies.length > 0) {
    return input.policies.map((policy) => ({
      subjectType: policy.subjectType,
      subjectId: policy.subjectId.trim(),
      effect: policy.effect
    }));
  }

  const items: IntegrationPolicyInput[] = [];
  for (const subjectId of input.roleAllowIds ?? []) items.push({ subjectType: "role", subjectId: subjectId.trim(), effect: "allow" });
  for (const subjectId of input.roleDenyIds ?? []) items.push({ subjectType: "role", subjectId: subjectId.trim(), effect: "deny" });
  for (const subjectId of input.departmentAllowIds ?? []) items.push({ subjectType: "department", subjectId: subjectId.trim(), effect: "allow" });
  for (const subjectId of input.departmentDenyIds ?? []) items.push({ subjectType: "department", subjectId: subjectId.trim(), effect: "deny" });
  for (const subjectId of input.userAllowIds ?? []) items.push({ subjectType: "user", subjectId: subjectId.trim(), effect: "allow" });
  for (const subjectId of input.userDenyIds ?? []) items.push({ subjectType: "user", subjectId: subjectId.trim(), effect: "deny" });
  return items.filter((item) => item.subjectId.length > 0);
}

function buildPoliciesResult(items: Array<{ subjectType: "role" | "department" | "user"; subjectId: string; effect: "allow" | "deny" }>): IntegrationPoliciesResult {
  const normalized = items.map((item) => ({
    subjectType: item.subjectType,
    subjectId: item.subjectId,
    effect: item.effect
  }));
  return {
    items: normalized,
    summary: toPolicySummary(normalized)
  };
}

function mapInstanceDetail(detail: Awaited<ReturnType<IntegrationInstanceRepository["getInstance"]>>, policies: IntegrationPoliciesResult): IntegrationDetail {
  if (!detail) {
    throw new Error("integration instance not found");
  }

  return {
    instance: {
      ...(detail as IntegrationListItem),
      config: detail.config ? sanitizeIntegrationConfigForRead(detail.config) : detail.config
    },
    config: sanitizeIntegrationConfigForRead(detail.config),
    secretState: detail.secretState,
    validationHistory: {
      items: detail.validationHistory.map(mapValidation)
    },
    bindings: {
      items: detail.bindings.map((binding) => ({ ...binding }))
    },
    policies
  };
}

function mapZendeskOverview(overview: ZendeskOverview): NonNullable<IntegrationDetail["zendesk"]> {
  return {
    ready: overview.ready,
    missing: [...overview.missing],
    setup: {
      webhookUrl: overview.setup.webhookUrl,
      legacyWebhookUrl: overview.setup.legacyWebhookUrl,
      payloadExample: overview.setup.payloadExample,
      triggers: overview.setup.triggers.map((item) => ({
        name: item.name,
        description: item.description,
        conditions: [...item.conditions]
      }))
    },
    runs: overview.runs.map((item) => ({ ...item }))
  };
}

function createValidationOutcome(instanceType: string, config: Record<string, unknown>): IntegrationValidationOutcome {
  return normalizeValidationSummary(instanceType, config);
}

export function createIntegrationCenterService(options: {
  db: IntegrationCenterDb;
  policies: IntegrationPolicyStore;
  policyService: Pick<PolicyService, "filterAllowedResources">;
  accessResolver: AccessResolver;
  usageLedger: Pick<UsageLedgerService, "listExternalApiEvents">;
  zendesk?: {
    getOverview(instanceId?: string): Promise<ZendeskOverview>;
    validateConnection(instanceId?: string): Promise<{ ok: true; overview: ZendeskOverview }>;
    runTicket(ticketId: string | number, instanceId?: string): Promise<{
      status: string;
      detail: string;
      runId: string;
      commentId?: number;
      requesterCommentId?: number;
      decision?: string;
    }>;
    listGroups(instanceId?: string): Promise<IntegrationZendeskGroupsResult>;
    previewCacheCleanup(input: { instanceId: string; retentionDays?: number; limit?: number }): Promise<IntegrationZendeskCacheCleanupResult["result"]>;
    runCacheCleanup(input: { instanceId: string; retentionDays?: number; limit?: number; execute?: boolean }): Promise<IntegrationZendeskCacheCleanupResult["result"]>;
  };
  zendeskAiReviewEmailReminders?: {
    sendManualReminder(input: {
      instance: ZendeskAiReviewEmailReminderInstance;
      mode: ZendeskAiReviewEmailReminderManualMode;
      testEmail?: string;
    }): Promise<ZendeskAiReviewEmailReminderSendResult>;
  };
  adapters?: Partial<Record<string, ValidationAdapter>>;
}): IntegrationCenterService {
  const repository = new IntegrationInstanceRepository(options.db);
  const adapters: Partial<Record<string, ValidationAdapter>> = {
    dingtalk: new DingTalkIntegrationAdapter(),
    crest_crm: new CrestCrmIntegrationAdapter(),
    openai_codex: new OpenAICodexIntegrationAdapter(),
    openai_compatible_api: new OpenAICompatibleApiIntegrationAdapter(),
    ...options.adapters
  };

  async function getAccessContext(userId: string): Promise<{ roleIds: string[]; departmentIds: string[] }> {
    return {
      roleIds: await options.accessResolver.getRoleIdsForUser(userId),
      departmentIds: await options.accessResolver.getDepartmentIdsForUser(userId)
    };
  }

  function requiresInstancePolicy(type: string | undefined): boolean {
    return trimOrUndefined(type) !== EXTERNAL_OPENAI_API_TYPE;
  }

  function asRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    return value as Record<string, unknown>;
  }

  function asString(value: unknown): string | undefined {
    return trimOrUndefined(typeof value === "string" ? value : undefined);
  }

  function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const items: string[] = [];
    for (const item of value) {
      const normalized = asString(item);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      items.push(normalized);
    }
    return items;
  }

  function toNumber(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  function asBoolean(value: unknown): boolean | undefined {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      if (value === "true") return true;
      if (value === "false") return false;
    }
    return undefined;
  }

  function toDayKey(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return new Date().toISOString().slice(0, 10);
    }
    return parsed.toISOString().slice(0, 10);
  }

  function utcDayOffset(daysAgo: number): string {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo)).toISOString().slice(0, 10);
  }

  function clampWindowDays(value: number | undefined): number {
    if (!Number.isFinite(value)) return 14;
    return Math.max(1, Math.min(90, Math.trunc(value as number)));
  }

  function clampRecordTake(value: number | undefined): number {
    if (!Number.isFinite(value)) return 120;
    return Math.max(1, Math.min(200, Math.trunc(value as number)));
  }

  function formatFixed(value: number): string {
    return value.toFixed(6);
  }

  function roundRatio(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return Number(((numerator / denominator) * 100).toFixed(1));
  }

  function average(values: number[]): number {
    if (values.length === 0) return 0;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  }

  function percentile(values: number[], ratio: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
    return Math.round(sorted[index] ?? 0);
  }

  function responseMetric(value: unknown): number | undefined {
    const parsed = toNumber(value);
    return parsed > 0 ? parsed : undefined;
  }

  function responseStatusCode(value: unknown): number | undefined {
    const parsed = toNumber(value);
    return parsed > 0 ? Math.trunc(parsed) : undefined;
  }

  function deliveryStatusFromUsage(record: UsageEventRecord): string {
    return asString(asRecord(record.metadata)?.deliveryStatus) ?? "unknown";
  }

  function deliveryStatusLabel(key: string): string {
    switch (key) {
      case "delivered":
        return "已送达";
      case "client_aborted":
        return "客户端中断";
      case "connection_closed":
        return "连接中断";
      default:
        return "未知";
    }
  }

  function executionStatusLabel(key: string): string {
    switch (key) {
      case "success":
        return "生成成功";
      case "failed":
        return "生成失败";
      default:
        return key;
    }
  }

  function buildUsageBreakdown(
    records: UsageEventRecord[],
    select: (record: UsageEventRecord) => string,
    label?: (key: string) => string
  ) {
    const buckets = new Map<
      string,
      {
        requestCount: number;
        successCount: number;
        failureCount: number;
        totalTokens: number;
        estimatedCost: number;
        internalCost: number;
      }
    >();

    for (const record of records) {
      const key = select(record).trim() || "unknown";
      const bucket = buckets.get(key) ?? {
        requestCount: 0,
        successCount: 0,
        failureCount: 0,
        totalTokens: 0,
        estimatedCost: 0,
        internalCost: 0
      };
      bucket.requestCount += 1;
      if (record.resultStatus === "success") bucket.successCount += 1;
      else bucket.failureCount += 1;
      bucket.totalTokens += usageTotalTokens(record.inputTokens, record.outputTokens);
      bucket.estimatedCost += toNumber(record.estimatedCost);
      bucket.internalCost += toNumber(record.internalCost);
      buckets.set(key, bucket);
    }

    return [...buckets.entries()]
      .map(([key, bucket]) => ({
        key,
        label: label ? label(key) : key,
        requestCount: bucket.requestCount,
        successCount: bucket.successCount,
        failureCount: bucket.failureCount,
        totalTokens: bucket.totalTokens,
        estimatedCost: formatFixed(bucket.estimatedCost),
        internalCost: formatFixed(bucket.internalCost)
      }))
      .sort(
        (left, right) =>
          right.requestCount - left.requestCount ||
          right.totalTokens - left.totalTokens ||
          left.label.localeCompare(right.label, "en", { sensitivity: "base" })
      );
  }

  async function filterAuthorizedInstanceIds(currentUserId: string, instanceIds: string[]): Promise<string[]> {
    const access = await getAccessContext(currentUserId);
    return await options.policyService.filterAllowedResources({
      userId: currentUserId,
      roleIds: access.roleIds,
      departmentIds: access.departmentIds,
      resourceType: integrationPolicyResourceType,
      candidateIds: instanceIds
    });
  }

  async function requireAuthorizedInstance(instanceId: string, currentUserId: string): Promise<NonNullable<Awaited<ReturnType<IntegrationInstanceRepository["getInstance"]>>>> {
    const detail = await repository.getInstance(instanceId);
    if (!detail) {
      throw new Error("integration instance not found");
    }
    if (!requiresInstancePolicy(detail.type)) {
      return detail;
    }
    const allowed = await filterAuthorizedInstanceIds(currentUserId, [detail.id]);
    if (!allowed.includes(detail.id)) {
      throw new Error("integration instance access denied");
    }
    return detail;
  }

  async function readDetail(instanceId: string, currentUserId: string): Promise<IntegrationDetail> {
    const detail = await requireAuthorizedInstance(instanceId, currentUserId);
    if (!requiresInstancePolicy(detail.type)) {
      const mapped = mapInstanceDetail(detail, buildPoliciesResult([]));
      if (detail.type === "zendesk" && options.zendesk) {
        mapped.zendesk = mapZendeskOverview(await options.zendesk.getOverview(detail.id));
      }
      return mapped;
    }

    const policies = await options.policies.listAll();

    const instancePolicies = policies
      .filter(
        (policy) => policy.resourceType === integrationPolicyResourceType && policy.resourceId === detail.id
      )
      .map((policy) => ({
        subjectType: policy.subjectType,
        subjectId: policy.subjectId,
        effect: policy.effect
      }));

    const mapped = mapInstanceDetail(detail, buildPoliciesResult(instancePolicies));
    if (detail.type === "zendesk" && options.zendesk) {
      mapped.zendesk = mapZendeskOverview(await options.zendesk.getOverview(detail.id));
    }
    return mapped;
  }

  async function readValidationConfig(instanceId: string): Promise<Record<string, unknown>> {
    const [configRow, secretRow] = await Promise.all([
      options.db.integrationInstanceConfig.findUnique({ where: { integrationInstanceId: instanceId } }),
      options.db.integrationInstanceSecret.findUnique({ where: { integrationInstanceId: instanceId } })
    ]);

    return {
      ...normalizeConfigValue(configRow?.config),
      ...normalizeConfigValue(secretRow?.secretState)
    };
  }

  async function persistConfigAndSecrets(
    db: Pick<IntegrationCenterTx, "integrationInstanceConfig" | "integrationInstanceSecret">,
    instanceId: string,
    payload: IntegrationInstanceBaseInput | IntegrationInstanceUpdateInput,
    currentUserId: string
  ): Promise<void> {
    if (payload.config) {
      await db.integrationInstanceConfig.upsert({
        where: { integrationInstanceId: instanceId },
        create: {
          integrationInstanceId: instanceId,
          config: assertConfigIsSafe(payload.config)
        },
        update: {
          config: assertConfigIsSafe(payload.config)
        }
      });
    }
    if (payload.secretState !== undefined) {
      if (payload.secretState === null) {
        const existing = await db.integrationInstanceSecret.findUnique({
          where: { integrationInstanceId: instanceId }
        });
        await db.integrationInstanceSecret.upsert({
          where: { integrationInstanceId: instanceId },
          create: {
            integrationInstanceId: instanceId,
            hasSecrets: false,
            secretState: {},
            rotatedAt: existing?.rotatedAt ?? null,
            rotatedByUserId: trimOrUndefined(existing?.rotatedByUserId) ?? null
          },
          update: {
            hasSecrets: false,
            secretState: {},
            rotatedAt: existing?.rotatedAt ?? null,
            rotatedByUserId: trimOrUndefined(existing?.rotatedByUserId) ?? null
          }
        });
      } else {
        const existing = await db.integrationInstanceSecret.findUnique({
          where: { integrationInstanceId: instanceId }
        });
        const nextSecretState = mergeSecretState(existing?.secretState, payload.secretState);
        await db.integrationInstanceSecret.upsert({
          where: { integrationInstanceId: instanceId },
          create: {
            integrationInstanceId: instanceId,
            hasSecrets: Object.keys(nextSecretState).length > 0,
            secretState: nextSecretState,
            rotatedAt: new Date(),
            rotatedByUserId: currentUserId
          },
          update: {
            hasSecrets: Object.keys(nextSecretState).length > 0,
            secretState: nextSecretState,
            rotatedAt: new Date(),
            rotatedByUserId: currentUserId
          }
        });
      }
    }
  }

  async function createCreatorPolicy(
    db: Pick<IntegrationCenterTx, "resourcePolicy">,
    created: { id: string; organizationId?: string | null; type?: string | null },
    currentUserId: string
  ): Promise<void> {
    if (!requiresInstancePolicy(trimOrUndefined(created.type) ?? undefined)) {
      return;
    }
    await db.resourcePolicy.create({
      data: {
        organizationId: created.organizationId ?? null,
        subjectType: "user",
        subjectId: currentUserId,
        resourceType: integrationPolicyResourceType,
        resourceId: created.id,
        effect: "allow"
      }
    });
  }

  async function saveInstance(input: {
    currentUserId: string;
    instanceId?: string;
    payload: IntegrationInstanceBaseInput | IntegrationInstanceUpdateInput;
  }): Promise<IntegrationDetail> {
    const instanceId = input.instanceId;
    if (instanceId) {
      const existing = await requireAuthorizedInstance(instanceId, input.currentUserId);

      if ("slug" in input.payload && input.payload.slug && input.payload.slug !== existing.slug) {
        throw new Error("integration slug cannot be changed");
      }

      await options.db.$transaction(async (tx) => {
        await tx.integrationInstance.update({
          where: { id: instanceId },
          data: {
            name: trimOrUndefined(input.payload.name) ?? existing.name,
            description: input.payload.description === undefined ? existing.description ?? null : input.payload.description ?? null,
            status: input.payload.status ?? existing.status,
            updatedAt: new Date()
          }
        });
        await persistConfigAndSecrets(tx, instanceId, input.payload, input.currentUserId);
      });
      return await readDetail(instanceId, input.currentUserId);
    }

    const payload = input.payload as IntegrationInstanceBaseInput;
    const safeConfig = payload.config ? assertConfigIsSafe(payload.config) : undefined;
    const createdId = await options.db.$transaction(async (tx) => {
      const created = await tx.integrationInstance.create({
        data: {
          organizationId: payload.organizationId ?? null,
          type: payload.type,
          slug: payload.slug,
          name: payload.name,
          description: payload.description ?? null,
          status: payload.status ?? "draft",
          isSystemSingleton: payload.type === "dingtalk" || payload.type === "openai_codex"
        }
      });
      await persistConfigAndSecrets(tx, created.id, { ...input.payload, config: safeConfig }, input.currentUserId);
      await createCreatorPolicy(tx, created, input.currentUserId);
      return created.id;
    });
    return await readDetail(createdId, input.currentUserId);
  }

  return {
    async listInstances(input) {
      const items = (await repository.listInstances(trimOrUndefined(input.type))).map((item) => ({
        ...(item as IntegrationListItem),
        config: item.config ? sanitizeIntegrationConfigForRead(item.config) : item.config
      }));
      const unrestrictedIds = items.filter((item) => !requiresInstancePolicy(item.type)).map((item) => item.id);
      const restrictedIds = items.filter((item) => requiresInstancePolicy(item.type)).map((item) => item.id);
      const allowedIds = new Set([
        ...unrestrictedIds,
        ...(await filterAuthorizedInstanceIds(input.currentUserId, restrictedIds))
      ]);
      return {
        items: items.filter((item) => allowedIds.has(item.id))
      };
    },

    async findInstanceBySlug(input) {
      const { items } = await this.listInstances({
        currentUserId: input.currentUserId,
        type: input.type
      });
      return items.find((item) => item.slug === input.slug) ?? null;
    },

    async getInstanceDetail(input) {
      return await readDetail(input.instanceId, input.currentUserId);
    },

    async saveInstance(input) {
      return await saveInstance(input);
    },

    async validateInstance(input) {
      const detail = await repository.getInstance(input.instanceId);
      if (!detail) {
        throw new Error("integration instance not found");
      }
      await requireAuthorizedInstance(detail.id, input.currentUserId);

      try {
        let outcome: IntegrationValidationOutcome;
        if (detail.type === "zendesk" && options.zendesk) {
          const result = await options.zendesk.validateConnection(detail.id);
          outcome = {
            status: "success",
            summary: "zendesk connection validated",
            detail: {
              ready: result.overview.ready,
              missing: result.overview.missing,
              lastValidatedAt: result.overview.settings.lastValidatedAt,
              lastValidatedUser: result.overview.settings.lastValidatedUser
            }
          };
        } else {
          const validationConfig = await readValidationConfig(detail.id);
          outcome = adapters[detail.type]
            ? await adapters[detail.type]!.validate(validationConfig)
            : createValidationOutcome(detail.type, validationConfig);
        }

        const validation = mapValidation(
          await repository.recordValidation(detail.id, {
            triggerType: "manual" as IntegrationTriggerType,
            status: outcome.status,
            summary: outcome.summary,
            detail: outcome.detail,
            triggeredByUserId: input.currentUserId
          })
        );
        return {
          validation,
          detail: await readDetail(detail.id, input.currentUserId)
        };
      } catch (error) {
        const validation = mapValidation(
          await repository.recordValidation(detail.id, {
            triggerType: "manual" as IntegrationTriggerType,
            status: "failed",
            summary: "integration validation failed",
            detail: { error: detailFromError(error) },
            triggeredByUserId: input.currentUserId
          })
        );
        if (detail.type === "zendesk" && options.zendesk) {
          return {
            validation,
            detail: await readDetail(detail.id, input.currentUserId)
          };
        }
        throw error;
      }
    },

    async runZendeskTicket(input) {
      const instance = await requireAuthorizedInstance(input.instanceId, input.currentUserId);
      if (instance.type !== "zendesk") {
        throw new Error("当前集成实例不是 Zendesk。");
      }
      if (!options.zendesk) {
        throw new Error("Zendesk 集成功能未启用");
      }

      const result = await options.zendesk.runTicket(input.ticketId, instance.id);
      return {
        result,
        detail: await readDetail(instance.id, input.currentUserId)
      };
    },

    async listZendeskGroups(input) {
      const instance = await requireAuthorizedInstance(input.instanceId, input.currentUserId);
      if (instance.type !== "zendesk") {
        throw new Error("当前集成实例不是 Zendesk。");
      }
      if (!options.zendesk) {
        throw new Error("Zendesk 集成功能未启用");
      }

      return await options.zendesk.listGroups(instance.id);
    },

    async previewZendeskCacheCleanup(input) {
      const instance = await requireAuthorizedInstance(input.instanceId, input.currentUserId);
      if (instance.type !== "zendesk") {
        throw new Error("当前集成实例不是 Zendesk。");
      }
      if (!options.zendesk) {
        throw new Error("Zendesk 集成功能未启用");
      }

      return {
        result: await options.zendesk.previewCacheCleanup({
          instanceId: instance.id,
          retentionDays: input.retentionDays,
          limit: input.limit
        })
      };
    },

    async runZendeskCacheCleanup(input) {
      const instance = await requireAuthorizedInstance(input.instanceId, input.currentUserId);
      if (instance.type !== "zendesk") {
        throw new Error("当前集成实例不是 Zendesk。");
      }
      if (!options.zendesk) {
        throw new Error("Zendesk 集成功能未启用");
      }

      return {
        result: await options.zendesk.runCacheCleanup({
          instanceId: instance.id,
          retentionDays: input.retentionDays,
          limit: input.limit,
          execute: true
        })
      };
    },

    async sendZendeskAiReviewEmailReminder(input) {
      const instance = await requireAuthorizedInstance(input.instanceId, input.currentUserId);
      if (instance.type !== "zendesk") {
        throw new Error("当前集成实例不是 Zendesk。");
      }
      if (!options.zendeskAiReviewEmailReminders) {
        throw new Error("Zendesk AI review email reminder is not available");
      }
      const testEmail = trimOrUndefined(input.testEmail) ?? trimOrUndefined(input.currentUserEmail);
      const result = await options.zendeskAiReviewEmailReminders.sendManualReminder({
        instance: {
          id: instance.id,
          slug: instance.slug,
          name: instance.name,
          organizationId: instance.organizationId
        },
        mode: input.mode,
        testEmail
      });
      return { result };
    },

    async listValidationHistory(input) {
      await requireAuthorizedInstance(input.instanceId, input.currentUserId);
      const items = await repository.listValidationHistory(input.instanceId);
      return {
        items: items.map(mapValidation)
      };
    },

    async getExternalApiUsage(input) {
      const instance = await requireAuthorizedInstance(input.instanceId, input.currentUserId);
      if (instance.type !== EXTERNAL_OPENAI_API_TYPE) {
        throw new Error("当前集成实例不是外部 OpenAI API。");
      }

      const windowDays = clampWindowDays(input.days);
      const recordTake = clampRecordTake(input.take);
      const fromDate = new Date();
      fromDate.setUTCDate(fromDate.getUTCDate() - (windowDays - 1));
      fromDate.setUTCHours(0, 0, 0, 0);

      const rawEvents = await options.usageLedger.listExternalApiEvents();
      const relevantEvents = rawEvents.filter((record) => {
        const metadata = asRecord(record.metadata);
        if (asString(metadata?.integrationInstanceId) !== instance.id) {
          return false;
        }
        const createdAt = new Date(record.createdAt);
        if (Number.isNaN(createdAt.getTime())) {
          return false;
        }
        return createdAt.getTime() >= fromDate.getTime();
      });

      const trends = new Map<
        string,
        {
          date: string;
          requestCount: number;
          successCount: number;
          failureCount: number;
          deliverySuccessCount: number;
          deliveryFailureCount: number;
          totalTokens: number;
          estimatedCost: number;
          internalCost: number;
        }
      >();
      for (let offset = windowDays - 1; offset >= 0; offset -= 1) {
        const date = utcDayOffset(offset);
        trends.set(date, {
          date,
          requestCount: 0,
          successCount: 0,
          failureCount: 0,
          deliverySuccessCount: 0,
          deliveryFailureCount: 0,
          totalTokens: 0,
          estimatedCost: 0,
          internalCost: 0
        });
      }

      let successCount = 0;
      let failureCount = 0;
      let deliverySuccessCount = 0;
      let deliveryFailureCount = 0;
      let generatedUndeliveredCount = 0;
      let streamCount = 0;
      let totalInputTokens = 0;
      let totalCachedInputTokens = 0;
      let totalOutputTokens = 0;
      let totalEstimatedCost = 0;
      let totalInternalCost = 0;
      let lastRequestedAt: string | undefined;
      let lastDeliveredAt: string | undefined;
      const readyDurations: number[] = [];
      const responseDurations: number[] = [];

      for (const record of relevantEvents) {
        const metadata = asRecord(record.metadata);
        const deliveryStatus = deliveryStatusFromUsage(record);
        const totalTokens = usageTotalTokens(record.inputTokens, record.outputTokens);
        const trend = trends.get(toDayKey(record.createdAt));
        if (trend) {
          trend.requestCount += 1;
          if (record.resultStatus === "success") {
            trend.successCount += 1;
          } else {
            trend.failureCount += 1;
          }
          if (deliveryStatus === "delivered") {
            trend.deliverySuccessCount += 1;
          } else {
            trend.deliveryFailureCount += 1;
          }
          trend.totalTokens += totalTokens;
          trend.estimatedCost += toNumber(record.estimatedCost);
          trend.internalCost += toNumber(record.internalCost);
        }

        if (record.resultStatus === "success") {
          successCount += 1;
        } else {
          failureCount += 1;
        }
        if (deliveryStatus === "delivered") {
          deliverySuccessCount += 1;
          const deliveredAt = asString(metadata?.responseCompletedAt) ?? record.createdAt;
          if (!lastDeliveredAt || deliveredAt > lastDeliveredAt) {
            lastDeliveredAt = deliveredAt;
          }
        } else {
          deliveryFailureCount += 1;
          if (record.resultStatus === "success") {
            generatedUndeliveredCount += 1;
          }
        }
        if (metadata?.stream === true) {
          streamCount += 1;
        }
        const readyMs = responseMetric(metadata?.responseReadyMs);
        if (readyMs !== undefined) {
          readyDurations.push(readyMs);
        }
        const responseMs = responseMetric(metadata?.responseCompletedMs);
        if (responseMs !== undefined) {
          responseDurations.push(responseMs);
        }
        totalInputTokens += record.inputTokens;
        totalCachedInputTokens += record.cachedInputTokens;
        totalOutputTokens += record.outputTokens;
        totalEstimatedCost += toNumber(record.estimatedCost);
        totalInternalCost += toNumber(record.internalCost);
        if (!lastRequestedAt || record.createdAt > lastRequestedAt) {
          lastRequestedAt = record.createdAt;
        }
      }

      const records = relevantEvents.slice(0, recordTake).map((record) => {
        const metadata = asRecord(record.metadata);
        const deliveryStatus = deliveryStatusFromUsage(record);
        return {
          id: record.id,
          sessionId: record.sessionId,
          model: record.model,
          requestedModel: asString(metadata?.requestedModel),
          requestedReasoningEffort: asString(metadata?.requestedReasoningEffort),
          stream: metadata?.stream === true,
          messageCount: Number(metadata?.messageCount ?? 0) || 0,
          inputTokens: record.inputTokens,
          cachedInputTokens: record.cachedInputTokens,
          outputTokens: record.outputTokens,
          totalTokens: usageTotalTokens(record.inputTokens, record.outputTokens),
          estimatedCost: record.estimatedCost,
          internalCost: record.internalCost,
          resultStatus: record.resultStatus,
          deliveryStatus,
          responseMode: asString(metadata?.responseMode) ?? (metadata?.stream === true ? "stream" : "non_stream"),
          errorMessage: asString(metadata?.errorMessage),
          agentModeId: asString(metadata?.agentModeId),
          knowledgeSetIds: asStringArray(metadata?.knowledgeSetIds),
          requestAborted: asBoolean(metadata?.requestAborted) === true,
          responseFinished: asBoolean(metadata?.responseFinished) === true,
          responseClosedBeforeFinish: asBoolean(metadata?.responseClosedBeforeFinish) === true,
          responseStatusCode: responseStatusCode(metadata?.responseStatusCode),
          responseStartedAt: asString(metadata?.responseStartedAt),
          responseReadyAt: asString(metadata?.responseReadyAt),
          responseCompletedAt: asString(metadata?.responseCompletedAt),
          responseStartedMs: responseMetric(metadata?.responseStartedMs),
          responseReadyMs: responseMetric(metadata?.responseReadyMs),
          responseCompletedMs: responseMetric(metadata?.responseCompletedMs),
          outputChars: Math.max(0, Math.trunc(toNumber(metadata?.outputChars))),
          createdAt: record.createdAt
        };
      });

      const totalRequests = relevantEvents.length;
      const totalTokens = usageTotalTokens(totalInputTokens, totalOutputTokens);

      return {
        summary: {
          windowDays,
          totalRequests,
          successCount,
          failureCount,
          successRate: roundRatio(successCount, totalRequests),
          deliverySuccessCount,
          deliveryFailureCount,
          deliverySuccessRate: roundRatio(deliverySuccessCount, totalRequests),
          generatedUndeliveredCount,
          streamCount,
          streamRate: roundRatio(streamCount, totalRequests),
          totalInputTokens,
          totalCachedInputTokens,
          totalOutputTokens,
          totalTokens,
          averageTokensPerRequest: totalRequests > 0 ? Math.round(totalTokens / totalRequests) : 0,
          averageReadyMs: average(readyDurations),
          p95ReadyMs: percentile(readyDurations, 0.95),
          averageResponseMs: average(responseDurations),
          p95ResponseMs: percentile(responseDurations, 0.95),
          totalEstimatedCost: formatFixed(totalEstimatedCost),
          totalInternalCost: formatFixed(totalInternalCost),
          lastRequestedAt,
          lastDeliveredAt
        },
        trends: [...trends.values()].map((item) => ({
          date: item.date,
          requestCount: item.requestCount,
          successCount: item.successCount,
          failureCount: item.failureCount,
          deliverySuccessCount: item.deliverySuccessCount,
          deliveryFailureCount: item.deliveryFailureCount,
          totalTokens: item.totalTokens,
          estimatedCost: formatFixed(item.estimatedCost),
          internalCost: formatFixed(item.internalCost)
        })),
        breakdowns: {
          byModel: buildUsageBreakdown(relevantEvents, (record) => record.model),
          byStatus: buildUsageBreakdown(relevantEvents, (record) => record.resultStatus, executionStatusLabel),
          byDelivery: buildUsageBreakdown(
            relevantEvents,
            (record) => deliveryStatusFromUsage(record),
            deliveryStatusLabel
          ),
          byTransport: buildUsageBreakdown(
            relevantEvents,
            (record) => (asRecord(record.metadata)?.stream === true ? "stream" : "non_stream"),
            (key) => (key === "stream" ? "Streaming" : "Non-stream")
          )
        },
        records
      };
    },

    async listBindings(input) {
      await requireAuthorizedInstance(input.instanceId, input.currentUserId);
      return mapBindingsResult(await repository.listBindings(input.instanceId));
    },

    async getPolicies(input) {
      const detail = await requireAuthorizedInstance(input.instanceId, input.currentUserId);
      if (!requiresInstancePolicy(detail.type)) {
        return buildPoliciesResult([]);
      }

      const policies = await options.policies.listAll();
      const items = policies
        .filter((policy) => policy.resourceType === integrationPolicyResourceType && policy.resourceId === detail.id)
        .map((policy) => ({
          subjectType: policy.subjectType,
          subjectId: policy.subjectId,
          effect: policy.effect
        }));
      return buildPoliciesResult(items);
    },

    async replacePolicies(input) {
      const instance = await requireAuthorizedInstance(input.instanceId, input.currentUserId);
      if (!requiresInstancePolicy(instance.type)) {
        await options.policies.replacePoliciesForResource({
          resourceType: integrationPolicyResourceType,
          resourceId: instance.id,
          policies: []
        });
        return buildPoliciesResult([]);
      }

      const policies = input.policies.map((policy) => ({
        organizationId: input.organizationId ?? instance.organizationId ?? undefined,
        subjectType: policy.subjectType,
        subjectId: policy.subjectId.trim(),
        resourceType: integrationPolicyResourceType,
        resourceId: instance.id,
        effect: policy.effect
      }));
      const next = await options.policies.replacePoliciesForResource({
        resourceType: integrationPolicyResourceType,
        resourceId: instance.id,
        policies
      });
      const items = next
        .filter((policy) => policy.resourceType === integrationPolicyResourceType && policy.resourceId === instance.id)
        .map((policy) => ({
          subjectType: policy.subjectType,
          subjectId: policy.subjectId,
          effect: policy.effect
        }));
      return buildPoliciesResult(items);
    },

    async replaceBindings(input) {
      await requireAuthorizedInstance(input.instanceId, input.currentUserId);
      return mapBindingsResult(
        await repository.replaceBindings(
          input.instanceId,
          input.bindings.map((binding) => ({
            targetType: binding.targetType.trim(),
            targetId: binding.targetId.trim(),
            bindingType: binding.bindingType.trim(),
            bindingPayload: binding.bindingPayload ?? {}
          }))
        )
      );
    }
  };
}

export type { IntegrationPolicyStore };
