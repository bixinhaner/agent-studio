import { describe, expect, it, vi } from "vitest";

import {
  TEAM_INVITES_PER_DAY,
  createOrgTeamService,
  normalizeInviteDomains,
  type OrgTeamActor,
  type OrgTeamEventRow,
  type OrgTeamInviteRow,
  type OrgTeamJoinRequestRow,
  type OrgTeamMemberRow,
  type OrgTeamOrganization,
  type OrgTeamStore,
  type OrgTeamSubscription
} from "./service.js";

const NOW = new Date("2026-11-19T08:00:00.000Z");

function createHarness(options: { maxMembers?: number; brandReady?: boolean; subscription?: Partial<OrgTeamSubscription> | null } = {}) {
  const organizations = new Map<string, OrgTeamOrganization>([
    ["org_opticoms", { id: "org_opticoms", name: "Opticoms", type: "customer", status: "active", publicBrandId: "brand_ranley", teamInviteDomains: [] }],
    ["org_other", { id: "org_other", name: "Other", type: "customer", status: "active", publicBrandId: "brand_ranley", teamInviteDomains: [] }]
  ]);
  const members: Array<OrgTeamMemberRow & { organizationId: string }> = [
    { organizationId: "org_opticoms", membershipId: "m_ali", userId: "u_ali", email: "ali@opticoms.de", membershipType: "customer_admin", status: "active" },
    { organizationId: "org_opticoms", membershipId: "m_eva", userId: "u_eva", email: "eva@opticoms.de", membershipType: "customer_member", status: "active" }
  ];
  const invites: OrgTeamInviteRow[] = [];
  const joinRequests: OrgTeamJoinRequestRow[] = [];
  const events: OrgTeamEventRow[] = [];
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}_${++sequence}`;

  const store: OrgTeamStore = {
    getOrganization: async (id) => organizations.get(id),
    setTeamInviteDomains: async (id, domains) => {
      organizations.set(id, { ...organizations.get(id)!, teamInviteDomains: domains });
    },
    listActiveMembers: async (organizationId) => members.filter((member) => member.organizationId === organizationId && member.status === "active"),
    updateMembership: async (membershipId, changes) => {
      const member = members.find((item) => item.membershipId === membershipId)!;
      Object.assign(member, changes);
    },
    findActiveMemberByEmail: async (organizationId, email) =>
      members.find((member) => member.organizationId === organizationId && member.status === "active" && member.email === email),
    listPendingInvites: async (organizationId) => invites.filter((invite) => invite.organizationId === organizationId && invite.status === "pending"),
    listPendingInvitesByEmail: async (email) => invites.filter((invite) => invite.email === email && invite.status === "pending"),
    getInvite: async (id) => invites.find((invite) => invite.id === id),
    createInvite: async (input) => {
      const invite: OrgTeamInviteRow = {
        id: nextId("invite"),
        organizationId: input.organizationId,
        email: input.email,
        status: "pending",
        membershipType: input.membershipType,
        expiresAt: input.expiresAt.toISOString(),
        createdAt: NOW.toISOString(),
        invitedByUserId: input.invitedByUserId
      };
      invites.push(invite);
      return invite;
    },
    revokeInvite: async (id) => {
      invites.find((invite) => invite.id === id)!.status = "revoked";
    },
    countEventsSince: async (organizationId, eventType, since) =>
      events.filter((event) => event.organizationId === organizationId && event.eventType === eventType && new Date(event.createdAt) >= since).length,
    addEvent: async (input) => {
      events.push({ ...input, id: nextId("event"), createdAt: NOW.toISOString() });
    },
    listEvents: async (organizationId, limit) => events.filter((event) => event.organizationId === organizationId).slice(0, limit),
    createJoinRequest: async (input) => {
      const request: OrgTeamJoinRequestRow = { ...input, id: nextId("join"), status: "pending", createdAt: NOW.toISOString() };
      joinRequests.push(request);
      return request;
    },
    getJoinRequest: async (id) => joinRequests.find((request) => request.id === id),
    listJoinRequests: async (filter) =>
      joinRequests.filter(
        (request) => (!filter.organizationId || request.organizationId === filter.organizationId) && (!filter.status || request.status === filter.status)
      ),
    countJoinRequestsSince: async (email) => joinRequests.filter((request) => request.email === email).length,
    updateJoinRequest: async (id, changes) => {
      const request = joinRequests.find((item) => item.id === id)!;
      Object.assign(request, { ...changes, decidedAt: changes.decidedAt.toISOString() });
    },
    findJoinableOrganization: async (domain, publicBrandId) =>
      domain === "opticoms.de" && publicBrandId === "brand_ranley" ? organizations.get("org_opticoms") : undefined,
    getUserEmails: async (ids) => new Map(ids.map((id) => [id, `${id.replace(/^u_/, "")}@opticoms.de`] as const))
  };

  const emailSender = { send: vi.fn(async (_input: Record<string, unknown>) => ({ messageId: "ok" })) };
  const notifyPlatformAdmins = vi.fn(async (_input: Record<string, unknown>) => true);
  const subscription: OrgTeamSubscription | undefined =
    options.subscription === null
      ? undefined
      : {
          planName: "Standard Edition Trial",
          maxMembers: options.maxMembers,
          completedTurnLimit: 300,
          usedCompletedTurns: 12,
          remainingCompletedTurns: 288,
          cycleEndsAt: "2026-12-19T00:00:00.000Z",
          expiresAt: "2027-01-19T00:00:00.000Z",
          accessStatus: "available",
          ...options.subscription
        };
  const service = createOrgTeamService({
    store,
    getBrand: async (id) =>
      id === "brand_ranley"
        ? {
            id,
            platformName: "Ranley",
            primaryBaseUrl: "https://ranley.example",
            emailSenderVerified: options.brandReady ?? true,
            emailFromName: "Ranley",
            emailFromAddress: "no-reply@ranley.example",
            supportEmail: "support@ranley.example"
          }
        : undefined,
    getSubscription: async () => subscription,
    emailSender,
    notifyPlatformAdmins,
    appBaseUrl: "https://platform.example",
    defaultPlatformName: async () => "Bailey",
    now: () => NOW
  });
  return { service, organizations, members, invites, joinRequests, events, emailSender, notifyPlatformAdmins };
}

const ali: OrgTeamActor = { kind: "customer", userId: "u_ali", email: "ali@opticoms.de", organizationId: "org_opticoms", membershipType: "customer_admin" };
const eva: OrgTeamActor = { kind: "customer", userId: "u_eva", email: "eva@opticoms.de", organizationId: "org_opticoms", membershipType: "customer_member" };
const staff: OrgTeamActor = { kind: "platform", userId: "u_staff", email: "ops@baicells.com" };

describe("customer admin invites", () => {
  it("sends a brand email from Ranley and records an audit event", async () => {
    const harness = createHarness();
    const invite = await harness.service.inviteMember("org_opticoms", ali, { email: "Batuhan.Gunes@Opticoms.de" });

    expect(invite).toMatchObject({ email: "batuhan.gunes@opticoms.de", membershipType: "customer_member", status: "pending" });
    const sent = harness.emailSender.send.mock.calls[0]![0] as unknown as { to: string; from: string; text: string; subject: string };
    expect(sent.to).toBe("batuhan.gunes@opticoms.de");
    expect(sent.from).toBe("Ranley <no-reply@ranley.example>");
    expect(sent.subject).toBe("Opticoms invited you to Ranley");
    expect(sent.text).toContain("https://ranley.example/invite/");
    expect(sent.text).toContain("Standard Edition Trial");
    expect(harness.events).toMatchObject([{ eventType: "member_invited", actorType: "customer_admin", targetEmail: "batuhan.gunes@opticoms.de" }]);
  });

  it("only allows the admin's own domain plus domains a platform admin added", async () => {
    const harness = createHarness();
    await expect(harness.service.inviteMember("org_opticoms", ali, { email: "friend@gmail.com" })).rejects.toMatchObject({ code: "domain_not_allowed" });
    await expect(harness.service.inviteMember("org_opticoms", ali, { email: "sam@opticoms.com" })).rejects.toMatchObject({ code: "domain_not_allowed" });

    await harness.service.setInviteDomains("org_opticoms", staff, ["@Opticoms.com"]);
    await expect(harness.service.inviteMember("org_opticoms", ali, { email: "sam@opticoms.com" })).resolves.toMatchObject({ email: "sam@opticoms.com" });
    // Customers never pick the role: invitees always join as members.
    await expect(harness.service.inviteMember("org_opticoms", ali, { email: "max@opticoms.de", membershipType: "customer_admin" })).resolves.toMatchObject({
      membershipType: "customer_member"
    });
  });

  it("counts pending invites against the plan's seats, but a resend does not take another seat", async () => {
    const harness = createHarness({ maxMembers: 3 });
    await harness.service.inviteMember("org_opticoms", ali, { email: "one@opticoms.de" });
    await expect(harness.service.inviteMember("org_opticoms", ali, { email: "two@opticoms.de" })).rejects.toMatchObject({ code: "seat_limit_reached" });

    const resent = await harness.service.inviteMember("org_opticoms", ali, { email: "one@opticoms.de" });
    expect(harness.invites.filter((invite) => invite.status === "pending").map((invite) => invite.id)).toEqual([resent.id]);

    // Expired invites free their seat.
    harness.invites.find((invite) => invite.id === resent.id)!.expiresAt = "2026-11-01T00:00:00.000Z";
    await expect(harness.service.inviteMember("org_opticoms", ali, { email: "two@opticoms.de" })).resolves.toBeTruthy();
  });

  it("limits invitations per day", async () => {
    const harness = createHarness();
    for (let index = 0; index < TEAM_INVITES_PER_DAY; index += 1) {
      harness.events.push({ id: `old_${index}`, organizationId: "org_opticoms", eventType: "member_invited", actorType: "customer_admin", createdAt: NOW.toISOString() });
    }
    await expect(harness.service.inviteMember("org_opticoms", ali, { email: "late@opticoms.de" })).rejects.toMatchObject({ code: "invite_rate_limited", status: 429 });
  });

  it("refuses existing members and people already invited to another workspace", async () => {
    const harness = createHarness();
    await expect(harness.service.inviteMember("org_opticoms", ali, { email: "eva@opticoms.de" })).rejects.toMatchObject({ code: "already_member" });
    harness.invites.push({
      id: "elsewhere",
      organizationId: "org_other",
      email: "dual@opticoms.de",
      status: "pending",
      expiresAt: "2026-11-25T00:00:00.000Z",
      createdAt: NOW.toISOString()
    });
    await expect(harness.service.inviteMember("org_opticoms", ali, { email: "dual@opticoms.de" })).rejects.toMatchObject({ code: "invited_elsewhere" });
  });

  it("revokes the new invite and keeps the old one when the email fails", async () => {
    const harness = createHarness();
    const first = await harness.service.inviteMember("org_opticoms", ali, { email: "one@opticoms.de" });
    harness.emailSender.send.mockRejectedValueOnce(new Error("smtp down"));
    await expect(harness.service.inviteMember("org_opticoms", ali, { email: "one@opticoms.de" })).rejects.toMatchObject({ code: "email_failed" });
    expect(harness.invites.find((invite) => invite.id === first.id)?.status).toBe("pending");
    expect(harness.invites.filter((invite) => invite.status === "pending")).toHaveLength(1);
  });

  it("does not send when the brand mailbox is not verified", async () => {
    const harness = createHarness({ brandReady: false });
    await expect(harness.service.inviteMember("org_opticoms", ali, { email: "one@opticoms.de" })).rejects.toMatchObject({ code: "email_not_ready" });
    expect(harness.invites).toHaveLength(0);
  });
});

describe("customer admin boundaries", () => {
  it("lets only organization admins of that organization manage it", async () => {
    const harness = createHarness();
    await expect(harness.service.getOverview("org_opticoms", eva)).rejects.toMatchObject({ status: 403 });
    await expect(harness.service.getOverview("org_other", ali)).rejects.toMatchObject({ status: 403 });
    await expect(harness.service.setInviteDomains("org_opticoms", ali, ["opticoms.com"])).rejects.toMatchObject({ status: 403 });
    await expect(harness.service.changeMemberRole("org_opticoms", ali, "m_eva", "customer_admin")).rejects.toMatchObject({ status: 403 });
  });

  it("removes members but never admins or themselves", async () => {
    const harness = createHarness();
    await expect(harness.service.removeMember("org_opticoms", ali, "m_ali")).rejects.toMatchObject({ code: "cannot_remove_self" });
    harness.members.push({ organizationId: "org_opticoms", membershipId: "m_bob", userId: "u_bob", email: "bob@opticoms.de", membershipType: "customer_admin", status: "active" });
    await expect(harness.service.removeMember("org_opticoms", ali, "m_bob")).rejects.toMatchObject({ code: "cannot_remove_admin" });

    await harness.service.removeMember("org_opticoms", ali, "m_eva");
    expect(harness.members.find((member) => member.membershipId === "m_eva")?.status).toBe("removed");
    expect(harness.events.at(-1)).toMatchObject({ eventType: "member_removed", targetEmail: "eva@opticoms.de" });
  });

  it("revokes only pending invites of its own organization", async () => {
    const harness = createHarness();
    const invite = await harness.service.inviteMember("org_opticoms", ali, { email: "one@opticoms.de" });
    await harness.service.revokeInvite("org_opticoms", ali, invite.id);
    expect(harness.invites[0]?.status).toBe("revoked");
    await expect(harness.service.revokeInvite("org_opticoms", ali, invite.id)).rejects.toMatchObject({ code: "invite_not_found" });
  });

  it("shows seats, the shared quota and the plan end date", async () => {
    const harness = createHarness({ maxMembers: 5 });
    await harness.service.inviteMember("org_opticoms", ali, { email: "one@opticoms.de" });
    const overview = await harness.service.getOverview("org_opticoms", ali);

    expect(overview.seats).toEqual({ used: 3, limit: 5, members: 2, pendingInvites: 1 });
    expect(overview.allowedDomains).toEqual(["opticoms.de"]);
    expect(overview.subscription).toMatchObject({ completedTurnLimit: 300, usedCompletedTurns: 12, expiresAt: "2027-01-19T00:00:00.000Z" });
    expect(overview.members.map((member) => [member.email, member.isSelf])).toEqual([
      ["ali@opticoms.de", true],
      ["eva@opticoms.de", false]
    ]);
    expect(overview.invites[0]).toMatchObject({ email: "one@opticoms.de", invitedByEmail: "ali@opticoms.de" });
  });
});

describe("platform admin controls", () => {
  it("can invite an organization admin past customer guardrails and change roles", async () => {
    const harness = createHarness({ maxMembers: 2 });
    await harness.service.inviteMember("org_opticoms", staff, { email: "owner@subsidiary.example", membershipType: "customer_admin" });
    expect(harness.invites[0]).toMatchObject({ membershipType: "customer_admin" });
    expect((harness.emailSender.send.mock.calls[0]![0] as unknown as { text: string }).text).toContain("The Ranley team invited you");

    await harness.service.changeMemberRole("org_opticoms", staff, "m_eva", "customer_admin");
    expect(harness.members.find((member) => member.membershipId === "m_eva")?.membershipType).toBe("customer_admin");
    expect(harness.events.at(-1)).toMatchObject({ eventType: "member_role_changed", metadata: { from: "customer_member", to: "customer_admin" } });
  });

  it("rejects public mailbox domains and malformed domains for the allowlist", () => {
    expect(normalizeInviteDomains([" @Opticoms.COM ", "opticoms.com", ""])).toEqual(["opticoms.com"]);
    expect(() => normalizeInviteDomains(["gmail.com"])).toThrow("公共邮箱");
    expect(() => normalizeInviteDomains(["not a domain"])).toThrow("不是有效");
  });
});

describe("join requests", () => {
  it("emails the org admins, CCs platform admins, and approval issues a normal invite", async () => {
    const harness = createHarness();
    await expect(
      harness.service.submitJoinRequest({ email: "Batuhan@Opticoms.de", contactName: "Batuhan", message: "Ali suggested it", publicBrandId: "brand_ranley" })
    ).resolves.toEqual({ ok: true });

    const adminMail = harness.emailSender.send.mock.calls[0]![0] as unknown as { to: string[]; text: string; from: string };
    expect(adminMail.to).toEqual(["ali@opticoms.de"]);
    expect(adminMail.from).toBe("Ranley <no-reply@ranley.example>");
    expect(adminMail.text).toContain("https://ranley.example/?view=team");
    expect(adminMail.text).toContain("Ali suggested it");
    expect(harness.notifyPlatformAdmins).toHaveBeenCalledWith(expect.objectContaining({ eventType: "organization.join_requested", organizationId: "org_opticoms" }));

    const request = harness.joinRequests[0]!;
    const result = await harness.service.approveJoinRequest("org_opticoms", ali, request.id);
    expect(result.status).toBe("approved");
    expect(harness.joinRequests[0]).toMatchObject({ status: "approved", decidedByUserId: "u_ali" });
    expect(harness.invites[0]).toMatchObject({ email: "batuhan@opticoms.de", membershipType: "customer_member" });
    expect(harness.events.map((event) => event.eventType)).toEqual(["join_requested", "member_invited", "join_approved"]);
    await expect(harness.service.rejectJoinRequest("org_opticoms", ali, request.id)).rejects.toMatchObject({ code: "join_request_decided" });
  });

  it("answers the same way when nothing matches, so the form reveals nobody", async () => {
    const harness = createHarness();
    await expect(harness.service.submitJoinRequest({ email: "x@unknown.example", publicBrandId: "brand_ranley" })).resolves.toEqual({ ok: true });
    await expect(harness.service.submitJoinRequest({ email: "eva@opticoms.de", publicBrandId: "brand_ranley" })).resolves.toEqual({ ok: true });
    await expect(harness.service.submitJoinRequest({ email: "b@opticoms.de", publicBrandId: undefined })).resolves.toEqual({ ok: true });
    expect(harness.joinRequests).toHaveLength(0);
    expect(harness.emailSender.send).not.toHaveBeenCalled();
    await expect(harness.service.submitJoinRequest({ email: "someone@gmail.com" })).rejects.toMatchObject({ code: "business_email_required" });
  });

  it("keeps one pending request per person and caps repeats", async () => {
    const harness = createHarness();
    await harness.service.submitJoinRequest({ email: "b@opticoms.de", publicBrandId: "brand_ranley" });
    await harness.service.submitJoinRequest({ email: "b@opticoms.de", publicBrandId: "brand_ranley" });
    expect(harness.joinRequests).toHaveLength(1);
  });

  it("tells platform admins when the organization has no admin to approve it", async () => {
    const harness = createHarness();
    harness.members[0]!.membershipType = "customer_member";
    await harness.service.submitJoinRequest({ email: "b@opticoms.de", publicBrandId: "brand_ranley" });
    expect(harness.emailSender.send).not.toHaveBeenCalled();
    expect(harness.notifyPlatformAdmins.mock.calls[0]![0]).toMatchObject({ subject: expect.stringContaining("no org admin") });

    await harness.service.approveJoinRequest("org_opticoms", staff, harness.joinRequests[0]!.id);
    expect(harness.invites[0]).toMatchObject({ email: "b@opticoms.de" });
  });

  it("does not let a customer admin decide another organization's requests", async () => {
    const harness = createHarness();
    await harness.service.submitJoinRequest({ email: "b@opticoms.de", publicBrandId: "brand_ranley" });
    const otherAdmin: OrgTeamActor = { kind: "customer", userId: "u_x", email: "x@other.example", organizationId: "org_other", membershipType: "customer_admin" };
    await expect(harness.service.approveJoinRequest("org_other", otherAdmin, harness.joinRequests[0]!.id)).rejects.toMatchObject({ code: "join_request_not_found" });
  });
});
