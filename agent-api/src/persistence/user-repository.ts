export type AuthenticatedUser = {
  id: string;
  externalId?: string;
  email?: string;
  displayName?: string;
  role?: string;
  status?: string;
  createdAt: string;
  updatedAt: string;
};

export type DingTalkUserIdentity = {
  unionId: string;
  openId?: string;
  userId?: string;
  corpId?: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  mobile?: string;
};

export interface UserRepositoryLike {
  getById(id: string): Promise<AuthenticatedUser | undefined>;
  getByExternalId(externalId: string): Promise<AuthenticatedUser | undefined>;
  upsertFromDingTalk(identity: DingTalkUserIdentity): Promise<AuthenticatedUser>;
}

type UserRow = {
  id: string;
  externalId: string | null;
  email: string | null;
  displayName: string | null;
  role: string | null;
  status: string | null;
  dingtalkOpenId?: string | null;
  dingtalkUserId?: string | null;
  dingtalkCorpId?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type UserTable = {
  count(args?: unknown): Promise<number>;
  findUnique(args: { where: { id?: string; externalId?: string; email?: string } }): Promise<UserRow | null>;
  findMany(args?: { where?: { status?: string; role?: string }; orderBy?: { createdAt: "asc" | "desc" } }): Promise<UserRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<UserRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<UserRow>;
};

export type UserRepositoryDb = {
  user: UserTable;
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

function mapUser(row: UserRow): AuthenticatedUser {
  return {
    id: row.id,
    externalId: trimOrUndefined(row.externalId),
    email: trimOrUndefined(row.email),
    displayName: trimOrUndefined(row.displayName),
    role: trimOrUndefined(row.role) ?? "employee",
    status: trimOrUndefined(row.status) ?? "active",
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

export class UserRepository implements UserRepositoryLike {
  constructor(private readonly db: UserRepositoryDb) {}

  async count(): Promise<number> {
    return this.db.user.count();
  }

  async getById(id: string): Promise<AuthenticatedUser | undefined> {
    const userId = trimOrUndefined(id);
    if (!userId) return undefined;
    const row = await this.db.user.findUnique({ where: { id: userId } });
    return row ? mapUser(row) : undefined;
  }

  async getByExternalId(externalId: string): Promise<AuthenticatedUser | undefined> {
    const normalized = trimOrUndefined(externalId);
    if (!normalized) return undefined;
    const row = await this.db.user.findUnique({ where: { externalId: normalized } });
    return row ? mapUser(row) : undefined;
  }

  async findLegacyImportOwnerId(preferredId?: string): Promise<string | undefined> {
    const preferred = trimOrUndefined(preferredId);
    if (preferred) {
      const existing = await this.getById(preferred);
      if (existing?.status === "active") {
        return existing.id;
      }
    }

    const admins = await this.db.user.findMany({
      where: { status: "active", role: "admin" },
      orderBy: { createdAt: "asc" }
    });
    if (admins[0]?.id) {
      return admins[0].id;
    }

    const activeUsers = await this.db.user.findMany({
      where: { status: "active" },
      orderBy: { createdAt: "asc" }
    });
    return activeUsers[0]?.id;
  }

  async upsertFromDingTalk(identity: DingTalkUserIdentity): Promise<AuthenticatedUser> {
    const externalId = trimOrUndefined(identity.unionId);
    if (!externalId) {
      throw new Error("DingTalk user is missing a stable unionId");
    }

    const email = trimOrUndefined(identity.email)?.toLowerCase();
    const displayName = trimOrUndefined(identity.displayName);
    const dingtalkOpenId = trimOrUndefined(identity.openId);
    const dingtalkUserId = trimOrUndefined(identity.userId);
    const dingtalkCorpId = trimOrUndefined(identity.corpId);
    const existingByExternalId = await this.db.user.findUnique({ where: { externalId } });
    if (existingByExternalId) {
      const updated = await this.db.user.update({
        where: { id: existingByExternalId.id },
        data: {
          externalId,
          email: email ?? existingByExternalId.email,
          displayName: displayName ?? existingByExternalId.displayName,
          dingtalkOpenId: dingtalkOpenId ?? existingByExternalId.dingtalkOpenId ?? null,
          dingtalkUserId: dingtalkUserId ?? existingByExternalId.dingtalkUserId ?? null,
          dingtalkCorpId: dingtalkCorpId ?? existingByExternalId.dingtalkCorpId ?? null
        }
      });
      return mapUser(updated);
    }

    const created = await this.db.user.create({
      data: {
        externalId,
        email: email ?? null,
        displayName: displayName ?? null,
        role: "employee",
        status: "active",
        dingtalkOpenId: dingtalkOpenId ?? null,
        dingtalkUserId: dingtalkUserId ?? null,
        dingtalkCorpId: dingtalkCorpId ?? null
      }
    });
    return mapUser(created);
  }
}
