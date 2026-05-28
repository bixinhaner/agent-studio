export type CrestDelegationCredentialRecord = {
  id: string;
  userId: string;
  providerSubject?: string;
  delegationToken: string;
  delegationExpiresAt: string;
  delegationRefreshToken?: string;
  delegationRefreshExpiresAt?: string;
  lastRefreshedAt?: string;
  createdAt: string;
  updatedAt: string;
};

type CrestDelegationCredentialRow = {
  id: string;
  userId: string;
  providerSubject: string | null;
  delegationToken: string;
  delegationExpiresAt: Date | string;
  delegationRefreshToken: string | null;
  delegationRefreshExpiresAt: Date | string | null;
  lastRefreshedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type CrestDelegationCredentialTable = {
  findUnique(args: { where: { userId: string } }): Promise<CrestDelegationCredentialRow | null>;
  upsert(args: {
    where: { userId: string };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<CrestDelegationCredentialRow>;
  deleteMany(args: { where: { userId: string } }): Promise<{ count: number }>;
};

export type CrestDelegationCredentialRepositoryDb = {
  crestDelegationCredential: CrestDelegationCredentialTable;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toDate(value: string | Date | undefined | null): Date | undefined {
  if (!value) return undefined;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function mapCredential(row: CrestDelegationCredentialRow): CrestDelegationCredentialRecord {
  return {
    id: row.id,
    userId: row.userId,
    providerSubject: trimOrUndefined(row.providerSubject),
    delegationToken: row.delegationToken,
    delegationExpiresAt: toIsoString(row.delegationExpiresAt),
    delegationRefreshToken: trimOrUndefined(row.delegationRefreshToken),
    delegationRefreshExpiresAt: row.delegationRefreshExpiresAt ? toIsoString(row.delegationRefreshExpiresAt) : undefined,
    lastRefreshedAt: row.lastRefreshedAt ? toIsoString(row.lastRefreshedAt) : undefined,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

export class CrestDelegationCredentialRepository {
  constructor(private readonly db: CrestDelegationCredentialRepositoryDb) {}

  async getForUser(userId: string): Promise<CrestDelegationCredentialRecord | undefined> {
    const normalized = trimOrUndefined(userId);
    if (!normalized) return undefined;
    const row = await this.db.crestDelegationCredential.findUnique({ where: { userId: normalized } });
    return row ? mapCredential(row) : undefined;
  }

  async upsertForUser(input: {
    userId: string;
    providerSubject?: string;
    delegationToken: string;
    delegationExpiresAt: string | Date;
    delegationRefreshToken?: string;
    delegationRefreshExpiresAt?: string | Date | null;
    lastRefreshedAt?: string | Date | null;
  }): Promise<CrestDelegationCredentialRecord> {
    const userId = trimOrUndefined(input.userId);
    const delegationToken = trimOrUndefined(input.delegationToken);
    const delegationExpiresAt = toDate(input.delegationExpiresAt);
    if (!userId || !delegationToken || !delegationExpiresAt) {
      throw new Error("userId, delegationToken, and delegationExpiresAt are required");
    }

    const data = {
      providerSubject: trimOrUndefined(input.providerSubject) ?? null,
      delegationToken,
      delegationExpiresAt,
      delegationRefreshToken: trimOrUndefined(input.delegationRefreshToken) ?? null,
      delegationRefreshExpiresAt: toDate(input.delegationRefreshExpiresAt) ?? null,
      lastRefreshedAt: toDate(input.lastRefreshedAt) ?? null,
      updatedAt: new Date()
    };

    const row = await this.db.crestDelegationCredential.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data
    });
    return mapCredential(row);
  }

  async deleteForUser(userId: string): Promise<void> {
    const normalized = trimOrUndefined(userId);
    if (!normalized) return;
    await this.db.crestDelegationCredential.deleteMany({ where: { userId: normalized } });
  }

  isUsable(record: CrestDelegationCredentialRecord | undefined, now = Date.now()): boolean {
    if (!record) return false;
    const accessExpiresAt = new Date(record.delegationExpiresAt).getTime();
    const refreshExpiresAt = record.delegationRefreshExpiresAt
      ? new Date(record.delegationRefreshExpiresAt).getTime()
      : Number.NaN;
    return accessExpiresAt > now || refreshExpiresAt > now;
  }
}
