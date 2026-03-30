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
          resourceType: String(data.resourceType),
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

  return createIntegrationCenterService({
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
        return policies.filter((item) => item.resourceType === resourceType && item.resourceId === resourceId).map((item) => ({ ...item }));
      }
    }
  });
}

describe("createIntegrationCenterService", () => {
  it("returns a unified instance detail with validation history and policies", async () => {
    const service = buildService({
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
        }
      ],
      configs: [{ integrationInstanceId: "int-zendesk-1", config: { zendeskBaseUrl: "https://example.zendesk.com" } }],
      validations: [
        {
          integrationInstanceId: "int-zendesk-1",
          triggerType: "manual",
          status: "success",
          summary: { ok: true },
          detail: { message: "connected" },
          triggeredByUserId: "admin-1",
          createdAt: makeDate("2026-03-30T10:00:00.000Z")
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

    const detail = await service.getInstanceDetail({ instanceId: "int-zendesk-1", currentUserId: "admin-1" });

    expect(detail.instance).toMatchObject({
      id: "int-zendesk-1",
      type: "zendesk",
      name: "Zendesk Main"
    });
    expect(detail.validationHistory.items).toHaveLength(1);
    expect(detail.policies.summary.allow.roles).toContain("role-support-admin");
  });

  it("saves configuration and records a validation run for an integration instance", async () => {
    const service = buildService({
      instances: [
        {
          id: "int-openai-1",
          type: "openai_codex",
          slug: "openai-primary",
          name: "OpenAI Primary",
          description: null,
          status: "draft",
          isSystemSingleton: true,
          createdAt: makeDate("2026-03-29T00:00:00.000Z").toISOString(),
          updatedAt: makeDate("2026-03-29T00:00:00.000Z").toISOString()
        }
      ]
    });

    const saved = await service.saveInstance({
      currentUserId: "admin-1",
      instanceId: "int-openai-1",
      payload: {
        name: "OpenAI Platform",
        status: "active",
        config: { apiKey: "sk-test", defaultModel: "gpt-5.4-mini" }
      }
    });
    const validation = await service.validateInstance({
      currentUserId: "admin-1",
      instanceId: "int-openai-1"
    });

    expect(saved.instance).toMatchObject({
      id: "int-openai-1",
      name: "OpenAI Platform",
      status: "active"
    });
    expect(validation.validation.status).toBe("success");
    expect(validation.detail.validationHistory.items[0].triggerType).toBe("manual");
  });
});
