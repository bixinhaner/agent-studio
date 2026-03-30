import { describe, expect, it } from "vitest";

import { appConfig } from "../../config.js";
import { IntegrationRepository } from "../../persistence/integration-repository.js";
import { ZendeskIntegrationService } from "./service.js";
import { ZendeskSettingsStore } from "./settings-store.js";

type FakeIntegrationConfigRow = {
  key: string;
  config: Record<string, unknown>;
};

type FakeIntegrationInstanceRow = {
  id: string;
  organizationId: string | null;
  type: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  isSystemSingleton: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type FakeIntegrationInstanceConfigRow = {
  id: string;
  integrationInstanceId: string;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

type FakeIntegrationInstanceSecretRow = {
  id: string;
  integrationInstanceId: string;
  hasSecrets: boolean;
  secretState: Record<string, unknown>;
  rotatedAt: Date | null;
  rotatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function makeZendeskSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: true,
    publicBaseUrl: "https://studio.example.com",
    zendeskBaseUrl: "https://example.zendesk.com",
    zendeskEmail: "bot@example.com",
    zendeskApiToken: "center-token",
    webhookSigningSecret: "center-secret",
    responseMode: "public_reply",
    fallbackMode: "internal_note",
    autoStatus: "pending",
    excludedTags: [],
    workspace: appConfig.defaultWorkspace,
    model: "gpt-4.1",
    reasoningEffort: "high",
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    networkAccessEnabled: true,
    webSearchMode: "disabled",
    additionalDirectories: [],
    maxCommentHistory: 12,
    systemPrompt: "system prompt",
    ...overrides
  };
}

function buildDb(seed?: {
  legacyConfig?: Record<string, unknown>;
  instances?: FakeIntegrationInstanceRow[];
  configs?: FakeIntegrationInstanceConfigRow[];
  secrets?: FakeIntegrationInstanceSecretRow[];
}) {
  const state = {
    legacyConfig: seed?.legacyConfig ? clone(seed.legacyConfig) : undefined,
    instances: seed?.instances ? clone(seed.instances) : [],
    configs: seed?.configs ? clone(seed.configs) : [],
    secrets: seed?.secrets ? clone(seed.secrets) : []
  };

  const db = {
    integrationConfig: {
      findUnique: async ({ where }: { where: { key: string } }) => {
        if (where.key !== "zendesk" || !state.legacyConfig) return null;
        return {
          key: where.key,
          config: clone(state.legacyConfig),
          createdAt: new Date("2026-03-29T00:00:00.000Z"),
          updatedAt: new Date("2026-03-29T00:00:00.000Z")
        };
      },
      upsert: async ({
        where,
        create,
        update
      }: {
        where: { key: string };
        create: { key: string; config: Record<string, unknown> };
        update: { config: Record<string, unknown> };
      }) => {
        const config = where.key === "zendesk" ? update.config ?? create.config : create.config;
        state.legacyConfig = clone(config);
        return {
          key: where.key,
          config: clone(config),
          createdAt: new Date("2026-03-29T00:00:00.000Z"),
          updatedAt: new Date("2026-03-29T00:00:00.000Z")
        };
      }
    },
    integrationInstance: {
      findMany: async ({ where }: { where?: { type?: string } } = {}) =>
        clone(state.instances.filter((item) => (where?.type ? item.type === where.type : true))),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row: FakeIntegrationInstanceRow = {
          id: String(data.id ?? `integration-instance-${state.instances.length + 1}`),
          organizationId: (data.organizationId as string | null | undefined) ?? null,
          type: String(data.type ?? ""),
          slug: String(data.slug ?? ""),
          name: String(data.name ?? ""),
          description: (data.description as string | null | undefined) ?? null,
          status: String(data.status ?? "draft"),
          isSystemSingleton: Boolean(data.isSystemSingleton),
          createdAt: new Date("2026-03-29T00:00:00.000Z"),
          updatedAt: new Date("2026-03-29T00:00:00.000Z")
        };
        state.instances.push(row);
        return clone(row);
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = state.instances.find((item) => item.id === where.id);
        if (!row) throw new Error("integration instance not found");
        Object.assign(row, clone(data));
        row.updatedAt = new Date("2026-03-30T00:00:00.000Z");
        return clone(row);
      }
    },
    integrationInstanceConfig: {
      findUnique: async ({ where }: { where: { integrationInstanceId: string } }) =>
        clone(state.configs.find((item) => item.integrationInstanceId === where.integrationInstanceId) ?? null),
      upsert: async ({
        where,
        create,
        update
      }: {
        where: { integrationInstanceId: string };
        create: { integrationInstanceId: string; config: Record<string, unknown> };
        update: { config: Record<string, unknown> };
      }) => {
        const existing = state.configs.find((item) => item.integrationInstanceId === where.integrationInstanceId);
        if (existing) {
          existing.config = clone(update.config);
          existing.updatedAt = new Date("2026-03-30T00:00:00.000Z");
          return clone(existing);
        }
        const row: FakeIntegrationInstanceConfigRow = {
          id: `integration-instance-config-${state.configs.length + 1}`,
          integrationInstanceId: create.integrationInstanceId,
          config: clone(create.config),
          createdAt: new Date("2026-03-29T00:00:00.000Z"),
          updatedAt: new Date("2026-03-29T00:00:00.000Z")
        };
        state.configs.push(row);
        return clone(row);
      }
    },
    integrationInstanceSecret: {
      findUnique: async ({ where }: { where: { integrationInstanceId: string } }) =>
        clone(state.secrets.find((item) => item.integrationInstanceId === where.integrationInstanceId) ?? null),
      upsert: async ({
        where,
        create,
        update
      }: {
        where: { integrationInstanceId: string };
        create: { integrationInstanceId: string; hasSecrets: boolean; secretState: Record<string, unknown>; rotatedAt: Date | null; rotatedByUserId: string | null };
        update: { hasSecrets: boolean; secretState: Record<string, unknown>; rotatedAt: Date | null; rotatedByUserId: string | null };
      }) => {
        const existing = state.secrets.find((item) => item.integrationInstanceId === where.integrationInstanceId);
        if (existing) {
          Object.assign(existing, clone(update));
          existing.updatedAt = new Date("2026-03-30T00:00:00.000Z");
          return clone(existing);
        }
        const row: FakeIntegrationInstanceSecretRow = {
          id: `integration-instance-secret-${state.secrets.length + 1}`,
          integrationInstanceId: create.integrationInstanceId,
          hasSecrets: create.hasSecrets,
          secretState: clone(create.secretState),
          rotatedAt: create.rotatedAt,
          rotatedByUserId: create.rotatedByUserId,
          createdAt: new Date("2026-03-29T00:00:00.000Z"),
          updatedAt: new Date("2026-03-29T00:00:00.000Z")
        };
        state.secrets.push(row);
        return clone(row);
      }
    },
    $transaction: async <T>(callback: (tx: never) => Promise<T>) => callback(db as never)
  };

  return { db, state };
}

function buildService(db: ReturnType<typeof buildDb>["db"]) {
  const integrations = new IntegrationRepository(db as never);
  const settingsStore = new ZendeskSettingsStore(integrations);
  return new ZendeskIntegrationService(settingsStore, {} as never, { list: async () => [] } as never);
}

describe("ZendeskIntegrationService compatibility with Integration Center", () => {
  it("reads overview for the requested integration instance", async () => {
    const { db } = buildDb({
      instances: [
        {
          id: "int-zendesk-1",
          organizationId: null,
          type: "zendesk",
          slug: "zendesk-a",
          name: "Zendesk A",
          description: null,
          status: "active",
          isSystemSingleton: false,
          createdAt: new Date("2026-03-29T00:00:00.000Z"),
          updatedAt: new Date("2026-03-29T00:00:00.000Z")
        },
        {
          id: "int-zendesk-2",
          organizationId: null,
          type: "zendesk",
          slug: "zendesk-b",
          name: "Zendesk B",
          description: null,
          status: "active",
          isSystemSingleton: false,
          createdAt: new Date("2026-03-29T01:00:00.000Z"),
          updatedAt: new Date("2026-03-29T01:00:00.000Z")
        }
      ],
      configs: [
        {
          id: "integration-instance-config-1",
          integrationInstanceId: "int-zendesk-1",
          config: makeZendeskSettings({
            publicBaseUrl: "https://one.example.com",
            zendeskBaseUrl: "https://one.zendesk.com",
            zendeskEmail: "one@example.com"
          }),
          createdAt: new Date("2026-03-29T00:00:00.000Z"),
          updatedAt: new Date("2026-03-29T00:00:00.000Z")
        },
        {
          id: "integration-instance-config-2",
          integrationInstanceId: "int-zendesk-2",
          config: makeZendeskSettings({
            publicBaseUrl: "https://two.example.com",
            zendeskBaseUrl: "https://two.zendesk.com",
            zendeskEmail: "two@example.com"
          }),
          createdAt: new Date("2026-03-29T01:00:00.000Z"),
          updatedAt: new Date("2026-03-29T01:00:00.000Z")
        }
      ],
      secrets: [
        {
          id: "integration-instance-secret-1",
          integrationInstanceId: "int-zendesk-1",
          hasSecrets: true,
          secretState: {
            zendeskApiToken: "token-one",
            webhookSigningSecret: "secret-one"
          },
          rotatedAt: new Date("2026-03-29T00:00:00.000Z"),
          rotatedByUserId: "admin-1",
          createdAt: new Date("2026-03-29T00:00:00.000Z"),
          updatedAt: new Date("2026-03-29T00:00:00.000Z")
        },
        {
          id: "integration-instance-secret-2",
          integrationInstanceId: "int-zendesk-2",
          hasSecrets: true,
          secretState: {
            zendeskApiToken: "token-two",
            webhookSigningSecret: "secret-two"
          },
          rotatedAt: new Date("2026-03-29T01:00:00.000Z"),
          rotatedByUserId: "admin-2",
          createdAt: new Date("2026-03-29T01:00:00.000Z"),
          updatedAt: new Date("2026-03-29T01:00:00.000Z")
        }
      ]
    });

    const service = buildService(db);
    const overview = await service.getOverview("int-zendesk-2");

    expect(overview.settings.publicBaseUrl).toBe("https://two.example.com");
    expect(overview.settings.zendeskBaseUrl).toBe("https://two.zendesk.com");
    expect(overview.settings.zendeskEmail).toBe("two@example.com");
    expect(overview.settings.hasZendeskApiToken).toBe(true);
    expect(overview.settings.hasWebhookSigningSecret).toBe(true);
    expect(overview.setup.webhookUrl).toBe("https://two.example.com/api/integrations/zendesk/webhook");
  });

  it("updates only the requested integration instance", async () => {
    const { db, state } = buildDb({
      instances: [
        {
          id: "int-zendesk-1",
          organizationId: null,
          type: "zendesk",
          slug: "zendesk-a",
          name: "Zendesk A",
          description: null,
          status: "active",
          isSystemSingleton: false,
          createdAt: new Date("2026-03-29T00:00:00.000Z"),
          updatedAt: new Date("2026-03-29T00:00:00.000Z")
        },
        {
          id: "int-zendesk-2",
          organizationId: null,
          type: "zendesk",
          slug: "zendesk-b",
          name: "Zendesk B",
          description: null,
          status: "active",
          isSystemSingleton: false,
          createdAt: new Date("2026-03-29T01:00:00.000Z"),
          updatedAt: new Date("2026-03-29T01:00:00.000Z")
        }
      ],
      configs: [
        {
          id: "integration-instance-config-1",
          integrationInstanceId: "int-zendesk-1",
          config: makeZendeskSettings({
            publicBaseUrl: "https://one.example.com",
            zendeskBaseUrl: "https://one.zendesk.com",
            zendeskEmail: "one@example.com"
          }),
          createdAt: new Date("2026-03-29T00:00:00.000Z"),
          updatedAt: new Date("2026-03-29T00:00:00.000Z")
        },
        {
          id: "integration-instance-config-2",
          integrationInstanceId: "int-zendesk-2",
          config: makeZendeskSettings({
            publicBaseUrl: "https://two.example.com",
            zendeskBaseUrl: "https://two.zendesk.com",
            zendeskEmail: "two@example.com"
          }),
          createdAt: new Date("2026-03-29T01:00:00.000Z"),
          updatedAt: new Date("2026-03-29T01:00:00.000Z")
        }
      ],
      secrets: [
        {
          id: "integration-instance-secret-1",
          integrationInstanceId: "int-zendesk-1",
          hasSecrets: true,
          secretState: {
            zendeskApiToken: "token-one",
            webhookSigningSecret: "secret-one"
          },
          rotatedAt: new Date("2026-03-29T00:00:00.000Z"),
          rotatedByUserId: "admin-1",
          createdAt: new Date("2026-03-29T00:00:00.000Z"),
          updatedAt: new Date("2026-03-29T00:00:00.000Z")
        },
        {
          id: "integration-instance-secret-2",
          integrationInstanceId: "int-zendesk-2",
          hasSecrets: true,
          secretState: {
            zendeskApiToken: "token-two",
            webhookSigningSecret: "secret-two"
          },
          rotatedAt: new Date("2026-03-29T01:00:00.000Z"),
          rotatedByUserId: "admin-2",
          createdAt: new Date("2026-03-29T01:00:00.000Z"),
          updatedAt: new Date("2026-03-29T01:00:00.000Z")
        }
      ]
    });

    const service = buildService(db);
    await service.updateSettings(
      {
        enabled: true,
        publicBaseUrl: "https://two-updated.example.com",
        zendeskBaseUrl: "https://two-updated.zendesk.com",
        zendeskEmail: "two-updated@example.com",
        zendeskApiToken: "token-two-updated",
        webhookSigningSecret: "secret-two-updated",
        workspace: appConfig.defaultWorkspace,
        model: "gpt-4.1"
      },
      "int-zendesk-2"
    );

    const first = state.configs.find((item) => item.integrationInstanceId === "int-zendesk-1");
    const second = state.configs.find((item) => item.integrationInstanceId === "int-zendesk-2");
    const firstSecret = state.secrets.find((item) => item.integrationInstanceId === "int-zendesk-1");
    const secondSecret = state.secrets.find((item) => item.integrationInstanceId === "int-zendesk-2");

    expect(first?.config).toMatchObject({
      publicBaseUrl: "https://one.example.com",
      zendeskBaseUrl: "https://one.zendesk.com",
      zendeskEmail: "one@example.com"
    });
    expect(second?.config).toMatchObject({
      publicBaseUrl: "https://two-updated.example.com",
      zendeskBaseUrl: "https://two-updated.zendesk.com",
      zendeskEmail: "two-updated@example.com"
    });
    expect(firstSecret?.secretState).toMatchObject({
      zendeskApiToken: "token-one",
      webhookSigningSecret: "secret-one"
    });
    expect(secondSecret?.secretState).toMatchObject({
      zendeskApiToken: "token-two-updated",
      webhookSigningSecret: "secret-two-updated"
    });
  });

  it("reads Zendesk settings from the center-backed instance without changing overview semantics", async () => {
    const { db } = buildDb({
      legacyConfig: makeZendeskSettings({
        enabled: false,
        publicBaseUrl: "https://legacy.example.com",
        zendeskBaseUrl: "https://legacy.zendesk.com",
        zendeskEmail: "legacy@example.com",
        zendeskApiToken: "legacy-token",
        webhookSigningSecret: "legacy-secret"
      }),
      instances: [
        {
          id: "int-zendesk-primary",
          organizationId: null,
          type: "zendesk",
          slug: "zendesk-primary",
          name: "Zendesk Primary",
          description: null,
          status: "active",
          isSystemSingleton: false,
          createdAt: new Date("2026-03-29T00:00:00.000Z"),
          updatedAt: new Date("2026-03-29T00:00:00.000Z")
        }
      ],
      configs: [
        {
          id: "integration-instance-config-1",
          integrationInstanceId: "int-zendesk-primary",
          config: makeZendeskSettings({
            publicBaseUrl: "https://studio.example.com",
            zendeskBaseUrl: "https://example.zendesk.com",
            zendeskEmail: "bot@example.com"
          }),
          createdAt: new Date("2026-03-29T00:00:00.000Z"),
          updatedAt: new Date("2026-03-29T00:00:00.000Z")
        }
      ],
      secrets: [
        {
          id: "integration-instance-secret-1",
          integrationInstanceId: "int-zendesk-primary",
          hasSecrets: true,
          secretState: {
            zendeskApiToken: "center-token",
            webhookSigningSecret: "center-secret"
          },
          rotatedAt: new Date("2026-03-29T00:00:00.000Z"),
          rotatedByUserId: "admin-1",
          createdAt: new Date("2026-03-29T00:00:00.000Z"),
          updatedAt: new Date("2026-03-29T00:00:00.000Z")
        }
      ]
    });

    const service = buildService(db);
    const overview = await service.getOverview();

    expect(overview.settings.publicBaseUrl).toBe("https://studio.example.com");
    expect(overview.settings.zendeskBaseUrl).toBe("https://example.zendesk.com");
    expect(overview.settings.zendeskEmail).toBe("bot@example.com");
    expect(overview.settings.hasZendeskApiToken).toBe(true);
    expect(overview.settings.hasWebhookSigningSecret).toBe(true);
    expect(overview.settings).not.toHaveProperty("zendeskApiToken");
    expect(overview.settings).not.toHaveProperty("webhookSigningSecret");
    expect(overview.ready).toBe(true);
    expect(overview.setup.webhookUrl).toBe("https://studio.example.com/api/integrations/zendesk/webhook");
  });

  it("writes Zendesk settings back to the center-backed instance without leaking secrets into config", async () => {
    const { db, state } = buildDb({
      instances: [
        {
          id: "int-zendesk-primary",
          organizationId: null,
          type: "zendesk",
          slug: "zendesk-primary",
          name: "Zendesk Primary",
          description: null,
          status: "draft",
          isSystemSingleton: false,
          createdAt: new Date("2026-03-29T00:00:00.000Z"),
          updatedAt: new Date("2026-03-29T00:00:00.000Z")
        }
      ]
    });

    const service = buildService(db);
    await service.updateSettings({
      enabled: true,
      publicBaseUrl: "https://studio.example.com",
      zendeskBaseUrl: "https://example.zendesk.com",
      zendeskEmail: "bot@example.com",
      zendeskApiToken: "new-token",
      webhookSigningSecret: "new-secret",
      workspace: appConfig.defaultWorkspace,
      model: "gpt-4.1"
    });

    expect(state.configs).toHaveLength(1);
    expect(state.configs[0].config).toMatchObject({
      enabled: true,
      publicBaseUrl: "https://studio.example.com",
      zendeskBaseUrl: "https://example.zendesk.com",
      zendeskEmail: "bot@example.com"
    });
    expect(JSON.stringify(state.configs[0].config)).not.toContain("new-token");
    expect(JSON.stringify(state.configs[0].config)).not.toContain("new-secret");

    expect(state.secrets).toHaveLength(1);
    expect(state.secrets[0].secretState).toMatchObject({
      zendeskApiToken: "new-token",
      webhookSigningSecret: "new-secret"
    });

    const overview = await service.getOverview();
    expect(overview.settings.hasZendeskApiToken).toBe(true);
    expect(overview.settings.hasWebhookSigningSecret).toBe(true);
    expect(overview.ready).toBe(true);
  });
});
