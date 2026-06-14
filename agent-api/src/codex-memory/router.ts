import fs from "node:fs/promises";
import { existsSync, type Dirent } from "node:fs";
import path from "node:path";
import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";

import {
  AGENT_STUDIO_MEMORY_CONTENT_ROOTS,
  AGENT_STUDIO_MEMORY_ROOT_FILE_NAMES,
  agentStudioMemoryCandidatesPath,
  agentStudioMemorySourcePath,
  codexMemoryProjectionPath,
  ensureAgentStudioMemorySource,
  syncAgentStudioMemoryProjection
} from "./engine.js";

type CodexMemoryAdminRouterOptions = {
  sessionHomeRoot: string;
  requirePermission(permissionKey: string): RequestHandler;
  llmSecretStore?: {
    getState(): Promise<{ hasApiKey: boolean; rotatedAt?: string; updatedAt?: string }>;
    update(input: { apiKey?: string; clearApiKey?: boolean; currentUserId?: string }): Promise<{ hasApiKey: boolean; rotatedAt?: string; updatedAt?: string }>;
  };
  users?: {
    getById(id: string): Promise<{ displayName?: string; email?: string } | undefined>;
  };
  agentModes?: {
    get(id: string): Promise<{ name: string; slug: string } | undefined>;
  };
  listIntegrationInstancesByIds?: (ids: string[]) => Promise<Array<{
    id: string;
    type: string;
    slug: string;
    name: string;
    status: string;
  }>>;
};

type CodexMemoryScopeKind = "user_agent" | "integration_agent" | "legacy_thread" | "unknown";

type CodexMemoryScope = {
  id: string;
  kind: CodexMemoryScopeKind;
  label: string;
  relativeHome: string;
  codexHome: string;
  memoriesPath: string;
  fileCount: number;
  totalBytes: number;
  latestModifiedAt: string | null;
  provider?: string;
  integrationInstanceId?: string;
  organizationKey?: string;
  userId?: string;
  agentSegment?: string;
  displayLabel?: string;
  displaySubtitle?: string;
  ownerName?: string;
  ownerEmail?: string;
  agentModeId?: string;
  agentName?: string;
  agentSlug?: string;
  integrationName?: string;
  integrationType?: string;
  integrationSlug?: string;
};

type CodexMemoryRunLogItem = {
  id: string;
  status: "written" | "skipped_no_durable_memory" | "skipped_missing_input" | "failed";
  reason: string;
  channel: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  promptChars: number;
  answerChars: number;
  relativeHome?: string;
  codexThreadId?: string;
  sessionId?: string;
  threadId?: string;
  organizationId?: string;
  userId?: string;
  model?: string;
  hasExternalContext?: boolean;
  llmProvider?: string;
  llmApiMode?: string;
  llmModel?: string;
  category?: string;
  confidence?: number;
  memoryChars?: number;
  error?: string;
  scope?: Pick<
    CodexMemoryScope,
    | "id"
    | "kind"
    | "displayLabel"
    | "displaySubtitle"
    | "ownerName"
    | "ownerEmail"
    | "agentName"
    | "agentSlug"
    | "integrationName"
    | "integrationType"
    | "integrationSlug"
  >;
};

const MAX_SCAN_DEPTH = 8;
const MAX_SCOPE_COUNT = 2000;
const MAX_FILE_CONTENT_BYTES = 1024 * 1024;
const MAX_RUN_LOG_ITEMS = 1000;
const MEMORY_RUN_LOG_PATH = path.join(".agent-studio", "memory-runs.jsonl");
const MEMORY_RUN_STATUSES = new Set(["written", "skipped_no_durable_memory", "skipped_missing_input", "failed"]);

const writeMemoryFileSchema = z
  .object({
    path: z.string().trim().min(1).max(500),
    content: z.string().max(MAX_FILE_CONTENT_BYTES)
  })
  .strict();

const updateLlmSecretSchema = z
  .object({
    apiKey: z.string().trim().max(2000).optional(),
    clearApiKey: z.boolean().optional()
  })
  .strict();

function detailFromError(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败";
}

function toUnixRelative(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function encodeScopeId(relativeHome: string): string {
  return Buffer.from(relativeHome, "utf8").toString("base64url");
}

function decodeScopeId(scopeId: string): string {
  return Buffer.from(scopeId, "base64url").toString("utf8");
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeRelativePath(value: string, label: string): string {
  const normalized = path.normalize(value.replaceAll("\\", "/"));
  if (!normalized || normalized === "." || path.isAbsolute(normalized) || normalized.startsWith("..")) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

function splitUnixPath(value: string): string[] {
  return value.split("/").filter(Boolean);
}

function isHiddenPathSegment(value: string): boolean {
  return value.startsWith(".");
}

function isMemoryManagedFile(relativeFilePath: string): boolean {
  const parts = splitUnixPath(toUnixRelative(relativeFilePath));
  if (!parts.length || parts.some(isHiddenPathSegment)) return false;
  if (parts.length === 1) return AGENT_STUDIO_MEMORY_ROOT_FILE_NAMES.has(parts[0]);
  if (parts[0] === "rollout_summaries" || parts[0] === "skills") return true;
  return parts[0] === "extensions" && parts[1] === "ad_hoc";
}

function shouldWalkMemoryDirectory(relativeDirectoryPath: string): boolean {
  const parts = splitUnixPath(toUnixRelative(relativeDirectoryPath));
  if (!parts.length) return true;
  if (parts.some(isHiddenPathSegment)) return false;
  if (!AGENT_STUDIO_MEMORY_CONTENT_ROOTS.has(parts[0])) return false;
  if (parts[0] !== "extensions") return true;
  return parts.length === 1 || parts[1] === "ad_hoc";
}

function memoryFileSortRank(relativeFilePath: string): number {
  const normalized = toUnixRelative(relativeFilePath);
  if (normalized === "MEMORY.md") return 0;
  if (normalized === "raw_memories.md") return 1;
  if (normalized === "memory_summary.md") return 2;
  if (normalized.startsWith("rollout_summaries/")) return 3;
  if (normalized.startsWith("skills/")) return 4;
  if (normalized.startsWith("extensions/ad_hoc/")) return 5;
  return 9;
}

function trimOrUndefined(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? trimOrUndefined(value) : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resolveScopeHome(sessionHomeRoot: string, scopeId: string): { relativeHome: string; codexHome: string } {
  const relativeHome = safeRelativePath(decodeScopeId(scopeId), "scope");
  const codexHome = path.resolve(sessionHomeRoot, relativeHome);
  if (!isPathInside(sessionHomeRoot, codexHome)) {
    throw new Error("scope is outside the Codex home root");
  }
  return { relativeHome: toUnixRelative(path.relative(sessionHomeRoot, codexHome)), codexHome };
}

function adminMemoryPathForCodexHome(codexHome: string): string {
  const sourcePath = agentStudioMemorySourcePath(codexHome);
  return existsSync(sourcePath) ? sourcePath : codexMemoryProjectionPath(codexHome);
}

function resolveMemoryFile(input: {
  sessionHomeRoot: string;
  scopeId: string;
  memoryFilePath: string;
}): { relativeHome: string; codexHome: string; memoriesPath: string; relativeFilePath: string; absoluteFilePath: string } {
  const scope = resolveScopeHome(input.sessionHomeRoot, input.scopeId);
  const memoriesPath = path.resolve(adminMemoryPathForCodexHome(scope.codexHome));
  const relativeFilePath = safeRelativePath(input.memoryFilePath, "memory file path");
  if (!isMemoryManagedFile(relativeFilePath)) {
    throw new Error("memory file path is not a managed memory file");
  }
  const absoluteFilePath = path.resolve(memoriesPath, relativeFilePath);
  if (!isPathInside(memoriesPath, absoluteFilePath)) {
    throw new Error("memory file path is outside the memories directory");
  }
  return { ...scope, memoriesPath, relativeFilePath: toUnixRelative(relativeFilePath), absoluteFilePath };
}

function classifyScope(relativeHome: string): Omit<CodexMemoryScope, "id" | "relativeHome" | "codexHome" | "memoriesPath" | "fileCount" | "totalBytes" | "latestModifiedAt"> {
  const parts = relativeHome.split("/").filter(Boolean);
  if (parts[0] === "integrations" && parts.length >= 4) {
    const agentModeId = agentModeIdFromSegment(parts[3]);
    return {
      kind: "integration_agent",
      label: `${parts[1]} / ${parts[2]} / ${parts[3]}`,
      provider: parts[1],
      integrationInstanceId: parts[2],
      agentSegment: parts[3],
      agentModeId
    };
  }
  if (parts[0]?.startsWith("thread-") || parts[0]?.startsWith("session-")) {
    return {
      kind: "legacy_thread",
      label: parts[0] ?? relativeHome
    };
  }
  if (parts.length >= 3) {
    const agentModeId = agentModeIdFromSegment(parts[2]);
    return {
      kind: "user_agent",
      label: `${parts[0]} / ${parts[1]} / ${parts[2]}`,
      organizationKey: parts[0],
      userId: parts[1],
      agentSegment: parts[2],
      agentModeId
    };
  }
  return {
    kind: "unknown",
    label: relativeHome
  };
}

function agentModeIdFromSegment(segment: string | undefined): string | undefined {
  const normalized = trimOrUndefined(segment);
  if (!normalized) return undefined;
  const withoutPrefix = normalized.startsWith("agent-") ? normalized.slice("agent-".length) : normalized;
  return trimOrUndefined(withoutPrefix.replace(/-[a-f0-9]{12}$/i, ""));
}

function providerDisplayName(provider: string | undefined): string | undefined {
  const normalized = trimOrUndefined(provider);
  if (!normalized) return undefined;
  const labels: Record<string, string> = {
    zendesk: "Zendesk",
    dingtalk: "钉钉",
    crest: "CREST",
    openai: "OpenAI API"
  };
  return labels[normalized.toLowerCase()] ?? normalized;
}

async function enrichMemoryScopes(
  scopes: CodexMemoryScope[],
  options: CodexMemoryAdminRouterOptions
): Promise<CodexMemoryScope[]> {
  const userIds = [...new Set(scopes.map((scope) => scope.userId).filter((value): value is string => Boolean(value)))];
  const agentModeIds = [...new Set(scopes.map((scope) => scope.agentModeId).filter((value): value is string => Boolean(value)))];
  const integrationIds = [
    ...new Set(scopes.map((scope) => scope.integrationInstanceId).filter((value): value is string => Boolean(value)))
  ];
  const usersById = new Map<string, { displayName?: string; email?: string }>();
  const modesById = new Map<string, { name: string; slug: string }>();
  const integrationsById = new Map<string, { id: string; type: string; slug: string; name: string; status: string }>();

  await Promise.all([
    Promise.all(
      userIds.map(async (userId) => {
        const user = await options.users?.getById(userId);
        if (user) usersById.set(userId, user);
      })
    ),
    Promise.all(
      agentModeIds.map(async (agentModeId) => {
        const mode = await options.agentModes?.get(agentModeId);
        if (mode) modesById.set(agentModeId, mode);
      })
    ),
    (async () => {
      const integrations = await options.listIntegrationInstancesByIds?.(integrationIds);
      for (const integration of integrations ?? []) {
        integrationsById.set(integration.id, integration);
      }
    })()
  ]);

  return scopes.map((scope) => {
    const user = scope.userId ? usersById.get(scope.userId) : undefined;
    const mode = scope.agentModeId ? modesById.get(scope.agentModeId) : undefined;
    const integration = scope.integrationInstanceId ? integrationsById.get(scope.integrationInstanceId) : undefined;
    const ownerName = trimOrUndefined(user?.displayName) ?? trimOrUndefined(user?.email);
    const agentName = trimOrUndefined(mode?.name) ?? trimOrUndefined(mode?.slug);
    const integrationName =
      trimOrUndefined(integration?.name) ??
      trimOrUndefined(integration?.slug) ??
      providerDisplayName(scope.provider);

    if (scope.kind === "user_agent") {
      return {
        ...scope,
        ownerName,
        ownerEmail: trimOrUndefined(user?.email),
        agentName,
        agentSlug: trimOrUndefined(mode?.slug),
        displayLabel: [ownerName ?? "未知用户", agentName ?? "默认智能体"].join(" · "),
        displaySubtitle: scope.organizationKey ? `组织：${scope.organizationKey}` : "用户智能体记忆空间"
      };
    }
    if (scope.kind === "integration_agent") {
      return {
        ...scope,
        agentName,
        agentSlug: trimOrUndefined(mode?.slug),
        integrationName,
        integrationType: trimOrUndefined(integration?.type) ?? scope.provider,
        integrationSlug: trimOrUndefined(integration?.slug),
        displayLabel: [integrationName ?? providerDisplayName(scope.provider) ?? "集成", agentName ?? "默认智能体"].join(" · "),
        displaySubtitle: `${providerDisplayName(scope.provider) ?? "集成"} 共享记忆空间`
      };
    }
    if (scope.kind === "legacy_thread") {
      return {
        ...scope,
        displayLabel: "旧会话记忆",
        displaySubtitle: "历史兼容空间，建议只在排查时查看"
      };
    }
    return {
      ...scope,
      displayLabel: "未识别记忆空间",
      displaySubtitle: "目录结构无法归类，建议排查来源"
    };
  });
}

function normalizeRunLogEntry(value: unknown): CodexMemoryRunLogItem | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const status = asString(record.status);
  const completedAt = asString(record.completedAt);
  if (!status || !MEMORY_RUN_STATUSES.has(status) || !completedAt) return undefined;
  return {
    id: asString(record.id) ?? `${completedAt}-${Math.random().toString(36).slice(2)}`,
    status: status as CodexMemoryRunLogItem["status"],
    reason: asString(record.reason) ?? "unknown",
    channel: asString(record.channel) ?? "unknown",
    startedAt: asString(record.startedAt) ?? completedAt,
    completedAt,
    durationMs: asNumber(record.durationMs) ?? 0,
    promptChars: asNumber(record.promptChars) ?? 0,
    answerChars: asNumber(record.answerChars) ?? 0,
    relativeHome: asString(record.relativeHome),
    codexThreadId: asString(record.codexThreadId),
    sessionId: asString(record.sessionId),
    threadId: asString(record.threadId),
    organizationId: asString(record.organizationId),
    userId: asString(record.userId),
    model: asString(record.model),
    hasExternalContext: asBoolean(record.hasExternalContext),
    llmProvider: asString(record.llmProvider),
    llmApiMode: asString(record.llmApiMode),
    llmModel: asString(record.llmModel),
    category: asString(record.category),
    confidence: asNumber(record.confidence),
    memoryChars: asNumber(record.memoryChars),
    error: asString(record.error)
  };
}

async function listMemoryRunLogs(sessionHomeRoot: string): Promise<CodexMemoryRunLogItem[]> {
  const logPath = path.join(sessionHomeRoot, MEMORY_RUN_LOG_PATH);
  let content = "";
  try {
    content = await fs.readFile(logPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return content
    .split(/\n/)
    .filter(Boolean)
    .slice(-MAX_RUN_LOG_ITEMS)
    .map((line) => {
      try {
        return normalizeRunLogEntry(JSON.parse(line));
      } catch {
        return undefined;
      }
    })
    .filter((entry): entry is CodexMemoryRunLogItem => Boolean(entry))
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt));
}

async function enrichMemoryRunLogs(
  runs: CodexMemoryRunLogItem[],
  options: CodexMemoryAdminRouterOptions,
  sessionHomeRoot: string
): Promise<CodexMemoryRunLogItem[]> {
  const scopes: CodexMemoryScope[] = [];
  for (const run of runs) {
    const relativeHome = trimOrUndefined(run.relativeHome);
    if (!relativeHome) continue;
    const codexHome = path.resolve(sessionHomeRoot, relativeHome);
    scopes.push({
      id: encodeScopeId(relativeHome),
      relativeHome,
      codexHome,
      memoriesPath: path.join(codexHome, "memories"),
      fileCount: 0,
      totalBytes: 0,
      latestModifiedAt: null,
      ...classifyScope(relativeHome)
    });
  }
  const enrichedByRelativeHome = new Map(
    (await enrichMemoryScopes(scopes, options)).map((scope) => [scope.relativeHome, scope] as const)
  );
  return runs.map((run) => {
    const scope = run.relativeHome ? enrichedByRelativeHome.get(run.relativeHome) : undefined;
    if (!scope) return run;
    return {
      ...run,
      scope: {
        id: scope.id,
        kind: scope.kind,
        displayLabel: scope.displayLabel,
        displaySubtitle: scope.displaySubtitle,
        ownerName: scope.ownerName,
        ownerEmail: scope.ownerEmail,
        agentName: scope.agentName,
        agentSlug: scope.agentSlug,
        integrationName: scope.integrationName,
        integrationType: scope.integrationType,
        integrationSlug: scope.integrationSlug
      }
    };
  });
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function summarizeMemoryDirectory(memoriesPath: string): Promise<{
  fileCount: number;
  totalBytes: number;
  latestModifiedAt: string | null;
}> {
  let fileCount = 0;
  let totalBytes = 0;
  let latestModified = 0;

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > MAX_SCAN_DEPTH) return;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        const relativeDirectoryPath = toUnixRelative(path.relative(memoriesPath, absolutePath));
        if (!shouldWalkMemoryDirectory(relativeDirectoryPath)) continue;
        await walk(absolutePath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = toUnixRelative(path.relative(memoriesPath, absolutePath));
      if (!isMemoryManagedFile(relativePath)) continue;
      try {
        const stat = await fs.stat(absolutePath);
        fileCount += 1;
        totalBytes += stat.size;
        latestModified = Math.max(latestModified, stat.mtimeMs);
      } catch {
        // A file can disappear while the directory is being scanned.
      }
    }
  }

  await walk(memoriesPath, 0);
  return {
    fileCount,
    totalBytes,
    latestModifiedAt: latestModified > 0 ? new Date(latestModified).toISOString() : null
  };
}

async function listMemoryFiles(memoriesPath: string): Promise<Array<{
  path: string;
  name: string;
  bytes: number;
  modifiedAt: string;
}>> {
  const files: Array<{ path: string; name: string; bytes: number; modifiedAt: string }> = [];

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > MAX_SCAN_DEPTH) return;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        const relativeDirectoryPath = toUnixRelative(path.relative(memoriesPath, absolutePath));
        if (!shouldWalkMemoryDirectory(relativeDirectoryPath)) continue;
        await walk(absolutePath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fs.stat(absolutePath);
      const relativePath = toUnixRelative(path.relative(memoriesPath, absolutePath));
      if (!isMemoryManagedFile(relativePath)) continue;
      files.push({
        path: relativePath,
        name: entry.name,
        bytes: stat.size,
        modifiedAt: stat.mtime.toISOString()
      });
    }
  }

  await walk(memoriesPath, 0);
  files.sort(
    (left, right) =>
      memoryFileSortRank(left.path) - memoryFileSortRank(right.path) ||
      left.path.localeCompare(right.path) ||
      right.modifiedAt.localeCompare(left.modifiedAt)
  );
  return files;
}

async function clearManagedMemoryFiles(memoriesPath: string): Promise<void> {
  const files = await listMemoryFiles(memoriesPath);
  await Promise.all(files.map((file) => fs.rm(path.resolve(memoriesPath, file.path), { force: true })));
}

async function listMemoryScopes(sessionHomeRoot: string): Promise<CodexMemoryScope[]> {
  await fs.mkdir(sessionHomeRoot, { recursive: true });
  const scopes: CodexMemoryScope[] = [];

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > MAX_SCAN_DEPTH || scopes.length >= MAX_SCOPE_COUNT) return;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (!entry.isDirectory()) continue;
      if (entry.name === "memories") {
        const codexHome = path.dirname(absolutePath);
        const relativeHome = toUnixRelative(path.relative(sessionHomeRoot, codexHome));
        const memoriesPath = adminMemoryPathForCodexHome(codexHome);
        const summary = await summarizeMemoryDirectory(memoriesPath);
        scopes.push({
          id: encodeScopeId(relativeHome),
          relativeHome,
          codexHome,
          memoriesPath,
          ...classifyScope(relativeHome),
          ...summary
        });
        continue;
      }
      await walk(absolutePath, depth + 1);
    }
  }

  await walk(sessionHomeRoot, 0);
  scopes.sort(
    (left, right) =>
      (right.latestModifiedAt ?? "").localeCompare(left.latestModifiedAt ?? "") ||
      right.totalBytes - left.totalBytes ||
      left.relativeHome.localeCompare(right.relativeHome)
  );
  return scopes;
}

async function sendMemoryFileContent(req: Request, res: Response, sessionHomeRoot: string): Promise<void> {
  const memoryFilePath = String(req.query.path ?? "").trim();
  if (!memoryFilePath) {
    res.status(400).json({ detail: "path is required" });
    return;
  }
  const resolved = resolveMemoryFile({
    sessionHomeRoot,
    scopeId: req.params.scopeId,
    memoryFilePath
  });
  if (!(await pathExists(resolved.absoluteFilePath))) {
    res.status(404).json({ detail: "memory file does not exist" });
    return;
  }
  const stat = await fs.stat(resolved.absoluteFilePath);
  if (!stat.isFile()) {
    res.status(400).json({ detail: "memory path is not a file" });
    return;
  }
  if (stat.size > MAX_FILE_CONTENT_BYTES) {
    res.json({
      file: {
        path: resolved.relativeFilePath,
        name: path.basename(resolved.relativeFilePath),
        bytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        content: "",
        truncated: true
      }
    });
    return;
  }
  const buffer = await fs.readFile(resolved.absoluteFilePath);
  const content = buffer.includes(0) ? "" : buffer.toString("utf8");
  res.json({
    file: {
      path: resolved.relativeFilePath,
      name: path.basename(resolved.relativeFilePath),
      bytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      content,
      truncated: false
    }
  });
}

export function createCodexMemoryAdminRouter(options: CodexMemoryAdminRouterOptions): Router {
  const router = Router();
  const sessionHomeRoot = path.resolve(options.sessionHomeRoot);
  const requireRead = options.requirePermission("system_settings.read");
  const requireWrite = options.requirePermission("system_settings.write");

  router.get("/codex-memory/llm-secret", requireRead, async (_req: Request, res: Response) => {
    try {
      res.json(options.llmSecretStore ? await options.llmSecretStore.getState() : { hasApiKey: false });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.put("/codex-memory/llm-secret", requireWrite, async (req: Request, res: Response) => {
    if (!options.llmSecretStore) {
      res.status(501).json({ detail: "LLM secret store is not configured" });
      return;
    }
    try {
      const parsed = updateLlmSecretSchema.parse(req.body ?? {});
      const currentUserId = trimOrUndefined((req as Request & { currentUser?: { id?: string } }).currentUser?.id);
      res.json(await options.llmSecretStore.update({
        apiKey: parsed.apiKey,
        clearApiKey: parsed.clearApiKey,
        currentUserId
      }));
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ detail: error.issues.map((issue) => issue.message).join("; ") });
        return;
      }
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/codex-memory/runs", requireRead, async (req: Request, res: Response) => {
    try {
      const status = String(req.query.status ?? "").trim();
      const channel = String(req.query.channel ?? "").trim().toLowerCase();
      const query = String(req.query.query ?? "").trim().toLowerCase();
      const limitInput = Number.parseInt(String(req.query.limit ?? "200"), 10);
      const limit = Number.isFinite(limitInput) && limitInput > 0 ? Math.min(limitInput, 500) : 200;
      const allRuns = await enrichMemoryRunLogs(await listMemoryRunLogs(sessionHomeRoot), options, sessionHomeRoot);
      const summary = allRuns.reduce<Record<CodexMemoryRunLogItem["status"], number>>(
        (acc, run) => {
          acc[run.status] += 1;
          return acc;
        },
        {
          written: 0,
          skipped_no_durable_memory: 0,
          skipped_missing_input: 0,
          failed: 0
        }
      );
      const runs = allRuns
        .filter((run) => !status || run.status === status)
        .filter((run) => !channel || run.channel.toLowerCase() === channel)
        .filter((run) => {
          if (!query) return true;
          return [
            run.channel,
            run.reason,
            run.model,
            run.llmProvider,
            run.llmModel,
            run.category,
            run.scope?.displayLabel,
            run.scope?.displaySubtitle,
            run.scope?.ownerName,
            run.scope?.ownerEmail,
            run.scope?.agentName,
            run.scope?.integrationName,
            run.threadId,
            run.sessionId,
            run.codexThreadId
          ]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(query));
        });
      res.json({
        total: runs.length,
        summary,
        runs: runs.slice(0, limit)
      });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.get("/codex-memory/scopes", requireRead, async (req: Request, res: Response) => {
    try {
      const query = String(req.query.query ?? "").trim().toLowerCase();
      const kind = String(req.query.kind ?? "").trim();
      const limitInput = Number.parseInt(String(req.query.limit ?? "200"), 10);
      const limit = Number.isFinite(limitInput) && limitInput > 0 ? Math.min(limitInput, 500) : 200;
      const allScopes = await enrichMemoryScopes(await listMemoryScopes(sessionHomeRoot), options);
      const scopes = allScopes
        .filter((scope) => !kind || scope.kind === kind)
        .filter((scope) => {
          if (!query) return true;
          return [
            scope.displayLabel,
            scope.displaySubtitle,
            scope.ownerName,
            scope.ownerEmail,
            scope.agentName,
            scope.agentSlug,
            scope.integrationName,
            scope.integrationType,
            scope.integrationSlug,
            scope.label,
            scope.relativeHome,
            scope.provider,
            scope.integrationInstanceId,
            scope.userId,
            scope.agentSegment
          ]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(query));
        });
      res.json({
        root: sessionHomeRoot,
        total: scopes.length,
        scopes: scopes.slice(0, limit)
      });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.get("/codex-memory/scopes/:scopeId/files", requireRead, async (req: Request, res: Response) => {
    try {
      const scope = resolveScopeHome(sessionHomeRoot, req.params.scopeId);
      const memoriesPath = path.resolve(adminMemoryPathForCodexHome(scope.codexHome));
      if (!(await pathExists(memoriesPath))) {
        res.status(404).json({ detail: "memories directory does not exist" });
        return;
      }
      const summary = await summarizeMemoryDirectory(memoriesPath);
      const enrichedScopes = await enrichMemoryScopes(
        [
          {
            id: req.params.scopeId,
            ...classifyScope(scope.relativeHome),
            relativeHome: scope.relativeHome,
            codexHome: scope.codexHome,
            memoriesPath,
            ...summary
          }
        ],
        options
      );
      res.json({
        scope: enrichedScopes[0],
        files: await listMemoryFiles(memoriesPath)
      });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/codex-memory/scopes/:scopeId/files/content", requireRead, async (req: Request, res: Response) => {
    try {
      await sendMemoryFileContent(req, res, sessionHomeRoot);
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.put("/codex-memory/scopes/:scopeId/files/content", requireWrite, async (req: Request, res: Response) => {
    try {
      const parsed = writeMemoryFileSchema.parse(req.body ?? {});
      const scope = resolveScopeHome(sessionHomeRoot, req.params.scopeId);
      await ensureAgentStudioMemorySource(scope.codexHome);
      const resolved = resolveMemoryFile({
        sessionHomeRoot,
        scopeId: req.params.scopeId,
        memoryFilePath: parsed.path
      });
      await fs.mkdir(path.dirname(resolved.absoluteFilePath), { recursive: true });
      await fs.writeFile(resolved.absoluteFilePath, parsed.content, "utf8");
      await syncAgentStudioMemoryProjection(resolved.codexHome);
      req.query.path = parsed.path;
      await sendMemoryFileContent(req, res, sessionHomeRoot);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ detail: error.issues.map((issue) => issue.message).join("; ") });
        return;
      }
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.delete("/codex-memory/scopes/:scopeId/files/content", requireWrite, async (req: Request, res: Response) => {
    try {
      const memoryFilePath = String(req.query.path ?? "").trim();
      if (!memoryFilePath) {
        res.status(400).json({ detail: "path is required" });
        return;
      }
      const resolved = resolveMemoryFile({
        sessionHomeRoot,
        scopeId: req.params.scopeId,
        memoryFilePath
      });
      await fs.rm(resolved.absoluteFilePath, { force: true });
      await syncAgentStudioMemoryProjection(resolved.codexHome);
      res.status(204).end();
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.delete("/codex-memory/scopes/:scopeId", requireWrite, async (req: Request, res: Response) => {
    try {
      const scope = resolveScopeHome(sessionHomeRoot, req.params.scopeId);
      const sourcePath = agentStudioMemorySourcePath(scope.codexHome);
      const projectionPath = codexMemoryProjectionPath(scope.codexHome);
      if (await pathExists(sourcePath)) {
        await clearManagedMemoryFiles(sourcePath);
        await fs.rm(agentStudioMemoryCandidatesPath(scope.codexHome), { force: true });
      }
      if (await pathExists(projectionPath)) {
        await clearManagedMemoryFiles(projectionPath);
      }
      res.status(204).end();
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  return router;
}
