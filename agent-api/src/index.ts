import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { registerCommonApiRoutes } from "./app-routes.js";
import { createAdminRouter } from "./admin/router.js";
import { createAuthRouter } from "./auth/router.js";
import { createCurrentUserMiddleware } from "./auth/current-user.js";
import { createDingTalkClient } from "./auth/dingtalk.js";
import { createOAuthStateCookieManager, createSessionCookieManager } from "./auth/session-cookie.js";
import { appConfig, resolveWorkspace } from "./config.js";
import { CodexRuntime } from "./codex-runtime.js";
import { getDbClient } from "./db/client.js";
import { createZendeskAdminRouter, handleZendeskWebhookRequest, ZendeskIntegrationService } from "./integrations/zendesk/index.js";
import { REASONING_EFFORT_VALUES, normalizeModel, normalizeReasoningEffortForModel } from "./model-config.js";
import { importLegacyThreadsFromJson } from "./persistence/json-import.js";
import { SessionRepository, type SessionRepositoryDb } from "./persistence/session-repository.js";
import {
  ThreadRepository,
  type ReasoningEffort,
  type ThreadRecord,
  type ThreadRepositoryDb
} from "./persistence/thread-repository.js";
import { UserRepository, type UserRepositoryDb } from "./persistence/user-repository.js";
import {
  DepartmentMembershipRepository,
  type DepartmentMembershipRepositoryDb
} from "./persistence/department-membership-repository.js";
import { WorkspaceRepository, type WorkspaceRepositoryDb } from "./persistence/workspace-repository.js";
import { KnowledgeSetRepository, type KnowledgeSetRepositoryDb } from "./persistence/knowledge-set-repository.js";
import { ResourcePolicyRepository, type ResourcePolicyRepositoryDb } from "./persistence/resource-policy-repository.js";
import { createPortalRouter } from "./portal/router.js";
import { createResourcesAdminRouter } from "./resources/admin-router.js";
import { createResourcesPortalRouter } from "./resources/portal-router.js";
import { RuntimeKnowledgeSetService } from "./resources/runtime-knowledge-set-service.js";
import { FilesystemKnowledgeSetStorage } from "./resources/storage/filesystem-knowledge-set-storage.js";
import { PolicyService } from "./resources/policy-service.js";
import { initSSE, sendSSE } from "./sse.js";

const app = express();
const runtime = new CodexRuntime();
const db = getDbClient();
const sessions = new SessionRepository(db as unknown as SessionRepositoryDb, appConfig.sessionTtlMs);
const threads = new ThreadRepository(db as unknown as ThreadRepositoryDb);
const users = new UserRepository(db as unknown as UserRepositoryDb);
const departmentMemberships = new DepartmentMembershipRepository(db as unknown as DepartmentMembershipRepositoryDb);
const workspaces = new WorkspaceRepository(db as unknown as WorkspaceRepositoryDb);
const knowledgeSets = new KnowledgeSetRepository(db as unknown as KnowledgeSetRepositoryDb);
const resourcePolicies = new ResourcePolicyRepository(db as unknown as ResourcePolicyRepositoryDb);
const knowledgeSetStorage = new FilesystemKnowledgeSetStorage(appConfig.knowledgeSetStorageRoot);
const policyService = new PolicyService(resourcePolicies);
const runtimeKnowledgeSets = new RuntimeKnowledgeSetService({
  workspaces,
  knowledgeSets,
  policies: policyService,
  storage: knowledgeSetStorage
});
const zendesk = new ZendeskIntegrationService();
const sessionCookies = createSessionCookieManager({
  cookieName: appConfig.sessionCookie.name,
  secret: appConfig.sessionCookie.secret,
  maxAgeMs: appConfig.sessionCookie.maxAgeMs,
  secure: appConfig.sessionCookie.secure,
  sameSite: "lax"
});
const oauthStates = createOAuthStateCookieManager({
  cookieName: `${appConfig.sessionCookie.name}_oauth_state`,
  secret: appConfig.sessionCookie.secret,
  maxAgeMs: 10 * 60 * 1000,
  secure: appConfig.sessionCookie.secure,
  sameSite: "lax"
});
const dingtalkClient = createDingTalkClient(appConfig.dingtalk);
const reasoningEffortSchema = z.enum(REASONING_EFFORT_VALUES);
type LiveRuntimeThread = Awaited<ReturnType<CodexRuntime["startThreadWithOptions"]>>;
const liveRuntimeThreads = new Map<string, LiveRuntimeThread>();

const createSessionSchema = z.object({
  session_id: z.string().optional(),
  model: z.string().optional(),
  reasoning_effort: reasoningEffortSchema.optional(),
  workspace: z.string().optional(),
  knowledge_set_ids: z.array(z.string()).optional(),
  codex_run_config: z.record(z.unknown()).optional()
});

const streamSchema = z.object({
  session_id: z.string().min(1),
  thread_id: z.string().min(1).optional(),
  message: z.string().min(1)
});

const createThreadSchema = z.object({
  title: z.string().optional(),
  external_id: z.string().optional(),
  model: z.string().optional(),
  reasoning_effort: reasoningEffortSchema.optional(),
  workspace: z.string().optional(),
  knowledge_set_ids: z.array(z.string()).optional(),
  codex_run_config: z.record(z.unknown()).optional()
});

const patchThreadSchema = z.object({
  title: z.string().optional(),
  status: z.enum(["regular", "archived"]).optional(),
  model: z.string().optional(),
  reasoning_effort: reasoningEffortSchema.optional(),
  workspace: z.string().optional(),
  codex_run_config: z.record(z.unknown()).optional()
});

const ensureThreadSessionSchema = z.object({
  model: z.string().optional(),
  reasoning_effort: reasoningEffortSchema.optional(),
  workspace: z.string().optional(),
  knowledge_set_ids: z.array(z.string()).optional(),
  codex_run_config: z.record(z.unknown()).optional()
});

const appendMessageSchema = z.object({
  parent_id: z.string().nullable().optional(),
  message: z.unknown(),
  run_config: z.record(z.unknown()).optional()
});

const replaceMessagesSchema = z.object({
  head_id: z.string().nullable().optional(),
  messages: z.array(appendMessageSchema)
});

const feedbackSchema = z.object({
  type: z.enum(["positive", "negative"]),
  message_id: z.string().optional(),
  content_preview: z.string().optional()
});

const browseDirectoriesSchema = z.object({
  path: z.string().optional()
});

type SessionOptions = {
  userId: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  workspace: string;
  codexRunConfig?: Record<string, unknown>;
};

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return String(value);
  }
}

function sessionOut(session: {
  sessionId: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  workspace: string;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    session_id: session.sessionId,
    model: session.model,
    reasoning_effort: session.reasoningEffort,
    workspace: session.workspace,
    created_at: session.createdAt,
    updated_at: session.updatedAt
  };
}

function threadOut(thread: ThreadRecord) {
  return {
    id: thread.id,
    status: thread.status,
    title: thread.title,
    external_id: thread.externalId,
    model: thread.model,
    reasoning_effort: thread.reasoningEffort,
    workspace: thread.workspace,
    created_at: thread.createdAt,
    updated_at: thread.updatedAt
  };
}

function pickSessionOptions(input: {
  model?: string;
  reasoning_effort?: ReasoningEffort;
  workspace?: string;
  codex_run_config?: Record<string, unknown>;
}, userId: string): SessionOptions {
  const workspace = resolveWorkspace(input.workspace);
  const model = normalizeModel(input.model || appConfig.defaultModel);
  return {
    userId,
    model,
    reasoningEffort: normalizeReasoningEffortForModel(
      model,
      input.reasoning_effort || appConfig.defaultReasoningEffort
    ),
    workspace,
    codexRunConfig: input.codex_run_config
  };
}

function getThreadUploadTempDir(threadId: string): string {
  const safeThreadId = threadId.replace(/[^a-zA-Z0-9_-]/g, "_").trim() || "thread";
  return path.join(appConfig.uploadTempRoot, safeThreadId);
}

function normalizeAdditionalDirectories(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((it) => (typeof it === "string" ? it.trim() : ""))
    .filter(Boolean);
}

function ensureThreadUploadInRunConfig(
  input: Record<string, unknown> | undefined,
  uploadDir: string
): Record<string, unknown> {
  const next: Record<string, unknown> = input ? { ...input } : {};
  const dirs = normalizeAdditionalDirectories(next.additionalDirectories);
  const resolved = new Set(dirs.map((it) => path.resolve(it)));
  const normalizedUploadDir = path.resolve(uploadDir);
  if (!resolved.has(normalizedUploadDir)) {
    dirs.push(normalizedUploadDir);
  }
  next.additionalDirectories = dirs;
  return next;
}

async function createSession(options: SessionOptions, threadId?: string) {
  const uploadDir = threadId ? getThreadUploadTempDir(threadId) : "";
  const codexRunConfig = threadId
    ? ensureThreadUploadInRunConfig(options.codexRunConfig, uploadDir)
    : options.codexRunConfig;
  if (threadId && uploadDir) {
    await fs.mkdir(uploadDir, { recursive: true });
  }

  const liveThread = await runtime.startThreadWithOptions({
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    workspace: options.workspace,
    codexRunConfig
  });
  const session = await sessions.create({
    userId: options.userId,
    threadId,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    workspace: options.workspace,
    codexRunConfig
  });
  liveRuntimeThreads.set(session.sessionId, liveThread);
  return session;
}

async function resolveKnowledgeSetRunConfig(input: {
  currentUser: {
    id: string;
    role?: string;
  };
  workspacePath: string;
  knowledgeSetIds?: string[];
  codexRunConfig?: Record<string, unknown>;
}): Promise<Record<string, unknown> | undefined> {
  return runtimeKnowledgeSets.mergeSelectedKnowledgeSetsIntoRunConfig({
    userId: input.currentUser.id,
    roleIds: [input.currentUser.role ?? "employee"],
    departmentIds: await departmentMemberships.listIdsForUser(input.currentUser.id),
    workspacePath: input.workspacePath,
    knowledgeSetIds: input.knowledgeSetIds,
    codexRunConfig: input.codexRunConfig
  });
}

async function resolveSessionOptions(
  input: {
    model?: string;
    reasoning_effort?: ReasoningEffort;
    workspace?: string;
    knowledge_set_ids?: string[];
    codex_run_config?: Record<string, unknown>;
  },
  currentUser: {
    id: string;
    role?: string;
  }
): Promise<SessionOptions> {
  const options = pickSessionOptions(input, currentUser.id);
  return {
    ...options,
    codexRunConfig: await resolveKnowledgeSetRunConfig({
      currentUser,
      workspacePath: options.workspace,
      knowledgeSetIds: input.knowledge_set_ids,
      codexRunConfig: options.codexRunConfig
    })
  };
}

async function ensureThreadSession(
  currentUser: {
    id: string;
    role?: string;
  },
  threadId: string,
  patch?: {
    model?: string;
    reasoning_effort?: ReasoningEffort;
    workspace?: string;
    knowledge_set_ids?: string[];
    codex_run_config?: Record<string, unknown>;
  }
) {
  const thread = await threads.getOwned(threadId, currentUser.id);
  if (!thread) throw new Error("thread 不存在");

  const sourceCodexRunConfig = patch?.codex_run_config ?? thread.codexRunConfig;
  const desiredModel = normalizeModel(patch?.model || thread.model || appConfig.defaultModel);
  const desiredReasoning = normalizeReasoningEffortForModel(
    desiredModel,
    patch?.reasoning_effort || thread.reasoningEffort || appConfig.defaultReasoningEffort
  );
  const desiredWorkspace = resolveWorkspace(patch?.workspace || thread.workspace);
  const desiredBaseCodexRunConfig =
    patch?.knowledge_set_ids !== undefined
      ? await resolveKnowledgeSetRunConfig({
          currentUser,
          workspacePath: desiredWorkspace,
          knowledgeSetIds: patch.knowledge_set_ids,
          codexRunConfig: sourceCodexRunConfig
        })
      : sourceCodexRunConfig;
  const desiredCodexRunConfig = ensureThreadUploadInRunConfig(
    desiredBaseCodexRunConfig,
    getThreadUploadTempDir(threadId)
  );

  const desired: SessionOptions = {
    userId: thread.userId ?? currentUser.id,
    model: desiredModel,
    reasoningEffort: desiredReasoning,
    workspace: desiredWorkspace,
    codexRunConfig: desiredCodexRunConfig
  };

  const shouldPersistNormalizedThread =
    thread.model !== desired.model ||
    thread.reasoningEffort !== desired.reasoningEffort ||
    thread.workspace !== desired.workspace ||
    stableJson(thread.codexRunConfig) !== stableJson(desiredBaseCodexRunConfig);

  if (
    patch?.model ||
    patch?.reasoning_effort ||
    patch?.workspace ||
    patch?.knowledge_set_ids ||
    patch?.codex_run_config ||
    shouldPersistNormalizedThread
  ) {
    await threads.update(threadId, {
      model: desired.model,
      reasoningEffort: desired.reasoningEffort,
      workspace: desired.workspace,
      codexRunConfig: desiredBaseCodexRunConfig
    });
  }

  const active = thread.sessionId ? await sessions.get(thread.sessionId) : undefined;
  const changed =
    !active ||
    !liveRuntimeThreads.has(active.sessionId) ||
    active.model !== desired.model ||
    active.reasoningEffort !== desired.reasoningEffort ||
    active.workspace !== desired.workspace ||
    stableJson(active.codexRunConfig) !== stableJson(desired.codexRunConfig);

  if (!changed && active) {
    return active;
  }

  if (active?.sessionId) {
    await sessions.remove(active.sessionId);
    liveRuntimeThreads.delete(active.sessionId);
  }
  return createSession(desired, threadId);
}

function summarizeText(text: string): string {
  const value = text.trim();
  if (!value) return "";
  if (value.length <= 120) return value;
  return `${value.slice(0, 120)}...`;
}

function decodeHeaderMaybeUri(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function sanitizeUploadFilename(value: string): string {
  const raw = decodeHeaderMaybeUri(value);
  const base = path.basename(raw).trim();
  const normalized = base
    .replace(/[/\\]/g, "_")
    .replace(/[\x00-\x1f\x7f]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  const safe = normalized || "upload.bin";
  if (safe.length <= 160) return safe;
  const ext = path.extname(safe);
  const name = ext ? safe.slice(0, -ext.length) : safe;
  return `${name.slice(0, 140)}${ext.slice(0, 20)}`;
}

function normalizeMimeType(value: string): string {
  const decoded = decodeHeaderMaybeUri(value).trim().toLowerCase();
  if (!decoded) return "application/octet-stream";
  if (/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(decoded)) return decoded;
  return "application/octet-stream";
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/");
}

function findWhitelistRoot(candidate: string): string | undefined {
  for (const root of appConfig.workspaceWhitelist) {
    if (candidate === root || candidate.startsWith(`${root}${path.sep}`)) {
      return root;
    }
  }
  return undefined;
}

async function listDirectories(cwd: string): Promise<Array<{ name: string; path: string }>> {
  const entries = await fs.readdir(cwd, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: path.join(cwd, entry.name)
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true, sensitivity: "base" }));
  return directories;
}

const uploadRawParser = express.raw({
  type: () => true,
  limit: "128mb"
});

app.use(cors());
app.post(
  "/api/integrations/zendesk/webhook",
  express.raw({
    type: () => true,
    limit: "1mb"
  }),
  async (req: Request, res: Response) => {
    await handleZendeskWebhookRequest(zendesk, req, res);
  }
);
app.use(express.json({ limit: "1mb" }));

function requireServiceToken(req: Request, res: Response, next: NextFunction) {
  if (!appConfig.token) {
    next();
    return;
  }
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (token !== appConfig.token) {
    res.status(401).json({ detail: "Unauthorized" });
    return;
  }
  next();
}

app.get("/healthz", (_req: Request, res: Response) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

registerCommonApiRoutes(app, {
  currentUserMiddleware: createCurrentUserMiddleware({ users, cookies: sessionCookies }),
  authRouter: createAuthRouter({
    users,
    cookies: sessionCookies,
    dingtalkClient,
    dingtalkConfig: appConfig.dingtalk,
    oauthStates,
    sessionCookieReady: Boolean(appConfig.sessionCookie.secret)
  }),
  adminRouter: createAdminRouter({
    users,
    threads,
    sessions: {
      countActive: async () => liveRuntimeThreads.size
    }
  }),
  resourcesAdminRouter: createResourcesAdminRouter({
    workspaces,
    knowledgeSets,
    resourcePolicies,
    storage: knowledgeSetStorage,
    validateFilesystemPath: resolveWorkspace
  }),
  portalRouter: createPortalRouter({
    workspaceWhitelist: appConfig.workspaceWhitelist,
    defaultWorkspace: appConfig.defaultWorkspace
  }),
    resourcesPortalRouter: createResourcesPortalRouter({
      workspaces,
      knowledgeSets,
      policies: policyService,
      listDepartmentIdsForUser: (userId) => departmentMemberships.listIdsForUser(userId)
    }),
  serviceTokenMiddleware: requireServiceToken,
  zendeskRouter: createZendeskAdminRouter(zendesk)
});

app.get("/api/fs/directories", async (req: Request, res: Response) => {
  try {
    const query = browseDirectoriesSchema.parse({
      path: typeof req.query.path === "string" ? req.query.path : undefined
    });
    const cwd = resolveWorkspace(query.path);
    const root = findWhitelistRoot(cwd);
    if (!root) {
      throw new Error("workspace 不在允许目录白名单中");
    }

    const directories = await listDirectories(cwd);
    let parent: string | null = null;
    if (cwd !== root) {
      const parentCandidate = path.dirname(cwd);
      parent =
        parentCandidate === root || parentCandidate.startsWith(`${root}${path.sep}`)
          ? parentCandidate
          : root;
    }

    res.json({
      roots: appConfig.workspaceWhitelist,
      cwd,
      parent,
      directories
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "读取目录失败";
    res.status(400).json({ detail });
  }
});

app.post("/api/threads/:threadId/attachments", uploadRawParser, async (req: Request, res: Response) => {
  try {
    const currentUser = req.currentUser!;
    const threadId = String(req.params.threadId || "").trim();
    if (!threadId) {
      res.status(400).json({ detail: "threadId 不能为空" });
      return;
    }

    const thread = await threads.getOwned(threadId, currentUser.id);
    if (!thread) {
      res.status(404).json({ detail: "thread 不存在" });
      return;
    }

    const payload = req.body;
    if (!Buffer.isBuffer(payload) || payload.length === 0) {
      res.status(400).json({ detail: "上传内容为空" });
      return;
    }

    const safeName = sanitizeUploadFilename(String(req.headers["x-file-name"] || ""));
    const mimeType = normalizeMimeType(String(req.headers["x-file-type"] || ""));
    const expectedSize = Number(String(req.headers["x-file-size"] || "0"));
    if (Number.isFinite(expectedSize) && expectedSize > 0 && expectedSize !== payload.length) {
      res.status(400).json({ detail: "上传体积与文件声明不一致" });
      return;
    }

    const uploadDir = getThreadUploadTempDir(threadId);
    await fs.mkdir(uploadDir, { recursive: true });

    const id = randomUUID().replace(/-/g, "").slice(0, 12);
    const storedName = `${Date.now()}-${id}-${safeName}`;
    const absolutePath = path.join(uploadDir, storedName);
    await fs.writeFile(absolutePath, payload);

    const relativePath = normalizeRelativePath(path.relative(uploadDir, absolutePath));
    res.json({
      attachment: {
        name: safeName,
        mime_type: mimeType,
        bytes: payload.length,
        path: absolutePath,
        relative_path: relativePath,
        upload_dir: uploadDir
      }
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "上传附件失败";
    res.status(400).json({ detail });
  }
});

app.post("/api/session", async (req: Request, res: Response) => {
  try {
    const currentUser = req.currentUser!;
    const input = createSessionSchema.parse(req.body || {});
    const existingId = (input.session_id || "").trim();
    if (existingId) {
      const existing = await sessions.getOwned(existingId, currentUser.id);
      if (existing) {
        if (!liveRuntimeThreads.has(existing.sessionId)) {
          await sessions.remove(existing.sessionId);
          liveRuntimeThreads.delete(existing.sessionId);
        } else if (input.model || input.reasoning_effort || input.workspace || input.knowledge_set_ids || input.codex_run_config) {
          const workspace = input.workspace ? resolveWorkspace(input.workspace) : existing.workspace;
          const nextSourceCodexRunConfig = input.codex_run_config ?? existing.codexRunConfig;
          const nextCodexRunConfig =
            input.knowledge_set_ids !== undefined
              ? await resolveKnowledgeSetRunConfig({
                  currentUser,
                  workspacePath: workspace,
                  knowledgeSetIds: input.knowledge_set_ids,
                  codexRunConfig: nextSourceCodexRunConfig
                })
              : nextSourceCodexRunConfig;
          const updated = await sessions.update(existingId, {
            model: (input.model || existing.model).trim(),
            reasoningEffort: input.reasoning_effort || existing.reasoningEffort,
            workspace,
            codexRunConfig: nextCodexRunConfig
          });
          res.json(sessionOut(updated));
          return;
        } else {
          res.json(sessionOut(existing));
          return;
        }
      }
    }

    const created = await createSession(await resolveSessionOptions(input, currentUser));
    res.json(sessionOut(created));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "创建 session 失败";
    res.status(400).json({ detail });
  }
});

app.get("/api/threads", async (req: Request, res: Response) => {
  const list = await threads.listForUser(req.currentUser!.id, true);
  res.json({
    threads: list.map((thread) => threadOut(thread))
  });
});

app.post("/api/threads", async (req: Request, res: Response) => {
  try {
    const currentUser = req.currentUser!;
    const input = createThreadSchema.parse(req.body || {});
    const options = await resolveSessionOptions(input, currentUser);
    const createdThread = await threads.create({
      userId: currentUser.id,
      title: input.title?.trim() || undefined,
      externalId: input.external_id?.trim() || undefined,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      workspace: options.workspace,
      codexRunConfig: options.codexRunConfig
    });
    const session = await createSession(options, createdThread.id);
    const updated = (await threads.get(createdThread.id)) ?? createdThread;

    res.json({
      thread: threadOut(updated),
      session: sessionOut(session)
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "创建 thread 失败";
    res.status(400).json({ detail });
  }
});

app.get("/api/threads/:threadId", async (req: Request, res: Response) => {
  const thread = await threads.getOwned(String(req.params.threadId || "").trim(), req.currentUser!.id);
  if (!thread) {
    res.status(404).json({ detail: "thread 不存在" });
    return;
  }
  res.json({ thread: threadOut(thread) });
});

app.patch("/api/threads/:threadId", async (req: Request, res: Response) => {
  try {
    const currentUser = req.currentUser!;
    const threadId = String(req.params.threadId || "").trim();
    const input = patchThreadSchema.parse(req.body || {});
    const existing = await threads.getOwned(threadId, currentUser.id);
    if (!existing) {
      res.status(404).json({ detail: "thread 不存在" });
      return;
    }

    const patch: Parameters<typeof threads.update>[1] = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.status !== undefined) patch.status = input.status;
    const nextModel = input.model !== undefined ? normalizeModel(input.model) : existing.model;
    if (input.model !== undefined) patch.model = nextModel;
    if (input.model !== undefined || input.reasoning_effort !== undefined) {
      patch.reasoningEffort = normalizeReasoningEffortForModel(
        nextModel,
        input.reasoning_effort ?? existing.reasoningEffort
      );
    }
    if (input.workspace !== undefined) patch.workspace = resolveWorkspace(input.workspace);
    if (input.codex_run_config !== undefined) patch.codexRunConfig = input.codex_run_config;
    const updated = await threads.update(threadId, patch);
    res.json({ thread: threadOut(updated) });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "更新 thread 失败";
    res.status(400).json({ detail });
  }
});

app.delete("/api/threads/:threadId", async (req: Request, res: Response) => {
  try {
    const currentUser = req.currentUser!;
    const threadId = String(req.params.threadId || "").trim();
    const thread = await threads.getOwned(threadId, currentUser.id);
    if (!thread) {
      res.status(404).json({ detail: "thread 不存在" });
      return;
    }
    if (thread.sessionId) {
      await sessions.remove(thread.sessionId);
      liveRuntimeThreads.delete(thread.sessionId);
    }
    await threads.delete(threadId);
    await fs.rm(getThreadUploadTempDir(threadId), { recursive: true, force: true });
    res.json({ ok: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "删除 thread 失败";
    res.status(400).json({ detail });
  }
});

app.post("/api/threads/:threadId/session", async (req: Request, res: Response) => {
  try {
    const currentUser = req.currentUser!;
    const threadId = String(req.params.threadId || "").trim();
    const input = ensureThreadSessionSchema.parse(req.body || {});
    const session = await ensureThreadSession(currentUser, threadId, input);
    res.json({ session: sessionOut(session) });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "确保 thread session 失败";
    res.status(400).json({ detail });
  }
});

app.get("/api/threads/:threadId/messages", async (req: Request, res: Response) => {
  try {
    const currentUser = req.currentUser!;
    const threadId = String(req.params.threadId || "").trim();
    const thread = await threads.getOwned(threadId, currentUser.id);
    if (!thread) {
      res.status(404).json({ detail: "thread 不存在" });
      return;
    }
    const repository = await threads.getRepository(threadId);
    res.json({
      head_id: repository.headId ?? null,
      messages: repository.messages.map((item) => ({
        parent_id: item.parentId,
        message: item.message,
        run_config: item.runConfig
      }))
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "读取消息历史失败";
    res.status(400).json({ detail });
  }
});

app.post("/api/threads/:threadId/messages", async (req: Request, res: Response) => {
  try {
    const currentUser = req.currentUser!;
    const threadId = String(req.params.threadId || "").trim();
    const thread = await threads.getOwned(threadId, currentUser.id);
    if (!thread) {
      res.status(404).json({ detail: "thread 不存在" });
      return;
    }
    const input = appendMessageSchema.parse(req.body || {});
    const updated = await threads.appendMessage(threadId, {
      parentId: input.parent_id ?? null,
      message: input.message,
      runConfig: input.run_config
    });
    res.json({ ok: true, head_id: updated.headId ?? null });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "追加消息失败";
    res.status(400).json({ detail });
  }
});

app.put("/api/threads/:threadId/messages", async (req: Request, res: Response) => {
  try {
    const currentUser = req.currentUser!;
    const threadId = String(req.params.threadId || "").trim();
    const thread = await threads.getOwned(threadId, currentUser.id);
    if (!thread) {
      res.status(404).json({ detail: "thread 不存在" });
      return;
    }
    const input = replaceMessagesSchema.parse(req.body || {});
    await threads.replaceMessages(threadId, {
      headId: input.head_id ?? null,
      messages: input.messages.map((item) => ({
        parentId: item.parent_id ?? null,
        message: item.message,
        runConfig: item.run_config
      }))
    });
    res.json({ ok: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "覆盖消息历史失败";
    res.status(400).json({ detail });
  }
});

app.post("/api/threads/:threadId/feedback", async (req: Request, res: Response) => {
  try {
    const currentUser = req.currentUser!;
    const threadId = String(req.params.threadId || "").trim();
    const thread = await threads.getOwned(threadId, currentUser.id);
    if (!thread) {
      res.status(404).json({ detail: "thread 不存在" });
      return;
    }
    const input = feedbackSchema.parse(req.body || {});
    const feedback = await threads.addFeedback(threadId, {
      type: input.type,
      messageId: input.message_id,
      contentPreview: summarizeText(input.content_preview || "")
    });
    res.json({ feedback });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "提交反馈失败";
    res.status(400).json({ detail });
  }
});

app.post("/api/chat/stream", async (req: Request, res: Response) => {
  initSSE(res);
  const heartbeat = setInterval(() => sendSSE(res, "ping", { now: new Date().toISOString() }), 15000);

  try {
    const currentUser = req.currentUser!;
    const input = streamSchema.parse(req.body || {});
    const session = await sessions.getOwned(input.session_id, currentUser.id);
    const liveThread = session ? liveRuntimeThreads.get(session.sessionId) : undefined;
    if (!session || !liveThread) {
      if (session?.sessionId) {
        await sessions.remove(session.sessionId);
        liveRuntimeThreads.delete(session.sessionId);
      }
      sendSSE(res, "error", { detail: "session 不存在或已过期" });
      res.end();
      return;
    }
    const requestedThreadId = String(input.thread_id || "").trim();
    if (requestedThreadId) {
      const boundThreadId = String(session.threadId || "").trim();
      if (!boundThreadId) {
        sendSSE(res, "error", { detail: "session 未绑定 thread，请刷新后重试" });
        res.end();
        return;
      }
      if (boundThreadId !== requestedThreadId) {
        sendSSE(res, "error", { detail: "session 与 thread 不匹配，请重试" });
        res.end();
        return;
      }
    }

    sendSSE(res, "meta", {
      session_id: session.sessionId,
      thread_id: session.threadId,
      model: session.model,
      reasoning_effort: session.reasoningEffort,
      workspace: session.workspace,
      started_at: new Date().toISOString()
    });

    let answer = "";
    for await (const event of runtime.runStreamed(liveThread, input.message)) {
      if (event.delta) answer += event.delta;
      else if (event.text) answer += event.text;
      sendSSE(res, "codex", event);
    }

    sendSSE(res, "done", {
      session_id: session.sessionId,
      answer,
      completed_at: new Date().toISOString()
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "聊天流失败";
    sendSSE(res, "error", { detail });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

async function cleanupExpiredSessions() {
  const expiredSessionIds = await sessions.cleanupExpired();
  for (const sessionId of expiredSessionIds) {
    liveRuntimeThreads.delete(sessionId);
  }
}

setInterval(() => {
  void cleanupExpiredSessions();
}, 60_000).unref();

async function bootstrap() {
  await db.$connect();
  const legacyThreadOwnerId = await users.findLegacyImportOwnerId(appConfig.legacyThreadOwnerId);
  const imported = await importLegacyThreadsFromJson({
    filePath: appConfig.threadStoreFile,
    repository: threads,
    defaultUserId: legacyThreadOwnerId
  });
  if (imported.importedCount) {
    // eslint-disable-next-line no-console
    console.log(
      `imported ${imported.importedCount} legacy thread(s) from ${appConfig.threadStoreFile}${imported.archivedPath ? ` -> ${imported.archivedPath}` : ""}`
    );
  }
  app.listen(appConfig.port, appConfig.host, () => {
    // eslint-disable-next-line no-console
    console.log(`agent-studio-api listening on http://${appConfig.host}:${appConfig.port}`);
  });
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("failed to bootstrap api", error);
  process.exit(1);
});
