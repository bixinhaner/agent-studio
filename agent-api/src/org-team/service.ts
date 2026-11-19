import { createHash, randomUUID } from "node:crypto";

import { PUBLIC_EMAIL_DOMAINS } from "../access-requests/public-email-domains.js";

/**
 * Customer organization team management.
 *
 * Customer admins (membership `customer_admin`) invite colleagues into their own organization, revoke
 * pending invites and remove members. Everyone in the organization shares one subscription, so the
 * guardrails here keep that shared quota from leaking outside the company: invitees must use the
 * admin's email domain (or a domain a platform admin added), seats are capped per plan, and invites
 * are rate limited per day. Platform admins use the same service without those customer guardrails.
 *
 * People whose company already has a workspace can ask to join instead of opening a second trial;
 * approving a join request simply issues a normal invite, so the requester still has to prove they
 * own the mailbox by signing in.
 */

export const TEAM_INVITE_VALID_DAYS = 7;
export const TEAM_INVITES_PER_DAY = 20;
export const JOIN_REQUESTS_PER_EMAIL_PER_DAY = 3;
export const CUSTOMER_ADMIN = "customer_admin";
export const CUSTOMER_MEMBER = "customer_member";

export class OrgTeamError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "OrgTeamError";
  }
}

export type OrgTeamOrganization = {
  id: string;
  name: string;
  type: string;
  status: string;
  publicBrandId?: string;
  teamInviteDomains: string[];
};

export type OrgTeamMemberRow = {
  membershipId: string;
  userId: string;
  email?: string;
  displayName?: string;
  membershipType: string;
  status: string;
  joinedAt?: string;
};

export type OrgTeamInviteRow = {
  id: string;
  organizationId: string;
  email: string;
  status: string;
  membershipType?: string;
  expiresAt: string;
  createdAt: string;
  invitedByUserId?: string;
};

export type OrgTeamJoinRequestRow = {
  id: string;
  organizationId: string;
  publicBrandId?: string;
  email: string;
  contactName?: string;
  message?: string;
  status: string;
  inviteId?: string;
  decidedByUserId?: string;
  decidedAt?: string;
  createdAt: string;
};

export type OrgTeamEventRow = {
  id: string;
  organizationId: string;
  eventType: string;
  actorType: string;
  actorUserId?: string;
  actorEmail?: string;
  targetEmail?: string;
  targetUserId?: string;
  detail?: string;
  metadata?: unknown;
  createdAt: string;
};

export type OrgTeamSubscription = {
  planName?: string;
  maxMembers?: number;
  completedTurnLimit: number | null;
  usedCompletedTurns: number | null;
  remainingCompletedTurns: number | null;
  cycleEndsAt?: string;
  expiresAt?: string;
  accessStatus: string;
};

export type OrgTeamStore = {
  getOrganization(organizationId: string): Promise<OrgTeamOrganization | undefined>;
  setTeamInviteDomains(organizationId: string, domains: string[]): Promise<void>;
  listActiveMembers(organizationId: string): Promise<OrgTeamMemberRow[]>;
  updateMembership(membershipId: string, changes: { status?: string; membershipType?: string }): Promise<void>;
  findActiveMemberByEmail(organizationId: string, email: string): Promise<OrgTeamMemberRow | undefined>;
  listPendingInvites(organizationId: string): Promise<OrgTeamInviteRow[]>;
  listPendingInvitesByEmail(email: string): Promise<OrgTeamInviteRow[]>;
  getInvite(inviteId: string): Promise<OrgTeamInviteRow | undefined>;
  createInvite(input: {
    organizationId: string;
    email: string;
    inviteTokenHash: string;
    membershipType: string;
    expiresAt: Date;
    invitedByUserId?: string;
  }): Promise<OrgTeamInviteRow>;
  revokeInvite(inviteId: string): Promise<void>;
  countEventsSince(organizationId: string, eventType: string, since: Date): Promise<number>;
  addEvent(input: Omit<OrgTeamEventRow, "id" | "createdAt">): Promise<void>;
  listEvents(organizationId: string, limit: number): Promise<OrgTeamEventRow[]>;
  createJoinRequest(input: {
    organizationId: string;
    publicBrandId?: string;
    email: string;
    contactName?: string;
    message?: string;
  }): Promise<OrgTeamJoinRequestRow>;
  getJoinRequest(id: string): Promise<OrgTeamJoinRequestRow | undefined>;
  listJoinRequests(filter: { organizationId?: string; status?: string; limit?: number }): Promise<OrgTeamJoinRequestRow[]>;
  countJoinRequestsSince(email: string, since: Date): Promise<number>;
  updateJoinRequest(
    id: string,
    changes: { status: string; inviteId?: string; decidedByUserId?: string; decidedAt: Date }
  ): Promise<void>;
  /** Most recent active customer organization of this brand that this company domain already uses. */
  findJoinableOrganization(domain: string, publicBrandId: string | undefined): Promise<OrgTeamOrganization | undefined>;
  getUserEmails(userIds: string[]): Promise<Map<string, string>>;
};

export type OrgTeamBrand = {
  id: string;
  platformName: string;
  primaryBaseUrl?: string;
  emailSenderVerified?: boolean;
  emailFromName?: string;
  emailFromAddress?: string;
  emailReplyTo?: string;
  supportEmail?: string;
};

export type OrgTeamServiceDeps = {
  store: OrgTeamStore;
  getBrand(publicBrandId: string | undefined): Promise<OrgTeamBrand | undefined>;
  getSubscription(organizationId: string): Promise<OrgTeamSubscription | undefined>;
  emailSender: {
    send(input: {
      publicBrandId?: string;
      to: string | string[];
      from?: string;
      replyTo?: string;
      subject: string;
      text: string;
      debugLabel?: string;
    }): Promise<unknown>;
  };
  notifyPlatformAdmins?(input: {
    targetRef: string;
    eventType: string;
    organizationId?: string;
    subject: string;
    text: string;
    envelope?: { publicBrandId?: string; from?: string; replyTo?: string };
  }): Promise<unknown>;
  appBaseUrl?: string;
  defaultPlatformName(): Promise<string>;
  now?(): Date;
  logger?: Pick<Console, "warn">;
};

/** Who is acting. Customer admins act on their own organization only; platform admins skip customer guardrails. */
export type OrgTeamActor =
  | { kind: "customer"; userId: string; email?: string; organizationId: string; membershipType: string }
  | { kind: "platform"; userId: string; email?: string };

export type TeamMemberView = {
  membershipId: string;
  userId: string;
  email: string | null;
  displayName: string | null;
  membershipType: string;
  joinedAt: string | null;
  isSelf: boolean;
};

export type TeamInviteView = {
  id: string;
  email: string;
  status: "pending" | "expired";
  membershipType: string;
  expiresAt: string;
  createdAt: string;
  invitedByEmail: string | null;
};

export type TeamJoinRequestView = {
  id: string;
  email: string;
  contactName: string | null;
  message: string | null;
  status: string;
  createdAt: string;
};

export type TeamOverview = {
  organization: { id: string; name: string };
  seats: { used: number; limit: number | null; members: number; pendingInvites: number };
  allowedDomains: string[];
  invitesToday: { used: number; limit: number };
  subscription: OrgTeamSubscription | null;
  members: TeamMemberView[];
  invites: TeamInviteView[];
  joinRequests: TeamJoinRequestView[];
};

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function normalizeTeamEmail(value: unknown): string {
  const email = trimOrUndefined(value)?.toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new OrgTeamError(400, "invalid_email", "Enter a valid email address.");
  }
  return email;
}

export function emailDomainOf(email: string | undefined): string {
  return email?.split("@")[1]?.trim().toLowerCase() ?? "";
}

/** Cleans an admin-entered domain list; free mailbox domains are refused because they would let anyone in. */
export function normalizeInviteDomains(values: unknown): string[] {
  if (!Array.isArray(values)) throw new OrgTeamError(400, "invalid_domains", "domains must be a list");
  const result: string[] = [];
  for (const raw of values) {
    const domain = trimOrUndefined(raw)?.toLowerCase().replace(/^@/, "");
    if (!domain) continue;
    if (!/^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) {
      throw new OrgTeamError(400, "invalid_domains", `${domain} 不是有效的邮箱域名`);
    }
    if (PUBLIC_EMAIL_DOMAINS.has(domain)) {
      throw new OrgTeamError(400, "invalid_domains", `${domain} 是公共邮箱域名，不能用于团队邀请`);
    }
    if (!result.includes(domain)) result.push(domain);
  }
  if (result.length > 20) throw new OrgTeamError(400, "invalid_domains", "最多设置 20 个域名");
  return result;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isExpired(invite: Pick<OrgTeamInviteRow, "expiresAt">, now: Date): boolean {
  const expiresAt = new Date(invite.expiresAt).getTime();
  return !Number.isFinite(expiresAt) || expiresAt <= now.getTime();
}

function buildUrl(base: string | undefined, path: string): string | undefined {
  const normalized = trimOrUndefined(base);
  if (!normalized) return undefined;
  return `${normalized.replace(/\/+$/, "")}${path}`;
}

export function createOrgTeamService(deps: OrgTeamServiceDeps) {
  const now = () => deps.now?.() ?? new Date();

  async function loadOrganization(organizationId: string): Promise<OrgTeamOrganization> {
    const organization = await deps.store.getOrganization(organizationId);
    if (!organization || organization.type !== "customer") {
      throw new OrgTeamError(404, "organization_not_found", "Organization does not exist");
    }
    return organization;
  }

  /** Customer admins only ever reach their own active organization. */
  async function authorize(organizationId: string, actor: OrgTeamActor): Promise<OrgTeamOrganization> {
    if (actor.kind === "customer") {
      if (actor.organizationId !== organizationId || actor.membershipType !== CUSTOMER_ADMIN) {
        throw new OrgTeamError(403, "forbidden", "Only organization admins can manage the team.");
      }
    }
    const organization = await loadOrganization(organizationId);
    if (actor.kind === "customer" && organization.status !== "active") {
      throw new OrgTeamError(403, "organization_inactive", "This organization is not active.");
    }
    return organization;
  }

  async function envelopeFor(organization: OrgTeamOrganization) {
    const brand = await deps.getBrand(organization.publicBrandId);
    if (!brand) {
      return { brand: undefined, envelope: {}, platformName: await deps.defaultPlatformName(), baseUrl: deps.appBaseUrl };
    }
    if (!brand.emailSenderVerified || !trimOrUndefined(brand.emailFromAddress)) {
      throw new OrgTeamError(409, "email_not_ready", `${brand.platformName} email delivery is not ready. Contact support.`);
    }
    return {
      brand,
      envelope: {
        publicBrandId: brand.id,
        from: `${brand.emailFromName ?? brand.platformName} <${brand.emailFromAddress}>`,
        replyTo: trimOrUndefined(brand.emailReplyTo) ?? trimOrUndefined(brand.supportEmail)
      },
      platformName: brand.platformName,
      baseUrl: trimOrUndefined(brand.primaryBaseUrl) ?? deps.appBaseUrl
    };
  }

  function allowedDomainsFor(organization: OrgTeamOrganization, actor: OrgTeamActor): string[] {
    const own = actor.kind === "customer" ? emailDomainOf(actor.email) : "";
    return [...new Set([own, ...organization.teamInviteDomains].filter(Boolean))];
  }

  async function seatUsage(organizationId: string) {
    const [members, invites] = await Promise.all([
      deps.store.listActiveMembers(organizationId),
      deps.store.listPendingInvites(organizationId)
    ]);
    const current = now();
    const activeInvites = invites.filter((invite) => !isExpired(invite, current));
    return { members, invites, activeInvites, used: members.length + activeInvites.length };
  }

  async function addEvent(
    organizationId: string,
    actor: OrgTeamActor | { kind: "applicant"; email: string },
    eventType: string,
    input: { targetEmail?: string; targetUserId?: string; detail?: string; metadata?: unknown } = {}
  ) {
    await deps.store.addEvent({
      organizationId,
      eventType,
      actorType: actor.kind === "customer" ? "customer_admin" : actor.kind === "platform" ? "platform_admin" : "applicant",
      actorUserId: "userId" in actor ? actor.userId : undefined,
      actorEmail: actor.email,
      targetEmail: input.targetEmail,
      targetUserId: input.targetUserId,
      detail: input.detail,
      metadata: input.metadata
    });
  }

  async function issueInvite(
    organization: OrgTeamOrganization,
    actor: OrgTeamActor,
    rawEmail: unknown,
    options: { membershipType?: string; source: "team" | "join_request"; joinRequestId?: string } = { source: "team" }
  ): Promise<TeamInviteView> {
    const email = normalizeTeamEmail(rawEmail);
    const membershipType =
      actor.kind === "platform" && options.membershipType === CUSTOMER_ADMIN ? CUSTOMER_ADMIN : CUSTOMER_MEMBER;
    const current = now();

    if (actor.kind === "customer") {
      const allowed = allowedDomainsFor(organization, actor);
      if (!allowed.includes(emailDomainOf(email))) {
        throw new OrgTeamError(
          400,
          "domain_not_allowed",
          `You can only invite colleagues with ${allowed.map((domain) => `@${domain}`).join(" / ")} addresses. Contact support to add another domain.`
        );
      }
      const sentToday = await deps.store.countEventsSince(
        organization.id,
        "member_invited",
        new Date(current.getTime() - 24 * 60 * 60 * 1000)
      );
      if (sentToday >= TEAM_INVITES_PER_DAY) {
        throw new OrgTeamError(429, "invite_rate_limited", `You can send up to ${TEAM_INVITES_PER_DAY} invitations per day. Try again tomorrow.`);
      }
    }

    if (await deps.store.findActiveMemberByEmail(organization.id, email)) {
      throw new OrgTeamError(409, "already_member", `${email} is already a member of this team.`);
    }

    const pendingForEmail = (await deps.store.listPendingInvitesByEmail(email)).filter((invite) => !isExpired(invite, current));
    if (pendingForEmail.some((invite) => invite.organizationId !== organization.id)) {
      // A second usable invite elsewhere would make the email sign-in refuse with "multiple active invitations".
      throw new OrgTeamError(409, "invited_elsewhere", `${email} already has a pending invitation to another workspace.`);
    }
    const replacing = pendingForEmail.filter((invite) => invite.organizationId === organization.id);

    const subscription = await deps.getSubscription(organization.id);
    const limit = subscription?.maxMembers ?? null;
    if (actor.kind === "customer" && limit !== null) {
      const usage = await seatUsage(organization.id);
      // Re-sending to the same person does not take another seat.
      if (usage.used - replacing.length >= limit) {
        throw new OrgTeamError(
          409,
          "seat_limit_reached",
          `Your plan includes ${limit} seats and all are in use (members and pending invitations). Remove someone or contact support to add seats.`
        );
      }
    }

    const { envelope, platformName, baseUrl } = await envelopeFor(organization);
    const rawToken = randomUUID().replace(/-/g, "");
    const invite = await deps.store.createInvite({
      organizationId: organization.id,
      email,
      inviteTokenHash: hashToken(rawToken),
      membershipType,
      expiresAt: new Date(current.getTime() + TEAM_INVITE_VALID_DAYS * 24 * 60 * 60 * 1000),
      invitedByUserId: actor.userId
    });
    const inviteUrl = buildUrl(baseUrl, `/invite/${rawToken}`);
    const inviter = actor.kind === "customer" ? actor.email ?? "Your organization admin" : `The ${platformName} team`;
    try {
      await deps.emailSender.send({
        to: email,
        ...envelope,
        subject: `${organization.name} invited you to ${platformName}`,
        text: [
          `${inviter} invited you to join ${organization.name} on ${platformName}.`,
          "",
          inviteUrl ? `Open this link to sign in: ${inviteUrl}` : `Invite code: ${rawToken}`,
          `You can also sign in with ${email} on the sign-in page within ${TEAM_INVITE_VALID_DAYS} days.`,
          subscription?.planName ? `Your team shares the ${subscription.planName} subscription.` : undefined
        ]
          .filter((line) => line !== undefined)
          .join("\n"),
        debugLabel: "organization-team-invite"
      });
    } catch (error) {
      await deps.store.revokeInvite(invite.id).catch(() => undefined);
      throw new OrgTeamError(502, "email_failed", `The invitation email could not be sent: ${error instanceof Error ? error.message : String(error)}`);
    }
    for (const previous of replacing) {
      await deps.store.revokeInvite(previous.id);
    }
    await addEvent(organization.id, actor, "member_invited", {
      targetEmail: email,
      metadata: {
        inviteId: invite.id,
        membershipType,
        source: options.source,
        joinRequestId: options.joinRequestId,
        replacedInviteIds: replacing.map((item) => item.id)
      }
    });
    return {
      id: invite.id,
      email,
      status: "pending",
      membershipType,
      expiresAt: invite.expiresAt,
      createdAt: invite.createdAt,
      invitedByEmail: actor.email ?? null
    };
  }

  async function decideJoinRequest(
    organizationId: string,
    actor: OrgTeamActor,
    requestId: string,
    decision: "approve" | "reject"
  ) {
    const organization = await authorize(organizationId, actor);
    const request = await deps.store.getJoinRequest(requestId);
    if (!request || request.organizationId !== organization.id) {
      throw new OrgTeamError(404, "join_request_not_found", "Join request does not exist");
    }
    if (request.status !== "pending") {
      throw new OrgTeamError(409, "join_request_decided", "This join request was already handled.");
    }
    if (decision === "reject") {
      await deps.store.updateJoinRequest(request.id, { status: "rejected", decidedByUserId: actor.userId, decidedAt: now() });
      await addEvent(organization.id, actor, "join_rejected", { targetEmail: request.email, metadata: { joinRequestId: request.id } });
      return { status: "rejected" as const };
    }
    const invite = await issueInvite(organization, actor, request.email, { source: "join_request", joinRequestId: request.id });
    await deps.store.updateJoinRequest(request.id, {
      status: "approved",
      inviteId: invite.id,
      decidedByUserId: actor.userId,
      decidedAt: now()
    });
    await addEvent(organization.id, actor, "join_approved", { targetEmail: request.email, metadata: { joinRequestId: request.id, inviteId: invite.id } });
    return { status: "approved" as const, invite };
  }

  return {
    async getOverview(organizationId: string, actor: OrgTeamActor): Promise<TeamOverview> {
      const organization = await authorize(organizationId, actor);
      const current = now();
      const [usage, subscription, joinRequests, invitesToday] = await Promise.all([
        seatUsage(organization.id),
        deps.getSubscription(organization.id),
        deps.store.listJoinRequests({ organizationId: organization.id, status: "pending", limit: 50 }),
        deps.store.countEventsSince(organization.id, "member_invited", new Date(current.getTime() - 24 * 60 * 60 * 1000))
      ]);
      const inviterEmails = await deps.store.getUserEmails(
        usage.invites.map((invite) => invite.invitedByUserId).filter((id): id is string => Boolean(id))
      );
      return {
        organization: { id: organization.id, name: organization.name },
        seats: {
          used: usage.used,
          limit: subscription?.maxMembers ?? null,
          members: usage.members.length,
          pendingInvites: usage.activeInvites.length
        },
        allowedDomains: allowedDomainsFor(organization, actor),
        invitesToday: { used: invitesToday, limit: TEAM_INVITES_PER_DAY },
        subscription: subscription ?? null,
        members: usage.members
          .map((member) => ({
            membershipId: member.membershipId,
            userId: member.userId,
            email: member.email ?? null,
            displayName: member.displayName ?? null,
            membershipType: member.membershipType,
            joinedAt: member.joinedAt ?? null,
            isSelf: member.userId === actor.userId
          }))
          .sort((left, right) =>
            left.membershipType === right.membershipType
              ? (left.email ?? "").localeCompare(right.email ?? "")
              : left.membershipType === CUSTOMER_ADMIN
                ? -1
                : 1
          ),
        invites: usage.invites.map((invite) => ({
          id: invite.id,
          email: invite.email,
          status: isExpired(invite, current) ? "expired" : "pending",
          membershipType: invite.membershipType ?? CUSTOMER_MEMBER,
          expiresAt: invite.expiresAt,
          createdAt: invite.createdAt,
          invitedByEmail: invite.invitedByUserId ? inviterEmails.get(invite.invitedByUserId) ?? null : null
        })),
        joinRequests: joinRequests.map((request) => ({
          id: request.id,
          email: request.email,
          contactName: request.contactName ?? null,
          message: request.message ?? null,
          status: request.status,
          createdAt: request.createdAt
        }))
      };
    },

    async inviteMember(organizationId: string, actor: OrgTeamActor, input: { email: unknown; membershipType?: string }) {
      const organization = await authorize(organizationId, actor);
      if (organization.status !== "active") {
        throw new OrgTeamError(409, "organization_inactive", "This organization is not active.");
      }
      return issueInvite(organization, actor, input.email, { membershipType: input.membershipType, source: "team" });
    },

    async revokeInvite(organizationId: string, actor: OrgTeamActor, inviteId: string) {
      const organization = await authorize(organizationId, actor);
      const invite = await deps.store.getInvite(inviteId);
      if (!invite || invite.organizationId !== organization.id || invite.status !== "pending") {
        throw new OrgTeamError(404, "invite_not_found", "Invitation does not exist or was already used.");
      }
      await deps.store.revokeInvite(invite.id);
      await addEvent(organization.id, actor, "invite_revoked", { targetEmail: invite.email, metadata: { inviteId: invite.id } });
    },

    async removeMember(organizationId: string, actor: OrgTeamActor, membershipId: string) {
      const organization = await authorize(organizationId, actor);
      const member = (await deps.store.listActiveMembers(organization.id)).find((item) => item.membershipId === membershipId);
      if (!member) throw new OrgTeamError(404, "member_not_found", "Member does not exist");
      if (member.userId === actor.userId) {
        throw new OrgTeamError(400, "cannot_remove_self", "You cannot remove yourself.");
      }
      if (actor.kind === "customer" && member.membershipType === CUSTOMER_ADMIN) {
        throw new OrgTeamError(403, "cannot_remove_admin", "Organization admins can only be removed by support.");
      }
      const { membershipType } = member;
      await deps.store.updateMembership(member.membershipId, { status: "removed" });
      await addEvent(organization.id, actor, "member_removed", {
        targetEmail: member.email,
        targetUserId: member.userId,
        metadata: { membershipId: member.membershipId, membershipType }
      });
    },

    approveJoinRequest(organizationId: string, actor: OrgTeamActor, requestId: string) {
      return decideJoinRequest(organizationId, actor, requestId, "approve");
    },

    rejectJoinRequest(organizationId: string, actor: OrgTeamActor, requestId: string) {
      return decideJoinRequest(organizationId, actor, requestId, "reject");
    },

    /** Platform admin only: promote a member to organization admin or back. */
    async changeMemberRole(organizationId: string, actor: OrgTeamActor, membershipId: string, membershipType: string) {
      if (actor.kind !== "platform") throw new OrgTeamError(403, "forbidden", "Forbidden");
      if (membershipType !== CUSTOMER_ADMIN && membershipType !== CUSTOMER_MEMBER) {
        throw new OrgTeamError(400, "invalid_role", "membershipType 只支持 customer_admin 或 customer_member");
      }
      const organization = await loadOrganization(organizationId);
      const member = (await deps.store.listActiveMembers(organization.id)).find((item) => item.membershipId === membershipId);
      if (!member) throw new OrgTeamError(404, "member_not_found", "成员不存在");
      const previous = member.membershipType;
      if (previous === membershipType) return;
      await deps.store.updateMembership(member.membershipId, { membershipType });
      await addEvent(organization.id, actor, "member_role_changed", {
        targetEmail: member.email,
        targetUserId: member.userId,
        metadata: { from: previous, to: membershipType }
      });
    },

    /** Platform admin only: extra domains customer admins may invite from. */
    async setInviteDomains(organizationId: string, actor: OrgTeamActor, rawDomains: unknown) {
      if (actor.kind !== "platform") throw new OrgTeamError(403, "forbidden", "Forbidden");
      const organization = await loadOrganization(organizationId);
      const domains = normalizeInviteDomains(rawDomains);
      await deps.store.setTeamInviteDomains(organization.id, domains);
      await addEvent(organization.id, actor, "invite_domains_updated", {
        metadata: { from: organization.teamInviteDomains, to: domains }
      });
      return domains;
    },

    async listEvents(organizationId: string, actor: OrgTeamActor, limit = 100) {
      if (actor.kind !== "platform") throw new OrgTeamError(403, "forbidden", "Forbidden");
      await loadOrganization(organizationId);
      return deps.store.listEvents(organizationId, Math.min(Math.max(limit, 1), 200));
    },

    /** Platform admin queue of join requests across organizations. */
    async listPendingJoinRequests(actor: OrgTeamActor) {
      if (actor.kind !== "platform") throw new OrgTeamError(403, "forbidden", "Forbidden");
      const requests = await deps.store.listJoinRequests({ status: "pending", limit: 200 });
      const organizations = new Map<string, OrgTeamOrganization | undefined>();
      for (const id of new Set(requests.map((request) => request.organizationId))) {
        organizations.set(id, await deps.store.getOrganization(id));
      }
      return requests.map((request) => ({
        id: request.id,
        organizationId: request.organizationId,
        organizationName: organizations.get(request.organizationId)?.name ?? request.organizationId,
        email: request.email,
        contactName: request.contactName ?? null,
        message: request.message ?? null,
        createdAt: request.createdAt
      }));
    },

    /**
     * Public: someone whose company already has a workspace asks to join it. The response never says
     * which organization matched or who its admins are; a non-match looks the same as a match.
     */
    async submitJoinRequest(input: {
      email: unknown;
      contactName?: unknown;
      message?: unknown;
      publicBrandId?: string;
    }): Promise<{ ok: true }> {
      const email = normalizeTeamEmail(input.email);
      const domain = emailDomainOf(email);
      if (PUBLIC_EMAIL_DOMAINS.has(domain)) {
        throw new OrgTeamError(400, "business_email_required", "Use your company email address.");
      }
      const contactName = trimOrUndefined(input.contactName)?.slice(0, 120);
      const message = trimOrUndefined(input.message)?.slice(0, 1000);
      const current = now();
      if ((await deps.store.countJoinRequestsSince(email, new Date(current.getTime() - 24 * 60 * 60 * 1000))) >= JOIN_REQUESTS_PER_EMAIL_PER_DAY) {
        return { ok: true };
      }
      const organization = await deps.store.findJoinableOrganization(domain, input.publicBrandId);
      if (!organization || organization.status !== "active") return { ok: true };
      if (await deps.store.findActiveMemberByEmail(organization.id, email)) return { ok: true };
      const pending = await deps.store.listJoinRequests({ organizationId: organization.id, status: "pending", limit: 200 });
      if (pending.some((request) => request.email === email)) return { ok: true };

      const request = await deps.store.createJoinRequest({
        organizationId: organization.id,
        publicBrandId: input.publicBrandId,
        email,
        contactName,
        message
      });
      await addEvent(organization.id, { kind: "applicant", email }, "join_requested", {
        targetEmail: email,
        metadata: { joinRequestId: request.id }
      });

      try {
        const { envelope, platformName, baseUrl } = await envelopeFor(organization);
        const admins = (await deps.store.listActiveMembers(organization.id))
          .filter((member) => member.membershipType === CUSTOMER_ADMIN && member.email)
          .map((member) => member.email!);
        const reviewUrl = buildUrl(baseUrl, "/?view=team");
        const lines = [
          `${contactName ? `${contactName} (${email})` : email} asked to join ${organization.name} on ${platformName}.`,
          message ? `Message: ${message}` : undefined,
          "",
          reviewUrl ? `Review the request: ${reviewUrl}` : "Review the request from Team in the account menu.",
          "Approving sends them an invitation. Your team shares one subscription."
        ].filter((line) => line !== undefined);
        if (admins.length) {
          await deps.emailSender.send({
            to: admins,
            ...envelope,
            subject: `${email} asked to join ${organization.name}`,
            text: lines.join("\n"),
            debugLabel: "organization-join-request"
          });
        }
        await deps.notifyPlatformAdmins?.({
          targetRef: `organization_join_request:${request.id}`,
          eventType: "organization.join_requested",
          organizationId: organization.id,
          subject: `[Join request] ${email} → ${organization.name}${admins.length ? "" : " (no org admin)"}`,
          text: [
            ...lines.slice(0, 2),
            admins.length
              ? `Organization admins notified: ${admins.length}`
              : "This organization has no customer admin. Approve it from the admin console (Users → 客户组织与邀请).",
          ]
            .filter((line) => line !== undefined)
            .join("\n"),
          envelope
        });
      } catch (error) {
        deps.logger?.warn("[org-team] join request notification failed", error instanceof Error ? error.message : String(error));
      }
      return { ok: true };
    }
  };
}

export type OrgTeamService = ReturnType<typeof createOrgTeamService>;
