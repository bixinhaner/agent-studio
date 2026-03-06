import "dotenv/config";
import path from "node:path";
import { z } from "zod";
import { DEFAULT_MODEL, REASONING_EFFORT_VALUES, normalizeModel, normalizeReasoningEffortForModel } from "./model-config.js";

const schema = z.object({
  PORT: z.string().default("8787"),
  HOST: z.string().default("0.0.0.0"),
  AGENT_API_TOKEN: z.string().optional(),
  DEFAULT_MODEL: z.string().default(DEFAULT_MODEL),
  DEFAULT_REASONING_EFFORT: z.enum(REASONING_EFFORT_VALUES).default("high"),
  DEFAULT_WORKSPACE: z.string().default("."),
  SESSION_TTL_MINUTES: z.string().default("180"),
  WORKSPACE_WHITELIST: z.string().default("."),
  THREAD_STORE_FILE: z.string().default("./temp/agent-threads.json"),
  UPLOAD_TEMP_ROOT: z.string().default("./temp/session-uploads")
});

const env = schema.parse(process.env);

const ttlMinutes = Number(env.SESSION_TTL_MINUTES);
const ttlMs = Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes * 60 * 1000 : 180 * 60 * 1000;

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

export const appConfig = {
  port: Number(env.PORT) || 8787,
  host: env.HOST,
  token: (env.AGENT_API_TOKEN || "").trim(),
  defaultModel,
  defaultReasoningEffort,
  defaultWorkspace,
  sessionTtlMs: ttlMs,
  workspaceWhitelist: whitelist.length ? whitelist : [defaultWorkspace],
  threadStoreFile,
  uploadTempRoot
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
