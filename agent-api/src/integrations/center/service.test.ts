import { describe, expect, it, vi } from "vitest";

import { createIntegrationCenterService, type IntegrationCenterDb } from "./service.js";

type IntegrationInstanceRow = {
  id: string;
  organizationId: string | null;
  type: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  isSystemSingleton: boolean;
  createdAt: string;
  updatedAt: string;
};

type ConfigRow = {
  id: string;
  integrationInstanceId: string;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type SecretRow = {
  id: string;
  integrationInstanceId: string;
  hasSecrets: boolean;
  secretState: Record<string, unknown>;
  rotatedAt: string | null;
  rotatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

type TestIntegrationCenterDb = IntegrationCenterDb & {
  resourcePolicy: {
    create: ReturnType<typeof vi.fn>;
  };
};

function createIntegrationCenterDbMock() {
  const now = "2026-05-18T10:00:00.000Z";
  let instance: IntegrationInstanceRow = {
    id: "zendesk-1",
    organizationId: null,
    type: "zendesk",
    slug: "zendesk-main",
    name: "Zendesk",
    description: null,
    status: "active",
    isSystemSingleton: false,
    createdAt: now,
    updatedAt: now
  };
  let config: ConfigRow | null = {
    id: "config-1",
    integrationInstanceId: instance.id,
    config: { enabled: true, zendeskBaseUrl: "https://example.zendesk.com" },
    createdAt: now,
    updatedAt: now
  };
  let secret: SecretRow | null = {
    id: "secret-1",
    integrationInstanceId: instance.id,
    hasSecrets: true,
    secretState: {
      zendeskApiToken: "old-token",
      webhookSigningSecret: "old-secret"
    },
    rotatedAt: now,
    rotatedByUserId: "user-0",
    createdAt: now,
    updatedAt: now
  };

  const db = {} as TestIntegrationCenterDb;
  Object.assign(db, {
    integrationInstance: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === instance.id ? instance : null)),
      findMany: vi.fn(async () => [instance]),
      create: vi.fn(async () => instance),
      update: vi.fn(async ({ data }: { where: { id: string }; data: Partial<IntegrationInstanceRow> }) => {
        instance = {
          ...instance,
          ...data,
          updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : now
        };
        return instance;
      })
    },
    integrationInstanceConfig: {
      findUnique: vi.fn(async ({ where }: { where: { integrationInstanceId: string } }) =>
        config && where.integrationInstanceId === instance.id ? config : null
      ),
      upsert: vi.fn(
        async ({
          create,
          update
        }: {
          where: { integrationInstanceId: string };
          create: { integrationInstanceId: string; config: Record<string, unknown> };
          update: { config: Record<string, unknown> };
        }) => {
          config = {
            id: config?.id ?? "config-1",
            integrationInstanceId: create.integrationInstanceId,
            config: update.config ?? create.config,
            createdAt: config?.createdAt ?? now,
            updatedAt: now
          };
          return config;
        }
      )
    },
    integrationInstanceSecret: {
      findUnique: vi.fn(async ({ where }: { where: { integrationInstanceId: string } }) =>
        secret && where.integrationInstanceId === instance.id ? secret : null
      ),
      upsert: vi.fn(
        async ({
          create,
          update
        }: {
          where: { integrationInstanceId: string };
          create: { integrationInstanceId: string; hasSecrets: boolean; secretState: Record<string, unknown>; rotatedAt: Date | null; rotatedByUserId: string | null };
          update: { hasSecrets: boolean; secretState: Record<string, unknown>; rotatedAt: Date | null; rotatedByUserId: string | null };
        }) => {
          secret = {
            id: secret?.id ?? "secret-1",
            integrationInstanceId: create.integrationInstanceId,
            hasSecrets: update.hasSecrets,
            secretState: update.secretState,
            rotatedAt: update.rotatedAt?.toISOString() ?? null,
            rotatedByUserId: update.rotatedByUserId,
            createdAt: secret?.createdAt ?? now,
            updatedAt: now
          };
          return secret;
        }
      )
    },
    integrationValidationRun: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({
        id: "validation-1",
        integrationInstanceId: instance.id,
        triggerType: "manual",
        status: "success",
        summary: null,
        detail: null,
        triggeredByUserId: null,
        createdAt: now
      }))
    },
    integrationBindingRecord: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async () => ({
        id: "binding-1",
        integrationInstanceId: instance.id,
        targetType: "department",
        targetId: "dept-1",
        bindingType: "owner",
        bindingPayload: {},
        createdAt: now,
        updatedAt: now
      }))
    },
    resourcePolicy: {
      create: vi.fn(async () => ({}))
    },
    $transaction: vi.fn(async <T>(callback: (tx: TestIntegrationCenterDb) => Promise<T>): Promise<T> => callback(db))
  });

  return {
    db,
    getSecretState: () => secret?.secretState
  };
}

describe("IntegrationCenterService", () => {
  it("merges partial secret updates with existing secret state", async () => {
    const { db, getSecretState } = createIntegrationCenterDbMock();
    const service = createIntegrationCenterService({
      db,
      policies: {
        listAll: vi.fn(async () => []),
        replacePoliciesForResource: vi.fn(async () => [])
      },
      policyService: {
        filterAllowedResources: vi.fn(async ({ candidateIds }: { candidateIds: string[] }) => candidateIds)
      },
      usageLedger: {
        listExternalApiEvents: vi.fn(async () => [])
      },
      accessResolver: {
        getRoleIdsForUser: vi.fn(async () => []),
        getDepartmentIdsForUser: vi.fn(async () => [])
      }
    });

    await service.saveInstance({
      currentUserId: "user-1",
      instanceId: "zendesk-1",
      payload: {
        secretState: {
          webhookSigningSecret: "new-secret"
        }
      }
    });

    expect(getSecretState()).toEqual({
      zendeskApiToken: "old-token",
      webhookSigningSecret: "new-secret"
    });
  });
});
