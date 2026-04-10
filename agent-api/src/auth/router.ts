import { createHash, randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { requireCurrentUser, userOut } from "./current-user.js";
import { resolveDingTalkConfig, type DingTalkClient, type DingTalkConfig } from "./dingtalk.js";
import type { AuthEmailSender } from "./email.js";
import type { OAuthStateCookieManager, SessionCookieManager } from "./session-cookie.js";
import type { AuthIdentityRepository } from "../persistence/auth-identity-repository.js";
import type { OrganizationMembershipRepository } from "../persistence/organization-membership-repository.js";
import type { OrganizationRepository } from "../persistence/organization-repository.js";
import type { UserRepositoryLike } from "../persistence/user-repository.js";
import type { OrganizationInviteRepository } from "../persistence/organization-invite-repository.js";
import type { LoginChallengeRepository } from "../persistence/login-challenge-repository.js";

const dingtalkSessionSchema = z.object({
  code: z.string().trim().min(1, "code is required"),
  state: z.string().trim().min(1, "state is required"),
  nonce: z.string().trim().min(1, "nonce is required")
});

const selectOrganizationSchema = z.object({
  organization_id: z.string().trim().min(1, "organization_id is required")
});

const requestEmailSchema = z.object({
  email: z.string().trim().email("请输入有效邮箱").optional(),
  invite_token: z.string().trim().min(1).optional()
});

const verifyEmailSchema = z.object({
  email: z.string().trim().email("请输入有效邮箱"),
  code: z.string().trim().min(4, "请输入验证码"),
  invite_token: z.string().trim().min(1).optional()
});

const createInviteSchema = z.object({
  organization_id: z.string().trim().min(1).optional(),
  email: z.string().trim().email("请输入有效邮箱"),
  membership_type: z.string().trim().min(1).optional()
});

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toEmail(value: unknown): string | undefined {
  const normalized = trimOrUndefined(value)?.toLowerCase();
  return normalized || undefined;
}

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function issueLoginCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function maskEmail(email: string): string {
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return email;
  if (localPart.length <= 2) return `${localPart[0] || "*"}***@${domain}`;
  return `${localPart.slice(0, 2)}***@${domain}`;
}

function membershipOut(
  membership: Awaited<ReturnType<OrganizationMembershipRepository["listForUser"]>>[number]
) {
  return {
    id: membership.id,
    membership_type: membership.membershipType,
    status: membership.status,
    display_name_override: membership.displayNameOverride ?? null,
    title: membership.title ?? null,
    joined_at: membership.joinedAt ?? null,
    organization: membership.organization
      ? {
          id: membership.organization.id,
          slug: membership.organization.slug,
          name: membership.organization.name,
          type: membership.organization.type,
          status: membership.organization.status
        }
      : null
  };
}

async function buildAuthEnvelope(input: {
  user: NonNullable<Awaited<ReturnType<UserRepositoryLike["getById"]>>>;
  memberships: Awaited<ReturnType<OrganizationMembershipRepository["listActiveForUser"]>>;
  activeOrganizationId?: string;
  identities: Awaited<ReturnType<AuthIdentityRepository["listForUser"]>>;
}) {
  const membershipMap = new Map(
    input.memberships.filter((membership) => membership.organization).map((membership) => [membership.organizationId, membership] as const)
  );
  const activeMembership =
    (input.activeOrganizationId ? membershipMap.get(input.activeOrganizationId) : undefined) ?? input.memberships[0];
  return {
    user: userOut(input.user),
    active_organization: activeMembership?.organization
      ? {
          id: activeMembership.organization.id,
          slug: activeMembership.organization.slug,
          name: activeMembership.organization.name,
          type: activeMembership.organization.type,
          status: activeMembership.organization.status,
          membership_type: activeMembership.membershipType
        }
      : null,
    memberships: input.memberships.map(membershipOut),
    identities: input.identities.map((identity) => ({
      provider: identity.provider,
      email: identity.email ?? null,
      last_login_at: identity.lastLoginAt ?? null
    }))
  };
}

async function ensureInternalOrganization(organizations: OrganizationRepository) {
  const existing = await organizations.getBySlug("internal");
  if (existing) return existing;
  return organizations.create({
    slug: "internal",
    name: "Internal Organization",
    type: "internal",
    status: "active"
  });
}

async function resolveDingTalkUser(options: {
  users: UserRepositoryLike;
  identities: AuthIdentityRepository;
  memberships: OrganizationMembershipRepository;
  organizations: OrganizationRepository;
  identity: Awaited<ReturnType<DingTalkClient["exchangeCode"]>>;
}) {
  const internalOrganization = await ensureInternalOrganization(options.organizations);
  const providerSubject = trimOrUndefined(options.identity.unionId);
  if (!providerSubject) {
    throw new Error("DingTalk user is missing a stable unionId");
  }

  const existingIdentity = await options.identities.getByProviderSubject("dingtalk", providerSubject);
  let user =
    (existingIdentity ? await options.users.getById(existingIdentity.userId) : undefined) ??
    (await options.users.getByExternalId(providerSubject)) ??
    (options.identity.email && options.users.getByEmail ? await options.users.getByEmail(options.identity.email) : undefined);

  if (!user) {
    if (!options.users.createUser) {
      throw new Error("user repository does not support creating users");
    }
    user = await options.users.createUser({
      email: options.identity.email ?? null,
      displayName: options.identity.displayName ?? null,
      userType: "internal_employee",
      primaryOrganizationId: internalOrganization.id,
      role: "employee"
    });
  } else if (options.users.updateUserProfile) {
    user = await options.users.updateUserProfile({
      userId: user.id,
      email: options.identity.email ?? user.email ?? null,
      displayName: options.identity.displayName ?? user.displayName ?? null,
      userType: "internal_employee",
      primaryOrganizationId: user.primaryOrganizationId ?? internalOrganization.id
    });
  }

  await options.identities.upsert({
    userId: user.id,
    provider: "dingtalk",
    providerSubject,
    email: options.identity.email ?? user.email ?? null,
    emailVerifiedAt: options.identity.email ? new Date() : null,
    profileJson: {
      openId: options.identity.openId ?? null,
      userId: options.identity.userId ?? null,
      corpId: options.identity.corpId ?? null,
      externalId: providerSubject
    },
    lastLoginAt: new Date()
  });

  await options.memberships.upsert({
    organizationId: internalOrganization.id,
    userId: user.id,
    membershipType: "employee",
    status: "active",
    joinedAt: new Date()
  });

  return { user, organizationId: internalOrganization.id };
}

function canCreateInvite(req: Request): boolean {
  if (req.currentUser?.role === "admin" || req.currentUser?.role === "super_admin") {
    return true;
  }
  return req.currentMembership?.membershipType === "customer_admin";
}

function resolveInviteOrganizationId(req: Request, requestedOrganizationId?: string): string | undefined {
  if (req.currentUser?.role === "admin" || req.currentUser?.role === "super_admin") {
    return trimOrUndefined(requestedOrganizationId) ?? trimOrUndefined(req.currentOrganization?.id);
  }
  if (req.currentMembership?.membershipType === "customer_admin") {
    return trimOrUndefined(req.currentMembership.organizationId);
  }
  return undefined;
}

export function createAuthRouter(options: {
  users: UserRepositoryLike;
  cookies: SessionCookieManager;
  dingtalkClient: DingTalkClient;
  dingtalkConfig: DingTalkConfig;
  oauthStates: OAuthStateCookieManager;
  identities: AuthIdentityRepository;
  memberships: OrganizationMembershipRepository;
  organizations: OrganizationRepository;
  invites: OrganizationInviteRepository;
  challenges: LoginChallengeRepository;
  emailSender: AuthEmailSender;
  appBaseUrl?: string;
  sessionCookieReady?: boolean;
}): Router {
  const router = Router();

  router.get("/dingtalk/config", (_req: Request, res: Response) => {
    const resolved = resolveDingTalkConfig(options.dingtalkConfig);
    const missing = resolved.ok ? [] : [...resolved.missing];
    if (options.sessionCookieReady === false) {
      missing.push("session_cookie_secret");
    }
    if (missing.length) {
      res.status(503).json({
        detail: "DingTalk auth is not configured",
        missing
      });
      return;
    }
    if (!resolved.ok) {
      res.status(503).json({
        detail: "DingTalk auth is not configured",
        missing
      });
      return;
    }

    const issued = options.oauthStates.issue();
    res.setHeader("Set-Cookie", issued.cookie);
    res.json({
      config: {
        ...resolved.publicConfig,
        state: issued.state,
        nonce: issued.nonce
      }
    });
  });

  router.post("/dingtalk/session", async (req: Request, res: Response) => {
    try {
      const resolved = resolveDingTalkConfig(options.dingtalkConfig);
      const missing = resolved.ok ? [] : [...resolved.missing];
      if (options.sessionCookieReady === false) {
        missing.push("session_cookie_secret");
      }
      if (missing.length || !resolved.ok) {
        res.status(503).json({
          detail: "DingTalk auth is not configured",
          missing
        });
        return;
      }

      const input = dingtalkSessionSchema.parse(req.body ?? {});
      const expectedState = options.oauthStates.read(req.headers.cookie);
      if (!expectedState || expectedState.state !== input.state || expectedState.nonce !== input.nonce) {
        res.setHeader("Set-Cookie", options.oauthStates.clear());
        res.status(401).json({ detail: "Invalid OAuth state" });
        return;
      }

      const identity = await options.dingtalkClient.exchangeCode(input.code);
      const resolvedUser = await resolveDingTalkUser({
        users: options.users,
        identities: options.identities,
        memberships: options.memberships,
        organizations: options.organizations,
        identity
      });
      const memberships = await options.memberships.listActiveForUser(resolvedUser.user.id);
      const identities = await options.identities.listForUser(resolvedUser.user.id);
      res.setHeader("Set-Cookie", [options.oauthStates.clear(), options.cookies.create(resolvedUser.user.id, resolvedUser.organizationId)]);
      res.json(await buildAuthEnvelope({
        user: resolvedUser.user,
        memberships,
        activeOrganizationId: resolvedUser.organizationId,
        identities
      }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "DingTalk login failed";
      res.status(400).json({ detail });
    }
  });

  router.get("/whoami", requireCurrentUser, async (req: Request, res: Response) => {
    const currentUser = req.currentUser!;
    const memberships = await options.memberships.listActiveForUser(currentUser.id);
    const identities = await options.identities.listForUser(currentUser.id);
    res.json(await buildAuthEnvelope({
      user: currentUser,
      memberships,
      activeOrganizationId: req.currentOrganization?.id,
      identities
    }));
  });

  router.get("/organizations", requireCurrentUser, async (req: Request, res: Response) => {
    const currentUser = req.currentUser!;
    const memberships = await options.memberships.listActiveForUser(currentUser.id);
    res.json({
      active_organization_id: req.currentOrganization?.id ?? null,
      memberships: memberships.map(membershipOut)
    });
  });

  router.post("/organizations/select", requireCurrentUser, async (req: Request, res: Response) => {
    try {
      const currentUser = req.currentUser!;
      const input = selectOrganizationSchema.parse(req.body ?? {});
      const membership = await options.memberships.getActiveForUserAndOrganization(currentUser.id, input.organization_id);
      if (!membership?.organization) {
        res.status(404).json({ detail: "organization 不存在或未授权" });
        return;
      }
      const identities = await options.identities.listForUser(currentUser.id);
      res.setHeader("Set-Cookie", options.cookies.create(currentUser.id, membership.organizationId));
      res.json(await buildAuthEnvelope({
        user: currentUser,
        memberships: await options.memberships.listActiveForUser(currentUser.id),
        activeOrganizationId: membership.organizationId,
        identities
      }));
    } catch (error) {
      res.status(400).json({ detail: error instanceof Error ? error.message : "切换组织失败" });
    }
  });

  router.get("/invites/:token", async (req: Request, res: Response) => {
    try {
      const token = trimOrUndefined(req.params.token);
      if (!token) {
        res.status(404).json({ detail: "邀请不存在" });
        return;
      }
      const invite = await options.invites.getByTokenHash(hashToken(token));
      if (!invite) {
        res.status(404).json({ detail: "邀请不存在" });
        return;
      }
      const organization = await options.organizations.getById(invite.organizationId);
      if (!organization) {
        res.status(404).json({ detail: "组织不存在" });
        return;
      }
      const expired = new Date(invite.expiresAt).getTime() <= Date.now();
      res.json({
        invite: {
          organization: {
            id: organization.id,
            slug: organization.slug,
            name: organization.name,
            type: organization.type,
            status: organization.status
          },
          email_hint: maskEmail(invite.email),
          email: invite.email,
          membership_type: invite.roleTemplate && typeof invite.roleTemplate === "object"
            ? trimOrUndefined((invite.roleTemplate as Record<string, unknown>).membershipType)
            : null,
          status: expired && invite.status === "pending" ? "expired" : invite.status,
          expires_at: invite.expiresAt
        }
      });
    } catch (error) {
      res.status(400).json({ detail: error instanceof Error ? error.message : "读取邀请失败" });
    }
  });

  router.post("/invites", requireCurrentUser, async (req: Request, res: Response) => {
    try {
      if (!canCreateInvite(req)) {
        res.status(403).json({ detail: "Forbidden" });
        return;
      }

      const input = createInviteSchema.parse(req.body ?? {});
      const organizationId = resolveInviteOrganizationId(req, input.organization_id);
      if (!organizationId) {
        res.status(400).json({ detail: "organization_id is required" });
        return;
      }
      const organization = await options.organizations.getById(organizationId);
      if (!organization || organization.status !== "active") {
        res.status(404).json({ detail: "organization 不存在或不可用" });
        return;
      }

      const rawToken = randomUUID().replace(/-/g, "");
      const invite = await options.invites.create({
        organizationId,
        email: input.email,
        inviteTokenHash: hashToken(rawToken),
        intendedProvider: "email_magic_link",
        roleTemplate: {
          membershipType: trimOrUndefined(input.membership_type) ?? "customer_member"
        },
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        invitedByUserId: req.currentUser!.id
      });

      const inviteUrlBase = trimOrUndefined(options.appBaseUrl);
      const inviteUrl = inviteUrlBase ? `${inviteUrlBase.replace(/\/+$/, "")}/invite/${rawToken}` : undefined;
      await options.emailSender.send({
        to: invite.email,
        subject: `${organization.name} 邀请你加入 Agent Studio`,
        text: inviteUrl
          ? `你已被邀请加入 ${organization.name}。\n\n访问链接：${inviteUrl}\n\n如果页面提示，请使用该邮箱获取验证码登录。`
          : `你已被邀请加入 ${organization.name}。\n\n邀请码：${rawToken}\n\n请打开登录页并输入该邀请码获取验证码。`,
        debugLabel: "organization-invite"
      });

      res.status(201).json({
        invite: {
          id: invite.id,
          organization_id: invite.organizationId,
          email: invite.email,
          status: invite.status,
          expires_at: invite.expiresAt
        }
      });
    } catch (error) {
      res.status(400).json({ detail: error instanceof Error ? error.message : "创建邀请失败" });
    }
  });

  router.post("/email/request", async (req: Request, res: Response) => {
    try {
      const input = requestEmailSchema.parse(req.body ?? {});
      const inviteToken = trimOrUndefined(input.invite_token);
      const invite = inviteToken ? await options.invites.getByTokenHash(hashToken(inviteToken)) : undefined;
      const email = toEmail(input.email) ?? invite?.email;
      if (!email) {
        res.status(400).json({ detail: "email is required" });
        return;
      }

      if (invite && invite.email !== email) {
        res.status(400).json({ detail: "邀请邮箱不匹配" });
        return;
      }

      const existingIdentities = await options.identities.listByEmail(email);
      const pendingInvites = invite ? [invite] : await options.invites.listPendingByEmail(email);
      if (existingIdentities.length === 0 && pendingInvites.length === 0) {
        res.json({ ok: true });
        return;
      }

      const code = issueLoginCode();
      const challenge = await options.challenges.create({
        channel: "email",
        targetRef: email,
        challengeHash: hashToken(code),
        purpose: invite ? "invite_accept" : "email_sign_in",
        organizationId: invite?.organizationId,
        inviteId: invite?.id,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      });

      const organization = invite?.organizationId ? await options.organizations.getById(invite.organizationId) : undefined;
      const subject = invite && organization
        ? `${organization.name} 邀请登录验证码`
        : "Agent Studio 登录验证码";
      await options.emailSender.send({
        to: email,
        subject,
        text: [
          invite && organization ? `你正在接受 ${organization.name} 的邀请。` : "你正在登录 Agent Studio。",
          `验证码：${code}`,
          "验证码 15 分钟内有效。"
        ].join("\n"),
        debugLabel: "email-login-code"
      });

      res.json({
        ok: true,
        challenge_id: challenge.id,
        email_hint: maskEmail(email)
      });
    } catch (error) {
      res.status(400).json({ detail: error instanceof Error ? error.message : "发送验证码失败" });
    }
  });

  router.post("/email/verify", async (req: Request, res: Response) => {
    try {
      const input = verifyEmailSchema.parse(req.body ?? {});
      const inviteToken = trimOrUndefined(input.invite_token);
      const invite = inviteToken ? await options.invites.getByTokenHash(hashToken(inviteToken)) : undefined;
      const email = input.email.trim().toLowerCase();
      if (invite && invite.email !== email) {
        res.status(400).json({ detail: "邀请邮箱不匹配" });
        return;
      }

      const challenges = await options.challenges.listActive({
        channel: "email",
        targetRef: email,
        purpose: invite ? "invite_accept" : "email_sign_in"
      });
      const challenge = challenges.find((item) => item.challengeHash === hashToken(input.code));
      if (!challenge) {
        res.status(400).json({ detail: "验证码无效或已过期" });
        return;
      }
      await options.challenges.consume(challenge.id);

      let identity = await options.identities.getByProviderSubject("email_magic_link", email);
      let user =
        (identity ? await options.users.getById(identity.userId) : undefined) ??
        (options.users.getByEmail ? await options.users.getByEmail(email) : undefined);

      if (!user) {
        if (!options.users.createUser) {
          throw new Error("user repository does not support creating users");
        }
        user = await options.users.createUser({
          email,
          displayName: email.split("@")[0] || email,
          userType: invite ? "external_user" : "external_user",
          role: "employee"
        });
      }

      let activeOrganizationId = trimOrUndefined(user.primaryOrganizationId);
      if (invite) {
        const expired = new Date(invite.expiresAt).getTime() <= Date.now();
        if (invite.status !== "pending" || expired) {
          res.status(400).json({ detail: "邀请已失效" });
          return;
        }
        const membershipType =
          invite.roleTemplate && typeof invite.roleTemplate === "object"
            ? trimOrUndefined((invite.roleTemplate as Record<string, unknown>).membershipType)
            : undefined;
        await options.memberships.upsert({
          organizationId: invite.organizationId,
          userId: user.id,
          membershipType: membershipType ?? "customer_member",
          status: "active",
          joinedAt: new Date()
        });
        await options.invites.accept(invite.id, user.id);
        activeOrganizationId = invite.organizationId;
      }

      const activeMemberships = await options.memberships.listActiveForUser(user.id);
      const selectedOrganizationId =
        (activeOrganizationId && activeMemberships.some((membership) => membership.organizationId === activeOrganizationId)
          ? activeOrganizationId
          : undefined) ??
        activeMemberships[0]?.organizationId;
      if (!selectedOrganizationId) {
        res.status(403).json({ detail: "当前账号尚未加入任何组织" });
        return;
      }

      if (options.users.updateUserProfile) {
        user = await options.users.updateUserProfile({
          userId: user.id,
          email,
          userType: user.userType ?? "external_user",
          primaryOrganizationId: user.primaryOrganizationId ?? selectedOrganizationId
        });
      }

      identity = await options.identities.upsert({
        userId: user.id,
        provider: "email_magic_link",
        providerSubject: email,
        email,
        emailVerifiedAt: new Date(),
        lastLoginAt: new Date()
      });

      const identities = await options.identities.listForUser(user.id);
      res.setHeader("Set-Cookie", options.cookies.create(user.id, selectedOrganizationId));
      res.json(await buildAuthEnvelope({
        user,
        memberships: await options.memberships.listActiveForUser(user.id),
        activeOrganizationId: selectedOrganizationId,
        identities: identities.length ? identities : [identity]
      }));
    } catch (error) {
      res.status(400).json({ detail: error instanceof Error ? error.message : "邮箱登录失败" });
    }
  });

  router.post("/logout", (_req: Request, res: Response) => {
    res.setHeader("Set-Cookie", options.cookies.clear());
    res.status(204).end();
  });

  return router;
}
