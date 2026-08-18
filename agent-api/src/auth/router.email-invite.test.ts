import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createAuthRouter } from "./router.js";

type InviteState = {
  id: string;
  organizationId: string;
  email: string;
  inviteTokenHash: string;
  intendedProvider: string;
  roleTemplate: { membershipType: string };
  status: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  acceptedByUserId?: string;
};

type TestUserState = {
  id: string;
  email: string;
  displayName: string;
  userType: string;
  primaryOrganizationId?: string;
  role: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

function createEmailAuthHarness(input?: {
  invites?: InviteState[];
  existingUser?: boolean;
  maintenanceEnabled?: boolean;
  publicBrandId?: string;
}) {
  const email = "customer@example.com";
  const publicBrandId = input?.publicBrandId ?? "brand-bailey";
  const organization = {
    id: "org-1",
    slug: "customer-org",
    name: "Customer Org",
    type: "customer",
    status: "active",
    publicBrandId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const initialUser: TestUserState | undefined = input?.existingUser
      ? {
          id: "user-1",
          email,
          displayName: "Customer",
          userType: "external_user",
          primaryOrganizationId: organization.id,
          role: "employee",
          status: "active",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      : undefined;
  const state = {
    user: initialUser,
    invites: [...(input?.invites ?? [])],
    challenges: [] as Array<{
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
    }>,
    memberships: [] as Array<Record<string, unknown>>,
    identities: [] as Array<Record<string, unknown>>,
    sentCode: "",
    sentSubject: ""
  };

  if (state.user) {
    state.memberships.push({
      id: "membership-existing",
      organizationId: organization.id,
      userId: state.user.id,
      membershipType: "customer_member",
      status: "active",
      joinedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      organization
    });
    state.identities.push({
      id: "identity-existing",
      userId: state.user.id,
      provider: "email_magic_link",
      providerSubject: email,
      email,
      emailVerifiedAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  const markActivatedFromInvite = vi.fn(async () => undefined);
  const options = {
    users: {
      async getById(id: string) {
        return state.user?.id === id ? state.user : undefined;
      },
      async getByExternalId() {
        return undefined;
      },
      async getByEmail(target: string) {
        return state.user?.email === target ? state.user : undefined;
      },
      async upsertFromDingTalk() {
        throw new Error("not used");
      },
      async createUser() {
        state.user = {
          id: "user-1",
          email,
          displayName: "customer",
          userType: "external_user",
          primaryOrganizationId: undefined,
          role: "employee",
          status: "active",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        return state.user;
      },
      async updateUserProfile(profile: { primaryOrganizationId?: string | null }) {
        if (!state.user) throw new Error("user missing");
        state.user = {
          ...state.user,
          primaryOrganizationId: profile.primaryOrganizationId ?? state.user.primaryOrganizationId,
          updatedAt: new Date().toISOString()
        };
        return state.user;
      },
      async updateLocalSettings() {
        throw new Error("not used");
      }
    },
    cookies: {
      cookieName: "agent_studio_session",
      create: (userId: string, organizationId?: string) => `agent_studio_session=${userId}:${organizationId}; Path=/`,
      clear: () => "agent_studio_session=; Max-Age=0",
      read: () => undefined
    },
    dingtalkClient: {},
    dingtalkConfig: {},
    oauthStates: {
      cookieName: "oauth_state",
      issue: () => ({ state: "state", nonce: "nonce", cookie: "oauth_state=value" }),
      clear: () => "oauth_state=; Max-Age=0",
      read: () => undefined
    },
    identities: {
      async getByProviderSubject(provider: string, subject: string) {
        return state.identities.find((item) => item.provider === provider && item.providerSubject === subject);
      },
      async listByEmail(target: string) {
        return state.identities.filter((item) => item.email === target);
      },
      async listForUser(userId: string) {
        return state.identities.filter((item) => item.userId === userId);
      },
      async upsert(identity: Record<string, unknown>) {
        const next = {
          id: "identity-1",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ...identity,
          emailVerifiedAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString()
        };
        state.identities = [next];
        return next;
      }
    },
    memberships: {
      async listActiveForUser(userId: string) {
        return state.memberships.filter((item) => item.userId === userId && item.status === "active");
      },
      async listForUser(userId: string) {
        return state.memberships.filter((item) => item.userId === userId);
      },
      async getActiveForUserAndOrganization(userId: string, organizationId: string) {
        return state.memberships.find(
          (item) => item.userId === userId && item.organizationId === organizationId && item.status === "active"
        );
      },
      async upsert(membership: Record<string, unknown>) {
        const next = {
          id: "membership-1",
          membershipType: "customer_member",
          status: "active",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          organization,
          ...membership
        };
        state.memberships = [next];
        return next;
      }
    },
    organizations: {
      async getById(id: string) {
        return id === organization.id ? organization : undefined;
      }
    },
    invites: {
      async getByTokenHash(tokenHash: string) {
        return state.invites.find((item) => item.inviteTokenHash === tokenHash);
      },
      async listPendingByEmail(target: string) {
        return state.invites.filter((item) => item.email === target && item.status === "pending");
      },
      async accept(id: string, userId: string) {
        const invite = state.invites.find((item) => item.id === id);
        if (!invite) throw new Error("invite missing");
        invite.status = "accepted";
        invite.acceptedByUserId = userId;
        return invite;
      }
    },
    challenges: {
      async create(challenge: Record<string, unknown>) {
        const next = {
          id: `challenge-${state.challenges.length + 1}`,
          publicBrandId: challenge.publicBrandId ? String(challenge.publicBrandId) : undefined,
          channel: String(challenge.channel),
          targetRef: String(challenge.targetRef),
          challengeHash: String(challenge.challengeHash),
          purpose: String(challenge.purpose),
          organizationId: challenge.organizationId ? String(challenge.organizationId) : undefined,
          inviteId: challenge.inviteId ? String(challenge.inviteId) : undefined,
          expiresAt: new Date(challenge.expiresAt as Date).toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        state.challenges.push(next);
        return next;
      },
      async listActive(query: { channel: string; targetRef: string; purpose: string; publicBrandId?: string | null }) {
        return state.challenges.filter(
          (item) =>
            item.publicBrandId === (query.publicBrandId || undefined) &&
            item.channel === query.channel &&
            item.targetRef === query.targetRef &&
            item.purpose === query.purpose &&
            !item.consumedAt &&
            new Date(item.expiresAt).getTime() > Date.now()
        );
      },
      async consume(id: string) {
        const challenge = state.challenges.find((item) => item.id === id);
        if (!challenge) throw new Error("challenge missing");
        challenge.consumedAt = new Date().toISOString();
        return challenge;
      }
    },
    emailSender: {
      async send(message: { subject: string; text: string }) {
        state.sentSubject = message.subject;
        state.sentCode = message.text.match(/Verification code: (\d+)/)?.[1] ?? "";
        return { delivered: true as const, mode: "smtp" as const };
      }
    },
    accessRequests: { markActivatedFromInvite },
    externalWebAccess: {
      isMaintenanceEnabled: async () => input?.maintenanceEnabled === true
    }
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.publicBrand = {
      id: publicBrandId,
      platformName: publicBrandId === "brand-ranley" ? "Ranley" : "Bailey",
      externalOnly: true,
      emailFromName: publicBrandId === "brand-ranley" ? "Ranley" : "Bailey",
      emailFromAddress: publicBrandId === "brand-ranley" ? "support@cloud-ran.ai" : "support@baicells.com",
      emailSenderVerified: true
    } as never;
    next();
  });
  app.use("/api/auth", createAuthRouter(options as never));
  return { app, state, email, organization, markActivatedFromInvite };
}

function pendingInvite(id: string, overrides?: Partial<InviteState>): InviteState {
  const now = new Date().toISOString();
  return {
    id,
    organizationId: "org-1",
    email: "customer@example.com",
    inviteTokenHash: `hash-${id}`,
    intendedProvider: "email_magic_link",
    roleTemplate: { membershipType: "customer_member" },
    status: "pending",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

describe("email invitation sign-in", () => {
  it("blocks external email sign-in before looking up accounts during maintenance", async () => {
    const harness = createEmailAuthHarness({
      invites: [pendingInvite("invite-1")],
      maintenanceEnabled: true
    });

    const requested = await request(harness.app).post("/api/auth/email/request").send({ email: harness.email });

    expect(requested.status).toBe(503);
    expect(requested.body).toEqual({ detail: "系统维护中，请稍后再试。" });
    expect(harness.state.challenges).toHaveLength(0);
    expect(harness.state.sentCode).toBe("");
  });

  it("automatically accepts the only active invitation from the normal login entry", async () => {
    const harness = createEmailAuthHarness({ invites: [pendingInvite("invite-1")] });

    const requested = await request(harness.app).post("/api/auth/email/request").send({ email: harness.email });

    expect(requested.status).toBe(200);
    expect(requested.body.challenge_id).toBe("challenge-1");
    expect(harness.state.challenges[0]).toMatchObject({
      purpose: "invite_accept",
      inviteId: "invite-1",
      organizationId: harness.organization.id
    });
    expect(harness.state.sentSubject).toContain("Customer Org invite sign-in verification code");

    const verified = await request(harness.app)
      .post("/api/auth/email/verify")
      .send({ email: harness.email, code: harness.state.sentCode });

    expect(verified.status).toBe(200);
    expect(verified.body.active_organization.id).toBe(harness.organization.id);
    expect(harness.state.invites[0]).toMatchObject({ status: "accepted", acceptedByUserId: "user-1" });
    expect(harness.state.memberships[0]).toMatchObject({
      userId: "user-1",
      organizationId: harness.organization.id,
      status: "active"
    });
    expect(harness.state.identities[0]).toMatchObject({
      provider: "email_magic_link",
      providerSubject: harness.email,
      userId: "user-1"
    });
    expect(harness.markActivatedFromInvite).toHaveBeenCalledWith("invite-1", "user-1");
    expect(verified.headers["set-cookie"]?.[0]).toContain("agent_studio_session=user-1:org-1");
  });

  it("keeps ordinary email sign-in unchanged for an existing member without invitations", async () => {
    const harness = createEmailAuthHarness({ existingUser: true });

    const requested = await request(harness.app).post("/api/auth/email/request").send({ email: harness.email });

    expect(requested.status).toBe(200);
    expect(requested.body.challenge_id).toBe("challenge-1");
    expect(harness.state.challenges[0]).toMatchObject({ purpose: "email_sign_in" });
    expect(harness.state.challenges[0].inviteId).toBeUndefined();
  });

  it("keeps email verification codes isolated to the requesting public brand", async () => {
    const harness = createEmailAuthHarness({ existingUser: true, publicBrandId: "brand-ranley" });

    const requested = await request(harness.app).post("/api/auth/email/request").send({ email: harness.email });

    expect(requested.status).toBe(200);
    expect(harness.state.challenges[0]).toMatchObject({
      purpose: "email_sign_in",
      publicBrandId: "brand-ranley"
    });

    harness.state.challenges[0]!.publicBrandId = "brand-bailey";
    const verified = await request(harness.app)
      .post("/api/auth/email/verify")
      .send({ email: harness.email, code: harness.state.sentCode });

    expect(verified.status).toBe(400);
    expect(verified.body.detail).toBe("Verification code is invalid or expired");
  });

  it("does not choose an organization when multiple active invitations exist", async () => {
    const harness = createEmailAuthHarness({ invites: [pendingInvite("invite-1"), pendingInvite("invite-2")] });

    const requested = await request(harness.app).post("/api/auth/email/request").send({ email: harness.email });

    expect(requested.status).toBe(409);
    expect(requested.body.detail).toContain("Multiple active invitations");
    expect(harness.state.challenges).toHaveLength(0);
    expect(harness.state.sentCode).toBe("");
  });

  it("does not issue a login challenge for an expired pending invitation", async () => {
    const harness = createEmailAuthHarness({
      invites: [pendingInvite("invite-expired", { expiresAt: new Date(Date.now() - 60_000).toISOString() })]
    });

    const requested = await request(harness.app).post("/api/auth/email/request").send({ email: harness.email });

    expect(requested.status).toBe(200);
    expect(requested.body.challenge_id).toBeUndefined();
    expect(harness.state.challenges).toHaveLength(0);
    expect(harness.state.sentCode).toBe("");
  });
});
