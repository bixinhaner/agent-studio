import "dotenv/config";
import path from "node:path";
import { z } from "zod";
import { DEFAULT_MODEL, REASONING_EFFORT_VALUES, normalizeModel, normalizeReasoningEffortForModel } from "./model-config.js";

const schema = z.object({
  NODE_ENV: z.string().optional(),
  PORT: z.string().default("8787"),
  HOST: z.string().default("0.0.0.0"),
  AGENT_API_TOKEN: z.string().optional(),
  DINGTALK_CLIENT_ID: z.string().optional(),
  DINGTALK_CLIENT_SECRET: z.string().optional(),
  DINGTALK_REDIRECT_URI: z.string().optional(),
  DINGTALK_SCOPE: z.string().default("openid"),
  DEFAULT_MODEL: z.string().default(DEFAULT_MODEL),
  DEFAULT_REASONING_EFFORT: z.enum(REASONING_EFFORT_VALUES).default("high"),
  DEFAULT_WORKSPACE: z.string().default("."),
  SESSION_TTL_MINUTES: z.string().default("180"),
  SESSION_COOKIE_NAME: z.string().default("agent_studio_session"),
  SESSION_COOKIE_SECRET: z.string().optional(),
  SESSION_COOKIE_MAX_AGE_DAYS: z.string().default("7"),
  SESSION_COOKIE_SECURE: z.string().optional(),
  ORG_SYNC_ENABLED: z.string().optional(),
  ORG_SYNC_INTERVAL_MINUTES: z.string().optional(),
  WORKSPACE_WHITELIST: z.string().default("."),
  LEGACY_THREAD_OWNER_ID: z.string().optional(),
  THREAD_STORE_FILE: z.string().default("./temp/agent-threads.json"),
  UPLOAD_TEMP_ROOT: z.string().default("./temp/session-uploads"),
  KNOWLEDGE_SET_STORAGE_ROOT: z.string().default("./temp/knowledge-sets")
});

const env = schema.parse(process.env);

const ttlMinutes = Number(env.SESSION_TTL_MINUTES);
const ttlMs = Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes * 60 * 1000 : 180 * 60 * 1000;
const sessionCookieDays = Number(env.SESSION_COOKIE_MAX_AGE_DAYS);
const sessionCookieMaxAgeMs =
  Number.isFinite(sessionCookieDays) && sessionCookieDays > 0
    ? sessionCookieDays * 24 * 60 * 60 * 1000
    : 7 * 24 * 60 * 60 * 1000;

const defaultModel = normalizeModel(env.DEFAULT_MODEL);
const defaultReasoningEffort = normalizeReasoningEffortForModel(defaultModel, env.DEFAULT_REASONING_EFFORT);
const defaultWorkspace = path.resolve(process.cwd(), env.DEFAULT_WORKSPACE);
const whitelist = env.WORKSPACE_WHITELIST.split(",")
  .map((item) => item.trim())
  .filter(Boolean)
  .map((item) => path.resolve(process.cwd(), item));

const threadStoreFile = path.isAbsolute(env.THREAD_STORE_FILE)
  ? env.THREAD_STORE_FILE
  : path.resolve(process.cwd(), env.THREAD_STORE_FILE);

const uploadTempRoot = path.isAbsolute(env.UPLOAD_TEMP_ROOT)
  ? env.UPLOAD_TEMP_ROOT
  : path.resolve(process.cwd(), env.UPLOAD_TEMP_ROOT);

const knowledgeSetStorageRoot = path.isAbsolute(env.KNOWLEDGE_SET_STORAGE_ROOT)
  ? env.KNOWLEDGE_SET_STORAGE_ROOT
  : path.resolve(process.cwd(), env.KNOWLEDGE_SET_STORAGE_ROOT);

function parseBoolean(value: string): boolean {
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseBooleanWithDefault(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  return parseBoolean(value);
}

function parseInteger(value: string | undefined, defaultValue: number): number {
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function defaultCookieSecure(nodeEnv: string | undefined): boolean {
  const normalized = (nodeEnv || "").trim().toLowerCase();
  return normalized !== "development" && normalized !== "test";
}

export const appConfig = {
  port: Number(env.PORT) || 8787,
  host: env.HOST,
  token: (env.AGENT_API_TOKEN || "").trim(),
  dingtalk: {
    clientId: (env.DINGTALK_CLIENT_ID || "").trim(),
    clientSecret: (env.DINGTALK_CLIENT_SECRET || "").trim(),
    redirectUri: (env.DINGTALK_REDIRECT_URI || "").trim(),
    scope: (env.DINGTALK_SCOPE || "").trim() || "openid"
  },
  defaultModel,
  defaultReasoningEffort,
  defaultWorkspace,
  sessionTtlMs: ttlMs,
  sessionCookie: {
    name: (env.SESSION_COOKIE_NAME || "").trim() || "agent_studio_session",
    secret: (env.SESSION_COOKIE_SECRET || "").trim(),
    maxAgeMs: sessionCookieMaxAgeMs,
    secure:
      env.SESSION_COOKIE_SECURE === undefined
        ? defaultCookieSecure(env.NODE_ENV)
        : parseBoolean(env.SESSION_COOKIE_SECURE)
  },
  workspaceWhitelist: whitelist.length ? whitelist : [defaultWorkspace],
  legacyThreadOwnerId: (env.LEGACY_THREAD_OWNER_ID || "").trim(),
  threadStoreFile,
  uploadTempRoot,
  knowledgeSetStorageRoot,
  orgSync: {
    enabled: parseBooleanWithDefault(env.ORG_SYNC_ENABLED, true),
    intervalMinutes: parseInteger(env.ORG_SYNC_INTERVAL_MINUTES, 24 * 60)
  }
};

export function resolveWorkspace(input?: string | null): string {
  const raw = (input || "").trim();
  const candidate = raw ? path.resolve(process.cwd(), raw) : appConfig.defaultWorkspace;
  for (const root of appConfig.workspaceWhitelist) {
    if (candidate === root || candidate.startsWith(`${root}${path.sep}`)) {
      return candidate;
    }
  }
  throw new Error("workspace 不在允许目录白名单中");
}
