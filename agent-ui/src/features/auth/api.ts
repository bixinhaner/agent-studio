import { api } from "../../lib/api";

export type AuthUserRole = "employee" | "admin" | "super_admin" | string;

export type AuthUser = {
  id: string;
  role: AuthUserRole;
  externalId?: string | null;
  displayName?: string;
  email?: string;
  status?: string;
};

export type WhoAmIResponse = {
  user: AuthUser;
};

type AuthUserPayload = {
  id: string;
  role: AuthUserRole;
  external_id?: string | null;
  display_name?: string | null;
  email?: string | null;
  status?: string | null;
};

type WhoAmIPayload = {
  user: AuthUserPayload;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeAuthUser(user: AuthUserPayload): AuthUser {
  return {
    id: user.id,
    role: user.role,
    externalId: user.external_id ?? null,
    displayName: trimOrUndefined(user.display_name),
    email: trimOrUndefined(user.email),
    status: trimOrUndefined(user.status)
  };
}

function normalizeWhoAmIResponse(payload: WhoAmIPayload): WhoAmIResponse {
  return {
    user: normalizeAuthUser(payload.user)
  };
}

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

export async function fetchWhoAmI(): Promise<WhoAmIResponse> {
  const payload = await api<WhoAmIPayload>("/api/auth/whoami");
  return normalizeWhoAmIResponse(payload);
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
  return normalizeWhoAmIResponse(payload);
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
