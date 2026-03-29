export type SyncJobRecord = {
  id: string;
  organizationId?: string;
  provider: string;
  scopeType: string;
  scopeExternalId?: string;
  status: string;
  triggerType: string;
  triggeredByUserId?: string;
  startedAt?: string;
  finishedAt?: string;
  summary?: unknown;
  createdAt: string;
  updatedAt: string;
};

export type SyncJobEventRecord = {
  id: string;
  level: string;
  eventType: string;
  message: string;
  payload?: unknown;
  createdAt: string;
};

export type SyncSnapshotRecord = {
  id: string;
  entityType: string;
  scopeType: string;
  scopeExternalId?: string;
  snapshotPayload: unknown;
  createdAt: string;
};

export type SyncDiffRecord = {
  id: string;
  entityType: string;
  entityExternalId?: string;
  changeType: string;
  beforePayload?: unknown;
  afterPayload?: unknown;
  createdAt: string;
};

export type SyncJobDetail = SyncJobRecord & {
  events: SyncJobEventRecord[];
  snapshots: SyncSnapshotRecord[];
  diffs: SyncDiffRecord[];
};

type SyncJobRow = {
  id: string;
  organizationId: string | null;
  provider: string;
  scopeType: string;
  scopeExternalId: string | null;
  status: string;
  triggerType: string;
  triggeredByUserId: string | null;
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
  summary: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type SyncJobEventRow = {
  id: string;
  syncJobId: string;
  level: string;
  eventType: string;
  message: string;
  payload: unknown;
  createdAt: Date | string;
};

type SyncSnapshotRow = {
  id: string;
  syncJobId: string;
  entityType: string;
  scopeType: string;
  scopeExternalId: string | null;
  snapshotPayload: unknown;
  createdAt: Date | string;
};

type SyncDiffRow = {
  id: string;
  syncJobId: string;
  entityType: string;
  entityExternalId: string | null;
  changeType: string;
  beforePayload: unknown;
  afterPayload: unknown;
  createdAt: Date | string;
};

type SyncJobTable = {
  findUnique(args: { where: { id: string } }): Promise<SyncJobRow | null>;
  findMany(args?: { orderBy?: { createdAt?: "asc" | "desc" }; take?: number }): Promise<SyncJobRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<SyncJobRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<SyncJobRow>;
};

type SyncJobEventTable = {
  findMany(args: { where: { syncJobId: string }; orderBy?: { createdAt?: "asc" | "desc" } }): Promise<SyncJobEventRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<SyncJobEventRow>;
};

type SyncSnapshotTable = {
  findMany(args: { where: { syncJobId: string }; orderBy?: { createdAt?: "asc" | "desc" } }): Promise<SyncSnapshotRow[]>;
  deleteMany(args: { where: { syncJobId: string } }): Promise<{ count: number }>;
  create(args: { data: Record<string, unknown> }): Promise<SyncSnapshotRow>;
};

type SyncDiffTable = {
  findMany(args: { where: { syncJobId: string }; orderBy?: { createdAt?: "asc" | "desc" } }): Promise<SyncDiffRow[]>;
  deleteMany(args: { where: { syncJobId: string } }): Promise<{ count: number }>;
  create(args: { data: Record<string, unknown> }): Promise<SyncDiffRow>;
};

export type SyncJobRepositoryDb = {
  syncJob: SyncJobTable;
  syncJobEvent: SyncJobEventTable;
  syncSnapshot: SyncSnapshotTable;
  syncDiff: SyncDiffTable;
  $transaction<T>(callback: (tx: SyncJobRepositoryDb) => Promise<T>): Promise<T>;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function mapJob(row: SyncJobRow): SyncJobRecord {
  return {
    id: row.id,
    organizationId: trimOrUndefined(row.organizationId),
    provider: row.provider,
    scopeType: row.scopeType,
    scopeExternalId: trimOrUndefined(row.scopeExternalId),
    status: row.status,
    triggerType: row.triggerType,
    triggeredByUserId: trimOrUndefined(row.triggeredByUserId),
    startedAt: row.startedAt ? toIsoString(row.startedAt) : undefined,
    finishedAt: row.finishedAt ? toIsoString(row.finishedAt) : undefined,
    summary: row.summary ?? undefined,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

function mapEvent(row: SyncJobEventRow): SyncJobEventRecord {
  return {
    id: row.id,
    level: row.level,
    eventType: row.eventType,
    message: row.message,
    payload: row.payload ?? undefined,
    createdAt: toIsoString(row.createdAt)
  };
}

function mapSnapshot(row: SyncSnapshotRow): SyncSnapshotRecord {
  return {
    id: row.id,
    entityType: row.entityType,
    scopeType: row.scopeType,
    scopeExternalId: trimOrUndefined(row.scopeExternalId),
    snapshotPayload: row.snapshotPayload,
    createdAt: toIsoString(row.createdAt)
  };
}

function mapDiff(row: SyncDiffRow): SyncDiffRecord {
  return {
    id: row.id,
    entityType: row.entityType,
    entityExternalId: trimOrUndefined(row.entityExternalId),
    changeType: row.changeType,
    beforePayload: row.beforePayload ?? undefined,
    afterPayload: row.afterPayload ?? undefined,
    createdAt: toIsoString(row.createdAt)
  };
}

export class SyncJobRepository {
  constructor(private readonly db: SyncJobRepositoryDb) {}

  async create(input: {
    scopeType: string;
    scopeExternalId?: string | null;
    triggerType: string;
    triggeredByUserId?: string | null;
  }): Promise<SyncJobRecord> {
    const created = await this.db.syncJob.create({
      data: {
        provider: "dingtalk",
        scopeType: input.scopeType,
        scopeExternalId: trimOrUndefined(input.scopeExternalId) ?? null,
        status: "pending",
        triggerType: input.triggerType,
        triggeredByUserId: trimOrUndefined(input.triggeredByUserId) ?? null
      }
    });
    return mapJob(created);
  }

  async markRunning(jobId: string, startedAt: Date): Promise<void> {
    await this.updateJob(jobId, {
      status: "running",
      startedAt,
      finishedAt: null
    });
  }

  async appendEvent(
    jobId: string,
    input: { level: string; eventType: string; message: string; payload?: unknown }
  ): Promise<void> {
    await this.db.syncJobEvent.create({
      data: {
        syncJobId: jobId,
        level: input.level,
        eventType: input.eventType,
        message: input.message,
        payload: input.payload
      }
    });
  }

  async replaceSnapshots(
    jobId: string,
    input: Array<{ entityType: string; scopeType: string; scopeExternalId?: string | null; snapshotPayload: unknown }>
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.syncSnapshot.deleteMany({ where: { syncJobId: jobId } });
      for (const item of input) {
        await tx.syncSnapshot.create({
          data: {
            syncJobId: jobId,
            entityType: item.entityType,
            scopeType: item.scopeType,
            scopeExternalId: trimOrUndefined(item.scopeExternalId) ?? null,
            snapshotPayload: item.snapshotPayload
          }
        });
      }
    });
  }

  async replaceDiffs(
    jobId: string,
    input: Array<{
      entityType: string;
      entityExternalId?: string | null;
      changeType: string;
      beforePayload?: unknown;
      afterPayload?: unknown;
    }>
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.syncDiff.deleteMany({ where: { syncJobId: jobId } });
      for (const item of input) {
        await tx.syncDiff.create({
          data: {
            syncJobId: jobId,
            entityType: item.entityType,
            entityExternalId: trimOrUndefined(item.entityExternalId) ?? null,
            changeType: item.changeType,
            beforePayload: item.beforePayload,
            afterPayload: item.afterPayload
          }
        });
      }
    });
  }

  async markSucceeded(jobId: string, summary: unknown): Promise<void> {
    await this.updateJob(jobId, {
      status: "succeeded",
      finishedAt: new Date(),
      summary
    });
  }

  async markFailed(jobId: string, summary: unknown): Promise<void> {
    await this.updateJob(jobId, {
      status: "failed",
      finishedAt: new Date(),
      summary
    });
  }

  async getDetail(jobId: string): Promise<SyncJobDetail | null> {
    const row = await this.db.syncJob.findUnique({ where: { id: jobId } });
    if (!row) return null;

    const [events, snapshots, diffs] = await Promise.all([
      this.db.syncJobEvent.findMany({ where: { syncJobId: jobId }, orderBy: { createdAt: "asc" } }),
      this.db.syncSnapshot.findMany({ where: { syncJobId: jobId }, orderBy: { createdAt: "asc" } }),
      this.db.syncDiff.findMany({ where: { syncJobId: jobId }, orderBy: { createdAt: "asc" } })
    ]);

    return {
      ...mapJob(row),
      events: events.map(mapEvent),
      snapshots: snapshots.map(mapSnapshot),
      diffs: diffs.map(mapDiff)
    };
  }

  async listRecent(limit = 20): Promise<SyncJobRecord[]> {
    const rows = await this.db.syncJob.findMany({
      orderBy: { createdAt: "desc" },
      take: limit
    });
    return rows.map(mapJob);
  }

  private async updateJob(jobId: string, data: Record<string, unknown>): Promise<void> {
    await this.db.syncJob.update({
      where: { id: jobId },
      data: {
        ...data,
        updatedAt: new Date()
      }
    });
  }
}
