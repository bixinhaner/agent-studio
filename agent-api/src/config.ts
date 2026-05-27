import "dotenv/config";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  DINGTALK_REDIRECT_URI_ALIASES: z.string().optional(),
  DINGTALK_SCOPE: z.string().default("openid"),
  DINGTALK_ALERT_AGENT_ID: z.string().optional(),
  DINGTALK_ALERT_USER_IDS: z.string().optional(),
  CREST_BASE_URL: z.string().optional(),
  CREST_AGENT_STUDIO_CLIENT_ID: z.string().optional(),
  CREST_AGENT_STUDIO_CLIENT_SECRET: z.string().optional(),
  DEFAULT_MODEL: z.string().default(DEFAULT_MODEL),
  DEFAULT_REASONING_EFFORT: z.enum(REASONING_EFFORT_VALUES).default("high"),
  DEFAULT_WORKSPACE: z.string().default("."),
  SESSION_WORKSPACE_ROOT: z.string().optional(),
  SESSION_TTL_MINUTES: z.string().default("0"),
  SESSION_COOKIE_NAME: z.string().default("agent_studio_session"),
  SESSION_COOKIE_SECRET: z.string().optional(),
  SESSION_COOKIE_MAX_AGE_DAYS: z.string().default("7"),
  SESSION_COOKIE_SECURE: z.string().optional(),
  APP_BASE_URL: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_SECURE: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  AUTH_EMAIL_FROM: z.string().optional(),
  AUTH_EMAIL_DEBUG: z.string().optional(),
  ACCESS_REQUEST_INTERNAL_EMAIL_DOMAINS: z.string().optional(),
  ACCESS_REQUEST_PUBLIC_EMAIL_BLOCKLIST_EXTRA: z.string().optional(),
  ACCESS_REQUEST_DEFAULT_TRIAL_DAYS: z.string().optional(),
  ACCESS_REQUEST_UPLOAD_ROOT: z.string().default("./temp/access-request-proofs"),
  ORG_SYNC_ENABLED: z.string().optional(),
  ORG_SYNC_INTERVAL_MINUTES: z.string().optional(),
  WORKSPACE_WHITELIST: z.string().default("."),
  LEGACY_THREAD_OWNER_ID: z.string().optional(),
  THREAD_STORE_FILE: z.string().default("./temp/agent-threads.json"),
  UPLOAD_TEMP_ROOT: z.string().default("./temp/session-uploads"),
  BRANDING_ASSET_ROOT: z.string().default("./temp/branding-assets"),
  KNOWLEDGE_SET_STORAGE_ROOT: z.string().default("./temp/knowledge-sets"),
  CODEX_BASE_HOME: z.string().optional(),
  CODEX_SESSION_HOME_ROOT: z.string().default("./temp/codex-homes"),
  CODEX_SKILL_DRAFT_ROOT: z.string().default("./temp/skill-drafts"),
  AGENT_STUDIO_DEPLOY_DRAIN_FILE: z.string().default("./temp/deploy-drain.json")
});

const env = schema.parse(process.env);

// Runtime sessions are kept until they are explicitly replaced or the thread is deleted.
const ttlMs: number | null = null;
const sessionCookieDays = Number(env.SESSION_COOKIE_MAX_AGE_DAYS);
const sessionCookieMaxAgeMs =
  Number.isFinite(sessionCookieDays) && sessionCookieDays > 0
    ? sessionCookieDays * 24 * 60 * 60 * 1000
    : 7 * 24 * 60 * 60 * 1000;

const defaultModel = normalizeModel(env.DEFAULT_MODEL);
const defaultReasoningEffort = normalizeReasoningEffortForModel(defaultModel, env.DEFAULT_REASONING_EFFORT);
const defaultWorkspace = path.resolve(process.cwd(), env.DEFAULT_WORKSPACE);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultSessionWorkspaceRoot = path.resolve(moduleDir, "..", "..", "sessions");
const sessionWorkspaceRootInput = (env.SESSION_WORKSPACE_ROOT || "").trim();
const sessionWorkspaceRoot = sessionWorkspaceRootInput
  ? path.isAbsolute(sessionWorkspaceRootInput)
    ? sessionWorkspaceRootInput
    : path.resolve(process.cwd(), sessionWorkspaceRootInput)
  : defaultSessionWorkspaceRoot;
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

const brandingAssetRoot = path.isAbsolute(env.BRANDING_ASSET_ROOT)
  ? env.BRANDING_ASSET_ROOT
  : path.resolve(process.cwd(), env.BRANDING_ASSET_ROOT);

const knowledgeSetStorageRoot = path.isAbsolute(env.KNOWLEDGE_SET_STORAGE_ROOT)
  ? env.KNOWLEDGE_SET_STORAGE_ROOT
  : path.resolve(process.cwd(), env.KNOWLEDGE_SET_STORAGE_ROOT);

const accessRequestUploadRoot = path.isAbsolute(env.ACCESS_REQUEST_UPLOAD_ROOT)
  ? env.ACCESS_REQUEST_UPLOAD_ROOT
  : path.resolve(process.cwd(), env.ACCESS_REQUEST_UPLOAD_ROOT);

const codexBaseHomeInput = (env.CODEX_BASE_HOME || process.env.CODEX_HOME || "").trim();
const codexBaseHome = codexBaseHomeInput
  ? path.isAbsolute(codexBaseHomeInput)
    ? codexBaseHomeInput
    : path.resolve(process.cwd(), codexBaseHomeInput)
  : path.join(os.homedir(), ".codex");

const codexSessionHomeRoot = path.isAbsolute(env.CODEX_SESSION_HOME_ROOT)
  ? env.CODEX_SESSION_HOME_ROOT
  : path.resolve(process.cwd(), env.CODEX_SESSION_HOME_ROOT);

const codexSkillDraftRoot = path.isAbsolute(env.CODEX_SKILL_DRAFT_ROOT)
  ? env.CODEX_SKILL_DRAFT_ROOT
  : path.resolve(process.cwd(), env.CODEX_SKILL_DRAFT_ROOT);

const deployDrainFile = path.isAbsolute(env.AGENT_STUDIO_DEPLOY_DRAIN_FILE)
  ? env.AGENT_STUDIO_DEPLOY_DRAIN_FILE
  : path.resolve(process.cwd(), env.AGENT_STUDIO_DEPLOY_DRAIN_FILE);

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
    redirectUriAliases: (env.DINGTALK_REDIRECT_URI_ALIASES || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    scope: (env.DINGTALK_SCOPE || "").trim() || "openid",
    alertAgentId: (env.DINGTALK_ALERT_AGENT_ID || "").trim(),
    alertUserIds: (env.DINGTALK_ALERT_USER_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  },
  crest: {
    baseUrl: ((env.CREST_BASE_URL || "").trim() || "https://crest.baicells.com").replace(/\/+$/, ""),
    clientId: (env.CREST_AGENT_STUDIO_CLIENT_ID || "").trim(),
    clientSecret: (env.CREST_AGENT_STUDIO_CLIENT_SECRET || "").trim()
  },
  defaultModel,
  defaultReasoningEffort,
  defaultWorkspace,
  sessionWorkspaceRoot,
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
  appBaseUrl: (env.APP_BASE_URL || "").trim(),
  authEmail: {
    host: (env.SMTP_HOST || "").trim(),
    port: parseInteger(env.SMTP_PORT, 587),
    secure: parseBooleanWithDefault(env.SMTP_SECURE, false),
    user: (env.SMTP_USER || "").trim(),
    pass: (env.SMTP_PASS || "").trim(),
    from: (env.AUTH_EMAIL_FROM || "").trim(),
    debug: parseBooleanWithDefault(env.AUTH_EMAIL_DEBUG, false)
  },
  accessRequests: {
    internalEmailDomains: ((env.ACCESS_REQUEST_INTERNAL_EMAIL_DOMAINS || "").trim() || "baicells.com")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
    publicEmailBlocklistExtra: (env.ACCESS_REQUEST_PUBLIC_EMAIL_BLOCKLIST_EXTRA || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
    defaultTrialDays: parseInteger(env.ACCESS_REQUEST_DEFAULT_TRIAL_DAYS, 14)
  },
  accessRequestUploadRoot,
  workspaceWhitelist: whitelist.length ? whitelist : [defaultWorkspace],
  legacyThreadOwnerId: (env.LEGACY_THREAD_OWNER_ID || "").trim(),
  threadStoreFile,
  uploadTempRoot,
  brandingAssetRoot,
  knowledgeSetStorageRoot,
  codex: {
    baseHome: codexBaseHome,
    sessionHomeRoot: codexSessionHomeRoot,
    skillDraftRoot: codexSkillDraftRoot
  },
  deployDrainFile,
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
  throw new Error("Workspace is not within the allowed whitelist");
}
