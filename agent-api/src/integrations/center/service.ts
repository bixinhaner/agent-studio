import { IntegrationInstanceRepository, type IntegrationInstanceRepositoryDb, type IntegrationValidationRecord } from "../../persistence/integration-instance-repository.js";
import {
  createEmptyPolicySummary,
  collectSecretLikeConfigKeys,
  integrationPolicyResourceType,
  type IntegrationDetail,
  type IntegrationInstanceBaseInput,
  type IntegrationInstanceUpdateInput,
  type IntegrationListItem,
  type IntegrationPoliciesResult,
  type IntegrationPolicyInput,
  type IntegrationPolicySummary,
  type IntegrationTriggerType,
  type IntegrationValidationItem,
  type IntegrationValidationResult,
  sanitizeIntegrationConfigForRead
} from "./types.js";
import type { PolicyService } from "../../resources/policy-service.js";

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

type ValidationOutcome = {
  status: "success" | "failed";
  summary: unknown;
  detail: unknown;
};

export type IntegrationCenterService = {
  listInstances(input: { currentUserId: string; type?: string }): Promise<{ items: IntegrationListItem[] }>;
  getInstanceDetail(input: { currentUserId: string; instanceId: string }): Promise<IntegrationDetail>;
  saveInstance(input: {
    currentUserId: string;
    instanceId?: string;
    payload: IntegrationInstanceBaseInput | IntegrationInstanceUpdateInput;
  }): Promise<IntegrationDetail>;
  validateInstance(input: { currentUserId: string; instanceId: string }): Promise<IntegrationValidationResult>;
  listValidationHistory(input: { currentUserId: string; instanceId: string }): Promise<{ items: IntegrationValidationItem[] }>;
  getPolicies(input: { currentUserId: string; instanceId: string }): Promise<IntegrationPoliciesResult>;
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

function normalizeConfigValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function assertConfigIsSafe(config: unknown): Record<string, unknown> {
  const normalized = normalizeConfigValue(config);
  const secretLikeKeys = collectSecretLikeConfigKeys(normalized);
  if (secretLikeKeys.length > 0) {
    throw new Error(`config must not contain secret-like keys: ${[...new Set(secretLikeKeys)].join(", ")}`);
  }
  return normalized;
}

function normalizeValidationSummary(type: string, config: Record<string, unknown>): ValidationOutcome {
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

function createValidationOutcome(instanceType: string, config: Record<string, unknown>): ValidationOutcome {
  return normalizeValidationSummary(instanceType, config);
}

export function createIntegrationCenterService(options: {
  db: IntegrationCenterDb;
  policies: IntegrationPolicyStore;
  policyService: Pick<PolicyService, "filterAllowedResources">;
  accessResolver: AccessResolver;
}): IntegrationCenterService {
  const repository = new IntegrationInstanceRepository(options.db);

  async function getAccessContext(userId: string): Promise<{ roleIds: string[]; departmentIds: string[] }> {
    return {
      roleIds: await options.accessResolver.getRoleIdsForUser(userId),
      departmentIds: await options.accessResolver.getDepartmentIdsForUser(userId)
    };
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
    const allowed = await filterAuthorizedInstanceIds(currentUserId, [detail.id]);
    if (!allowed.includes(detail.id)) {
      throw new Error("integration instance access denied");
    }
    return detail;
  }

  async function readDetail(instanceId: string, currentUserId: string): Promise<IntegrationDetail> {
    const [detail, policies] = await Promise.all([
      requireAuthorizedInstance(instanceId, currentUserId),
      options.policies.listAll()
    ]);

    const instancePolicies = policies
      .filter(
        (policy) => policy.resourceType === integrationPolicyResourceType && policy.resourceId === detail.id
      )
      .map((policy) => ({
        subjectType: policy.subjectType,
        subjectId: policy.subjectId,
        effect: policy.effect
      }));

    return mapInstanceDetail(detail, buildPoliciesResult(instancePolicies));
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
        await db.integrationInstanceSecret.upsert({
          where: { integrationInstanceId: instanceId },
          create: {
            integrationInstanceId: instanceId,
            hasSecrets: true,
            secretState: payload.secretState,
            rotatedAt: new Date(),
            rotatedByUserId: currentUserId
          },
          update: {
            hasSecrets: true,
            secretState: payload.secretState,
            rotatedAt: new Date(),
            rotatedByUserId: currentUserId
          }
        });
      }
    }
  }

  async function createCreatorPolicy(
    db: Pick<IntegrationCenterTx, "resourcePolicy">,
    created: { id: string; organizationId?: string | null },
    currentUserId: string
  ): Promise<void> {
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
      const allowedIds = new Set(await filterAuthorizedInstanceIds(input.currentUserId, items.map((item) => item.id)));
      return {
        items: items.filter((item) => allowedIds.has(item.id))
      };
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

      const validationConfig = normalizeConfigValue(detail.config);
      const outcome = createValidationOutcome(detail.type, validationConfig);
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
    },

    async listValidationHistory(input) {
      await requireAuthorizedInstance(input.instanceId, input.currentUserId);
      const items = await repository.listValidationHistory(input.instanceId);
      return {
        items: items.map(mapValidation)
      };
    },

    async getPolicies(input) {
      const detail = await requireAuthorizedInstance(input.instanceId, input.currentUserId);

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
    }
  };
}

export type { IntegrationPolicyStore };
