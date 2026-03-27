import type { DingTalkUserIdentity } from "../persistence/user-repository.js";

export type DingTalkConfig = {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  scope?: string;
  apiBaseUrl?: string;
};

export type DingTalkPublicConfig = {
  client_id: string;
  redirect_uri: string;
  response_type: "code";
  scope: string;
};

export interface DingTalkClient {
  exchangeCode(code: string): Promise<DingTalkUserIdentity>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function getString(record: Record<string, unknown> | null, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = trimOrUndefined(record?.[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function normalizeUserIdentity(payload: unknown): DingTalkUserIdentity {
  const root = asRecord(payload);
  const result = asRecord(root?.result) ?? root;
  const unionId = getString(result, ["unionId", "unionid", "union_id"]);
  const openId = getString(result, ["openId", "openid", "open_id"]);
  if (!unionId) {
    throw new Error("DingTalk user profile did not include unionId");
  }

  return {
    unionId,
    openId,
    userId: getString(result, ["userId", "userid", "user_id"]),
    corpId: getString(result, ["corpId", "corpid", "corp_id"]),
    email: getString(result, ["email"]),
    displayName: getString(result, ["nick", "name", "displayName", "display_name"]),
    avatarUrl: getString(result, ["avatarUrl", "avatar", "avatar_url"]),
    mobile: getString(result, ["mobile"])
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function requestJson(
  input: string,
  init: RequestInit,
  fetchImpl: typeof fetch
): Promise<unknown> {
  const response = await fetchImpl(input, init);
  const payload = await readJson(response);
  if (!response.ok) {
    const message = getString(asRecord(payload), ["message", "msg", "errmsg", "error_description"]) ?? `DingTalk request failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

export function resolveDingTalkConfig(config: DingTalkConfig):
  | { ok: true; config: Required<Pick<DingTalkConfig, "clientId" | "clientSecret" | "redirectUri" | "scope" | "apiBaseUrl">>; publicConfig: DingTalkPublicConfig }
  | { ok: false; missing: string[] } {
  const clientId = trimOrUndefined(config.clientId);
  const clientSecret = trimOrUndefined(config.clientSecret);
  const redirectUri = trimOrUndefined(config.redirectUri);
  const scope = trimOrUndefined(config.scope) ?? "openid";
  const apiBaseUrl = trimOrUndefined(config.apiBaseUrl) ?? "https://api.dingtalk.com";

  const missing: string[] = [];
  if (!clientId) missing.push("client_id");
  if (!clientSecret) missing.push("client_secret");
  if (!redirectUri) missing.push("redirect_uri");

  if (missing.length) {
    return { ok: false, missing };
  }

  const resolvedClientId = clientId!;
  const resolvedClientSecret = clientSecret!;
  const resolvedRedirectUri = redirectUri!;

  return {
    ok: true,
    config: {
      clientId: resolvedClientId,
      clientSecret: resolvedClientSecret,
      redirectUri: resolvedRedirectUri,
      scope,
      apiBaseUrl
    },
    publicConfig: {
      client_id: resolvedClientId,
      redirect_uri: resolvedRedirectUri,
      response_type: "code",
      scope
    }
  };
}

export function createDingTalkClient(
  config: DingTalkConfig,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)
): DingTalkClient {
  return {
    async exchangeCode(code: string): Promise<DingTalkUserIdentity> {
      const normalizedCode = trimOrUndefined(code);
      if (!normalizedCode) {
        throw new Error("DingTalk auth code is required");
      }

      const resolved = resolveDingTalkConfig(config);
      if (!resolved.ok) {
        throw new Error(`DingTalk auth is not configured: ${resolved.missing.join(", ")}`);
      }

      const tokenPayload = await requestJson(
        `${resolved.config.apiBaseUrl}/v1.0/oauth2/userAccessToken`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            clientId: resolved.config.clientId,
            clientSecret: resolved.config.clientSecret,
            code: normalizedCode,
            grantType: "authorization_code",
            redirectUri: resolved.config.redirectUri
          })
        },
        fetchImpl
      );
      const tokenRecord = asRecord(tokenPayload);
      const accessToken = getString(tokenRecord, ["accessToken", "access_token"]);
      if (!accessToken) {
        throw new Error("DingTalk access token exchange did not return an access token");
      }

      const userPayload = await requestJson(
        `${resolved.config.apiBaseUrl}/v1.0/contact/users/me`,
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${accessToken}`
          }
        },
        fetchImpl
      );
      return normalizeUserIdentity(userPayload);
    }
  };
}
