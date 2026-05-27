export type AuthenticatedUser = {
  id: string;
  userType?: string;
  primaryOrganizationId?: string;
  externalId?: string;
  email?: string;
  displayName?: string;
  role?: string;
  status?: string;
  portalPreferences?: UserPortalPreferences;
  createdAt: string;
  updatedAt: string;
};

export type UserPortalPreferences = {
  showProcessTrace?: boolean;
  collapseFinalTraceOnDone?: boolean;
};

export type UserRecord = AuthenticatedUser & {
  statusSource: string;
  syncState: string;
  manualDisabled: boolean;
  adminNote?: string;
  lastSyncedAt?: string;
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
  getByEmail?(email: string): Promise<AuthenticatedUser | undefined>;
  upsertFromDingTalk(identity: DingTalkUserIdentity): Promise<AuthenticatedUser>;
  createUser?(input: {
    externalId?: string | null;
    email?: string | null;
    displayName?: string | null;
    userType?: string;
    primaryOrganizationId?: string | null;
    role?: string;
  }): Promise<AuthenticatedUser>;
  updateUserProfile?(input: {
    userId: string;
    externalId?: string | null;
    email?: string | null;
    displayName?: string | null;
    userType?: string;
    primaryOrganizationId?: string | null;
  }): Promise<AuthenticatedUser>;
  updateLegacyRole?(input: { userId: string; role: string }): Promise<AuthenticatedUser>;
  updateLocalSettings(input: {
    userId: string;
    role: string;
    manualDisabled: boolean;
    adminNote?: string | null;
  }): Promise<UserRecord>;
  updatePortalPreferences?(input: {
    userId: string;
    portalPreferences: UserPortalPreferences;
  }): Promise<AuthenticatedUser>;
}

type UserRow = {
  id: string;
  userType?: string | null;
  primaryOrganizationId?: string | null;
  externalId: string | null;
  email: string | null;
  displayName: string | null;
  role: string | null;
  status: string | null;
  statusSource?: string | null;
  syncState?: string | null;
  manualDisabled?: boolean;
  adminNote?: string | null;
  preferencesJson?: unknown;
  lastSyncedAt?: Date | string | null;
  dingtalkOpenId?: string | null;
  dingtalkUserId?: string | null;
  dingtalkCorpId?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type UserTable = {
  count(args?: unknown): Promise<number>;
  findUnique(args: { where: { id?: string; externalId?: string } }): Promise<UserRow | null>;
  findFirst(args?: {
    where?: { email?: string; status?: string; role?: string };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<UserRow | null>;
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function normalizePortalPreferences(value: unknown): UserPortalPreferences | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const showProcessTrace =
    typeof record.showProcessTrace === "boolean"
      ? record.showProcessTrace
      : typeof record.show_process_trace === "boolean"
        ? record.show_process_trace
        : undefined;
  const collapseFinalTraceOnDone =
    typeof record.collapseFinalTraceOnDone === "boolean"
      ? record.collapseFinalTraceOnDone
      : typeof record.collapse_final_trace_on_done === "boolean"
        ? record.collapse_final_trace_on_done
        : undefined;
  if (showProcessTrace === undefined && collapseFinalTraceOnDone === undefined) {
    return undefined;
  }
  return {
    ...(showProcessTrace !== undefined ? { showProcessTrace } : {}),
    ...(collapseFinalTraceOnDone !== undefined ? { collapseFinalTraceOnDone } : {})
  };
}

function readPortalPreferences(value: unknown): UserPortalPreferences | undefined {
  const root = asRecord(value);
  if (!root) return undefined;
  return normalizePortalPreferences(root.portal ?? root.portalPreferences ?? root.portal_preferences);
}

function mergePreferencesJson(
  existingValue: unknown,
  portalPreferences: UserPortalPreferences
): Record<string, unknown> | null {
  const existing = asRecord(existingValue) ? { ...(asRecord(existingValue) as Record<string, unknown>) } : {};
  const currentPortal = readPortalPreferences(existing) ?? {};
  const nextPortal: UserPortalPreferences = {
    ...(currentPortal.showProcessTrace !== undefined ? { showProcessTrace: currentPortal.showProcessTrace } : {}),
    ...(currentPortal.collapseFinalTraceOnDone !== undefined
      ? { collapseFinalTraceOnDone: currentPortal.collapseFinalTraceOnDone }
      : {}),
    ...(portalPreferences.showProcessTrace !== undefined ? { showProcessTrace: portalPreferences.showProcessTrace } : {}),
    ...(portalPreferences.collapseFinalTraceOnDone !== undefined
      ? { collapseFinalTraceOnDone: portalPreferences.collapseFinalTraceOnDone }
      : {})
  };
  if (Object.keys(nextPortal).length > 0) {
    existing.portal = nextPortal;
  } else {
    delete existing.portal;
  }
  return Object.keys(existing).length > 0 ? existing : null;
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
    userType: trimOrUndefined(row.userType) ?? "internal_employee",
    primaryOrganizationId: trimOrUndefined(row.primaryOrganizationId),
    externalId: trimOrUndefined(row.externalId),
    email: trimOrUndefined(row.email),
    displayName: trimOrUndefined(row.displayName),
    role: trimOrUndefined(row.role) ?? "employee",
    status: trimOrUndefined(row.status) ?? "active",
    portalPreferences: readPortalPreferences(row.preferencesJson),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

function mapUserRecord(row: UserRow): UserRecord {
  return {
    ...mapUser(row),
    statusSource: trimOrUndefined(row.statusSource) ?? "sync",
    syncState: trimOrUndefined(row.syncState) ?? "active",
    manualDisabled: Boolean(row.manualDisabled),
    adminNote: trimOrUndefined(row.adminNote),
    lastSyncedAt: row.lastSyncedAt ? toIsoString(row.lastSyncedAt) : undefined
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

  async getByEmail(email: string): Promise<AuthenticatedUser | undefined> {
    const normalized = trimOrUndefined(email)?.toLowerCase();
    if (!normalized) return undefined;
    const row = await this.db.user.findFirst({
      where: { email: normalized },
      orderBy: { createdAt: "asc" }
    });
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
          userType: existingByExternalId.userType ?? "internal_employee",
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
        userType: "internal_employee",
        externalId,
        email: email ?? null,
        displayName: displayName ?? null,
        role: "employee",
        status: "active",
        statusSource: "sync",
        syncState: "active",
        manualDisabled: false,
        adminNote: null,
        dingtalkOpenId: dingtalkOpenId ?? null,
        dingtalkUserId: dingtalkUserId ?? null,
        dingtalkCorpId: dingtalkCorpId ?? null
      }
    });
    return mapUser(created);
  }

  async createUser(input: {
    externalId?: string | null;
    email?: string | null;
    displayName?: string | null;
    userType?: string;
    primaryOrganizationId?: string | null;
    role?: string;
  }): Promise<AuthenticatedUser> {
    const created = await this.db.user.create({
      data: {
        userType: trimOrUndefined(input.userType) ?? "external_user",
        externalId: trimOrUndefined(input.externalId ?? undefined) ?? null,
        primaryOrganizationId: trimOrUndefined(input.primaryOrganizationId ?? undefined) ?? null,
        email: trimOrUndefined(input.email ?? undefined)?.toLowerCase() ?? null,
        displayName: trimOrUndefined(input.displayName ?? undefined) ?? null,
        role: trimOrUndefined(input.role) ?? "employee",
        status: "active",
        statusSource: "manual",
        syncState: "active",
        manualDisabled: false,
        adminNote: null
      }
    });
    return mapUser(created);
  }

  async updateUserProfile(input: {
    userId: string;
    externalId?: string | null;
    email?: string | null;
    displayName?: string | null;
    userType?: string;
    primaryOrganizationId?: string | null;
  }): Promise<AuthenticatedUser> {
    const userId = trimOrUndefined(input.userId);
    if (!userId) {
      throw new Error("user 不存在");
    }

    const existing = await this.db.user.findUnique({ where: { id: userId } });
    if (!existing) {
      throw new Error("user 不存在");
    }

    const updated = await this.db.user.update({
      where: { id: userId },
      data: {
        externalId:
          input.externalId === undefined ? existing.externalId : trimOrUndefined(input.externalId ?? undefined) ?? null,
        email:
          input.email === undefined ? existing.email : trimOrUndefined(input.email ?? undefined)?.toLowerCase() ?? null,
        displayName:
          input.displayName === undefined ? existing.displayName : trimOrUndefined(input.displayName ?? undefined) ?? null,
        userType: input.userType === undefined ? existing.userType : trimOrUndefined(input.userType) ?? existing.userType,
        primaryOrganizationId:
          input.primaryOrganizationId === undefined
            ? existing.primaryOrganizationId
            : trimOrUndefined(input.primaryOrganizationId ?? undefined) ?? null,
        updatedAt: new Date()
      }
    });
    return mapUser(updated);
  }

  async updateLocalSettings(input: {
    userId: string;
    role: string;
    manualDisabled: boolean;
    adminNote?: string | null;
  }): Promise<UserRecord> {
    const userId = trimOrUndefined(input.userId);
    if (!userId) {
      throw new Error("user 不存在");
    }

    const existing = await this.db.user.findUnique({ where: { id: userId } });
    if (!existing) {
      throw new Error("user 不存在");
    }

    const role = trimOrUndefined(input.role) ?? existing.role ?? "employee";
    const adminNote =
      input.adminNote === undefined ? existing.adminNote ?? null : trimOrUndefined(input.adminNote) ?? null;
    const syncState = trimOrUndefined(existing.syncState) ?? "active";
    const manualDisabled = input.manualDisabled;
    const status = manualDisabled
      ? "disabled"
      : syncState === "disabled" || syncState === "departed"
        ? "disabled"
        : "active";

    const updated = await this.db.user.update({
      where: { id: userId },
      data: {
        role,
        manualDisabled,
        adminNote,
        status,
        statusSource: manualDisabled ? "manual_disable" : "sync"
      }
    });

    return mapUserRecord(updated);
  }

  async updateLegacyRole(input: { userId: string; role: string }): Promise<AuthenticatedUser> {
    const userId = trimOrUndefined(input.userId);
    if (!userId) {
      throw new Error("user 不存在");
    }

    const existing = await this.db.user.findUnique({ where: { id: userId } });
    if (!existing) {
      throw new Error("user 不存在");
    }

    const updated = await this.db.user.update({
      where: { id: userId },
      data: {
        role: trimOrUndefined(input.role) ?? existing.role ?? "employee",
        updatedAt: new Date()
      }
    });
    return mapUser(updated);
  }

  async updatePortalPreferences(input: {
    userId: string;
    portalPreferences: UserPortalPreferences;
  }): Promise<AuthenticatedUser> {
    const userId = trimOrUndefined(input.userId);
    if (!userId) {
      throw new Error("user 不存在");
    }

    const existing = await this.db.user.findUnique({ where: { id: userId } });
    if (!existing) {
      throw new Error("user 不存在");
    }

    const updated = await this.db.user.update({
      where: { id: userId },
      data: {
        preferencesJson: mergePreferencesJson(existing.preferencesJson, input.portalPreferences),
        updatedAt: new Date()
      }
    });
    return mapUser(updated);
  }
}
