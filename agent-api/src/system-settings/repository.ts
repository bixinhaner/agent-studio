import {
  createDefaultSystemSettingsPayload,
  mergeSystemSettingsPayload,
  systemSettingsPayloadPatchSchema,
  systemSettingsPayloadSchema,
  systemSettingsVersionStatusSchema,
  type SystemSettingsPayloadPatch,
  type SystemSettingsPublishInput,
  type SystemSettingsVersionRecord,
  type SystemSettingsVersionStatus
} from "./types.js";

type SystemSettingsVersionRow = {
  id: string;
  versionNumber: number;
  status: SystemSettingsVersionStatus;
  payload: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
  publishedAt: Date | string | null;
  publishedByUserId: string | null;
};

type SystemSettingsVersionTable = {
  findMany(args?: {
    where?: { status?: SystemSettingsVersionStatus; id?: string };
    orderBy?: {
      versionNumber?: "asc" | "desc";
      createdAt?: "asc" | "desc";
      updatedAt?: "asc" | "desc";
      publishedAt?: "asc" | "desc";
    };
    take?: number;
  }): Promise<SystemSettingsVersionRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<SystemSettingsVersionRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<SystemSettingsVersionRow>;
};

export type SystemSettingsRepositoryDb = {
  systemSettingsVersion: SystemSettingsVersionTable;
  $transaction?<T>(callback: (tx: SystemSettingsRepositoryDb) => Promise<T>): Promise<T>;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function withTransaction<T>(db: SystemSettingsRepositoryDb, callback: (tx: SystemSettingsRepositoryDb) => Promise<T>): Promise<T> {
  if (typeof db.$transaction === "function") {
    return db.$transaction((tx) => callback(tx));
  }
  return callback(db);
}

function mapVersionRow(row: SystemSettingsVersionRow): SystemSettingsVersionRecord {
  return {
    id: row.id,
    versionNumber: row.versionNumber,
    status: systemSettingsVersionStatusSchema.parse(row.status),
    payload: systemSettingsPayloadSchema.parse(row.payload),
    createdAt: toIsoString(row.createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updatedAt) ?? new Date().toISOString(),
    publishedAt: toIsoString(row.publishedAt),
    publishedByUserId: trimOrUndefined(row.publishedByUserId)
  };
}

function latestByVersion(rows: SystemSettingsVersionRow[]): SystemSettingsVersionRow | undefined {
  return rows[0];
}

async function loadLatestVersion(
  db: SystemSettingsRepositoryDb,
  status?: SystemSettingsVersionStatus
): Promise<SystemSettingsVersionRow | undefined> {
  const rows = await db.systemSettingsVersion.findMany({
    where: status ? { status } : undefined,
    orderBy: { versionNumber: "desc" },
    take: 1
  });
  return latestByVersion(rows);
}

async function loadLatestDraft(db: SystemSettingsRepositoryDb): Promise<SystemSettingsVersionRow | undefined> {
  return loadLatestVersion(db, "draft");
}

async function nextVersionNumber(db: SystemSettingsRepositoryDb): Promise<number> {
  const row = await loadLatestVersion(db);
  return (row?.versionNumber ?? 0) + 1;
}

async function getOrCreateDraftRow(db: SystemSettingsRepositoryDb): Promise<SystemSettingsVersionRow> {
  const draft = await loadLatestDraft(db);
  if (draft) {
    return draft;
  }
  return db.systemSettingsVersion.create({
    data: {
      versionNumber: await nextVersionNumber(db),
      status: "draft",
      payload: createDefaultSystemSettingsPayload(),
      publishedAt: null,
      publishedByUserId: null
    }
  });
}

export class SystemSettingsRepository {
  constructor(private readonly db: SystemSettingsRepositoryDb) {}

  async getOrCreateDraft(): Promise<SystemSettingsVersionRecord> {
    return mapVersionRow(await getOrCreateDraftRow(this.db));
  }

  async saveDraft(patch: SystemSettingsPayloadPatch): Promise<SystemSettingsVersionRecord> {
    const normalizedPatch = systemSettingsPayloadPatchSchema.parse(patch);
    const draft = await this.getOrCreateDraft();
    const nextPayload = mergeSystemSettingsPayload(draft.payload, normalizedPatch);
    const updated = await this.db.systemSettingsVersion.update({
      where: { id: draft.id },
      data: {
        payload: nextPayload,
        updatedAt: new Date()
      }
    });
    return mapVersionRow(updated);
  }

  async publishDraft(input: SystemSettingsPublishInput): Promise<SystemSettingsVersionRecord> {
    const publishedByUserId = trimOrUndefined(input.publishedByUserId);
    if (!publishedByUserId) {
      throw new Error("publishedByUserId is required");
    }

    return withTransaction(this.db, async (tx) => {
      const draft = await getOrCreateDraftRow(tx);
      const published = await tx.systemSettingsVersion.create({
        data: {
          versionNumber: await nextVersionNumber(tx),
          status: "published",
          payload: draft.payload,
          publishedAt: new Date(),
          publishedByUserId
        }
      });
      return mapVersionRow(published);
    });
  }

  async getCurrentPublished(): Promise<SystemSettingsVersionRecord | undefined> {
    const published = await loadLatestVersion(this.db, "published");
    return published ? mapVersionRow(published) : undefined;
  }

  async listVersions(): Promise<SystemSettingsVersionRecord[]> {
    const rows = await this.db.systemSettingsVersion.findMany({
      orderBy: { versionNumber: "asc" }
    });
    return rows.map(mapVersionRow);
  }
}
