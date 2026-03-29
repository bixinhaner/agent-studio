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
  listDepartments?(input: { parentId?: string | null }): Promise<DingTalkDepartment[]>;
  listDepartmentUsers?(input: { departmentId: string }): Promise<DingTalkOrganizationUser[]>;
  getUser?(input: { userId: string }): Promise<DingTalkOrganizationUser | null>;
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
    email: getString(result, ["email"]),
    displayName: getString(result, ["nick", "name", "displayName", "display_name"]),
    avatarUrl: getString(result, ["avatarUrl", "avatar", "avatar_url"]),
    mobile: getString(result, ["mobile"])
  };
}

function normalizeLifecycleState(record: Record<string, unknown> | null): "active" | "disabled" | "departed" {
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
  if (status && ["disabled", "inactive"].includes(status)) {
    return "disabled";
  }
  if (status && ["enabled", "in-service", "in_service", "active"].includes(status)) {
    return "active";
  }

  if (record?.enabled === false || record?.active === false) {
    return "disabled";
  }

  return "active";
}

function getDepartmentExternalIds(record: Record<string, unknown> | null): string[] {
  const values: unknown[] = [];
  for (const key of ["departmentExternalIds", "departmentIds", "dept_id_list", "department", "deptIds"]) {
    values.push(...asArray(record?.[key]));
  }
  const primary = getString(record, [
    "primaryDepartmentExternalId",
    "dept_id",
    "deptId",
    "departmentId",
    "department_id"
  ]);
  if (primary) {
    values.push(primary);
  }
  return uniqueStrings(values);
}

function getPrimaryDepartmentExternalId(record: Record<string, unknown> | null): string | undefined {
  const explicitPrimary = getString(record, [
    "primaryDepartmentExternalId",
    "dept_id",
    "deptId",
    "departmentId",
    "department_id"
  ]);
  if (explicitPrimary) {
    return explicitPrimary;
  }

  for (const item of asArray(record?.leader_in_dept)) {
    const entry = asRecord(item);
    if (entry?.leader === true) {
      const deptId = getString(entry, ["dept_id", "deptId", "departmentId"]);
      if (deptId) {
        return deptId;
      }
    }
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
    },
    async listDepartments(input: { parentId?: string | null }): Promise<DingTalkDepartment[]> {
      const resolved = resolveDingTalkConfig(config);
      if (!resolved.ok) {
        throw new Error(`DingTalk auth is not configured: ${resolved.missing.join(", ")}`);
      }

      const parentId = normalizeString(input.parentId) ?? "0";
      const payload = await requestJson(
        `${resolved.config.apiBaseUrl}/v1.0/contact/departments?parentId=${encodeURIComponent(parentId)}`,
        {
          method: "GET"
        },
        fetchImpl
      );

      return getPayloadItems(payload, ["departments", "list"])
        .map((item) => normalizeDepartment(item))
        .filter((item): item is DingTalkDepartment => Boolean(item));
    },
    async listDepartmentUsers(input: { departmentId: string }): Promise<DingTalkOrganizationUser[]> {
      const resolved = resolveDingTalkConfig(config);
      if (!resolved.ok) {
        throw new Error(`DingTalk auth is not configured: ${resolved.missing.join(", ")}`);
      }

      const departmentId = normalizeString(input.departmentId);
      if (!departmentId) {
        throw new Error("DingTalk departmentId is required");
      }

      const payload = await requestJson(
        `${resolved.config.apiBaseUrl}/v1.0/contact/users?departmentId=${encodeURIComponent(departmentId)}`,
        {
          method: "GET"
        },
        fetchImpl
      );

      return getPayloadItems(payload, ["users", "list", "userlist"])
        .map((item) => normalizeOrganizationUser(item))
        .filter((item): item is DingTalkOrganizationUser => Boolean(item));
    },
    async getUser(input: { userId: string }): Promise<DingTalkOrganizationUser | null> {
      const resolved = resolveDingTalkConfig(config);
      if (!resolved.ok) {
        throw new Error(`DingTalk auth is not configured: ${resolved.missing.join(", ")}`);
      }

      const userId = normalizeString(input.userId);
      if (!userId) {
        throw new Error("DingTalk userId is required");
      }

      const response = await fetchImpl(`${resolved.config.apiBaseUrl}/v1.0/contact/users/${encodeURIComponent(userId)}`, {
        method: "GET"
      });
      if (response.status === 404) {
        return null;
      }

      const payload = await readJson(response);
      if (!response.ok) {
        const message =
          getString(asRecord(payload), ["message", "msg", "errmsg", "error_description"]) ??
          `DingTalk request failed (${response.status})`;
        throw new Error(message);
      }

      return normalizeOrganizationUser(asRecord(payload)?.result ?? payload);
    }
  };
}
