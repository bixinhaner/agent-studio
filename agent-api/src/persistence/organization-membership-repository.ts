import type { OrganizationRecord } from "./organization-repository.js";

export type OrganizationMembershipRecord = {
  id: string;
  organizationId: string;
  userId: string;
  membershipType: string;
  status: string;
  displayNameOverride?: string;
  title?: string;
  invitedByUserId?: string;
  joinedAt?: string;
  createdAt: string;
  updatedAt: string;
  organization?: OrganizationRecord;
};

type OrganizationRow = {
  id: string;
  slug: string;
  name: string;
  type: string | null;
  status: string | null;
  publicBrandId: string | null;
  ownerUserId: string | null;
  settingsJson: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type MembershipRow = {
  id: string;
  organizationId: string;
  userId: string;
  membershipType: string | null;
  status: string | null;
  displayNameOverride: string | null;
  title: string | null;
  invitedByUserId: string | null;
  joinedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  organization?: OrganizationRow | null;
};

type MembershipTable = {
  findMany(args?: {
    where?: { userId?: string; organizationId?: string; email?: string; status?: string };
    include?: { organization?: boolean };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<MembershipRow[]>;
  findFirst(args?: {
    where?: { userId?: string; organizationId?: string; status?: string };
    include?: { organization?: boolean };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<MembershipRow | null>;
  create(args: { data: Record<string, unknown> }): Promise<MembershipRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<MembershipRow>;
};

export type OrganizationMembershipRepositoryDb = {
  organizationMembership: MembershipTable;
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

function mapOrganization(row: OrganizationRow): OrganizationRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    type: trimOrUndefined(row.type) ?? "customer",
    status: trimOrUndefined(row.status) ?? "active",
    publicBrandId: trimOrUndefined(row.publicBrandId),
    ownerUserId: trimOrUndefined(row.ownerUserId),
    settingsJson: row.settingsJson ?? undefined,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

function mapMembership(row: MembershipRow): OrganizationMembershipRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    membershipType: trimOrUndefined(row.membershipType) ?? "customer_member",
    status: trimOrUndefined(row.status) ?? "active",
    displayNameOverride: trimOrUndefined(row.displayNameOverride),
    title: trimOrUndefined(row.title),
    invitedByUserId: trimOrUndefined(row.invitedByUserId),
    joinedAt: row.joinedAt ? toIsoString(row.joinedAt) : undefined,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
    organization: row.organization ? mapOrganization(row.organization) : undefined
  };
}

export class OrganizationMembershipRepository {
  constructor(private readonly db: OrganizationMembershipRepositoryDb) {}

  async listForUser(userId: string): Promise<OrganizationMembershipRecord[]> {
    const normalized = trimOrUndefined(userId);
    if (!normalized) return [];
    const rows = await this.db.organizationMembership.findMany({
      where: { userId: normalized },
      include: { organization: true },
      orderBy: { createdAt: "asc" }
    });
    return rows.map(mapMembership);
  }

  async listActiveForUser(userId: string): Promise<OrganizationMembershipRecord[]> {
    const rows = await this.listForUser(userId);
    return rows.filter((row) => row.status === "active" && row.organization?.status === "active");
  }

  async getActiveForUserAndOrganization(userId: string, organizationId: string): Promise<OrganizationMembershipRecord | undefined> {
    const normalizedUserId = trimOrUndefined(userId);
    const normalizedOrganizationId = trimOrUndefined(organizationId);
    if (!normalizedUserId || !normalizedOrganizationId) return undefined;
    const row = await this.db.organizationMembership.findFirst({
      where: {
        userId: normalizedUserId,
        organizationId: normalizedOrganizationId,
        status: "active"
      },
      include: { organization: true },
      orderBy: { createdAt: "asc" }
    });
    return row ? mapMembership(row) : undefined;
  }

  async upsert(input: {
    organizationId: string;
    userId: string;
    membershipType?: string;
    status?: string;
    displayNameOverride?: string | null;
    title?: string | null;
    invitedByUserId?: string | null;
    joinedAt?: string | Date | null;
  }): Promise<OrganizationMembershipRecord> {
    const organizationId = trimOrUndefined(input.organizationId);
    const userId = trimOrUndefined(input.userId);
    if (!organizationId || !userId) {
      throw new Error("organizationId and userId are required");
    }

    const existing = await this.db.organizationMembership.findFirst({
      where: { organizationId, userId },
      include: { organization: true },
      orderBy: { createdAt: "asc" }
    });

    if (!existing) {
      const created = await this.db.organizationMembership.create({
        data: {
          organizationId,
          userId,
          membershipType: trimOrUndefined(input.membershipType) ?? "customer_member",
          status: trimOrUndefined(input.status) ?? "active",
          displayNameOverride: trimOrUndefined(input.displayNameOverride ?? undefined) ?? null,
          title: trimOrUndefined(input.title ?? undefined) ?? null,
          invitedByUserId: trimOrUndefined(input.invitedByUserId ?? undefined) ?? null,
          joinedAt: input.joinedAt instanceof Date ? input.joinedAt : input.joinedAt ? new Date(input.joinedAt) : new Date()
        }
      });
      return mapMembership(created);
    }

    const updated = await this.db.organizationMembership.update({
      where: { id: existing.id },
      data: {
        membershipType:
          input.membershipType === undefined ? existing.membershipType : trimOrUndefined(input.membershipType) ?? existing.membershipType,
        status: input.status === undefined ? existing.status : trimOrUndefined(input.status) ?? existing.status,
        displayNameOverride:
          input.displayNameOverride === undefined
            ? existing.displayNameOverride
            : trimOrUndefined(input.displayNameOverride ?? undefined) ?? null,
        title: input.title === undefined ? existing.title : trimOrUndefined(input.title ?? undefined) ?? null,
        invitedByUserId:
          input.invitedByUserId === undefined
            ? existing.invitedByUserId
            : trimOrUndefined(input.invitedByUserId ?? undefined) ?? null,
        joinedAt:
          input.joinedAt === undefined
            ? existing.joinedAt
            : input.joinedAt instanceof Date
              ? input.joinedAt
              : input.joinedAt
                ? new Date(input.joinedAt)
                : null,
        updatedAt: new Date()
      }
    });
    return mapMembership(updated);
  }
}
