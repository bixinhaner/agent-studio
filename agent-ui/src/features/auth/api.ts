import { api } from "../../lib/api";

export type AuthUserRole = "employee" | "admin" | "super_admin" | string;
export type AuthUserType = "internal_employee" | "external_user" | string;

export type AuthUserPortalPreferences = {
  showProcessTrace?: boolean;
  collapseFinalTraceOnDone?: boolean;
};

export type AuthUser = {
  id: string;
  role: AuthUserRole;
  userType: AuthUserType;
  primaryOrganizationId?: string | null;
  externalId?: string | null;
  displayName?: string;
  email?: string;
  status?: string;
  portalPreferences?: AuthUserPortalPreferences;
};

export type AuthOrganization = {
  id: string;
  slug: string;
  name: string;
  type: string;
  status: string;
  membershipType?: string | null;
};

export type AuthMembership = {
  id: string;
  membershipType: string;
  status: string;
  displayNameOverride?: string | null;
  title?: string | null;
  joinedAt?: string | null;
  organization: AuthOrganization | null;
};

export type AuthIdentity = {
  provider: string;
  email?: string | null;
  lastLoginAt?: string | null;
};

export type AuthSession = {
  user: AuthUser;
  activeOrganization: AuthOrganization | null;
  memberships: AuthMembership[];
  identities: AuthIdentity[];
};

export type WhoAmIResponse = AuthSession;

type AuthUserPayload = {
  id: string;
  role: AuthUserRole;
  user_type?: AuthUserType | null;
  primary_organization_id?: string | null;
  external_id?: string | null;
  display_name?: string | null;
  email?: string | null;
  status?: string | null;
  portal_preferences?: {
    show_process_trace?: boolean | null;
    collapse_final_trace_on_done?: boolean | null;
  } | null;
};

type AuthOrganizationPayload = {
  id: string;
  slug: string;
  name: string;
  type?: string | null;
  status?: string | null;
  membership_type?: string | null;
};

type AuthMembershipPayload = {
  id: string;
  membership_type?: string | null;
  status?: string | null;
  display_name_override?: string | null;
  title?: string | null;
  joined_at?: string | null;
  organization?: AuthOrganizationPayload | null;
};

type AuthIdentityPayload = {
  provider: string;
  email?: string | null;
  last_login_at?: string | null;
};

type WhoAmIPayload = {
  user: AuthUserPayload;
  active_organization?: AuthOrganizationPayload | null;
  memberships?: AuthMembershipPayload[];
  identities?: AuthIdentityPayload[];
};

export type DingTalkConfigResponse = {
  config: {
    client_id: string;
    redirect_uri: string;
    response_type: "code";
    scope: string;
    state: string;
    nonce: string;
  };
};

type EmailRequestPayload = {
  ok: boolean;
  challenge_id?: string | null;
  email_hint?: string | null;
};

export type EmailRequestResponse = {
  ok: boolean;
  challengeId?: string;
  emailHint?: string;
};

type InvitePayload = {
  invite: {
    organization: AuthOrganizationPayload;
    email_hint?: string | null;
    email?: string | null;
    membership_type?: string | null;
    status?: string | null;
    expires_at?: string | null;
  };
};

type CreateInvitePayload = {
  invite: {
    id: string;
    organization_id: string;
    email: string;
    status: string;
    expires_at?: string | null;
  };
};

export type AuthInvite = {
  organization: AuthOrganization;
  emailHint?: string;
  email?: string;
  membershipType?: string | null;
  status: string;
  expiresAt?: string | null;
};

export type CreatedInvite = {
  id: string;
  organizationId: string;
  email: string;
  status: string;
  expiresAt?: string | null;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeAuthUser(user: AuthUserPayload): AuthUser {
  const portalPreferences =
    user.portal_preferences &&
    (typeof user.portal_preferences.show_process_trace === "boolean" ||
      typeof user.portal_preferences.collapse_final_trace_on_done === "boolean")
      ? {
          ...(typeof user.portal_preferences.show_process_trace === "boolean"
            ? { showProcessTrace: user.portal_preferences.show_process_trace }
            : {}),
          ...(typeof user.portal_preferences.collapse_final_trace_on_done === "boolean"
            ? { collapseFinalTraceOnDone: user.portal_preferences.collapse_final_trace_on_done }
            : {})
        }
      : undefined;
  return {
    id: user.id,
    role: user.role,
    userType: trimOrUndefined(user.user_type) ?? "internal_employee",
    primaryOrganizationId: user.primary_organization_id ?? null,
    externalId: user.external_id ?? null,
    displayName: trimOrUndefined(user.display_name),
    email: trimOrUndefined(user.email),
    status: trimOrUndefined(user.status),
    ...(portalPreferences ? { portalPreferences } : {})
  };
}

function normalizeOrganization(organization: AuthOrganizationPayload): AuthOrganization {
  return {
    id: organization.id,
    slug: organization.slug,
    name: organization.name,
    type: trimOrUndefined(organization.type) ?? "customer",
    status: trimOrUndefined(organization.status) ?? "active",
    membershipType: organization.membership_type ?? null
  };
}

function normalizeMembership(membership: AuthMembershipPayload): AuthMembership {
  return {
    id: membership.id,
    membershipType: trimOrUndefined(membership.membership_type) ?? "customer_member",
    status: trimOrUndefined(membership.status) ?? "active",
    displayNameOverride: membership.display_name_override ?? null,
    title: membership.title ?? null,
    joinedAt: membership.joined_at ?? null,
    organization: membership.organization ? normalizeOrganization(membership.organization) : null
  };
}

function normalizeIdentity(identity: AuthIdentityPayload): AuthIdentity {
  return {
    provider: identity.provider,
    email: identity.email ?? null,
    lastLoginAt: identity.last_login_at ?? null
  };
}

function normalizeAuthSession(payload: WhoAmIPayload): AuthSession {
  return {
    user: normalizeAuthUser(payload.user),
    activeOrganization: payload.active_organization ? normalizeOrganization(payload.active_organization) : null,
    memberships: (payload.memberships ?? []).map(normalizeMembership),
    identities: (payload.identities ?? []).map(normalizeIdentity)
  };
}

function normalizeEmailRequest(payload: EmailRequestPayload): EmailRequestResponse {
  return {
    ok: Boolean(payload.ok),
    challengeId: trimOrUndefined(payload.challenge_id),
    emailHint: trimOrUndefined(payload.email_hint)
  };
}

function normalizeInvite(payload: InvitePayload): AuthInvite {
  return {
    organization: normalizeOrganization(payload.invite.organization),
    emailHint: trimOrUndefined(payload.invite.email_hint),
    email: trimOrUndefined(payload.invite.email),
    membershipType: payload.invite.membership_type ?? null,
    status: trimOrUndefined(payload.invite.status) ?? "pending",
    expiresAt: payload.invite.expires_at ?? null
  };
}

function normalizeCreatedInvite(payload: CreateInvitePayload): CreatedInvite {
  return {
    id: payload.invite.id,
    organizationId: payload.invite.organization_id,
    email: payload.invite.email,
    status: payload.invite.status,
    expiresAt: payload.invite.expires_at ?? null
  };
}

export async function fetchWhoAmI(): Promise<WhoAmIResponse> {
  const payload = await api<WhoAmIPayload>("/api/auth/whoami");
  return normalizeAuthSession(payload);
}

export async function fetchDingTalkConfig(): Promise<DingTalkConfigResponse> {
  return await api<DingTalkConfigResponse>("/api/auth/dingtalk/config");
}

export async function createDingTalkSession(input: {
  code: string;
  state: string;
  nonce: string;
}): Promise<WhoAmIResponse> {
  const payload = await api<WhoAmIPayload>("/api/auth/dingtalk/session", {
    method: "POST",
    json: input
  });
  return normalizeAuthSession(payload);
}

export async function createCrestSession(input: { code: string }): Promise<WhoAmIResponse> {
  const payload = await api<WhoAmIPayload>("/api/auth/crest/session", {
    method: "POST",
    json: {
      code: input.code.trim()
    }
  });
  return normalizeAuthSession(payload);
}

export async function requestEmailSignIn(input: {
  email?: string;
  inviteToken?: string;
}): Promise<EmailRequestResponse> {
  const payload = await api<EmailRequestPayload>("/api/auth/email/request", {
    method: "POST",
    json: {
      email: trimOrUndefined(input.email),
      invite_token: trimOrUndefined(input.inviteToken)
    }
  });
  return normalizeEmailRequest(payload);
}

export async function verifyEmailSignIn(input: {
  email: string;
  code: string;
  inviteToken?: string;
}): Promise<WhoAmIResponse> {
  const payload = await api<WhoAmIPayload>("/api/auth/email/verify", {
    method: "POST",
    json: {
      email: input.email.trim(),
      code: input.code.trim(),
      invite_token: trimOrUndefined(input.inviteToken)
    }
  });
  return normalizeAuthSession(payload);
}

export async function fetchInvite(token: string): Promise<AuthInvite> {
  const payload = await api<InvitePayload>(`/api/auth/invites/${encodeURIComponent(token.trim())}`);
  return normalizeInvite(payload);
}

export async function selectActiveOrganization(organizationId: string): Promise<WhoAmIResponse> {
  const payload = await api<WhoAmIPayload>("/api/auth/organizations/select", {
    method: "POST",
    json: {
      organization_id: organizationId.trim()
    }
  });
  return normalizeAuthSession(payload);
}

export async function updateCurrentUserPortalPreferences(input: {
  showProcessTrace?: boolean;
  collapseFinalTraceOnDone?: boolean;
}): Promise<WhoAmIResponse> {
  const payload = await api<WhoAmIPayload>("/api/auth/portal-preferences", {
    method: "PATCH",
    json: {
      portal_preferences: {
        ...(typeof input.showProcessTrace === "boolean" ? { show_process_trace: input.showProcessTrace } : {}),
        ...(typeof input.collapseFinalTraceOnDone === "boolean"
          ? { collapse_final_trace_on_done: input.collapseFinalTraceOnDone }
          : {})
      }
    }
  });
  return normalizeAuthSession(payload);
}

export async function createOrganizationInvite(input: {
  email: string;
  membershipType?: string;
  organizationId?: string;
}): Promise<CreatedInvite> {
  const payload = await api<CreateInvitePayload>("/api/auth/invites", {
    method: "POST",
    json: {
      organization_id: trimOrUndefined(input.organizationId),
      email: input.email.trim(),
      membership_type: trimOrUndefined(input.membershipType)
    }
  });
  return normalizeCreatedInvite(payload);
}

export async function logoutSession(): Promise<void> {
  await api("/api/auth/logout", {
    method: "POST"
  });
}

export function buildDingTalkAuthorizeUrl(config: DingTalkConfigResponse["config"]): string {
  const search = new URLSearchParams({
    client_id: config.client_id,
    response_type: config.response_type,
    prompt: "consent",
    scope: config.scope,
    state: config.state,
    redirect_uri: config.redirect_uri
  });
  return `https://login.dingtalk.com/oauth2/auth?${search.toString()}`;
}

export function redirectTo(url: string) {
  window.location.assign(url);
}
