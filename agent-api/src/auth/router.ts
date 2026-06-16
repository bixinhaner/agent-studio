import { createHash, randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { requireCurrentUser, userOut } from "./current-user.js";
import { resolveDingTalkConfig, type DingTalkClient, type DingTalkConfig } from "./dingtalk.js";
import { isInternalUserForEmail } from "./email-entry.js";
import type { AuthEmailSender } from "./email.js";
import {
  ensureInternalOrganization,
  INTERNAL_ORGANIZATION_MEMBERSHIP_TYPE
} from "./internal-organization.js";
import type { OAuthStateCookieManager, SessionCookieManager } from "./session-cookie.js";
import type { AuthIdentityRepository } from "../persistence/auth-identity-repository.js";
import type { CrestDelegationCredentialRepository } from "../persistence/crest-delegation-credential-repository.js";
import type { OrganizationMembershipRepository } from "../persistence/organization-membership-repository.js";
import type { OrganizationRepository } from "../persistence/organization-repository.js";
import type { UserRepositoryLike } from "../persistence/user-repository.js";
import type { OrganizationInviteRepository } from "../persistence/organization-invite-repository.js";
import type { LoginChallengeRepository } from "../persistence/login-challenge-repository.js";
import { resolvePublicPlatformName } from "../system-settings/public-branding.js";
import type { SystemSettingsVersionRecord } from "../system-settings/types.js";

const dingtalkSessionSchema = z.object({
  code: z.string().trim().min(1, "code is required"),
  state: z.string().trim().min(1, "state is required"),
  nonce: z.string().trim().min(1, "nonce is required")
});

const crestSessionSchema = z.object({
  code: z.string().trim().min(1, "code is required")
});

export type CrestSsoConfig = {
  baseUrl?: string;
  clientId?: string;
  clientSecret?: string;
};

const crestExchangeResponseSchema = z.object({
  user: z
    .object({
      id: z.string().trim().min(1),
      domainName: z.string().trim().optional(),
      email: z.string().trim().email().optional(),
      fullName: z.string().trim().optional(),
      businessUnitId: z.string().trim().optional(),
      businessUnitName: z.string().trim().optional(),
      roleNames: z.array(z.string()).optional(),
      appNames: z.array(z.string()).optional(),
      defaultCurrency: z.string().trim().optional()
    })
    .passthrough(),
  state: z.string().optional(),
  delegationToken: z.string().trim().min(1),
  delegationExpiresAt: z.string().trim().min(1),
  delegationRefreshToken: z.string().trim().min(1).optional(),
  delegationRefreshExpiresAt: z.string().trim().min(1).optional()
});

export type CrestExchangeIdentity = z.infer<typeof crestExchangeResponseSchema>;

const selectOrganizationSchema = z.object({
  organization_id: z.string().trim().min(1, "organization_id is required")
});

const requestEmailSchema = z.object({
  email: z.string().trim().email("Enter a valid email address").optional(),
  invite_token: z.string().trim().min(1).optional()
});

const verifyEmailSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  code: z.string().trim().min(4, "Enter the verification code"),
  invite_token: z.string().trim().min(1).optional()
});

const createInviteSchema = z.object({
  organization_id: z.string().trim().min(1).optional(),
  email: z.string().trim().email("Enter a valid email address"),
  membership_type: z.string().trim().min(1).optional()
});

const updatePortalPreferencesSchema = z.object({
  portal_preferences: z
    .object({
      show_process_trace: z.boolean().optional(),
      collapse_final_trace_on_done: z.boolean().optional()
    })
    .refine(
      (value) => value.show_process_trace !== undefined || value.collapse_final_trace_on_done !== undefined,
      "portal_preferences must include at least one field"
    )
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
    membershipType: INTERNAL_ORGANIZATION_MEMBERSHIP_TYPE,
    status: "active",
    joinedAt: new Date()
  });

  return { user, organizationId: internalOrganization.id };
}

function resolveCrestConfig(config: CrestSsoConfig | undefined):
  | { ok: true; config: Required<CrestSsoConfig> }
  | { ok: false; missing: string[] } {
  const baseUrl = trimOrUndefined(config?.baseUrl);
  const clientId = trimOrUndefined(config?.clientId);
  const clientSecret = trimOrUndefined(config?.clientSecret);
  const missing = [
    ...(baseUrl ? [] : ["crest_base_url"]),
    ...(clientId ? [] : ["crest_client_id"]),
    ...(clientSecret ? [] : ["crest_client_secret"])
  ];
  if (missing.length > 0) return { ok: false, missing };
  if (!baseUrl || !clientId || !clientSecret) return { ok: false, missing };
  return {
    ok: true,
    config: {
      baseUrl: baseUrl.replace(/\/+$/, ""),
      clientId,
      clientSecret
    }
  };
}

async function exchangeCrestSsoCode(config: Required<CrestSsoConfig>, code: string) {
  const response = await fetch(`${config.baseUrl}/v1/agent-studio/sso/exchange`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code
    })
  });
  const data = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) {
    const detail = data && typeof data === "object" && "message" in data ? String((data as { message?: unknown }).message) : response.statusText;
    throw new Error(detail || "Crest SSO exchange failed");
  }
  return crestExchangeResponseSchema.parse(data);
}

export async function resolveCrestUser(options: {
  users: UserRepositoryLike;
  identities: AuthIdentityRepository;
  memberships: OrganizationMembershipRepository;
  organizations: OrganizationRepository;
  identity: CrestExchangeIdentity;
}) {
  const internalOrganization = await ensureInternalOrganization(options.organizations);
  const providerSubject = `crest:${options.identity.user.id}`;
  const email = toEmail(options.identity.user.email ?? options.identity.user.domainName);
  const displayName = trimOrUndefined(options.identity.user.fullName) ?? email ?? providerSubject;

  const existingIdentity = await options.identities.getByProviderSubject("crest", providerSubject);
  let user =
    (existingIdentity ? await options.users.getById(existingIdentity.userId) : undefined) ??
    (await options.users.getByExternalId(providerSubject)) ??
    (email && options.users.getByEmail ? await options.users.getByEmail(email) : undefined);

  if (!user) {
    if (!options.users.createUser) {
      throw new Error("user repository does not support creating users");
    }
    user = await options.users.createUser({
      externalId: providerSubject,
      email: email ?? null,
      displayName,
      userType: "internal_employee",
      primaryOrganizationId: internalOrganization.id,
      role: "employee"
    });
  } else if (options.users.updateUserProfile) {
    user = await options.users.updateUserProfile({
      userId: user.id,
      externalId: providerSubject,
      email: email ?? user.email ?? null,
      displayName: displayName ?? user.displayName ?? null,
      userType: "internal_employee",
      primaryOrganizationId: user.primaryOrganizationId ?? internalOrganization.id
    });
  }

  await options.identities.upsert({
    userId: user.id,
    provider: "crest",
    providerSubject,
    email: email ?? user.email ?? null,
    emailVerifiedAt: email ? new Date() : null,
    profileJson: {
      crestUser: options.identity.user,
      ...(options.identity.delegationRefreshToken ? {} : { delegationToken: options.identity.delegationToken }),
      delegationExpiresAt: options.identity.delegationExpiresAt,
      delegationRefreshExpiresAt: options.identity.delegationRefreshExpiresAt ?? null
    },
    lastLoginAt: new Date()
  });

  await options.memberships.upsert({
    organizationId: internalOrganization.id,
    userId: user.id,
    membershipType: INTERNAL_ORGANIZATION_MEMBERSHIP_TYPE,
    status: "active",
    joinedAt: new Date()
  });

  return { user, organizationId: internalOrganization.id };
}

function canCreateInvite(req: Request): boolean {
  if (req.currentOrganization?.type !== "internal") {
    return false;
  }
  return req.currentUser?.role === "admin" || req.currentUser?.role === "super_admin";
}

function resolveInviteOrganizationId(req: Request, requestedOrganizationId?: string): string | undefined {
  if (req.currentOrganization?.type !== "internal") {
    return undefined;
  }
  if (req.currentUser?.role === "admin" || req.currentUser?.role === "super_admin") {
    return trimOrUndefined(requestedOrganizationId);
  }
  return undefined;
}

function normalizeUrl(value: unknown): string | undefined {
  const raw = trimOrUndefined(value);
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return undefined;
    }
    return parsed.href;
  } catch {
    return undefined;
  }
}

function normalizeHost(value: unknown): string | undefined {
  const raw = trimOrUndefined(value);
  if (!raw) return undefined;
  const first = raw.split(",")[0]?.trim().toLowerCase();
  if (!first) return undefined;
  try {
    return new URL(`http://${first}`).host.toLowerCase();
  } catch {
    return undefined;
  }
}

function listDingTalkRedirectUris(config: DingTalkConfig): string[] {
  const seen = new Set<string>();
  const uris: string[] = [];
  for (const value of [config.redirectUri, ...(config.redirectUriAliases ?? [])]) {
    const normalized = normalizeUrl(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    uris.push(normalized);
  }
  return uris;
}

function redirectUriHost(value: string): string | undefined {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return undefined;
  }
}

function isAllowedDingTalkRedirectUri(config: DingTalkConfig, redirectUri?: string): string | undefined {
  const normalized = normalizeUrl(redirectUri);
  if (!normalized) return undefined;
  return listDingTalkRedirectUris(config).includes(normalized) ? normalized : undefined;
}

function resolveDingTalkRedirectUriForRequest(req: Request, config: DingTalkConfig): string | undefined {
  const redirectUris = listDingTalkRedirectUris(config);
  const requestedHost = normalizeHost(req.headers["x-forwarded-host"]) ?? normalizeHost(req.headers.host);
  if (requestedHost) {
    const matched = redirectUris.find((uri) => redirectUriHost(uri) === requestedHost);
    if (matched) return matched;
  }
  return redirectUris[0];
}

export function createAuthRouter(options: {
  users: UserRepositoryLike;
  cookies: SessionCookieManager;
  dingtalkClient: DingTalkClient;
  dingtalkConfig: DingTalkConfig;
  crestConfig?: CrestSsoConfig;
  crestConfigResolver?: () => Promise<CrestSsoConfig | undefined>;
  crestDelegationCredentials?: CrestDelegationCredentialRepository;
  oauthStates: OAuthStateCookieManager;
  identities: AuthIdentityRepository;
  memberships: OrganizationMembershipRepository;
  organizations: OrganizationRepository;
  invites: OrganizationInviteRepository;
  challenges: LoginChallengeRepository;
  emailSender: AuthEmailSender;
  appBaseUrl?: string;
  sessionCookieReady?: boolean;
  accessRequests?: {
    markActivatedFromInvite(organizationInviteId: string, userId: string): Promise<void>;
  };
  systemSettings?: {
    getCurrentPublished(): Promise<SystemSettingsVersionRecord | undefined>;
  };
}): Router {
  const router = Router();

  async function resolveConfiguredCrest() {
    const configured = resolveCrestConfig(options.crestConfig);
    if (configured.ok) return configured;
    const dynamicConfig = await options.crestConfigResolver?.();
    if (dynamicConfig) return resolveCrestConfig(dynamicConfig);
    return configured;
  }

  router.get("/dingtalk/config", (req: Request, res: Response) => {
    const redirectUri = resolveDingTalkRedirectUriForRequest(req, options.dingtalkConfig);
    const resolved = resolveDingTalkConfig({
      ...options.dingtalkConfig,
      redirectUri
    });
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

    const issued = options.oauthStates.issue({ redirectUri: resolved.config.redirectUri });
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
      const input = dingtalkSessionSchema.parse(req.body ?? {});
      const expectedState = options.oauthStates.read(req.headers.cookie);
      if (!expectedState || expectedState.state !== input.state || expectedState.nonce !== input.nonce) {
        res.setHeader("Set-Cookie", options.oauthStates.clear());
        res.status(401).json({ detail: "Invalid OAuth state" });
        return;
      }

      const redirectUri =
        isAllowedDingTalkRedirectUri(options.dingtalkConfig, expectedState.redirectUri) ??
        resolveDingTalkRedirectUriForRequest(req, options.dingtalkConfig);
      const resolved = resolveDingTalkConfig({
        ...options.dingtalkConfig,
        redirectUri
      });
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

      const identity = await options.dingtalkClient.exchangeCode(input.code, {
        redirectUri: resolved.config.redirectUri
      });
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

  router.post("/crest/session", async (req: Request, res: Response) => {
    try {
      const input = crestSessionSchema.parse(req.body ?? {});
      const resolved = await resolveConfiguredCrest();
      const missing = resolved.ok ? [] : [...resolved.missing];
      if (options.sessionCookieReady === false) {
        missing.push("session_cookie_secret");
      }
      if (missing.length || !resolved.ok) {
        res.status(503).json({
          detail: "Crest SSO is not configured",
          missing
        });
        return;
      }

      const identity = await exchangeCrestSsoCode(resolved.config, input.code);
      const resolvedUser = await resolveCrestUser({
        users: options.users,
        identities: options.identities,
        memberships: options.memberships,
        organizations: options.organizations,
        identity
      });
      if (identity.delegationRefreshToken) {
        await options.crestDelegationCredentials?.upsertForUser({
          userId: resolvedUser.user.id,
          providerSubject: `crest:${identity.user.id}`,
          delegationToken: identity.delegationToken,
          delegationExpiresAt: identity.delegationExpiresAt,
          delegationRefreshToken: identity.delegationRefreshToken,
          delegationRefreshExpiresAt: identity.delegationRefreshExpiresAt
        });
      }
      const memberships = await options.memberships.listActiveForUser(resolvedUser.user.id);
      const identities = await options.identities.listForUser(resolvedUser.user.id);
      res.setHeader("Set-Cookie", options.cookies.create(resolvedUser.user.id, resolvedUser.organizationId));
      res.json(await buildAuthEnvelope({
        user: resolvedUser.user,
        memberships,
        activeOrganizationId: resolvedUser.organizationId,
        identities
      }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Crest login failed";
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

  router.patch("/portal-preferences", requireCurrentUser, async (req: Request, res: Response) => {
    try {
      const currentUser = req.currentUser!;
      if (!options.users.updatePortalPreferences) {
        res.status(501).json({ detail: "User preferences are not supported" });
        return;
      }
      const input = updatePortalPreferencesSchema.parse(req.body ?? {});
      const updatedUser = await options.users.updatePortalPreferences({
        userId: currentUser.id,
        portalPreferences: {
          showProcessTrace: input.portal_preferences.show_process_trace,
          collapseFinalTraceOnDone: input.portal_preferences.collapse_final_trace_on_done
        }
      });
      req.currentUser = updatedUser;
      const memberships = await options.memberships.listActiveForUser(updatedUser.id);
      const identities = await options.identities.listForUser(updatedUser.id);
      res.json(
        await buildAuthEnvelope({
          user: updatedUser,
          memberships,
          activeOrganizationId: req.currentOrganization?.id,
          identities
        })
      );
    } catch (error) {
      res.status(400).json({ detail: error instanceof Error ? error.message : "Failed to update portal preferences" });
    }
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
        res.status(404).json({ detail: "Organization does not exist or is not authorized" });
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
      res.status(400).json({ detail: error instanceof Error ? error.message : "Failed to switch organization" });
    }
  });

  router.get("/invites/:token", async (req: Request, res: Response) => {
    try {
      const token = trimOrUndefined(req.params.token);
      if (!token) {
        res.status(404).json({ detail: "Invite not found" });
        return;
      }
      const invite = await options.invites.getByTokenHash(hashToken(token));
      if (!invite) {
        res.status(404).json({ detail: "Invite not found" });
        return;
      }
      const organization = await options.organizations.getById(invite.organizationId);
      if (!organization) {
        res.status(404).json({ detail: "Organization not found" });
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
      res.status(400).json({ detail: error instanceof Error ? error.message : "Failed to read invite" });
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
      if (!organization || organization.status !== "active" || organization.type !== "customer") {
        res.status(404).json({ detail: "Organization does not exist or is unavailable" });
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
      const platformName = await resolvePublicPlatformName(options.systemSettings);
      await options.emailSender.send({
        to: invite.email,
        subject: `${organization.name} invited you to ${platformName}`,
        text: inviteUrl
          ? `You were invited to join ${organization.name}.\n\nOpen this link: ${inviteUrl}\n\nIf prompted, use this email address to request a verification code.`
          : `You were invited to join ${organization.name}.\n\nInvite code: ${rawToken}\n\nOpen the sign-in page and enter this invite code to request a verification code.`,
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
      res.status(400).json({ detail: error instanceof Error ? error.message : "Failed to create invite" });
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
        res.status(400).json({ detail: "Invite email does not match" });
        return;
      }

      const shouldUseInternalEntry =
        !invite &&
        (await isInternalUserForEmail({
          users: options.users,
          identities: options.identities,
          memberships: options.memberships,
          email
        }));
      if (shouldUseInternalEntry) {
        res.json({
          ok: true,
          auth_entry: "internal",
          redirect_path: "/login/internal",
          email_hint: maskEmail(email)
        });
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
      const platformName = await resolvePublicPlatformName(options.systemSettings);
      const subject = invite && organization
        ? `${organization.name} invite sign-in verification code`
        : `${platformName} sign-in verification code`;
      await options.emailSender.send({
        to: email,
        subject,
        text: [
          invite && organization ? `You are accepting an invite from ${organization.name}.` : `You are signing in to ${platformName}.`,
          `Verification code: ${code}`,
          "This code expires in 15 minutes."
        ].join("\n"),
        debugLabel: "email-login-code"
      });

      res.json({
        ok: true,
        challenge_id: challenge.id,
        email_hint: maskEmail(email)
      });
    } catch (error) {
      res.status(400).json({ detail: error instanceof Error ? error.message : "Failed to send verification code" });
    }
  });

  router.post("/email/verify", async (req: Request, res: Response) => {
    try {
      const input = verifyEmailSchema.parse(req.body ?? {});
      const inviteToken = trimOrUndefined(input.invite_token);
      const invite = inviteToken ? await options.invites.getByTokenHash(hashToken(inviteToken)) : undefined;
      const email = input.email.trim().toLowerCase();
      if (invite && invite.email !== email) {
        res.status(400).json({ detail: "Invite email does not match" });
        return;
      }

      const challenges = await options.challenges.listActive({
        channel: "email",
        targetRef: email,
        purpose: invite ? "invite_accept" : "email_sign_in"
      });
      const challenge = challenges.find((item) => item.challengeHash === hashToken(input.code));
      if (!challenge) {
        res.status(400).json({ detail: "Verification code is invalid or expired" });
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
          res.status(400).json({ detail: "Invite has expired" });
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
        await options.accessRequests?.markActivatedFromInvite(invite.id, user.id);
        activeOrganizationId = invite.organizationId;
      }

      const activeMemberships = await options.memberships.listActiveForUser(user.id);
      const selectedOrganizationId =
        (activeOrganizationId && activeMemberships.some((membership) => membership.organizationId === activeOrganizationId)
          ? activeOrganizationId
          : undefined) ??
        activeMemberships[0]?.organizationId;
      if (!selectedOrganizationId) {
        res.status(403).json({ detail: "This account has not joined any organization yet" });
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
      res.status(400).json({ detail: error instanceof Error ? error.message : "Email sign-in failed" });
    }
  });

  router.post("/logout", (_req: Request, res: Response) => {
    res.setHeader("Set-Cookie", options.cookies.clear());
    res.status(204).end();
  });

  return router;
}
