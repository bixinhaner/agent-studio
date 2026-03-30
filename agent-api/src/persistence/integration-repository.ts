import type { ZendeskIntegrationSettings } from "../integrations/zendesk/types.js";

type IntegrationConfigRow = {
  key: string;
  config: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type IntegrationInstanceRow = {
  id: string;
  organizationId: string | null;
  type: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  isSystemSingleton: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type IntegrationInstanceConfigRow = {
  integrationInstanceId: string;
  config: unknown;
};

type IntegrationInstanceSecretRow = {
  integrationInstanceId: string;
  hasSecrets: boolean;
  secretState: unknown;
  rotatedAt: Date | string | null;
  rotatedByUserId: string | null;
};

type IntegrationConfigTable = {
  findUnique(args: { where: { key: string } }): Promise<IntegrationConfigRow | null>;
  upsert(args: {
    where: { key: string };
    create: { key: string; config: Record<string, unknown> };
    update: { config: Record<string, unknown> };
  }): Promise<IntegrationConfigRow>;
};

type IntegrationInstanceTable = {
  findMany(args?: { where?: { type?: string }; orderBy?: { createdAt?: "asc" | "desc" } }): Promise<IntegrationInstanceRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<IntegrationInstanceRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<IntegrationInstanceRow>;
};

type IntegrationInstanceConfigTable = {
  findUnique(args: { where: { integrationInstanceId: string } }): Promise<IntegrationInstanceConfigRow | null>;
  upsert(args: {
    where: { integrationInstanceId: string };
    create: { integrationInstanceId: string; config: Record<string, unknown> };
    update: { config: Record<string, unknown> };
  }): Promise<IntegrationInstanceConfigRow>;
};

type IntegrationInstanceSecretTable = {
  findUnique(args: { where: { integrationInstanceId: string } }): Promise<IntegrationInstanceSecretRow | null>;
  upsert(args: {
    where: { integrationInstanceId: string };
    create: {
      integrationInstanceId: string;
      hasSecrets: boolean;
      secretState: Record<string, unknown>;
      rotatedAt: Date | null;
      rotatedByUserId: string | null;
    };
    update: {
      hasSecrets: boolean;
      secretState: Record<string, unknown>;
      rotatedAt: Date | null;
      rotatedByUserId: string | null;
    };
  }): Promise<IntegrationInstanceSecretRow>;
};

export type IntegrationRepositoryDb = {
  integrationConfig: IntegrationConfigTable;
  integrationInstance?: IntegrationInstanceTable;
  integrationInstanceConfig?: IntegrationInstanceConfigTable;
  integrationInstanceSecret?: IntegrationInstanceSecretTable;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

const ZENDESK_BRIDGE_SLUG = "zendesk-primary";

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function pickZendeskInstance(instances: IntegrationInstanceRow[]): IntegrationInstanceRow | undefined {
  return instances.find((item) => item.slug === ZENDESK_BRIDGE_SLUG) ?? instances[0];
}

async function findZendeskInstanceById(
  db: Pick<IntegrationRepositoryDb, "integrationInstance">,
  instanceId: string
): Promise<IntegrationInstanceRow | undefined> {
  const normalizedId = trimOrUndefined(instanceId);
  if (!normalizedId || !db.integrationInstance) {
    return undefined;
  }

  const instances = await db.integrationInstance.findMany({
    where: { type: "zendesk" },
    orderBy: { createdAt: "asc" }
  });
  return instances.find((item) => item.id === normalizedId);
}

function splitZendeskSettings(config: Partial<ZendeskIntegrationSettings>): {
  config: Record<string, unknown>;
  secretState: Record<string, unknown>;
  hasSecrets: boolean;
} {
  const { zendeskApiToken, webhookSigningSecret, ...rest } = config;
  const secretState: Record<string, unknown> = {};
  if (typeof zendeskApiToken === "string" && zendeskApiToken.trim()) {
    secretState.zendeskApiToken = zendeskApiToken.trim();
  }
  if (typeof webhookSigningSecret === "string" && webhookSigningSecret.trim()) {
    secretState.webhookSigningSecret = webhookSigningSecret.trim();
  }
  return {
    config: rest,
    secretState,
    hasSecrets: Object.keys(secretState).length > 0
  };
}

function mergeZendeskSettings(
  config: Record<string, unknown> | undefined,
  secretState: Record<string, unknown> | undefined
): Partial<ZendeskIntegrationSettings> {
  return {
    ...(config ?? {}),
    zendeskApiToken: trimOrUndefined(secretState?.zendeskApiToken),
    webhookSigningSecret: trimOrUndefined(secretState?.webhookSigningSecret)
  };
}

export class IntegrationRepository {
  constructor(private readonly db: IntegrationRepositoryDb) {}

  async getConfig<T extends Record<string, unknown>>(key: string): Promise<Partial<T> | undefined> {
    const row = await this.db.integrationConfig.findUnique({
      where: { key }
    });
    if (!row) return undefined;
    return (asRecord(row.config) as Partial<T> | undefined) ?? undefined;
  }

  async upsertConfig<T extends Record<string, unknown>>(key: string, config: T): Promise<T> {
    const row = await this.db.integrationConfig.upsert({
      where: { key },
      create: { key, config },
      update: { config }
    });
    return (asRecord(row.config) as T | undefined) ?? config;
  }

  async getZendeskSettings(): Promise<Partial<ZendeskIntegrationSettings> | undefined> {
    if (this.db.integrationInstance && this.db.integrationInstanceConfig && this.db.integrationInstanceSecret) {
      const instances = await this.db.integrationInstance.findMany({
        where: { type: "zendesk" },
        orderBy: { createdAt: "asc" }
      });
      const instance = pickZendeskInstance(instances);
      if (instance) {
        const [configRow, secretRow] = await Promise.all([
          this.db.integrationInstanceConfig.findUnique({ where: { integrationInstanceId: instance.id } }),
          this.db.integrationInstanceSecret.findUnique({ where: { integrationInstanceId: instance.id } })
        ]);
        return mergeZendeskSettings(
          asRecord(configRow?.config),
          asRecord(secretRow?.secretState)
        );
      }
    }

    return this.getConfig<ZendeskIntegrationSettings>("zendesk");
  }

  async getZendeskSettingsForInstance(instanceId: string): Promise<Partial<ZendeskIntegrationSettings> | undefined> {
    if (!this.db.integrationInstance || !this.db.integrationInstanceConfig || !this.db.integrationInstanceSecret) {
      throw new Error("integration instance storage is not available");
    }

    const instance = await findZendeskInstanceById(this.db, instanceId);
    if (!instance) {
      throw new Error("integration instance not found");
    }

    const [configRow, secretRow] = await Promise.all([
      this.db.integrationInstanceConfig.findUnique({ where: { integrationInstanceId: instance.id } }),
      this.db.integrationInstanceSecret.findUnique({ where: { integrationInstanceId: instance.id } })
    ]);
    return mergeZendeskSettings(asRecord(configRow?.config), asRecord(secretRow?.secretState));
  }

  async upsertZendeskSettings(
    config: ZendeskIntegrationSettings
  ): Promise<ZendeskIntegrationSettings> {
    const { config: centerConfig, secretState, hasSecrets } = splitZendeskSettings(config);

    if (this.db.integrationInstance && this.db.integrationInstanceConfig && this.db.integrationInstanceSecret) {
      const existing = await this.db.integrationInstance.findMany({
        where: { type: "zendesk" },
        orderBy: { createdAt: "asc" }
      });
      let instance = pickZendeskInstance(existing);
      if (!instance) {
        instance = await this.db.integrationInstance.create({
          data: {
            type: "zendesk",
            slug: ZENDESK_BRIDGE_SLUG,
            name: "Zendesk",
            description: null,
            status: config.enabled ? "active" : "disabled",
            isSystemSingleton: false
          }
        });
      } else {
        instance = await this.db.integrationInstance.update({
          where: { id: instance.id },
          data: {
            name: instance.name || "Zendesk",
            status: config.enabled ? "active" : "disabled"
          }
        });
      }

      await Promise.all([
        this.db.integrationInstanceConfig.upsert({
          where: { integrationInstanceId: instance.id },
          create: { integrationInstanceId: instance.id, config: centerConfig },
          update: { config: centerConfig }
        }),
        this.db.integrationInstanceSecret.upsert({
          where: { integrationInstanceId: instance.id },
          create: {
            integrationInstanceId: instance.id,
            hasSecrets,
            secretState,
            rotatedAt: hasSecrets ? new Date() : null,
            rotatedByUserId: null
          },
          update: {
            hasSecrets,
            secretState,
            rotatedAt: hasSecrets ? new Date() : null,
            rotatedByUserId: null
          }
        })
      ]);
    }

    await this.upsertConfig("zendesk", config);
    return config;
  }

  async upsertZendeskSettingsForInstance(
    instanceId: string,
    config: ZendeskIntegrationSettings
  ): Promise<ZendeskIntegrationSettings> {
    if (!this.db.integrationInstance || !this.db.integrationInstanceConfig || !this.db.integrationInstanceSecret) {
      throw new Error("integration instance storage is not available");
    }

    const instance = await findZendeskInstanceById(this.db, instanceId);
    if (!instance) {
      throw new Error("integration instance not found");
    }

    const { config: centerConfig, secretState, hasSecrets } = splitZendeskSettings(config);
    await Promise.all([
      this.db.integrationInstance.update({
        where: { id: instance.id },
        data: {
          name: instance.name || "Zendesk",
          status: config.enabled ? "active" : "disabled"
        }
      }),
      this.db.integrationInstanceConfig.upsert({
        where: { integrationInstanceId: instance.id },
        create: { integrationInstanceId: instance.id, config: centerConfig },
        update: { config: centerConfig }
      }),
      this.db.integrationInstanceSecret.upsert({
        where: { integrationInstanceId: instance.id },
        create: {
          integrationInstanceId: instance.id,
          hasSecrets,
          secretState,
          rotatedAt: hasSecrets ? new Date() : null,
          rotatedByUserId: null
        },
        update: {
          hasSecrets,
          secretState,
          rotatedAt: hasSecrets ? new Date() : null,
          rotatedByUserId: null
        }
      })
    ]);

    return config;
  }
}
