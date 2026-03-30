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
  id: string;
  integrationInstanceId: string;
  config: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type IntegrationInstanceSecretRow = {
  id: string;
  integrationInstanceId: string;
  secretState: unknown;
  rotatedAt: Date | string | null;
  rotatedByUserId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type IntegrationValidationRunRow = {
  id: string;
  integrationInstanceId: string;
  triggerType: string;
  status: string;
  summary: unknown;
  detail: unknown;
  triggeredByUserId: string | null;
  createdAt: Date | string;
};

type IntegrationBindingRecordRow = {
  id: string;
  integrationInstanceId: string;
  targetType: string;
  targetId: string;
  bindingType: string;
  bindingPayload: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type IntegrationInstanceTable = {
  findUnique(args: { where: { id: string } }): Promise<IntegrationInstanceRow | null>;
  findMany(args?: { where?: { type?: string }; orderBy?: { createdAt?: "asc" | "desc" } }): Promise<IntegrationInstanceRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<IntegrationInstanceRow>;
};

type IntegrationInstanceConfigTable = {
  findUnique(args: { where: { integrationInstanceId: string } }): Promise<IntegrationInstanceConfigRow | null>;
  upsert(args: {
    where: { integrationInstanceId: string };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<IntegrationInstanceConfigRow>;
};

type IntegrationInstanceSecretTable = {
  findUnique(args: { where: { integrationInstanceId: string } }): Promise<IntegrationInstanceSecretRow | null>;
  upsert(args: {
    where: { integrationInstanceId: string };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<IntegrationInstanceSecretRow>;
};

type IntegrationValidationRunTable = {
  findMany(args: { where: { integrationInstanceId: string }; orderBy?: { createdAt?: "asc" | "desc" } }): Promise<IntegrationValidationRunRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<IntegrationValidationRunRow>;
};

type IntegrationBindingRecordTable = {
  findMany(args: { where: { integrationInstanceId: string }; orderBy?: { createdAt?: "asc" | "desc" } }): Promise<IntegrationBindingRecordRow[]>;
  deleteMany(args: { where: { integrationInstanceId: string } }): Promise<{ count: number }>;
  create(args: { data: Record<string, unknown> }): Promise<IntegrationBindingRecordRow>;
};

export type IntegrationInstanceRepositoryDb = {
  integrationInstance: IntegrationInstanceTable;
  integrationInstanceConfig: IntegrationInstanceConfigTable;
  integrationInstanceSecret: IntegrationInstanceSecretTable;
  integrationValidationRun: IntegrationValidationRunTable;
  integrationBindingRecord: IntegrationBindingRecordTable;
  $transaction<T>(callback: (tx: IntegrationInstanceRepositoryDb) => Promise<T>): Promise<T>;
};

export type IntegrationInstanceSecretStateSummary = {
  hasSecrets: boolean;
  rotatedAt?: string;
  rotatedByUserId?: string;
};

export type IntegrationValidationRecord = {
  id: string;
  triggerType: string;
  status: string;
  summary?: unknown;
  detail?: unknown;
  triggeredByUserId?: string;
  createdAt: string;
};

export type IntegrationBindingRecord = {
  id: string;
  targetType: string;
  targetId: string;
  bindingType: string;
  bindingPayload: unknown;
  createdAt: string;
  updatedAt: string;
};

export type IntegrationInstanceSummary = {
  id: string;
  organizationId?: string;
  type: string;
  slug: string;
  name: string;
  description?: string;
  status: string;
  isSystemSingleton: boolean;
  createdAt: string;
  updatedAt: string;
  config?: Record<string, unknown>;
  secretState: IntegrationInstanceSecretStateSummary;
};

export type IntegrationInstanceDetail = IntegrationInstanceSummary & {
  validationHistory: IntegrationValidationRecord[];
  bindings: IntegrationBindingRecord[];
};

export type CreateIntegrationInstanceInput = {
  organizationId?: string | null;
  type: string;
  slug: string;
  name: string;
  description?: string | null;
  status?: string;
};

export type UpsertIntegrationConfigInput = Record<string, unknown>;

export type RotateIntegrationSecretsInput = {
  payload: unknown;
  rotatedByUserId?: string | null;
};

export type RecordIntegrationValidationInput = {
  triggerType: string;
  status: string;
  summary?: unknown;
  detail?: unknown;
  triggeredByUserId?: string | null;
};

export type ReplaceIntegrationBindingsInput = Array<{
  targetType: string;
  targetId: string;
  bindingType: string;
  bindingPayload: unknown;
}>;

const SINGLETON_TYPES = new Set(["dingtalk", "openai_codex"]);

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function mapSecretState(row: IntegrationInstanceSecretRow | null | undefined): IntegrationInstanceSecretStateSummary {
  return {
    hasSecrets: Boolean(row),
    rotatedAt: toIsoString(row?.rotatedAt),
    rotatedByUserId: trimOrUndefined(row?.rotatedByUserId)
  };
}

function mapValidation(row: IntegrationValidationRunRow): IntegrationValidationRecord {
  return {
    id: row.id,
    triggerType: row.triggerType,
    status: row.status,
    summary: row.summary ?? undefined,
    detail: row.detail ?? undefined,
    triggeredByUserId: trimOrUndefined(row.triggeredByUserId),
    createdAt: toIsoString(row.createdAt) ?? new Date().toISOString()
  };
}

function mapBinding(row: IntegrationBindingRecordRow): IntegrationBindingRecord {
  return {
    id: row.id,
    targetType: row.targetType,
    targetId: row.targetId,
    bindingType: row.bindingType,
    bindingPayload: row.bindingPayload,
    createdAt: toIsoString(row.createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updatedAt) ?? new Date().toISOString()
  };
}

async function loadSummary(db: IntegrationInstanceRepositoryDb, row: IntegrationInstanceRow): Promise<IntegrationInstanceSummary> {
  const [configRow, secretRow] = await Promise.all([
    db.integrationInstanceConfig.findUnique({ where: { integrationInstanceId: row.id } }),
    db.integrationInstanceSecret.findUnique({ where: { integrationInstanceId: row.id } })
  ]);

  return {
    id: row.id,
    organizationId: trimOrUndefined(row.organizationId),
    type: row.type,
    slug: row.slug,
    name: row.name,
    description: trimOrUndefined(row.description),
    status: row.status,
    isSystemSingleton: row.isSystemSingleton,
    createdAt: toIsoString(row.createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updatedAt) ?? new Date().toISOString(),
    config: asRecord(configRow?.config),
    secretState: mapSecretState(secretRow)
  };
}

async function loadDetail(db: IntegrationInstanceRepositoryDb, row: IntegrationInstanceRow): Promise<IntegrationInstanceDetail> {
  const [summary, validationRows, bindingRows] = await Promise.all([
    loadSummary(db, row),
    db.integrationValidationRun.findMany({ where: { integrationInstanceId: row.id }, orderBy: { createdAt: "desc" } }),
    db.integrationBindingRecord.findMany({ where: { integrationInstanceId: row.id }, orderBy: { createdAt: "asc" } })
  ]);

  return {
    ...summary,
    validationHistory: validationRows
      .map(mapValidation)
      .sort((left, right) => {
        const createdAtDiff = right.createdAt.localeCompare(left.createdAt);
        return createdAtDiff !== 0 ? createdAtDiff : right.id.localeCompare(left.id);
      }),
    bindings: bindingRows
      .map(mapBinding)
      .sort((left, right) => {
        const createdAtDiff = left.createdAt.localeCompare(right.createdAt);
        return createdAtDiff !== 0 ? createdAtDiff : left.id.localeCompare(right.id);
      })
  };
}

export class IntegrationInstanceRepository {
  constructor(private readonly db: IntegrationInstanceRepositoryDb) {}

  async createInstance(input: CreateIntegrationInstanceInput): Promise<IntegrationInstanceSummary> {
    return this.db.$transaction(async (tx) => {
      if (SINGLETON_TYPES.has(input.type)) {
        const existing = await tx.integrationInstance.findMany({ where: { type: input.type } });
        if (existing.length > 0) {
          throw new Error(`single-instance integration already exists for ${input.type}`);
        }
      }

      const created = await tx.integrationInstance.create({
        data: {
          organizationId: trimOrUndefined(input.organizationId) ?? null,
          type: input.type,
          slug: input.slug,
          name: input.name,
          description: trimOrUndefined(input.description) ?? null,
          status: input.status ?? "draft",
          isSystemSingleton: SINGLETON_TYPES.has(input.type)
        }
      });

      return loadSummary(tx, created);
    });
  }

  async listInstances(type?: string): Promise<IntegrationInstanceSummary[]> {
    const rows = await this.db.integrationInstance.findMany({
      where: type ? { type } : undefined,
      orderBy: { createdAt: "asc" }
    });
    return Promise.all(rows.map((row) => loadSummary(this.db, row)));
  }

  async getInstance(id: string): Promise<IntegrationInstanceDetail | null> {
    const normalizedId = trimOrUndefined(id);
    if (!normalizedId) return null;
    const row = await this.db.integrationInstance.findUnique({ where: { id: normalizedId } });
    return row ? loadDetail(this.db, row) : null;
  }

  async upsertConfig(instanceId: string, config: UpsertIntegrationConfigInput): Promise<IntegrationInstanceSummary> {
    return this.db.$transaction(async (tx) => {
      const instance = await requireInstance(tx, instanceId);
      await tx.integrationInstanceConfig.upsert({
        where: { integrationInstanceId: instance.id },
        create: {
          integrationInstanceId: instance.id,
          config
        },
        update: {
          config
        }
      });
      const refreshed = await tx.integrationInstance.findUnique({ where: { id: instance.id } });
      return loadSummary(tx, refreshed ?? instance);
    });
  }

  async rotateSecrets(instanceId: string, input: RotateIntegrationSecretsInput): Promise<IntegrationInstanceSummary> {
    return this.db.$transaction(async (tx) => {
      const instance = await requireInstance(tx, instanceId);
      await tx.integrationInstanceSecret.upsert({
        where: { integrationInstanceId: instance.id },
        create: {
          integrationInstanceId: instance.id,
          secretState: input.payload,
          rotatedAt: new Date(),
          rotatedByUserId: trimOrUndefined(input.rotatedByUserId) ?? null
        },
        update: {
          secretState: input.payload,
          rotatedAt: new Date(),
          rotatedByUserId: trimOrUndefined(input.rotatedByUserId) ?? null
        }
      });
      const refreshed = await tx.integrationInstance.findUnique({ where: { id: instance.id } });
      return loadSummary(tx, refreshed ?? instance);
    });
  }

  async recordValidation(instanceId: string, input: RecordIntegrationValidationInput): Promise<IntegrationValidationRecord> {
    const instance = await requireInstance(this.db, instanceId);
    const created = await this.db.integrationValidationRun.create({
      data: {
        integrationInstanceId: instance.id,
        triggerType: input.triggerType,
        status: input.status,
        summary: input.summary,
        detail: input.detail,
        triggeredByUserId: trimOrUndefined(input.triggeredByUserId) ?? null
      }
    });
    return mapValidation(created);
  }

  async listValidationHistory(instanceId: string): Promise<IntegrationValidationRecord[]> {
    const instance = await requireInstance(this.db, instanceId);
    const rows = await this.db.integrationValidationRun.findMany({
      where: { integrationInstanceId: instance.id },
      orderBy: { createdAt: "desc" }
    });
    return rows
      .map(mapValidation)
      .sort((left, right) => {
        const createdAtDiff = right.createdAt.localeCompare(left.createdAt);
        return createdAtDiff !== 0 ? createdAtDiff : right.id.localeCompare(left.id);
      });
  }

  async replaceBindings(instanceId: string, bindings: ReplaceIntegrationBindingsInput): Promise<IntegrationBindingRecord[]> {
    return this.db.$transaction(async (tx) => {
      const instance = await requireInstance(tx, instanceId);
      await tx.integrationBindingRecord.deleteMany({ where: { integrationInstanceId: instance.id } });
      const created: IntegrationBindingRecordRow[] = [];
      for (const binding of bindings) {
        created.push(
          await tx.integrationBindingRecord.create({
            data: {
              integrationInstanceId: instance.id,
              targetType: binding.targetType,
              targetId: binding.targetId,
              bindingType: binding.bindingType,
              bindingPayload: binding.bindingPayload
            }
          })
        );
      }
      return created.map(mapBinding);
    });
  }

  async listBindings(instanceId: string): Promise<IntegrationBindingRecord[]> {
    const instance = await requireInstance(this.db, instanceId);
    const rows = await this.db.integrationBindingRecord.findMany({
      where: { integrationInstanceId: instance.id },
      orderBy: { createdAt: "asc" }
    });
    return rows
      .map(mapBinding)
      .sort((left, right) => {
        const createdAtDiff = left.createdAt.localeCompare(right.createdAt);
        return createdAtDiff !== 0 ? createdAtDiff : left.id.localeCompare(right.id);
      });
  }
}

async function requireInstance(db: IntegrationInstanceRepositoryDb, instanceId: string): Promise<IntegrationInstanceRow> {
  const normalizedId = trimOrUndefined(instanceId);
  if (!normalizedId) {
    throw new Error("integration instance not found");
  }
  const row = await db.integrationInstance.findUnique({ where: { id: normalizedId } });
  if (!row) {
    throw new Error("integration instance not found");
  }
  return row;
}
