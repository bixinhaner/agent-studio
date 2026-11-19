import type { PrismaClient } from "@prisma/client";

import type {
  OrgTeamEventRow,
  OrgTeamInviteRow,
  OrgTeamJoinRequestRow,
  OrgTeamMemberRow,
  OrgTeamOrganization,
  OrgTeamStore
} from "./service.js";

const PROVISIONED_ACCESS_REQUEST_STATUSES = ["provisioned", "invited", "activated"];

type OrganizationRow = {
  id: string;
  name: string;
  type: string;
  status: string;
  publicBrandId: string | null;
  teamInviteDomains: string[] | null;
};

type InviteRow = {
  id: string;
  organizationId: string;
  email: string;
  status: string;
  roleTemplate: unknown;
  expiresAt: Date;
  createdAt: Date;
  invitedByUserId: string | null;
};

type JoinRequestRow = {
  id: string;
  organizationId: string;
  publicBrandId: string | null;
  email: string;
  contactName: string | null;
  message: string | null;
  status: string;
  inviteId: string | null;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  createdAt: Date;
};

function orUndefined<T>(value: T | null | undefined): T | undefined {
  return value === null || value === undefined ? undefined : value;
}

function mapOrganization(row: OrganizationRow): OrgTeamOrganization {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    publicBrandId: orUndefined(row.publicBrandId),
    teamInviteDomains: row.teamInviteDomains ?? []
  };
}

function inviteMembershipType(roleTemplate: unknown): string | undefined {
  if (!roleTemplate || typeof roleTemplate !== "object") return undefined;
  const value = (roleTemplate as Record<string, unknown>).membershipType;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function mapInvite(row: InviteRow): OrgTeamInviteRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    email: row.email,
    status: row.status,
    membershipType: inviteMembershipType(row.roleTemplate),
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    invitedByUserId: orUndefined(row.invitedByUserId)
  };
}

function mapJoinRequest(row: JoinRequestRow): OrgTeamJoinRequestRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    publicBrandId: orUndefined(row.publicBrandId),
    email: row.email,
    contactName: orUndefined(row.contactName),
    message: orUndefined(row.message),
    status: row.status,
    inviteId: orUndefined(row.inviteId),
    decidedByUserId: orUndefined(row.decidedByUserId),
    decidedAt: row.decidedAt?.toISOString(),
    createdAt: row.createdAt.toISOString()
  };
}

const organizationSelect = {
  id: true,
  name: true,
  type: true,
  status: true,
  publicBrandId: true,
  teamInviteDomains: true
} as const;

export function createPrismaOrgTeamStore(db: PrismaClient): OrgTeamStore {
  async function listActiveMembers(organizationId: string, email?: string): Promise<OrgTeamMemberRow[]> {
    const rows = await db.organizationMembership.findMany({
      where: {
        organizationId,
        status: "active",
        ...(email ? { user: { email: { equals: email, mode: "insensitive" as const } } } : {})
      },
      include: { user: { select: { id: true, email: true, displayName: true } } },
      orderBy: { createdAt: "asc" }
    });
    return rows.map((row) => ({
      membershipId: row.id,
      userId: row.userId,
      email: orUndefined(row.user?.email)?.toLowerCase(),
      displayName: orUndefined(row.user?.displayName),
      membershipType: row.membershipType,
      status: row.status,
      joinedAt: row.joinedAt?.toISOString()
    }));
  }

  return {
    async getOrganization(organizationId) {
      const row = await db.organization.findUnique({ where: { id: organizationId }, select: organizationSelect });
      return row ? mapOrganization(row) : undefined;
    },

    async setTeamInviteDomains(organizationId, domains) {
      await db.organization.update({ where: { id: organizationId }, data: { teamInviteDomains: domains } });
    },

    listActiveMembers: (organizationId) => listActiveMembers(organizationId),

    async findActiveMemberByEmail(organizationId, email) {
      return (await listActiveMembers(organizationId, email))[0];
    },

    async updateMembership(membershipId, changes) {
      await db.organizationMembership.update({ where: { id: membershipId }, data: changes });
    },

    async listPendingInvites(organizationId) {
      const rows = await db.organizationInvite.findMany({
        where: { organizationId, status: "pending" },
        orderBy: { createdAt: "desc" }
      });
      return rows.map(mapInvite);
    },

    async listPendingInvitesByEmail(email) {
      const rows = await db.organizationInvite.findMany({ where: { email, status: "pending" } });
      return rows.map(mapInvite);
    },

    async getInvite(inviteId) {
      const row = await db.organizationInvite.findUnique({ where: { id: inviteId } });
      return row ? mapInvite(row) : undefined;
    },

    async createInvite(input) {
      const row = await db.organizationInvite.create({
        data: {
          organizationId: input.organizationId,
          email: input.email,
          inviteTokenHash: input.inviteTokenHash,
          intendedProvider: "email_magic_link",
          roleTemplate: { membershipType: input.membershipType },
          status: "pending",
          expiresAt: input.expiresAt,
          invitedByUserId: input.invitedByUserId ?? null
        }
      });
      return mapInvite(row);
    },

    async revokeInvite(inviteId) {
      await db.organizationInvite.update({ where: { id: inviteId }, data: { status: "revoked" } });
    },

    async countEventsSince(organizationId, eventType, since) {
      return db.organizationTeamEvent.count({ where: { organizationId, eventType, createdAt: { gte: since } } });
    },

    async addEvent(input) {
      await db.organizationTeamEvent.create({
        data: {
          organizationId: input.organizationId,
          eventType: input.eventType,
          actorType: input.actorType,
          actorUserId: input.actorUserId ?? null,
          actorEmail: input.actorEmail ?? null,
          targetEmail: input.targetEmail ?? null,
          targetUserId: input.targetUserId ?? null,
          detail: input.detail ?? null,
          metadata: input.metadata === undefined ? undefined : (input.metadata as object)
        }
      });
    },

    async listEvents(organizationId, limit) {
      const rows = await db.organizationTeamEvent.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        take: limit
      });
      return rows.map(
        (row): OrgTeamEventRow => ({
          id: row.id,
          organizationId: row.organizationId,
          eventType: row.eventType,
          actorType: row.actorType,
          actorUserId: orUndefined(row.actorUserId),
          actorEmail: orUndefined(row.actorEmail),
          targetEmail: orUndefined(row.targetEmail),
          targetUserId: orUndefined(row.targetUserId),
          detail: orUndefined(row.detail),
          metadata: orUndefined(row.metadata),
          createdAt: row.createdAt.toISOString()
        })
      );
    },

    async createJoinRequest(input) {
      const row = await db.organizationJoinRequest.create({
        data: {
          organizationId: input.organizationId,
          publicBrandId: input.publicBrandId ?? null,
          email: input.email,
          contactName: input.contactName ?? null,
          message: input.message ?? null,
          status: "pending"
        }
      });
      return mapJoinRequest(row);
    },

    async getJoinRequest(id) {
      const row = await db.organizationJoinRequest.findUnique({ where: { id } });
      return row ? mapJoinRequest(row) : undefined;
    },

    async listJoinRequests(filter) {
      const rows = await db.organizationJoinRequest.findMany({
        where: {
          ...(filter.organizationId ? { organizationId: filter.organizationId } : {}),
          ...(filter.status ? { status: filter.status } : {})
        },
        orderBy: { createdAt: "desc" },
        take: filter.limit ?? 100
      });
      return rows.map(mapJoinRequest);
    },

    async countJoinRequestsSince(email, since) {
      return db.organizationJoinRequest.count({ where: { email, createdAt: { gte: since } } });
    },

    async updateJoinRequest(id, changes) {
      await db.organizationJoinRequest.update({
        where: { id },
        data: {
          status: changes.status,
          inviteId: changes.inviteId ?? undefined,
          decidedByUserId: changes.decidedByUserId ?? null,
          decidedAt: changes.decidedAt
        }
      });
    },

    async findJoinableOrganization(domain, publicBrandId) {
      const brandFilter = { publicBrandId: publicBrandId ?? null };
      const activeCustomer = { type: "customer", status: "active", ...brandFilter };
      // 1. A trial this company already received.
      const request = await db.accessRequest.findFirst({
        where: {
          applicantEmailDomain: { equals: domain, mode: "insensitive" },
          status: { in: PROVISIONED_ACCESS_REQUEST_STATUSES },
          targetOrganizationId: { not: null },
          targetOrganization: activeCustomer
        },
        orderBy: { createdAt: "desc" },
        select: { targetOrganization: { select: organizationSelect } }
      });
      if (request?.targetOrganization) return mapOrganization(request.targetOrganization);
      // 2. A domain a platform admin allowed for that organization.
      const allowed = await db.organization.findFirst({
        where: { ...activeCustomer, teamInviteDomains: { has: domain } },
        orderBy: { createdAt: "desc" },
        select: organizationSelect
      });
      if (allowed) return mapOrganization(allowed);
      // 3. An organization whose members already sign in with this domain.
      const membership = await db.organizationMembership.findFirst({
        where: {
          status: "active",
          user: { email: { endsWith: `@${domain}`, mode: "insensitive" } },
          organization: activeCustomer
        },
        orderBy: { createdAt: "asc" },
        select: { organization: { select: organizationSelect } }
      });
      return membership?.organization ? mapOrganization(membership.organization) : undefined;
    },

    async getUserEmails(userIds) {
      const ids = [...new Set(userIds)];
      if (!ids.length) return new Map();
      const rows = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } });
      return new Map(rows.filter((row) => row.email).map((row) => [row.id, row.email!.toLowerCase()] as const));
    }
  };
}
