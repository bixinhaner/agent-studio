import fs from "node:fs/promises";
import path from "node:path";

export type WorkspaceAgentsMdSourceRef =
  | { version: 1; kind: "inline"; content: string }
  | { version: 1; kind: "template"; templateId: string }
  | { version: 1; kind: "path"; path: string };

export type WorkspaceAgentsMdTemplateRecord = {
  id: string;
  label: string;
  sourcePath: string;
  content: string;
  updatedAt: string;
};

const WORKSPACE_ROOT_TEMPLATE_ID = "workspace:AGENTS.md";
const TEMPLATE_ID_PREFIX = "template:";
const templateRootPath = path.resolve(process.cwd(), "templates", "agents-md");
const workspaceRootAgentsPath = path.resolve(process.cwd(), "AGENTS.md");

function trimOrEmpty(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTemplateRelativePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function buildTemplateId(relativePath: string): string {
  return `${TEMPLATE_ID_PREFIX}${normalizeTemplateRelativePath(relativePath)}`;
}

function labelForTemplateRelativePath(relativePath: string): string {
  const normalized = normalizeTemplateRelativePath(relativePath);
  const fileName = path.basename(normalized, path.extname(normalized));
  return fileName || normalized;
}

function parseWorkspaceAgentsMdSourceRef(value: string): WorkspaceAgentsMdSourceRef | undefined {
  const raw = trimOrEmpty(value);
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return { version: 1, kind: "path", path: raw };
    }
    const payload = parsed as Record<string, unknown>;
    if (payload.version !== 1) {
      return { version: 1, kind: "path", path: raw };
    }
    const kind = payload.kind;
    if (kind === "inline") {
      const content = typeof payload.content === "string" ? payload.content : "";
      return { version: 1, kind, content };
    }
    if (kind === "template") {
      const templateId = typeof payload.templateId === "string" ? payload.templateId.trim() : "";
      if (!templateId) return undefined;
      return { version: 1, kind, templateId };
    }
    if (kind === "path") {
      const filePath = typeof payload.path === "string" ? payload.path.trim() : "";
      if (!filePath) return undefined;
      return { version: 1, kind, path: filePath };
    }
  } catch {
    return { version: 1, kind: "path", path: raw };
  }

  return { version: 1, kind: "path", path: raw };
}

async function readTemplateByAbsolutePath(input: {
  id: string;
  label: string;
  sourcePath: string;
}): Promise<WorkspaceAgentsMdTemplateRecord | undefined> {
  const sourcePath = path.resolve(input.sourcePath);
  let stat;
  try {
    stat = await fs.stat(sourcePath);
  } catch {
    return undefined;
  }
  if (!stat.isFile()) {
    return undefined;
  }
  const content = await fs.readFile(sourcePath, "utf8");
  return {
    id: input.id,
    label: input.label,
    sourcePath,
    content,
    updatedAt: toIsoString(stat.mtime)
  };
}

async function listTemplateRelativePaths(rootPath: string, relativePath = ""): Promise<string[]> {
  const current = relativePath ? path.join(rootPath, relativePath) : rootPath;
  let entries;
  try {
    entries = await fs.readdir(current, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const entryName = String(entry.name);
    const nextRelative = relativePath ? path.join(relativePath, entryName) : entryName;
    if (entry.isDirectory()) {
      files.push(...(await listTemplateRelativePaths(rootPath, nextRelative)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!entryName.toLowerCase().endsWith(".md")) {
      continue;
    }
    files.push(normalizeTemplateRelativePath(nextRelative));
  }
  return files;
}

async function resolveTemplatePathById(templateId: string): Promise<string | undefined> {
  if (templateId === WORKSPACE_ROOT_TEMPLATE_ID) {
    return workspaceRootAgentsPath;
  }
  if (!templateId.startsWith(TEMPLATE_ID_PREFIX)) {
    return undefined;
  }
  const relativePath = normalizeTemplateRelativePath(templateId.slice(TEMPLATE_ID_PREFIX.length));
  if (!relativePath) {
    return undefined;
  }
  const absolutePath = path.resolve(templateRootPath, relativePath);
  if (absolutePath !== templateRootPath && !absolutePath.startsWith(`${templateRootPath}${path.sep}`)) {
    return undefined;
  }
  return absolutePath;
}

export async function listWorkspaceAgentsMdTemplates(): Promise<WorkspaceAgentsMdTemplateRecord[]> {
  const templates: WorkspaceAgentsMdTemplateRecord[] = [];

  const workspaceTemplate = await readTemplateByAbsolutePath({
    id: WORKSPACE_ROOT_TEMPLATE_ID,
    label: "Workspace AGENTS.md",
    sourcePath: workspaceRootAgentsPath
  });
  if (workspaceTemplate) {
    templates.push(workspaceTemplate);
  }

  const templateRelativePaths = await listTemplateRelativePaths(templateRootPath);
  templateRelativePaths.sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base", numeric: true }));

  for (const relativePath of templateRelativePaths) {
    const template = await readTemplateByAbsolutePath({
      id: buildTemplateId(relativePath),
      label: labelForTemplateRelativePath(relativePath),
      sourcePath: path.resolve(templateRootPath, relativePath)
    });
    if (template) {
      templates.push(template);
    }
  }

  return templates;
}

export async function readWorkspaceAgentsMdTemplateById(
  templateId: string
): Promise<WorkspaceAgentsMdTemplateRecord | undefined> {
  const sourcePath = await resolveTemplatePathById(templateId.trim());
  if (!sourcePath) return undefined;
  const label =
    templateId === WORKSPACE_ROOT_TEMPLATE_ID
      ? "Workspace AGENTS.md"
      : labelForTemplateRelativePath(templateId.slice(TEMPLATE_ID_PREFIX.length));
  return readTemplateByAbsolutePath({
    id: templateId,
    label,
    sourcePath
  });
}

async function readAgentsContentFromPath(filePathValue: string): Promise<string> {
  const normalized = filePathValue.trim();
  if (!normalized) {
    throw new Error("workspace_agents_md path is required");
  }
  const absolutePath = path.isAbsolute(normalized) ? normalized : path.resolve(process.cwd(), normalized);
  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch {
    throw new Error(`workspace_agents_md path does not exist: ${absolutePath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`workspace_agents_md path is not a file: ${absolutePath}`);
  }
  return fs.readFile(absolutePath, "utf8");
}

export async function resolveWorkspaceAgentsMdContent(sourceRef: string): Promise<string | undefined> {
  const parsed = parseWorkspaceAgentsMdSourceRef(sourceRef);
  if (!parsed) return undefined;

  if (parsed.kind === "inline") {
    const content = parsed.content;
    return content.trim() ? content : undefined;
  }

  if (parsed.kind === "template") {
    const template = await readWorkspaceAgentsMdTemplateById(parsed.templateId);
    if (!template) {
      throw new Error(`workspace_agents_md template does not exist: ${parsed.templateId}`);
    }
    return template.content.trim() ? template.content : undefined;
  }

  const content = await readAgentsContentFromPath(parsed.path);
  return content.trim() ? content : undefined;
}
