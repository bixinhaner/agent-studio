import type { DingTalkUserIdentity } from "../persistence/user-repository.js";

export type DingTalkConfig = {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  redirectUriAliases?: string[];
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

export type DingTalkTodoDetailUrl = {
  pcUrl?: string;
  appUrl?: string;
};

export type DingTalkCreateTodoTaskInput = {
  unionId: string;
  operatorUnionId?: string;
  sourceId: string;
  subject: string;
  description?: string;
  dueTime?: number;
  detailUrl?: DingTalkTodoDetailUrl;
  priority?: number;
};

export type DingTalkCreateTodoTaskResult = {
  taskId: string;
  sourceId?: string;
};

export type DingTalkCompleteTodoTaskInput = {
  unionId: string;
  operatorUnionId?: string;
  taskId: string;
};

export interface DingTalkClient {
  exchangeCode(code: string, options?: { redirectUri?: string }): Promise<DingTalkUserIdentity>;
  validateCredentials?(): Promise<void>;
  listDepartments(input: { parentId?: string | null }): Promise<DingTalkDepartment[]>;
  listDepartmentUsers(input: { departmentId: string }): Promise<DingTalkOrganizationUser[]>;
  getUser(input: { userId: string }): Promise<DingTalkOrganizationUser | null>;
  sendWorkNotice?(input: { userIds?: string[]; message: string }): Promise<void>;
  createTodoTask?(input: DingTalkCreateTodoTaskInput): Promise<DingTalkCreateTodoTaskResult>;
  completeTodoTask?(input: DingTalkCompleteTodoTaskInput): Promise<void>;
}

type AppAccessTokenCache = {
  token: string;
  expiresAt: number;
};

const APP_ACCESS_TOKEN_REFRESH_WINDOW_MS = 60 * 1000;
const APP_ACCESS_TOKEN_FALLBACK_TTL_MS = 60 * 60 * 1000;
export const DINGTALK_ROOT_DEPARTMENT_ID = "1";
const DINGTALK_DEPARTMENT_USER_PAGE_SIZE = 100;

class DingTalkRequestError extends Error {
  readonly code?: string;
  readonly subcode?: string;
  readonly status?: number;

  constructor(input: { message: string; code?: string; subcode?: string; status?: number }) {
    super(input.message);
    this.name = "DingTalkRequestError";
    this.code = input.code;
    this.subcode = input.subcode;
    this.status = input.status;
  }
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

function getBoolean(record: Record<string, unknown> | null, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
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
  const rawResult = root?.result;
  if (Array.isArray(rawResult)) {
    return rawResult;
  }
  const result = asRecord(rawResult) ?? root;
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
    throw new DingTalkRequestError({
      message:
        getString(asRecord(payload), ["message", "msg", "errmsg", "error_description", "sub_msg", "submsg"]) ??
        `DingTalk request failed (${response.status})`,
      code: getString(asRecord(payload), ["errcode", "code"]),
      subcode: getString(asRecord(payload), ["subcode", "sub_code"]),
      status: response.status
    });
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

  throw new DingTalkRequestError({
    message: getErrorMessage(payload) ?? `DingTalk request failed (${String(errcode)})`,
    code: getString(record, ["errcode", "code"]),
    subcode: getString(record, ["subcode", "sub_code"])
  });
}

function getAppAccessTokenExpiresAt(payload: unknown): number {
  const expiresInSeconds = getNumber(asRecord(payload), ["expireIn", "expire_in", "expiresIn", "expires_in"]);
  if (!expiresInSeconds || expiresInSeconds <= 0) {
    return Date.now() + APP_ACCESS_TOKEN_FALLBACK_TTL_MS;
  }

  const expiresInMs = expiresInSeconds * 1000;
  const effectiveTtlMs =
    expiresInMs > APP_ACCESS_TOKEN_REFRESH_WINDOW_MS
      ? expiresInMs - APP_ACCESS_TOKEN_REFRESH_WINDOW_MS
      : expiresInMs;
  return Date.now() + Math.max(1000, effectiveTtlMs);
}

function isInvalidAccessTokenError(error: unknown): boolean {
  if (error instanceof DingTalkRequestError) {
    if (error.code === "40014" || error.subcode === "40014") {
      return true;
    }
  }

  if (!(error instanceof Error)) {
    return false;
  }

  if (!/access[_\s-]*token/i.test(error.message)) {
    return false;
  }

  return /40014|invalid|illegal|not legal|不合法/i.test(error.message);
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
  let appAccessTokenCache: AppAccessTokenCache | undefined;
  let appAccessTokenPromise: Promise<AppAccessTokenCache> | undefined;
  let appAccessTokenGeneration = 0;
  const orgApiBaseUrl = "https://oapi.dingtalk.com";

  const getResolvedConfig = (options?: { redirectUri?: string }) => {
    const resolved = resolveDingTalkConfig({
      ...config,
      redirectUri: trimOrUndefined(options?.redirectUri) ?? config.redirectUri
    });
    if (!resolved.ok) {
      throw new Error(`DingTalk auth is not configured: ${resolved.missing.join(", ")}`);
    }
    return resolved;
  };

  const invalidateAppAccessToken = () => {
    appAccessTokenGeneration += 1;
    appAccessTokenCache = undefined;
    appAccessTokenPromise = undefined;
  };

  const getAppAccessToken = async (options?: { forceRefresh?: boolean }): Promise<string> => {
    const forceRefresh = options?.forceRefresh === true;
    if (forceRefresh) {
      invalidateAppAccessToken();
    } else if (appAccessTokenCache && appAccessTokenCache.expiresAt > Date.now()) {
      return appAccessTokenCache.token;
    }

    if (!appAccessTokenPromise) {
      const generation = appAccessTokenGeneration;
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

          const cachedToken = {
            token: accessToken,
            expiresAt: getAppAccessTokenExpiresAt(tokenPayload)
          };
          if (generation === appAccessTokenGeneration) {
            appAccessTokenCache = cachedToken;
          }
          return cachedToken;
        } catch (error) {
          if (generation === appAccessTokenGeneration) {
            appAccessTokenCache = undefined;
          }
          throw error;
        } finally {
          if (generation === appAccessTokenGeneration) {
            appAccessTokenPromise = undefined;
          }
        }
      })();
    }

    return (await appAccessTokenPromise).token;
  };

  const requestOrgApi = async (path: string, body: Record<string, unknown>): Promise<unknown> => {
    const requestWithAppAccessToken = async (forceRefresh = false): Promise<unknown> => {
      const accessToken = await getAppAccessToken({ forceRefresh });
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

    try {
      return await requestWithAppAccessToken();
    } catch (error) {
      if (!isInvalidAccessTokenError(error)) {
        throw error;
      }
      return requestWithAppAccessToken(true);
    }
  };

  const requestOpenApi = async (
    method: "POST" | "PUT" | "GET" | "DELETE",
    path: string,
    body?: Record<string, unknown>,
    query?: Record<string, string>
  ): Promise<unknown> => {
    const requestWithAppAccessToken = async (forceRefresh = false): Promise<unknown> => {
      const accessToken = await getAppAccessToken({ forceRefresh });
      const resolved = getResolvedConfig();
      const input = new URL(`${resolved.config.apiBaseUrl}${path}`);
      for (const [key, value] of Object.entries(query ?? {})) {
        if (value) input.searchParams.set(key, value);
      }
      const payload = await requestJson(
        input.toString(),
        {
          method,
          headers: {
            "content-type": "application/json",
            "x-acs-dingtalk-access-token": accessToken
          },
          body: body === undefined ? undefined : JSON.stringify(body)
        },
        fetchImpl
      );
      const record = asRecord(payload);
      const errorCode = getString(record, ["errcode", "code"]);
      if (errorCode && errorCode !== "0" && errorCode.toLowerCase() !== "ok") {
        throw new DingTalkRequestError({
          message: getErrorMessage(payload) ?? `DingTalk request failed (${errorCode})`,
          code: errorCode,
          subcode: getString(record, ["subcode", "sub_code"])
        });
      }
      return payload;
    };

    try {
      return await requestWithAppAccessToken();
    } catch (error) {
      if (!isInvalidAccessTokenError(error)) {
        throw error;
      }
      return requestWithAppAccessToken(true);
    }
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
    async exchangeCode(code: string, options?: { redirectUri?: string }): Promise<DingTalkUserIdentity> {
      const normalizedCode = trimOrUndefined(code);
      if (!normalizedCode) {
        throw new Error("DingTalk auth code is required");
      }

      const resolved = getResolvedConfig(options);

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
      const parentId = normalizeString(input.parentId) ?? DINGTALK_ROOT_DEPARTMENT_ID;
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

      const users: DingTalkOrganizationUser[] = [];
      let cursor = 0;
      for (;;) {
        const payload = await requestOrgApi("/topapi/v2/user/list", {
          dept_id: departmentId,
          cursor,
          size: DINGTALK_DEPARTMENT_USER_PAGE_SIZE
        });
        users.push(
          ...getPayloadItems(payload, ["users", "list", "userlist"])
            .map((item) => normalizeOrganizationUser(item))
            .filter((item): item is DingTalkOrganizationUser => Boolean(item))
        );

        const result = asRecord(asRecord(payload)?.result) ?? asRecord(payload);
        const hasMore = getBoolean(result, ["has_more", "hasMore"]) ?? false;
        const nextCursor = getNumber(result, ["next_cursor", "nextCursor"]);
        if (!hasMore || nextCursor === undefined || nextCursor === cursor) {
          break;
        }
        cursor = nextCursor;
      }
      return users;
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
    },
    async createTodoTask(input: DingTalkCreateTodoTaskInput): Promise<DingTalkCreateTodoTaskResult> {
      const unionId = normalizeString(input.unionId);
      const sourceId = normalizeString(input.sourceId);
      const subject = trimOrUndefined(input.subject);
      if (!unionId) {
        throw new Error("DingTalk todo unionId is required");
      }
      if (!sourceId) {
        throw new Error("DingTalk todo sourceId is required");
      }
      if (!subject) {
        throw new Error("DingTalk todo subject is required");
      }
      const detailUrl =
        input.detailUrl?.pcUrl || input.detailUrl?.appUrl
          ? {
              pcUrl: trimOrUndefined(input.detailUrl.pcUrl),
              appUrl: trimOrUndefined(input.detailUrl.appUrl)
            }
          : undefined;
      const body: Record<string, unknown> = {
        sourceId,
        subject,
        creatorId: unionId,
        description: trimOrUndefined(input.description),
        dueTime: Number.isFinite(input.dueTime) ? input.dueTime : undefined,
        executorIds: [unionId],
        participantIds: [],
        detailUrl,
        isOnlyShowExecutor: true,
        priority: Number.isFinite(input.priority) ? input.priority : 20,
        notifyConfigs: {
          dingNotify: "1"
        }
      };
      for (const key of Object.keys(body)) {
        if (body[key] === undefined) delete body[key];
      }
      const payload = await requestOpenApi(
        "POST",
        `/v1.0/todo/users/${encodeURIComponent(unionId)}/tasks`,
        body,
        { operatorId: normalizeString(input.operatorUnionId) ?? unionId }
      );
      const record = asRecord(payload);
      const taskId = getString(record, ["id", "taskId", "task_id"]);
      if (!taskId) {
        throw new Error("DingTalk todo creation did not return a task id");
      }
      return {
        taskId,
        sourceId: getString(record, ["sourceId", "source_id"]) ?? sourceId
      };
    },
    async completeTodoTask(input: DingTalkCompleteTodoTaskInput): Promise<void> {
      const unionId = normalizeString(input.unionId);
      const taskId = normalizeString(input.taskId);
      if (!unionId) {
        throw new Error("DingTalk todo unionId is required");
      }
      if (!taskId) {
        throw new Error("DingTalk todo taskId is required");
      }
      await requestOpenApi(
        "PUT",
        `/v1.0/todo/users/${encodeURIComponent(unionId)}/tasks/${encodeURIComponent(taskId)}`,
        {
          done: true,
          executorIds: [unionId],
          participantIds: []
        },
        { operatorId: normalizeString(input.operatorUnionId) ?? unionId }
      );
    }
  };
}
