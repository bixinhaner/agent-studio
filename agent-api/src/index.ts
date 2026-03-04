import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { appConfig, resolveWorkspace } from "./config.js";
import { CodexRuntime } from "./codex-runtime.js";
import { SessionStore } from "./session-store.js";
import { initSSE, sendSSE } from "./sse.js";
import { ThreadStore, type ReasoningEffort, type ThreadRecord } from "./thread-store.js";

const app = express();
const runtime = new CodexRuntime();
const sessions = new SessionStore(appConfig.sessionTtlMs);
const threads = new ThreadStore(appConfig.threadStoreFile);

const createSessionSchema = z.object({
  session_id: z.string().optional(),
  model: z.string().optional(),
  reasoning_effort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
  workspace: z.string().optional(),
  codex_run_config: z.record(z.unknown()).optional()
});

const streamSchema = z.object({
  session_id: z.string().min(1),
  message: z.string().min(1)
});

const createThreadSchema = z.object({
  title: z.string().optional(),
  external_id: z.string().optional(),
  model: z.string().optional(),
  reasoning_effort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
  workspace: z.string().optional(),
  codex_run_config: z.record(z.unknown()).optional()
});

const patchThreadSchema = z.object({
  title: z.string().optional(),
  status: z.enum(["regular", "archived"]).optional(),
  model: z.string().optional(),
  reasoning_effort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
  workspace: z.string().optional(),
  codex_run_config: z.record(z.unknown()).optional()
});

const ensureThreadSessionSchema = z.object({
  model: z.string().optional(),
  reasoning_effort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
  workspace: z.string().optional(),
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

const suggestionsSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.string().optional(),
        text: z.string().optional()
      })
    )
    .optional()
});

const browseDirectoriesSchema = z.object({
  path: z.string().optional()
});

type SessionOptions = {
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
}): SessionOptions {
  const workspace = resolveWorkspace(input.workspace);
  return {
    model: (input.model || appConfig.defaultModel).trim() || appConfig.defaultModel,
    reasoningEffort: input.reasoning_effort || appConfig.defaultReasoningEffort,
    workspace,
    codexRunConfig: input.codex_run_config
  };
}

async function createSession(options: SessionOptions, threadId?: string) {
  const thread = await runtime.startThreadWithOptions({
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    workspace: options.workspace,
    codexRunConfig: options.codexRunConfig
  });
  return sessions.create({
    threadId,
    thread,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    workspace: options.workspace,
    codexRunConfig: options.codexRunConfig
  });
}

async function ensureThreadSession(
  threadId: string,
  patch?: {
    model?: string;
    reasoning_effort?: ReasoningEffort;
    workspace?: string;
    codex_run_config?: Record<string, unknown>;
  }
) {
  const thread = await threads.get(threadId);
  if (!thread) throw new Error("thread 不存在");

  const desired: SessionOptions = {
    model: (patch?.model || thread.model || appConfig.defaultModel).trim() || appConfig.defaultModel,
    reasoningEffort: patch?.reasoning_effort || thread.reasoningEffort || appConfig.defaultReasoningEffort,
    workspace: resolveWorkspace(patch?.workspace || thread.workspace),
    codexRunConfig: patch?.codex_run_config ?? thread.codexRunConfig
  };

  if (patch?.model || patch?.reasoning_effort || patch?.workspace || patch?.codex_run_config) {
    await threads.update(threadId, {
      model: desired.model,
      reasoningEffort: desired.reasoningEffort,
      workspace: desired.workspace,
      codexRunConfig: desired.codexRunConfig
    });
  }

  const active = thread.sessionId ? sessions.get(thread.sessionId) : undefined;
  const changed =
    !active ||
    active.model !== desired.model ||
    active.reasoningEffort !== desired.reasoningEffort ||
    active.workspace !== desired.workspace ||
    stableJson(active.codexRunConfig) !== stableJson(desired.codexRunConfig);

  if (!changed && active) {
    return active;
  }

  if (active?.sessionId) {
    sessions.remove(active.sessionId);
  }
  const created = await createSession(desired, threadId);
  await threads.update(threadId, { sessionId: created.sessionId });
  return created;
}

function summarizeText(text: string): string {
  const value = text.trim();
  if (!value) return "";
  if (value.length <= 120) return value;
  return `${value.slice(0, 120)}...`;
}

function buildSuggestions(messages: Array<{ role?: string; text?: string }>): Array<{ prompt: string }> {
  const latestUser = [...messages]
    .reverse()
    .find((m) => String(m.role || "").trim().toLowerCase() === "user" && String(m.text || "").trim());
  const prompt = String(latestUser?.text || "").trim();
  const picks = new Set<string>();
  if (prompt) {
    if (/配置|部署|安装|连接|对接|如何|怎么/i.test(prompt)) {
      picks.add("请给我一个可直接执行的分步骤操作清单。");
      picks.add("请补充关键配置项示例（含默认值和推荐值）。");
      picks.add("请列出常见报错和对应排查命令。");
    } else if (/报错|失败|错误|异常|问题|故障/i.test(prompt)) {
      picks.add("请按“现象-原因-排查-修复”结构回答。");
      picks.add("请给出最小复现步骤和验证方法。");
      picks.add("请先给一个 5 分钟快速止血方案。");
    } else {
      picks.add("请给出一个简洁结论和 3 条可执行建议。");
      picks.add("请继续展开关键步骤并补充示例。");
      picks.add("请列出风险点和注意事项。");
    }
  }
  if (picks.size === 0) {
    picks.add("请给出下一步建议。");
    picks.add("请提供可执行步骤。");
  }
  return Array.from(picks)
    .slice(0, 4)
    .map((it) => ({ prompt: it }));
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

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use((req: Request, res: Response, next: NextFunction) => {
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
});

app.get("/healthz", (_req: Request, res: Response) => {
  res.json({ ok: true, now: new Date().toISOString() });
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

app.post("/api/session", async (req: Request, res: Response) => {
  try {
    const input = createSessionSchema.parse(req.body || {});
    const existingId = (input.session_id || "").trim();
    if (existingId) {
      const existing = sessions.get(existingId);
      if (existing) {
        if (input.model || input.reasoning_effort || input.workspace || input.codex_run_config) {
          const workspace = input.workspace ? resolveWorkspace(input.workspace) : existing.workspace;
          const updated = sessions.update(existingId, {
            model: (input.model || existing.model).trim(),
            reasoningEffort: input.reasoning_effort || existing.reasoningEffort,
            workspace,
            codexRunConfig: input.codex_run_config ?? existing.codexRunConfig
          });
          res.json(sessionOut(updated));
          return;
        }
        res.json(sessionOut(existing));
        return;
      }
    }

    const created = await createSession(pickSessionOptions(input));
    res.json(sessionOut(created));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "创建 session 失败";
    res.status(400).json({ detail });
  }
});

app.get("/api/threads", async (_req: Request, res: Response) => {
  const list = await threads.list(true);
  res.json({
    threads: list.map((thread) => threadOut(thread))
  });
});

app.post("/api/threads", async (req: Request, res: Response) => {
  try {
    const input = createThreadSchema.parse(req.body || {});
    const options = pickSessionOptions(input);
    const createdThread = await threads.create({
      title: input.title?.trim() || undefined,
      externalId: input.external_id?.trim() || undefined,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      workspace: options.workspace,
      codexRunConfig: options.codexRunConfig
    });
    const session = await createSession(options, createdThread.id);
    const updated = await threads.update(createdThread.id, { sessionId: session.sessionId });

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
  const thread = await threads.get(String(req.params.threadId || "").trim());
  if (!thread) {
    res.status(404).json({ detail: "thread 不存在" });
    return;
  }
  res.json({ thread: threadOut(thread) });
});

app.patch("/api/threads/:threadId", async (req: Request, res: Response) => {
  try {
    const threadId = String(req.params.threadId || "").trim();
    const input = patchThreadSchema.parse(req.body || {});
    const patch: Parameters<typeof threads.update>[1] = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.status !== undefined) patch.status = input.status;
    if (input.model !== undefined) patch.model = input.model.trim();
    if (input.reasoning_effort !== undefined) patch.reasoningEffort = input.reasoning_effort;
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
    const threadId = String(req.params.threadId || "").trim();
    const thread = await threads.get(threadId);
    if (!thread) {
      res.status(404).json({ detail: "thread 不存在" });
      return;
    }
    if (thread.sessionId) {
      sessions.remove(thread.sessionId);
    }
    await threads.delete(threadId);
    res.json({ ok: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "删除 thread 失败";
    res.status(400).json({ detail });
  }
});

app.post("/api/threads/:threadId/session", async (req: Request, res: Response) => {
  try {
    const threadId = String(req.params.threadId || "").trim();
    const input = ensureThreadSessionSchema.parse(req.body || {});
    const session = await ensureThreadSession(threadId, input);
    res.json({ session: sessionOut(session) });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "确保 thread session 失败";
    res.status(400).json({ detail });
  }
});

app.get("/api/threads/:threadId/messages", async (req: Request, res: Response) => {
  try {
    const threadId = String(req.params.threadId || "").trim();
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
    const threadId = String(req.params.threadId || "").trim();
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
    const threadId = String(req.params.threadId || "").trim();
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

app.post("/api/threads/:threadId/suggestions", async (req: Request, res: Response) => {
  try {
    const threadId = String(req.params.threadId || "").trim();
    const thread = await threads.get(threadId);
    if (!thread) {
      res.status(404).json({ detail: "thread 不存在" });
      return;
    }
    const input = suggestionsSchema.parse(req.body || {});
    const suggestions = buildSuggestions(input.messages || []);
    res.json({ suggestions });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "生成建议失败";
    res.status(400).json({ detail });
  }
});

app.post("/api/threads/:threadId/feedback", async (req: Request, res: Response) => {
  try {
    const threadId = String(req.params.threadId || "").trim();
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
    const input = streamSchema.parse(req.body || {});
    const session = sessions.get(input.session_id);
    if (!session) {
      sendSSE(res, "error", { detail: "session 不存在或已过期" });
      res.end();
      return;
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
    for await (const event of runtime.runStreamed(session.thread, input.message)) {
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

setInterval(() => sessions.cleanupExpired(), 60_000).unref();

async function bootstrap() {
  await threads.load();
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
