import type { DingTalkUserIdentity } from "../persistence/user-repository.js";

export type DingTalkConfig = {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  scope?: string;
  apiBaseUrl?: string;
  alertAgentId?: string;
  alertUserIds?: string[];
};

export type DingTalkPublicConfig = {
  client_id: string;
  redirect_uri: string;
  response_type: "code";
  scope: string;
};

export type DingTalkDepartment = {
  externalId: string;
  name: string;
  parentExternalId: string | null;
  sortOrder: number;
};

export type DingTalkOrganizationUser = {
  userId: string;
  unionId?: string;
  openId?: string;
  corpId?: string;
  displayName: string;
  email?: string;
  departmentExternalIds: string[];
  primaryDepartmentExternalId?: string;
  lifecycleState: "active" | "disabled" | "departed";
};

export interface DingTalkClient {
  exchangeCode(code: string): Promise<DingTalkUserIdentity>;
  validateCredentials?(): Promise<void>;
  listDepartments(input: { parentId?: string | null }): Promise<DingTalkDepartment[]>;
  listDepartmentUsers(input: { departmentId: string }): Promise<DingTalkOrganizationUser[]>;
  getUser(input: { userId: string }): Promise<DingTalkOrganizationUser | null>;
  sendWorkNotice?(input: { userIds?: string[]; message: string }): Promise<void>;
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

function normalizeString(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return trimOrUndefined(value);
}

function getString(record: Record<string, unknown> | null, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = normalizeString(record?.[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function getNumber(record: Record<string, unknown> | null, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values: Iterable<unknown>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeString(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
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
    email: getString(result, ["email", "org_email", "orgEmail"]),
    displayName: getString(result, ["nickName", "nick_name", "nick", "name", "displayName", "display_name"]),
    avatarUrl: getString(result, ["avatarUrl", "avatar", "avatar_url"]),
    mobile: getString(result, ["mobile"])
  };
}

function normalizeLifecycleState(record: Record<string, unknown> | null): "active" | "disabled" | "departed" {
  const disableStatus = record?.disable_status;
  const status = getString(record, [
    "lifecycleState",
    "lifecycle_state",
    "status",
    "employeeStatus",
    "employee_status",
    "state"
  ])?.toLowerCase();

  if (status && ["departed", "left", "resigned"].includes(status)) {
    return "departed";
  }
  if (disableStatus === true || disableStatus === 1 || disableStatus === "1") {
    return "disabled";
  }
  if (record?.enabled === false) {
    return "disabled";
  }
  if (status && ["disabled", "inactive"].includes(status)) {
    return "disabled";
  }
  if (status && ["enabled", "in-service", "in_service", "active"].includes(status)) {
    return "active";
  }

  return "active";
}

function getDepartmentExternalIds(record: Record<string, unknown> | null): string[] {
  const values: unknown[] = [];
  for (const key of ["departmentExternalIds", "departmentIds", "dept_id_list", "department", "deptIds"]) {
    values.push(...asArray(record?.[key]));
  }
  for (const item of asArray(record?.dept_position_list)) {
    const entry = asRecord(item);
    values.push(getString(entry, ["dept_id", "deptId", "departmentId"]));
  }
  const directDepartmentId = getString(record, ["dept_id", "deptId", "departmentId", "department_id"]);
  if (directDepartmentId) {
    values.push(directDepartmentId);
  }
  return uniqueStrings(values);
}

function getPrimaryDepartmentExternalId(record: Record<string, unknown> | null): string | undefined {
  for (const item of asArray(record?.dept_position_list)) {
    const entry = asRecord(item);
    if (entry?.is_main === true || entry?.is_main === 1 || entry?.is_main === "1") {
      const deptId = getString(entry, ["dept_id", "deptId", "departmentId"]);
      if (deptId) return deptId;
    }
  }

  const explicitPrimary = getString(record, ["primaryDepartmentExternalId"]);
  if (explicitPrimary) return explicitPrimary;

  const departmentExternalIds = getDepartmentExternalIds(record);
  if (departmentExternalIds.length === 1) {
    return departmentExternalIds[0];
  }

  return undefined;
}

function normalizeDepartment(payload: unknown): DingTalkDepartment | null {
  const record = asRecord(payload);
  const externalId = getString(record, ["externalId", "dept_id", "deptId", "id"]);
  const name = getString(record, ["name"]);
  if (!externalId || !name) {
    return null;
  }

  return {
    externalId,
    name,
    parentExternalId: getString(record, ["parentExternalId", "parent_id", "parentId"]) ?? null,
    sortOrder: getNumber(record, ["sortOrder", "order"]) ?? 0
  };
}

function normalizeOrganizationUser(payload: unknown): DingTalkOrganizationUser | null {
  const record = asRecord(payload);
  const userId = getString(record, ["userId", "userid", "user_id"]);
  if (!userId) {
    return null;
  }

  const departmentExternalIds = getDepartmentExternalIds(record);
  const primaryDepartmentExternalId = getPrimaryDepartmentExternalId(record);
  const normalized: DingTalkOrganizationUser = {
    userId,
    displayName: getString(record, ["displayName", "display_name", "name", "nick"]) ?? userId,
    departmentExternalIds,
    lifecycleState: normalizeLifecycleState(record)
  };
  if (getString(record, ["unionId", "unionid", "union_id"])) {
    normalized.unionId = getString(record, ["unionId", "unionid", "union_id"]);
  }
  if (getString(record, ["openId", "openid", "open_id"])) {
    normalized.openId = getString(record, ["openId", "openid", "open_id"]);
  }
  if (getString(record, ["corpId", "corpid", "corp_id"])) {
    normalized.corpId = getString(record, ["corpId", "corpid", "corp_id"]);
  }
  if (getString(record, ["email", "org_email"])) {
    normalized.email = getString(record, ["email", "org_email"]);
  }
  if (primaryDepartmentExternalId && departmentExternalIds.includes(primaryDepartmentExternalId)) {
    normalized.primaryDepartmentExternalId = primaryDepartmentExternalId;
  }

  return normalized;
}

function getPayloadItems(payload: unknown, keys: string[]): unknown[] {
  const root = asRecord(payload);
  const result = asRecord(root?.result) ?? root;
  for (const key of keys) {
    const items = asArray(result?.[key]);
    if (items.length > 0) {
      return items;
    }
  }
  return [];
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

function getErrorMessage(payload: unknown): string | undefined {
  return getString(asRecord(payload), ["message", "msg", "errmsg", "error_description", "sub_msg"]);
}

async function requestTopApiJson(
  input: string,
  init: RequestInit,
  fetchImpl: typeof fetch
): Promise<unknown> {
  const payload = await requestJson(input, init, fetchImpl);
  const record = asRecord(payload);
  const errcode = record?.errcode;
  if (errcode === undefined || errcode === null || errcode === 0 || errcode === "0") {
    return payload;
  }

  throw new Error(getErrorMessage(payload) ?? `DingTalk request failed (${String(errcode)})`);
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
  let appAccessTokenPromise: Promise<string> | undefined;
  const orgApiBaseUrl = "https://oapi.dingtalk.com";

  const getResolvedConfig = () => {
    const resolved = resolveDingTalkConfig(config);
    if (!resolved.ok) {
      throw new Error(`DingTalk auth is not configured: ${resolved.missing.join(", ")}`);
    }
    return resolved;
  };

  const getAppAccessToken = async (): Promise<string> => {
    if (!appAccessTokenPromise) {
      appAccessTokenPromise = (async () => {
        try {
          const resolved = getResolvedConfig();
          const tokenPayload = await requestJson(
            `${resolved.config.apiBaseUrl}/v1.0/oauth2/accessToken`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json"
              },
              body: JSON.stringify({
                appKey: resolved.config.clientId,
                appSecret: resolved.config.clientSecret
              })
            },
            fetchImpl
          );
          const accessToken = getString(asRecord(tokenPayload), ["accessToken", "access_token"]);
          if (!accessToken) {
            throw new Error("DingTalk app access token request did not return an access token");
          }
          return accessToken;
        } catch (error) {
          appAccessTokenPromise = undefined;
          throw error;
        }
      })();
    }

    return appAccessTokenPromise;
  };

  const requestOrgApi = async (path: string, body: Record<string, unknown>): Promise<unknown> => {
    const accessToken = await getAppAccessToken();
    const input = new URL(`${orgApiBaseUrl}${path}`);
    input.searchParams.set("access_token", accessToken);
    return requestTopApiJson(
      input.toString(),
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body)
      },
      fetchImpl
    );
  };

  const getUserIdByUnionId = async (unionId: string): Promise<string | undefined> => {
    const normalizedUnionId = normalizeString(unionId);
    if (!normalizedUnionId) return undefined;

    const payload = await requestOrgApi("/topapi/user/getbyunionid", { unionid: normalizedUnionId });
    const payloadRecord = asRecord(payload);
    const payloadResult = asRecord(payloadRecord?.result) ?? payloadRecord;
    return getString(payloadResult, ["userid", "userId", "user_id"]);
  };

  return {
    async exchangeCode(code: string): Promise<DingTalkUserIdentity> {
      const normalizedCode = trimOrUndefined(code);
      if (!normalizedCode) {
        throw new Error("DingTalk auth code is required");
      }

      const resolved = getResolvedConfig();

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
            "x-acs-dingtalk-access-token": accessToken
          }
        },
        fetchImpl
      );
      const identity = normalizeUserIdentity(userPayload);
      const shouldHydrateProfile = !identity.displayName || !identity.email;
      if (!shouldHydrateProfile) {
        return identity;
      }

      const profileUserId = identity.userId ?? (await getUserIdByUnionId(identity.unionId));
      if (!profileUserId) {
        return identity;
      }

      const profile = await this.getUser({ userId: profileUserId });
      if (!profile) {
        return { ...identity, userId: profileUserId };
      }

      return {
        ...identity,
        userId: identity.userId ?? profile.userId,
        openId: identity.openId ?? profile.openId,
        corpId: identity.corpId ?? profile.corpId,
        email: identity.email ?? profile.email,
        displayName: identity.displayName ?? profile.displayName
      };
    },
    async validateCredentials(): Promise<void> {
      await getAppAccessToken();
    },
    async listDepartments(input: { parentId?: string | null }): Promise<DingTalkDepartment[]> {
      const parentId = normalizeString(input.parentId) ?? "0";
      const payload = await requestOrgApi("/topapi/v2/department/listsub", { dept_id: parentId });

      return getPayloadItems(payload, ["dept_list", "departments", "list"])
        .map((item) => normalizeDepartment(item))
        .filter((item): item is DingTalkDepartment => Boolean(item));
    },
    async listDepartmentUsers(input: { departmentId: string }): Promise<DingTalkOrganizationUser[]> {
      const departmentId = normalizeString(input.departmentId);
      if (!departmentId) {
        throw new Error("DingTalk departmentId is required");
      }

      const payload = await requestOrgApi("/topapi/v2/user/list", { dept_id: departmentId });

      return getPayloadItems(payload, ["users", "list", "userlist"])
        .map((item) => normalizeOrganizationUser(item))
        .filter((item): item is DingTalkOrganizationUser => Boolean(item));
    },
    async getUser(input: { userId: string }): Promise<DingTalkOrganizationUser | null> {
      const userId = normalizeString(input.userId);
      if (!userId) {
        throw new Error("DingTalk userId is required");
      }

      try {
        const payload = await requestOrgApi("/topapi/v2/user/get", { userid: userId });
        return normalizeOrganizationUser(asRecord(payload)?.result ?? payload);
      } catch (error) {
        if (
          error instanceof Error &&
          /not\s*found|not\s*exist|userid/i.test(error.message)
        ) {
          return null;
        }
        throw error;
      }
    },
    async sendWorkNotice(input: { userIds?: string[]; message: string }): Promise<void> {
      const userIds = uniqueStrings(input.userIds ?? config.alertUserIds ?? []);
      const message = trimOrUndefined(input.message);
      const agentId = trimOrUndefined(config.alertAgentId);
      if (!agentId) {
        throw new Error("DingTalk alert agent is not configured");
      }
      if (!message) {
        throw new Error("DingTalk notification message is required");
      }
      if (!userIds.length) {
        throw new Error("DingTalk alert recipients are not configured");
      }
      await requestOrgApi("/topapi/message/corpconversation/asyncsend_v2", {
        agent_id: Number(agentId),
        userid_list: userIds.join(","),
        msg: {
          msgtype: "text",
          text: {
            content: message
          }
        }
      });
    }
  };
}
