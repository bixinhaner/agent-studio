export type OrganizationInviteRecord = {
  id: string;
  organizationId: string;
  email: string;
  inviteTokenHash: string;
  intendedProvider: string;
  roleTemplate?: unknown;
  status: string;
  expiresAt: string;
  invitedByUserId?: string;
  acceptedByUserId?: string;
  createdAt: string;
  updatedAt: string;
};

type InviteRow = {
  id: string;
  organizationId: string;
  email: string;
  inviteTokenHash: string;
  intendedProvider: string | null;
  roleTemplate: unknown;
  status: string | null;
  expiresAt: Date | string;
  invitedByUserId: string | null;
  acceptedByUserId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type InviteTable = {
  findFirst(args?: {
    where?: { id?: string; inviteTokenHash?: string; email?: string; status?: string };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<InviteRow | null>;
  findMany(args?: {
    where?: { email?: string; organizationId?: string; status?: string };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<InviteRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<InviteRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<InviteRow>;
};

export type OrganizationInviteRepositoryDb = {
  organizationInvite: InviteTable;
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

function mapInvite(row: InviteRow): OrganizationInviteRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    email: row.email,
    inviteTokenHash: row.inviteTokenHash,
    intendedProvider: trimOrUndefined(row.intendedProvider) ?? "email_magic_link",
    roleTemplate: row.roleTemplate ?? undefined,
    status: trimOrUndefined(row.status) ?? "pending",
    expiresAt: toIsoString(row.expiresAt),
    invitedByUserId: trimOrUndefined(row.invitedByUserId),
    acceptedByUserId: trimOrUndefined(row.acceptedByUserId),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

export class OrganizationInviteRepository {
  constructor(private readonly db: OrganizationInviteRepositoryDb) {}

  async create(input: {
    organizationId: string;
    email: string;
    inviteTokenHash: string;
    intendedProvider?: string;
    roleTemplate?: unknown;
    status?: string;
    expiresAt: string | Date;
    invitedByUserId?: string | null;
  }): Promise<OrganizationInviteRecord> {
    const created = await this.db.organizationInvite.create({
      data: {
        organizationId: input.organizationId.trim(),
        email: input.email.trim().toLowerCase(),
        inviteTokenHash: input.inviteTokenHash.trim(),
        intendedProvider: trimOrUndefined(input.intendedProvider) ?? "email_magic_link",
        roleTemplate: input.roleTemplate ?? null,
        status: trimOrUndefined(input.status) ?? "pending",
        expiresAt: input.expiresAt instanceof Date ? input.expiresAt : new Date(input.expiresAt),
        invitedByUserId: trimOrUndefined(input.invitedByUserId ?? undefined) ?? null
      }
    });
    return mapInvite(created);
  }

  async getByTokenHash(inviteTokenHash: string): Promise<OrganizationInviteRecord | undefined> {
    const normalized = trimOrUndefined(inviteTokenHash);
    if (!normalized) return undefined;
    const row = await this.db.organizationInvite.findFirst({
      where: { inviteTokenHash: normalized },
      orderBy: { createdAt: "asc" }
    });
    return row ? mapInvite(row) : undefined;
  }

  async listPendingByEmail(email: string): Promise<OrganizationInviteRecord[]> {
    const normalized = trimOrUndefined(email)?.toLowerCase();
    if (!normalized) return [];
    const rows = await this.db.organizationInvite.findMany({
      where: { email: normalized, status: "pending" },
      orderBy: { createdAt: "asc" }
    });
    return rows.map(mapInvite);
  }

  async accept(id: string, acceptedByUserId: string): Promise<OrganizationInviteRecord> {
    const normalizedId = trimOrUndefined(id);
    const normalizedUserId = trimOrUndefined(acceptedByUserId);
    if (!normalizedId || !normalizedUserId) {
      throw new Error("invite id and acceptedByUserId are required");
    }
    const updated = await this.db.organizationInvite.update({
      where: { id: normalizedId },
      data: {
        status: "accepted",
        acceptedByUserId: normalizedUserId,
        updatedAt: new Date()
      }
    });
    return mapInvite(updated);
  }
}
