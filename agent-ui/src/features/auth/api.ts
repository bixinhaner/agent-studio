import { api } from "../../lib/api";

export type AuthUserRole = "employee" | "admin" | "super_admin" | string;

export type AuthUser = {
  id: string;
  role: AuthUserRole;
  displayName?: string;
  email?: string;
  status?: string;
};

export type WhoAmIResponse = {
  user: AuthUser;
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

export async function fetchWhoAmI(): Promise<WhoAmIResponse> {
  return await api<WhoAmIResponse>("/api/auth/whoami");
}

export async function fetchDingTalkConfig(): Promise<DingTalkConfigResponse> {
  return await api<DingTalkConfigResponse>("/api/auth/dingtalk/config");
}

export async function createDingTalkSession(input: {
  code: string;
  state: string;
  nonce: string;
}): Promise<WhoAmIResponse> {
  return await api<WhoAmIResponse>("/api/auth/dingtalk/session", {
    method: "POST",
    json: input
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
