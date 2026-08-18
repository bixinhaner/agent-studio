export type LoginChallengeRecord = {
  id: string;
  publicBrandId?: string;
  channel: string;
  targetRef: string;
  challengeHash: string;
  purpose: string;
  organizationId?: string;
  inviteId?: string;
  expiresAt: string;
  consumedAt?: string;
  createdAt: string;
  updatedAt: string;
};

type LoginChallengeRow = {
  id: string;
  publicBrandId: string | null;
  channel: string;
  targetRef: string;
  challengeHash: string;
  purpose: string;
  organizationId: string | null;
  inviteId: string | null;
  expiresAt: Date | string;
  consumedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type LoginChallengeTable = {
  findMany(args?: {
    where?: { targetRef?: string; purpose?: string; channel?: string; consumedAt?: null; inviteId?: string | null; publicBrandId?: string | null };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<LoginChallengeRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<LoginChallengeRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<LoginChallengeRow>;
  deleteMany?(args: { where?: { targetRef?: string; purpose?: string; channel?: string; consumedAt?: null; publicBrandId?: string | null } }): Promise<{ count: number }>;
};

export type LoginChallengeRepositoryDb = {
  loginChallenge: LoginChallengeTable;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function mapChallenge(row: LoginChallengeRow): LoginChallengeRecord {
  return {
    id: row.id,
    publicBrandId: trimOrUndefined(row.publicBrandId),
    channel: row.channel,
    targetRef: row.targetRef,
    challengeHash: row.challengeHash,
    purpose: row.purpose,
    organizationId: trimOrUndefined(row.organizationId),
    inviteId: trimOrUndefined(row.inviteId),
    expiresAt: toIsoString(row.expiresAt),
    consumedAt: row.consumedAt ? toIsoString(row.consumedAt) : undefined,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

export class LoginChallengeRepository {
  constructor(private readonly db: LoginChallengeRepositoryDb) {}

  async create(input: {
    publicBrandId?: string | null;
    channel: string;
    targetRef: string;
    challengeHash: string;
    purpose: string;
    organizationId?: string | null;
    inviteId?: string | null;
    expiresAt: string | Date;
  }): Promise<LoginChallengeRecord> {
    if (typeof this.db.loginChallenge.deleteMany === "function") {
      await this.db.loginChallenge.deleteMany({
        where: {
          channel: input.channel.trim(),
          targetRef: input.targetRef.trim().toLowerCase(),
          purpose: input.purpose.trim(),
          consumedAt: null,
          publicBrandId: trimOrUndefined(input.publicBrandId ?? undefined) ?? null
        }
      });
    }
    const created = await this.db.loginChallenge.create({
      data: {
        publicBrandId: trimOrUndefined(input.publicBrandId ?? undefined) ?? null,
        channel: input.channel.trim(),
        targetRef: input.targetRef.trim().toLowerCase(),
        challengeHash: input.challengeHash.trim(),
        purpose: input.purpose.trim(),
        organizationId: trimOrUndefined(input.organizationId ?? undefined) ?? null,
        inviteId: trimOrUndefined(input.inviteId ?? undefined) ?? null,
        expiresAt: input.expiresAt instanceof Date ? input.expiresAt : new Date(input.expiresAt)
      }
    });
    return mapChallenge(created);
  }

  async listActive(input: { channel: string; targetRef: string; purpose: string; publicBrandId?: string | null }): Promise<LoginChallengeRecord[]> {
    const rows = await this.db.loginChallenge.findMany({
      where: {
        channel: input.channel.trim(),
        targetRef: input.targetRef.trim().toLowerCase(),
        purpose: input.purpose.trim(),
        consumedAt: null,
        publicBrandId: trimOrUndefined(input.publicBrandId ?? undefined) ?? null
      },
      orderBy: { createdAt: "desc" }
    });
    const now = Date.now();
    return rows
      .map(mapChallenge)
      .filter((row) => !row.consumedAt && new Date(row.expiresAt).getTime() > now);
  }

  async consume(id: string): Promise<LoginChallengeRecord> {
    const normalized = trimOrUndefined(id);
    if (!normalized) {
      throw new Error("Challenge does not exist");
    }
    const updated = await this.db.loginChallenge.update({
      where: { id: normalized },
      data: {
        consumedAt: new Date(),
        updatedAt: new Date()
      }
    });
    return mapChallenge(updated);
  }
}
