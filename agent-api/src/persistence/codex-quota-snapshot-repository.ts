export type CodexQuotaSnapshotRecord = {
  id: string;
  credentialHash: string;
  limitId: string;
  resetAt: string;
  windowDurationMins: number;
  usedPercent: number;
  remainingPercent: number;
  ordinaryUsageAllowed: boolean;
  planType?: string;
  creditsAvailable?: boolean;
  creditsBalance?: string;
  observedAt: string;
  sampleBucket: string;
};

export type UpsertCodexQuotaSnapshotInput = Omit<CodexQuotaSnapshotRecord, "id" | "observedAt"> & {
  observedAt?: string | Date;
};

export type ListCodexQuotaSnapshotsInput = {
  from?: string | Date;
  to?: string | Date;
};

type CodexQuotaSnapshotRow = {
  id: string;
  credentialHash: string;
  limitId: string;
  resetAt: Date | string;
  windowDurationMins: number;
  usedPercent: number;
  remainingPercent: number;
  ordinaryUsageAllowed: boolean;
  planType: string | null;
  creditsAvailable: boolean | null;
  creditsBalance: string | null;
  observedAt: Date | string;
  sampleBucket: Date | string;
};

type CodexQuotaSnapshotTable = {
  upsert(args: { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<CodexQuotaSnapshotRow>;
  findMany(args?: { where?: Record<string, unknown>; orderBy?: Record<string, "asc" | "desc"> }): Promise<CodexQuotaSnapshotRow[]>;
};

export type CodexQuotaSnapshotRepositoryDb = {
  codexQuotaSnapshot: CodexQuotaSnapshotTable;
};

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function toIso(value: string | Date): string {
  const date = toDate(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function mapRow(row: CodexQuotaSnapshotRow): CodexQuotaSnapshotRecord {
  return {
    id: row.id,
    credentialHash: row.credentialHash,
    limitId: row.limitId,
    resetAt: toIso(row.resetAt),
    windowDurationMins: row.windowDurationMins,
    usedPercent: row.usedPercent,
    remainingPercent: row.remainingPercent,
    ordinaryUsageAllowed: row.ordinaryUsageAllowed,
    ...(row.planType ? { planType: row.planType } : {}),
    ...(row.creditsAvailable === null ? {} : { creditsAvailable: row.creditsAvailable }),
    ...(row.creditsBalance ? { creditsBalance: row.creditsBalance } : {}),
    observedAt: toIso(row.observedAt),
    sampleBucket: toIso(row.sampleBucket)
  };
}

export class CodexQuotaSnapshotRepository {
  constructor(private readonly db: CodexQuotaSnapshotRepositoryDb) {}

  async upsertHourly(input: UpsertCodexQuotaSnapshotInput): Promise<CodexQuotaSnapshotRecord> {
    const observedAt = input.observedAt ? toDate(input.observedAt) : new Date();
    const resetAt = toDate(input.resetAt);
    const sampleBucket = toDate(input.sampleBucket);
    const data = {
      credentialHash: input.credentialHash,
      limitId: input.limitId,
      resetAt,
      windowDurationMins: input.windowDurationMins,
      usedPercent: input.usedPercent,
      remainingPercent: input.remainingPercent,
      ordinaryUsageAllowed: input.ordinaryUsageAllowed,
      planType: input.planType ?? null,
      creditsAvailable: input.creditsAvailable ?? null,
      creditsBalance: input.creditsBalance ?? null,
      observedAt,
      sampleBucket
    };
    const row = await this.db.codexQuotaSnapshot.upsert({
      where: {
        credentialHash_limitId_resetAt_sampleBucket: {
          credentialHash: input.credentialHash,
          limitId: input.limitId,
          resetAt,
          sampleBucket
        }
      },
      create: data,
      update: data
    });
    return mapRow(row);
  }

  async list(input: ListCodexQuotaSnapshotsInput = {}): Promise<CodexQuotaSnapshotRecord[]> {
    const observedAt: Record<string, Date> = {};
    if (input.from) observedAt.gte = toDate(input.from);
    if (input.to) observedAt.lte = toDate(input.to);
    const rows = await this.db.codexQuotaSnapshot.findMany({
      where: Object.keys(observedAt).length ? { observedAt } : undefined,
      orderBy: { observedAt: "asc" }
    });
    return rows.map(mapRow);
  }
}
