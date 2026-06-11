import fs from "node:fs/promises";
import path from "node:path";
import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";

type CodexMemoryAdminRouterOptions = {
  sessionHomeRoot: string;
  requirePermission(permissionKey: string): RequestHandler;
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
};

const MAX_SCAN_DEPTH = 8;
const MAX_SCOPE_COUNT = 2000;
const MAX_FILE_CONTENT_BYTES = 1024 * 1024;

const writeMemoryFileSchema = z
  .object({
    path: z.string().trim().min(1).max(500),
    content: z.string().max(MAX_FILE_CONTENT_BYTES)
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

function resolveScopeHome(sessionHomeRoot: string, scopeId: string): { relativeHome: string; codexHome: string } {
  const relativeHome = safeRelativePath(decodeScopeId(scopeId), "scope");
  const codexHome = path.resolve(sessionHomeRoot, relativeHome);
  if (!isPathInside(sessionHomeRoot, codexHome)) {
    throw new Error("scope is outside the Codex home root");
  }
  return { relativeHome: toUnixRelative(path.relative(sessionHomeRoot, codexHome)), codexHome };
}

function resolveMemoryFile(input: {
  sessionHomeRoot: string;
  scopeId: string;
  memoryFilePath: string;
}): { relativeHome: string; codexHome: string; memoriesPath: string; relativeFilePath: string; absoluteFilePath: string } {
  const scope = resolveScopeHome(input.sessionHomeRoot, input.scopeId);
  const memoriesPath = path.resolve(scope.codexHome, "memories");
  const relativeFilePath = safeRelativePath(input.memoryFilePath, "memory file path");
  const absoluteFilePath = path.resolve(memoriesPath, relativeFilePath);
  if (!isPathInside(memoriesPath, absoluteFilePath)) {
    throw new Error("memory file path is outside the memories directory");
  }
  return { ...scope, memoriesPath, relativeFilePath: toUnixRelative(relativeFilePath), absoluteFilePath };
}

function classifyScope(relativeHome: string): Omit<CodexMemoryScope, "id" | "relativeHome" | "codexHome" | "memoriesPath" | "fileCount" | "totalBytes" | "latestModifiedAt"> {
  const parts = relativeHome.split("/").filter(Boolean);
  if (parts[0] === "integrations" && parts.length >= 4) {
    return {
      kind: "integration_agent",
      label: `${parts[1]} / ${parts[2]} / ${parts[3]}`,
      provider: parts[1],
      integrationInstanceId: parts[2],
      agentSegment: parts[3]
    };
  }
  if (parts[0]?.startsWith("thread-") || parts[0]?.startsWith("session-")) {
    return {
      kind: "legacy_thread",
      label: parts[0] ?? relativeHome
    };
  }
  if (parts.length >= 3) {
    return {
      kind: "user_agent",
      label: `${parts[0]} / ${parts[1]} / ${parts[2]}`,
      organizationKey: parts[0],
      userId: parts[1],
      agentSegment: parts[2]
    };
  }
  return {
    kind: "unknown",
    label: relativeHome
  };
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
    let entries: Array<import("node:fs").Dirent>;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
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
        await walk(absolutePath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fs.stat(absolutePath);
      const relativePath = toUnixRelative(path.relative(memoriesPath, absolutePath));
      files.push({
        path: relativePath,
        name: entry.name,
        bytes: stat.size,
        modifiedAt: stat.mtime.toISOString()
      });
    }
  }

  await walk(memoriesPath, 0);
  files.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt) || left.path.localeCompare(right.path));
  return files;
}

async function listMemoryScopes(sessionHomeRoot: string): Promise<CodexMemoryScope[]> {
  await fs.mkdir(sessionHomeRoot, { recursive: true });
  const scopes: CodexMemoryScope[] = [];

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > MAX_SCAN_DEPTH || scopes.length >= MAX_SCOPE_COUNT) return;
    let entries: Array<import("node:fs").Dirent>;
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
        const summary = await summarizeMemoryDirectory(absolutePath);
        scopes.push({
          id: encodeScopeId(relativeHome),
          relativeHome,
          codexHome,
          memoriesPath: absolutePath,
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

  router.get("/codex-memory/scopes", requireRead, async (req: Request, res: Response) => {
    try {
      const query = String(req.query.query ?? "").trim().toLowerCase();
      const kind = String(req.query.kind ?? "").trim();
      const limitInput = Number.parseInt(String(req.query.limit ?? "200"), 10);
      const limit = Number.isFinite(limitInput) && limitInput > 0 ? Math.min(limitInput, 500) : 200;
      const scopes = (await listMemoryScopes(sessionHomeRoot))
        .filter((scope) => !kind || scope.kind === kind)
        .filter((scope) => {
          if (!query) return true;
          return [scope.label, scope.relativeHome, scope.provider, scope.integrationInstanceId, scope.userId, scope.agentSegment]
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
      const memoriesPath = path.resolve(scope.codexHome, "memories");
      if (!(await pathExists(memoriesPath))) {
        res.status(404).json({ detail: "memories directory does not exist" });
        return;
      }
      res.json({
        scope: {
          id: req.params.scopeId,
          ...classifyScope(scope.relativeHome),
          relativeHome: scope.relativeHome,
          codexHome: scope.codexHome,
          memoriesPath
        },
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
      const resolved = resolveMemoryFile({
        sessionHomeRoot,
        scopeId: req.params.scopeId,
        memoryFilePath: parsed.path
      });
      await fs.mkdir(path.dirname(resolved.absoluteFilePath), { recursive: true });
      await fs.writeFile(resolved.absoluteFilePath, parsed.content, "utf8");
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
      res.status(204).end();
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.delete("/codex-memory/scopes/:scopeId", requireWrite, async (req: Request, res: Response) => {
    try {
      const scope = resolveScopeHome(sessionHomeRoot, req.params.scopeId);
      const memoriesPath = path.resolve(scope.codexHome, "memories");
      if (!(await pathExists(memoriesPath))) {
        res.status(204).end();
        return;
      }
      await fs.rm(memoriesPath, { recursive: true, force: true });
      await fs.mkdir(memoriesPath, { recursive: true });
      res.status(204).end();
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  return router;
}
