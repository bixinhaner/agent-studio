export type AuthIdentityRecord = {
  id: string;
  userId: string;
  provider: string;
  providerSubject: string;
  email?: string;
  emailVerifiedAt?: string;
  profileJson?: unknown;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
};

type AuthIdentityRow = {
  id: string;
  userId: string;
  provider: string;
  providerSubject: string;
  email: string | null;
  emailVerifiedAt: Date | string | null;
  profileJson: unknown;
  lastLoginAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type AuthIdentityTable = {
  findFirst(args?: {
    where?: { userId?: string; provider?: string; providerSubject?: string; email?: string };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<AuthIdentityRow | null>;
  findMany(args?: {
    where?: { userId?: string; provider?: string; email?: string };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<AuthIdentityRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<AuthIdentityRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<AuthIdentityRow>;
};

export type AuthIdentityRepositoryDb = {
  authIdentity: AuthIdentityTable;
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

function mapIdentity(row: AuthIdentityRow): AuthIdentityRecord {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    providerSubject: row.providerSubject,
    email: trimOrUndefined(row.email),
    emailVerifiedAt: row.emailVerifiedAt ? toIsoString(row.emailVerifiedAt) : undefined,
    profileJson: row.profileJson ?? undefined,
    lastLoginAt: row.lastLoginAt ? toIsoString(row.lastLoginAt) : undefined,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

export class AuthIdentityRepository {
  constructor(private readonly db: AuthIdentityRepositoryDb) {}

  async getByProviderSubject(provider: string, providerSubject: string): Promise<AuthIdentityRecord | undefined> {
    const normalizedProvider = trimOrUndefined(provider);
    const normalizedSubject = trimOrUndefined(providerSubject);
    if (!normalizedProvider || !normalizedSubject) return undefined;
    const row = await this.db.authIdentity.findFirst({
      where: { provider: normalizedProvider, providerSubject: normalizedSubject },
      orderBy: { createdAt: "asc" }
    });
    return row ? mapIdentity(row) : undefined;
  }

  async listByEmail(email: string): Promise<AuthIdentityRecord[]> {
    const normalized = trimOrUndefined(email)?.toLowerCase();
    if (!normalized) return [];
    const rows = await this.db.authIdentity.findMany({
      where: { email: normalized },
      orderBy: { createdAt: "asc" }
    });
    return rows.map(mapIdentity);
  }

  async listForUser(userId: string): Promise<AuthIdentityRecord[]> {
    const normalized = trimOrUndefined(userId);
    if (!normalized) return [];
    const rows = await this.db.authIdentity.findMany({
      where: { userId: normalized },
      orderBy: { createdAt: "asc" }
    });
    return rows.map(mapIdentity);
  }

  async upsert(input: {
    userId: string;
    provider: string;
    providerSubject: string;
    email?: string | null;
    emailVerifiedAt?: string | Date | null;
    profileJson?: unknown;
    lastLoginAt?: string | Date | null;
  }): Promise<AuthIdentityRecord> {
    const userId = trimOrUndefined(input.userId);
    const provider = trimOrUndefined(input.provider);
    const providerSubject = trimOrUndefined(input.providerSubject);
    if (!userId || !provider || !providerSubject) {
      throw new Error("userId, provider, and providerSubject are required");
    }

    const existing = await this.db.authIdentity.findFirst({
      where: { provider, providerSubject },
      orderBy: { createdAt: "asc" }
    });

    if (!existing) {
      const created = await this.db.authIdentity.create({
        data: {
          userId,
          provider,
          providerSubject,
          email: trimOrUndefined(input.email ?? undefined)?.toLowerCase() ?? null,
          emailVerifiedAt:
            input.emailVerifiedAt instanceof Date
              ? input.emailVerifiedAt
              : input.emailVerifiedAt
                ? new Date(input.emailVerifiedAt)
                : null,
          profileJson: input.profileJson ?? null,
          lastLoginAt:
            input.lastLoginAt instanceof Date ? input.lastLoginAt : input.lastLoginAt ? new Date(input.lastLoginAt) : null
        }
      });
      return mapIdentity(created);
    }

    const updated = await this.db.authIdentity.update({
      where: { id: existing.id },
      data: {
        userId,
        email: input.email === undefined ? existing.email : trimOrUndefined(input.email ?? undefined)?.toLowerCase() ?? null,
        emailVerifiedAt:
          input.emailVerifiedAt === undefined
            ? existing.emailVerifiedAt
            : input.emailVerifiedAt instanceof Date
              ? input.emailVerifiedAt
              : input.emailVerifiedAt
                ? new Date(input.emailVerifiedAt)
                : null,
        profileJson: input.profileJson === undefined ? existing.profileJson : input.profileJson ?? null,
        lastLoginAt:
          input.lastLoginAt === undefined
            ? existing.lastLoginAt
            : input.lastLoginAt instanceof Date
              ? input.lastLoginAt
              : input.lastLoginAt
                ? new Date(input.lastLoginAt)
                : null,
        updatedAt: new Date()
      }
    });
    return mapIdentity(updated);
  }
}
