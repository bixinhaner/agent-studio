import { describe, expect, it, vi } from "vitest";

import { createIntegrationCenterService } from "./service.js";

type FakeIntegrationInstance = {
  id: string;
  organizationId?: string | null;
  type: string;
  slug: string;
  name: string;
  description?: string | null;
  status: string;
  isSystemSingleton: boolean;
  createdAt: string;
  updatedAt: string;
};

function makeDate(value: string): Date {
  return new Date(value);
}

function buildService(seed?: {
  instances?: FakeIntegrationInstance[];
  configs?: Array<{ integrationInstanceId: string; config: Record<string, unknown> }>;
  secrets?: Array<{ integrationInstanceId: string; secretState: Record<string, unknown>; hasSecrets: boolean; rotatedByUserId?: string | null; rotatedAt?: Date | null }>;
  validations?: Array<{ integrationInstanceId: string; triggerType: string; status: string; summary?: unknown; detail?: unknown; triggeredByUserId?: string | null; createdAt?: Date }>;
  bindings?: Array<{ integrationInstanceId: string; targetType: string; targetId: string; bindingType: string; bindingPayload: unknown }>;
  policies?: Array<{
    id: string;
    subjectType: "role" | "department" | "user";
    subjectId: string;
    resourceType: string;
    resourceId: string;
    effect: "allow" | "deny";
    organizationId?: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
}) {
  const instances = seed?.instances ? [...seed.instances] : [];
  const configs = seed?.configs ? [...seed.configs] : [];
  const secrets = seed?.secrets ? [...seed.secrets] : [];
  const validations = seed?.validations ? [...seed.validations] : [];
  const bindings = seed?.bindings ? [...seed.bindings] : [];
  const policies = seed?.policies ? [...seed.policies] : [];

  const db = {
    integrationInstance: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => instances.find((item) => item.id === where.id) ?? null),
      findMany: vi.fn(async ({ where }: { where?: { type?: string } } = {}) =>
        instances.filter((item) => (where?.type ? item.type === where.type : true))),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const now = new Date().toISOString();
        const row: FakeIntegrationInstance = {
          id: String(data.id ?? `integration-instance-${instances.length + 1}`),
          organizationId: (data.organizationId as string | null | undefined) ?? null,
          type: String(data.type ?? ""),
          slug: String(data.slug ?? ""),
          name: String(data.name ?? ""),
          description: (data.description as string | null | undefined) ?? null,
          status: String(data.status ?? "draft"),
          isSystemSingleton: Boolean(data.isSystemSingleton),
          createdAt: now,
          updatedAt: now
        };
        instances.push(row);
        return row as never;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = instances.find((item) => item.id === where.id);
        if (!row) throw new Error("integration instance not found");
        Object.assign(row, data);
        row.updatedAt = new Date().toISOString();
        return row as never;
      })
    },
    integrationInstanceConfig: {
      findUnique: vi.fn(async ({ where }: { where: { integrationInstanceId: string } }) =>
        configs.find((item) => item.integrationInstanceId === where.integrationInstanceId) ?? null),
      upsert: vi.fn(async ({ where, create, update }: { where: { integrationInstanceId: string }; create: { integrationInstanceId: string; config: Record<string, unknown> }; update: { config: Record<string, unknown> } }) => {
        const existing = configs.find((item) => item.integrationInstanceId === where.integrationInstanceId);
        if (existing) {
          existing.config = update.config;
          return existing as never;
        }
        const created = { ...create };
        configs.push(created);
        return created as never;
      })
    },
    integrationInstanceSecret: {
      findUnique: vi.fn(async ({ where }: { where: { integrationInstanceId: string } }) =>
        secrets.find((item) => item.integrationInstanceId === where.integrationInstanceId) ?? null),
      upsert: vi.fn(async ({ where, create, update }: { where: { integrationInstanceId: string }; create: { integrationInstanceId: string; hasSecrets: boolean; secretState: Record<string, unknown>; rotatedAt: Date | null; rotatedByUserId: string | null }; update: { hasSecrets: boolean; secretState: Record<string, unknown>; rotatedAt: Date | null; rotatedByUserId: string | null } }) => {
        const existing = secrets.find((item) => item.integrationInstanceId === where.integrationInstanceId);
        if (existing) {
          Object.assign(existing, update);
          return existing as never;
        }
        const created = { ...create };
        secrets.push(created);
        return created as never;
      })
    },
    integrationValidationRun: {
      findMany: vi.fn(async ({ where }: { where: { integrationInstanceId: string } }) =>
        validations.filter((item) => item.integrationInstanceId === where.integrationInstanceId)),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `validation-${validations.length + 1}`,
          integrationInstanceId: String(data.integrationInstanceId),
          triggerType: String(data.triggerType),
          status: String(data.status),
          summary: data.summary,
          detail: data.detail,
          triggeredByUserId: (data.triggeredByUserId as string | null | undefined) ?? null,
          createdAt: new Date()
        };
        validations.push(row);
        return row as never;
      })
    },
    integrationBindingRecord: {
      findMany: vi.fn(async ({ where }: { where: { integrationInstanceId: string } }) =>
        bindings.filter((item) => item.integrationInstanceId === where.integrationInstanceId)),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `binding-${bindings.length + 1}`,
          integrationInstanceId: String(data.integrationInstanceId),
          targetType: String(data.targetType),
          targetId: String(data.targetId),
          bindingType: String(data.bindingType),
          bindingPayload: data.bindingPayload
        };
        bindings.push(row);
        return row as never;
      })
    },
    resourcePolicy: {
      findMany: vi.fn(async ({ where }: { where?: { resourceType?: string; resourceId?: string } } = {}) =>
        policies.filter((item) =>
          (where?.resourceType ? item.resourceType === where.resourceType : true) &&
          (where?.resourceId ? item.resourceId === where.resourceId : true)
        )),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `policy-${policies.length + 1}`,
          organizationId: (data.organizationId as string | null | undefined) ?? null,
          subjectType: data.subjectType as "role" | "department" | "user",
          subjectId: String(data.subjectId),
          resourceType: data.resourceType as string,
          resourceId: String(data.resourceId),
          effect: data.effect as "allow" | "deny",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        policies.push(row);
        return row as never;
      })
    },
    $transaction: async <T>(callback: (tx: never) => Promise<T>) => callback(db as never)
  } as never;

  const roleIdsByUser = new Map<string, string[]>([
    ["admin-1", ["role-support-admin"]],
    ["other-user", ["role-viewer"]]
  ]);
  const departmentIdsByUser = new Map<string, string[]>([
    ["admin-1", ["dept-support"]],
    ["other-user", ["dept-ops"]]
  ]);

    return {
      service: createIntegrationCenterService({
        db,
        policies: {
        listAll: async () => policies.map((item) => ({ ...item })),
        replacePoliciesForResource: async ({ resourceType, resourceId, policies: nextPolicies }) => {
          const kept = policies.filter((item) => item.resourceType !== resourceType || item.resourceId !== resourceId);
          policies.splice(0, policies.length, ...kept);
          for (const policy of nextPolicies) {
            policies.push({
              id: `policy-${policies.length + 1}`,
              organizationId: policy.organizationId ?? null,
              subjectType: policy.subjectType,
              subjectId: policy.subjectId,
              resourceType: resourceType as string,
              resourceId,
              effect: policy.effect,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            });
          }
          return policies
            .filter((item) => item.resourceType === resourceType && item.resourceId === resourceId)
            .map((item) => ({ ...item }));
          }
      },
      policyService: {
        async filterAllowedResources(input) {
          const subjectIds = new Set<string>([
            ...(roleIdsByUser.get(input.userId) ?? []),
            ...(departmentIdsByUser.get(input.userId) ?? []),
            input.userId
          ]);
          return input.candidateIds.filter((candidateId) =>
            policies.some(
              (policy) =>
                policy.resourceType === input.resourceType &&
                policy.resourceId === candidateId &&
                policy.effect === "allow" &&
                subjectIds.has(policy.subjectId)
            )
          );
        }
      },
      accessResolver: {
        getRoleIdsForUser: async (userId: string) => roleIdsByUser.get(userId) ?? [],
        getDepartmentIdsForUser: async (userId: string) => departmentIdsByUser.get(userId) ?? []
      }
    }),
    policies
  };
}

describe("createIntegrationCenterService", () => {
  it("filters unauthorized integration instances from list and denies detail access", async () => {
    const { service } = buildService({
      instances: [
        {
          id: "int-zendesk-1",
          type: "zendesk",
          slug: "zendesk-main",
          name: "Zendesk Main",
          description: "primary",
          status: "active",
          isSystemSingleton: false,
          createdAt: makeDate("2026-03-29T00:00:00.000Z").toISOString(),
          updatedAt: makeDate("2026-03-29T00:00:00.000Z").toISOString()
        },
        {
          id: "int-zendesk-2",
          type: "zendesk",
          slug: "zendesk-secret",
          name: "Zendesk Secret",
          description: "restricted",
          status: "active",
          isSystemSingleton: false,
          createdAt: makeDate("2026-03-29T01:00:00.000Z").toISOString(),
          updatedAt: makeDate("2026-03-29T01:00:00.000Z").toISOString()
        }
      ],
      policies: [
        {
          id: "policy-1",
          subjectType: "role",
          subjectId: "role-support-admin",
          resourceType: "integration_instance",
          resourceId: "int-zendesk-1",
          effect: "allow",
          createdAt: "2026-03-30T10:00:00.000Z",
          updatedAt: "2026-03-30T10:00:00.000Z"
        }
      ]
    });

    const list = await service.listInstances({ currentUserId: "admin-1", type: "zendesk" });
    expect(list.items.map((item) => item.id)).toEqual(["int-zendesk-1"]);
    await expect(
      service.getInstanceDetail({ currentUserId: "admin-1", instanceId: "int-zendesk-2" })
    ).rejects.toThrow(/access denied/i);
  });

  it("rejects secret-like config keys and keeps secrets in secretState", async () => {
    const { service } = buildService();

    await expect(
      service.saveInstance({
        currentUserId: "admin-1",
        payload: {
          type: "openai_codex",
          slug: "openai-primary",
          name: "OpenAI Primary",
          status: "active",
          config: {
            defaultModel: "gpt-5.4-mini",
            apiKey: "sk-test"
          },
          secretState: {
            apiKey: "sk-test"
          }
        }
      })
    ).rejects.toThrow(/secret/i);

    const detail = await service.saveInstance({
      currentUserId: "admin-1",
      payload: {
        type: "openai_codex",
        slug: "openai-primary",
        name: "OpenAI Primary",
        status: "active",
        config: {
          defaultModel: "gpt-5.4-mini"
        },
        secretState: {
          apiKey: "sk-test"
        }
      }
    });

    expect(detail.config).toMatchObject({ defaultModel: "gpt-5.4-mini" });
    expect(detail.secretState.hasSecrets).toBe(true);
    expect(JSON.stringify(detail.config)).not.toContain("sk-test");
  });
});
