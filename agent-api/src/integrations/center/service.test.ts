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

function buildService(
  seed?: {
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
  },
  failure?: {
    failOnConfigUpsert?: boolean;
    failOnSecretUpsert?: boolean;
    failOnResourcePolicyCreate?: boolean;
  }
) {
  type DbState = {
    instances: FakeIntegrationInstance[];
    configs: Array<{ integrationInstanceId: string; config: Record<string, unknown> }>;
    secrets: Array<{ integrationInstanceId: string; secretState: Record<string, unknown>; hasSecrets: boolean; rotatedByUserId?: string | null; rotatedAt?: Date | null }>;
    validations: Array<{ integrationInstanceId: string; triggerType: string; status: string; summary?: unknown; detail?: unknown; triggeredByUserId?: string | null; createdAt?: Date }>;
    bindings: Array<{ integrationInstanceId: string; targetType: string; targetId: string; bindingType: string; bindingPayload: unknown }>;
    policies: Array<{
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
  };

  const state: DbState = {
    instances: seed?.instances ? structuredClone(seed.instances) : [],
    configs: seed?.configs ? structuredClone(seed.configs) : [],
    secrets: seed?.secrets ? structuredClone(seed.secrets) : [],
    validations: seed?.validations ? structuredClone(seed.validations) : [],
    bindings: seed?.bindings ? structuredClone(seed.bindings) : [],
    policies: seed?.policies ? structuredClone(seed.policies) : []
  };

  function makeDb(currentState: DbState): any {
    const db = {
      integrationInstance: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => currentState.instances.find((item) => item.id === where.id) ?? null),
        findMany: vi.fn(async ({ where }: { where?: { type?: string } } = {}) =>
          currentState.instances.filter((item) => (where?.type ? item.type === where.type : true))),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const now = new Date().toISOString();
          const row: FakeIntegrationInstance = {
            id: String(data.id ?? `integration-instance-${currentState.instances.length + 1}`),
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
          currentState.instances.push(row);
          return row as never;
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = currentState.instances.find((item) => item.id === where.id);
          if (!row) throw new Error("integration instance not found");
          Object.assign(row, data);
          row.updatedAt = new Date().toISOString();
          return row as never;
        })
      },
      integrationInstanceConfig: {
        findUnique: vi.fn(async ({ where }: { where: { integrationInstanceId: string } }) =>
          currentState.configs.find((item) => item.integrationInstanceId === where.integrationInstanceId) ?? null),
        upsert: vi.fn(async ({ where, create, update }: { where: { integrationInstanceId: string }; create: { integrationInstanceId: string; config: Record<string, unknown> }; update: { config: Record<string, unknown> } }) => {
          if (failure?.failOnConfigUpsert) {
            throw new Error("config write failed");
          }
          const existing = currentState.configs.find((item) => item.integrationInstanceId === where.integrationInstanceId);
          if (existing) {
            existing.config = update.config;
            return existing as never;
          }
          const created = { ...create };
          currentState.configs.push(created);
          return created as never;
        })
      },
      integrationInstanceSecret: {
        findUnique: vi.fn(async ({ where }: { where: { integrationInstanceId: string } }) =>
          currentState.secrets.find((item) => item.integrationInstanceId === where.integrationInstanceId) ?? null),
        upsert: vi.fn(async ({ where, create, update }: { where: { integrationInstanceId: string }; create: { integrationInstanceId: string; hasSecrets: boolean; secretState: Record<string, unknown>; rotatedAt: Date | null; rotatedByUserId: string | null }; update: { hasSecrets: boolean; secretState: Record<string, unknown>; rotatedAt: Date | null; rotatedByUserId: string | null } }) => {
          if (failure?.failOnSecretUpsert) {
            throw new Error("secret write failed");
          }
          const existing = currentState.secrets.find((item) => item.integrationInstanceId === where.integrationInstanceId);
          if (existing) {
            Object.assign(existing, update);
            return existing as never;
          }
          const created = { ...create };
          currentState.secrets.push(created);
          return created as never;
        })
      },
      integrationValidationRun: {
        findMany: vi.fn(async ({ where }: { where: { integrationInstanceId: string } }) =>
          currentState.validations.filter((item) => item.integrationInstanceId === where.integrationInstanceId)),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = {
            id: `validation-${currentState.validations.length + 1}`,
            integrationInstanceId: String(data.integrationInstanceId),
            triggerType: String(data.triggerType),
            status: String(data.status),
            summary: data.summary,
            detail: data.detail,
            triggeredByUserId: (data.triggeredByUserId as string | null | undefined) ?? null,
            createdAt: new Date()
          };
          currentState.validations.push(row);
          return row as never;
        })
      },
      integrationBindingRecord: {
        findMany: vi.fn(async ({ where }: { where: { integrationInstanceId: string } }) =>
          currentState.bindings.filter((item) => item.integrationInstanceId === where.integrationInstanceId)),
        deleteMany: vi.fn(async () => ({ count: 0 })),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = {
            id: `binding-${currentState.bindings.length + 1}`,
            integrationInstanceId: String(data.integrationInstanceId),
            targetType: String(data.targetType),
            targetId: String(data.targetId),
            bindingType: String(data.bindingType),
            bindingPayload: data.bindingPayload
          };
          currentState.bindings.push(row);
          return row as never;
        })
      },
      resourcePolicy: {
        findMany: vi.fn(async ({ where }: { where?: { resourceType?: string; resourceId?: string } } = {}) =>
          currentState.policies.filter((item) =>
            (where?.resourceType ? item.resourceType === where.resourceType : true) &&
            (where?.resourceId ? item.resourceId === where.resourceId : true)
          )),
        deleteMany: vi.fn(async () => ({ count: 0 })),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          if (failure?.failOnResourcePolicyCreate) {
            throw new Error("policy write failed");
          }
          const row = {
            id: `policy-${currentState.policies.length + 1}`,
            organizationId: (data.organizationId as string | null | undefined) ?? null,
            subjectType: data.subjectType as "role" | "department" | "user",
            subjectId: String(data.subjectId),
            resourceType: data.resourceType as string,
            resourceId: String(data.resourceId),
            effect: data.effect as "allow" | "deny",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          currentState.policies.push(row);
          return row as never;
        })
      },
      $transaction: async <T>(callback: (tx: never) => Promise<T>) => {
        const txState: DbState = structuredClone(currentState);
        const txDb = makeDb(txState);
        try {
          const result = await callback(txDb as never);
          currentState.instances = txState.instances;
          currentState.configs = txState.configs;
          currentState.secrets = txState.secrets;
          currentState.validations = txState.validations;
          currentState.bindings = txState.bindings;
          currentState.policies = txState.policies;
          return result;
        } catch (error) {
          throw error;
        }
      }
    } as never;
    return db;
  }

  const db = makeDb(state);
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
        listAll: async () => state.policies.map((item) => ({ ...item })),
        replacePoliciesForResource: async ({ resourceType, resourceId, policies: nextPolicies }) => {
          const kept = state.policies.filter((item) => item.resourceType !== resourceType || item.resourceId !== resourceId);
          state.policies.splice(0, state.policies.length, ...kept);
          for (const policy of nextPolicies) {
            state.policies.push({
              id: `policy-${state.policies.length + 1}`,
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
          return state.policies
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
            state.policies.some(
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
      },
      adapters: {
        dingtalk: {
          async validate() {
            return {
              status: "success",
              summary: "DingTalk credential validation succeeded",
              detail: { validated: "credentials" }
            };
          }
        },
        openai_codex: {
          async validate(config) {
            return {
              status: "success",
              summary: "OpenAI/Codex provider validation succeeded",
              detail: {
                validated: "provider",
                defaultModel: config.defaultModel,
                defaultReasoningEffort: config.defaultReasoningEffort
              }
            };
          }
        }
      }
    }),
    state
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

  it("finds authorized Zendesk instances by slug for compatibility lookups", async () => {
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

    const found = await service.findInstanceBySlug({
      currentUserId: "admin-1",
      type: "zendesk",
      slug: "zendesk-main"
    });

    expect(found).toMatchObject({
      id: "int-zendesk-1",
      slug: "zendesk-main",
      type: "zendesk"
    });
  });

  it("redacts secret-like config keys from list and detail reads", async () => {
    const { service } = buildService({
      instances: [
        {
          id: "int-openai-1",
          type: "openai_codex",
          slug: "openai-primary",
          name: "OpenAI Primary",
          description: null,
          status: "active",
          isSystemSingleton: true,
          createdAt: makeDate("2026-03-29T00:00:00.000Z").toISOString(),
          updatedAt: makeDate("2026-03-29T00:00:00.000Z").toISOString()
        }
      ],
      configs: [
        {
          integrationInstanceId: "int-openai-1",
          config: {
            defaultModel: "gpt-5.4-mini",
            apiKey: "sk-legacy",
            nested: {
              clientSecret: "secret-value",
              publicValue: "ok"
            }
          }
        }
      ],
      policies: [
        {
          id: "policy-1",
          subjectType: "role",
          subjectId: "role-support-admin",
          resourceType: "integration_instance",
          resourceId: "int-openai-1",
          effect: "allow",
          createdAt: "2026-03-30T10:00:00.000Z",
          updatedAt: "2026-03-30T10:00:00.000Z"
        }
      ]
    });

    const list = await service.listInstances({ currentUserId: "admin-1", type: "openai_codex" });
    expect(list.items[0].config).toMatchObject({
      defaultModel: "gpt-5.4-mini",
      nested: { publicValue: "ok" }
    });
    expect(JSON.stringify(list.items[0].config)).not.toContain("sk-legacy");
    expect(JSON.stringify(list.items[0].config)).not.toContain("secret-value");

    const detail = await service.getInstanceDetail({ currentUserId: "admin-1", instanceId: "int-openai-1" });
    expect(detail.config).toMatchObject({
      defaultModel: "gpt-5.4-mini",
      nested: { publicValue: "ok" }
    });
    expect(JSON.stringify(detail.config)).not.toContain("sk-legacy");
    expect(JSON.stringify(detail.instance.config)).not.toContain("secret-value");
  });

  it("redacts secret-like config keys nested inside arrays from reads", async () => {
    const { service } = buildService({
      instances: [
        {
          id: "int-openai-array",
          type: "openai_codex",
          slug: "openai-array",
          name: "OpenAI Array",
          description: null,
          status: "active",
          isSystemSingleton: true,
          createdAt: makeDate("2026-03-29T00:00:00.000Z").toISOString(),
          updatedAt: makeDate("2026-03-29T00:00:00.000Z").toISOString()
        }
      ],
      configs: [
        {
          integrationInstanceId: "int-openai-array",
          config: {
            endpoints: [
              { apiKey: "sk-array", url: "https://api.example.com" },
              { headers: [{ clientSecret: "nested-secret" }] }
            ],
            publicValue: "ok"
          }
        }
      ],
      policies: [
        {
          id: "policy-1",
          subjectType: "role",
          subjectId: "role-support-admin",
          resourceType: "integration_instance",
          resourceId: "int-openai-array",
          effect: "allow",
          createdAt: "2026-03-30T10:00:00.000Z",
          updatedAt: "2026-03-30T10:00:00.000Z"
        }
      ]
    });

    const detail = await service.getInstanceDetail({ currentUserId: "admin-1", instanceId: "int-openai-array" });
    expect(detail.config).toMatchObject({
      endpoints: [{ url: "https://api.example.com" }, { headers: [{}] }],
      publicValue: "ok"
    });
    expect(JSON.stringify(detail.config)).not.toContain("sk-array");
    expect(JSON.stringify(detail.config)).not.toContain("nested-secret");
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

  it("rejects secret-like config keys nested inside arrays on write", async () => {
    const { service, state } = buildService();

    await expect(
      service.saveInstance({
        currentUserId: "admin-1",
        payload: {
          type: "openai_codex",
          slug: "openai-array",
          name: "OpenAI Array",
          status: "active",
          config: {
            endpoints: [
              {
                url: "https://api.example.com",
                apiKey: "sk-array"
              },
              {
                nested: [{ clientSecret: "nested-secret" }]
              }
            ]
          },
          secretState: {
            apiKey: "sk-array"
          }
        }
      })
    ).rejects.toThrow(/secret/i);

    expect(state.instances).toHaveLength(0);
    expect(state.configs).toHaveLength(0);
    expect(state.secrets).toHaveLength(0);
    expect(state.policies).toHaveLength(0);
  });

  it("rolls back create writes when a later policy write fails", async () => {
    const { service, state } = buildService(undefined, { failOnResourcePolicyCreate: true });

    await expect(
      service.saveInstance({
        currentUserId: "admin-1",
        payload: {
          type: "openai_codex",
          slug: "openai-atomic",
          name: "OpenAI Atomic",
          status: "active",
          config: {
            defaultModel: "gpt-5.4-mini"
          },
          secretState: {
            apiKey: "sk-atomic"
          }
        }
      })
    ).rejects.toThrow(/policy write failed/i);

    expect(state.instances).toHaveLength(0);
    expect(state.configs).toHaveLength(0);
    expect(state.secrets).toHaveLength(0);
    expect(state.policies).toHaveLength(0);
  });

  it("rolls back update writes when a later secret write fails", async () => {
    const { service, state } = buildService(
      {
        instances: [
          {
            id: "int-openai-update",
            type: "openai_codex",
            slug: "openai-update",
            name: "OpenAI Update",
            description: null,
            status: "active",
            isSystemSingleton: true,
            createdAt: makeDate("2026-03-29T00:00:00.000Z").toISOString(),
            updatedAt: makeDate("2026-03-29T00:00:00.000Z").toISOString()
          }
        ],
        configs: [
          {
            integrationInstanceId: "int-openai-update",
            config: {
              defaultModel: "gpt-5.4-mini"
            }
          }
        ],
        policies: [
          {
            id: "policy-1",
            subjectType: "role",
            subjectId: "role-support-admin",
            resourceType: "integration_instance",
            resourceId: "int-openai-update",
            effect: "allow",
            createdAt: "2026-03-30T10:00:00.000Z",
            updatedAt: "2026-03-30T10:00:00.000Z"
          }
        ]
      },
      { failOnSecretUpsert: true }
    );

    await expect(
      service.saveInstance({
        currentUserId: "admin-1",
        instanceId: "int-openai-update",
        payload: {
          name: "OpenAI Update v2",
          config: {
            defaultModel: "gpt-5.4-pro"
          },
          secretState: {
            apiKey: "sk-update"
          }
        }
      })
    ).rejects.toThrow(/secret write failed/i);

    expect(state.instances[0]).toMatchObject({
      name: "OpenAI Update",
      status: "active"
    });
    expect(state.configs[0].config).toMatchObject({
      defaultModel: "gpt-5.4-mini"
    });
    expect(state.secrets).toHaveLength(0);
  });

  it("validates dingtalk credentials with the type-specific adapter and records validation history", async () => {
    const { service, state } = buildService({
      instances: [
        {
          id: "int-dingtalk-main",
          type: "dingtalk",
          slug: "corp-main",
          name: "Corp Main",
          description: null,
          status: "active",
          isSystemSingleton: true,
          createdAt: makeDate("2026-03-29T00:00:00.000Z").toISOString(),
          updatedAt: makeDate("2026-03-29T00:00:00.000Z").toISOString()
        }
      ],
      configs: [
        {
          integrationInstanceId: "int-dingtalk-main",
          config: {
            clientId: "ding-client-id",
            redirectUri: "https://agent.example.com/auth/dingtalk/callback",
            scope: "openid"
          }
        }
      ],
      secrets: [
        {
          integrationInstanceId: "int-dingtalk-main",
          hasSecrets: true,
          secretState: {
            clientSecret: "ding-client-secret"
          },
          rotatedByUserId: "admin-1",
          rotatedAt: makeDate("2026-03-29T00:00:00.000Z")
        }
      ],
      policies: [
        {
          id: "policy-1",
          subjectType: "role",
          subjectId: "role-support-admin",
          resourceType: "integration_instance",
          resourceId: "int-dingtalk-main",
          effect: "allow",
          createdAt: "2026-03-30T10:00:00.000Z",
          updatedAt: "2026-03-30T10:00:00.000Z"
        }
      ]
    });

    const result = await service.validateInstance({
      currentUserId: "admin-1",
      instanceId: "int-dingtalk-main"
    });

    expect(result.validation.status).toBe("success");
    expect(String(result.validation.summary)).toMatch(/DingTalk credential validation succeeded/i);
    expect(state.validations.at(-1)?.integrationInstanceId).toBe("int-dingtalk-main");
  });

  it("validates openai codex provider connectivity with the type-specific adapter", async () => {
    const { service, state } = buildService({
      instances: [
        {
          id: "int-openai-main",
          type: "openai_codex",
          slug: "openai-main",
          name: "OpenAI Main",
          description: null,
          status: "active",
          isSystemSingleton: true,
          createdAt: makeDate("2026-03-29T00:00:00.000Z").toISOString(),
          updatedAt: makeDate("2026-03-29T00:00:00.000Z").toISOString()
        }
      ],
      configs: [
        {
          integrationInstanceId: "int-openai-main",
          config: {
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-5.4-mini",
            defaultReasoningEffort: "medium"
          }
        }
      ],
      secrets: [
        {
          integrationInstanceId: "int-openai-main",
          hasSecrets: true,
          secretState: {
            apiKey: "sk-test"
          },
          rotatedByUserId: "admin-1",
          rotatedAt: makeDate("2026-03-29T00:00:00.000Z")
        }
      ],
      policies: [
        {
          id: "policy-1",
          subjectType: "role",
          subjectId: "role-support-admin",
          resourceType: "integration_instance",
          resourceId: "int-openai-main",
          effect: "allow",
          createdAt: "2026-03-30T10:00:00.000Z",
          updatedAt: "2026-03-30T10:00:00.000Z"
        }
      ]
    });

    const result = await service.validateInstance({
      currentUserId: "admin-1",
      instanceId: "int-openai-main"
    });

    expect(result.validation.status).toBe("success");
    expect(String(result.validation.summary)).toMatch(/OpenAI\/Codex provider validation succeeded/i);
    expect(state.validations.at(-1)?.integrationInstanceId).toBe("int-openai-main");
  });
});
