import type { ZendeskIntegrationSettings } from "../integrations/zendesk/types.js";

type IntegrationConfigRow = {
  key: string;
  config: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type IntegrationConfigTable = {
  findUnique(args: { where: { key: string } }): Promise<IntegrationConfigRow | null>;
  upsert(args: {
    where: { key: string };
    create: { key: string; config: Record<string, unknown> };
    update: { config: Record<string, unknown> };
  }): Promise<IntegrationConfigRow>;
};

export type IntegrationRepositoryDb = {
  integrationConfig: IntegrationConfigTable;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
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
    return this.getConfig<ZendeskIntegrationSettings>("zendesk");
  }

  async upsertZendeskSettings(
    config: ZendeskIntegrationSettings
  ): Promise<ZendeskIntegrationSettings> {
    return this.upsertConfig("zendesk", config);
  }
}
