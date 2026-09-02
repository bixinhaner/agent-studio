import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import type { AgentModeRepository } from "../persistence/agent-mode-repository.js";
import type {
  CodexManagedSkillRecord,
  CodexSkillDraftRecord,
  CodexSkillRepository
} from "../persistence/codex-skill-repository.js";
import type { SkillPackageRepository, SkillPackageRecord } from "../persistence/skill-package-repository.js";
import type { SkillCatalogLocalizedContent } from "../skill-catalog/types.js";

type Actor = {
  id: string;
  displayName?: string;
  email?: string;
  organizationId?: string;
};

type CreateDraftInput = {
  actor: Actor;
  prompt: string;
  sourceThreadId?: string;
  modeId?: string;
};

type CreateDraftFromDirectoryInput = {
  actor: Actor;
  sourceDirectoryPath: string;
  requestedPrompt?: string;
  sourceThreadId?: string;
  modeId?: string;
};

type InstallSkillFromDirectoryInput = {
  actor: Actor;
  sourceDirectoryPath: string;
  sourceRelativePath?: string;
  requestedPrompt?: string;
  sourceThreadId?: string;
  modeId?: string;
};

type ReviseDraftInput = {
  actor: Actor;
  draftId: string;
  instruction: string;
};

type CreateNewVersionDraftInput = {
  actor: Actor;
  draftId: string;
  instruction: string;
};

type PublishDraftInput = {
  actor: Actor;
  draftId: string;
  reviewNote?: string;
  activationPrompt?: string;
  skillPackageId?: string;
  agentModeIds?: string[];
};

type ShareManagedSkillInput = {
  actor: Actor;
  skillId: string;
  activationPrompt?: string;
  skillPackageId?: string;
  agentModeIds?: string[];
};

type RemoveManagedSkillInput = {
  actor: Actor;
  skillId: string;
  reason?: string;
};

export type CodexSkillValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  metadata?: {
    name?: string;
    description?: string;
    hasScripts: boolean;
    fileCount: number;
    totalBytes: number;
  };
};

type CodexSkillServiceOptions = {
  draftRoot: string;
  publishedSkillsRoot: string;
};

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const SAFE_SKILL_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}$/;
const MAX_SKILL_MD_LINES = 500;

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function hashText(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 8);
}

function slugify(value: string, fallback = "custom-skill"): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 56);
  return normalized || `${fallback}-${hashText(value)}`;
}

function sanitizePathSegment(value: string, fallback: string): string {
  const normalized = value
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function firstLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringFromMetadata(value: unknown, key: string): string | undefined {
  const current = asRecord(value)[key];
  return typeof current === "string" ? trimOrUndefined(current) : undefined;
}

function bumpPatchVersion(value: string | undefined): string {
  const normalized = trimOrUndefined(value) ?? "1.0.0";
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)(-.+)?$/);
  if (!match) return "1.0.1";
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function displayNameFromPrompt(prompt: string): string {
  const cleaned = prompt
    .replace(/(创建|做成|生成|制作|保存|固化|封装|复用|skill|技能|能力)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return firstLine(cleaned || prompt, 48) || "Custom Skill";
}

function skillNameFromPrompt(prompt: string): string {
  const englishTokens = prompt
    .toLowerCase()
    .replace(/skill|create|creator|please|make|build|generate|保存|创建|做成|技能|能力|复用/g, " ")
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && token.length <= 24)
    .slice(0, 5);
  const base = englishTokens.length > 0 ? englishTokens.join("-") : `custom-skill-${hashText(prompt)}`;
  return slugify(base, "custom-skill");
}

function yamlString(value: string): string {
  return JSON.stringify(value.replace(/\r?\n/g, " ").trim());
}

function parseFrontmatterValue(raw: string | undefined): string | undefined {
  const value = trimOrUndefined(raw);
  if (!value) return undefined;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return trimOrUndefined(value.slice(1, -1));
  }
  return value;
}

function parseSkillMetadata(content: string): { name?: string; description?: string } {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return {};
  const metadata: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    metadata[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return {
    name: parseFrontmatterValue(metadata.name),
    description: parseFrontmatterValue(metadata.description)
  };
}

type SkillInterfaceMetadata = {
  displayName?: string;
  shortDescription?: string;
  defaultPrompt?: string;
};

function parseYamlScalar(raw: string): string | undefined {
  const value = trimOrUndefined(raw);
  if (!value || value === ">" || value === "|") return undefined;
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? trimOrUndefined(parsed) : undefined;
    } catch {
      return parseFrontmatterValue(value);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return trimOrUndefined(value.slice(1, -1).replace(/''/g, "'"));
  }
  return value.replace(/\s+#.*$/, "").trim() || undefined;
}

function parseSkillInterfaceMetadata(content: string): SkillInterfaceMetadata {
  const output: SkillInterfaceMetadata = {};
  let interfaceIndent: number | undefined;
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    if (/^interface\s*:\s*$/.test(line.trim())) {
      interfaceIndent = indent;
      continue;
    }
    if (interfaceIndent === undefined) continue;
    if (indent <= interfaceIndent) break;
    const match = line.trim().match(/^(display_name|short_description|default_prompt)\s*:\s*(.*)$/);
    if (!match) continue;
    const value = parseYamlScalar(match[2]);
    if (match[1] === "display_name") output.displayName = value;
    if (match[1] === "short_description") output.shortDescription = value;
    if (match[1] === "default_prompt") output.defaultPrompt = value;
  }
  return output;
}

async function readInitialSkillPresentation(input: {
  directoryPath: string;
  skillName: string;
  displayName?: string;
  description?: string;
}): Promise<{ defaultLocale: string; content: SkillCatalogLocalizedContent }> {
  const openAiYamlPath = path.join(input.directoryPath, "agents", "openai.yaml");
  const interfaceMetadata = await fs.readFile(openAiYamlPath, "utf8")
    .then(parseSkillInterfaceMetadata)
    .catch(() => ({} as SkillInterfaceMetadata));
  const displayName = interfaceMetadata.displayName ?? trimOrUndefined(input.displayName) ?? input.skillName;
  const summary = interfaceMetadata.shortDescription ?? trimOrUndefined(input.description) ?? input.skillName;
  const examplePrompts = interfaceMetadata.defaultPrompt ? [interfaceMetadata.defaultPrompt] : [];
  const defaultLocale = /[\u3400-\u9fff]/u.test(`${displayName}\n${summary}\n${examplePrompts.join("\n")}`)
    ? "zh-CN"
    : "en-US";
  return {
    defaultLocale,
    content: {
      displayName,
      summary,
      useCases: [],
      usageSteps: [],
      examplePrompts,
      dataScope: undefined
    }
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.lstat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyDirectoryNoSymlinks(sourcePath: string, destinationPath: string): Promise<void> {
  const stat = await fs.lstat(sourcePath);
  if (stat.isSymbolicLink()) {
    throw new Error("Skill draft contains symlink and cannot be published");
  }
  if (stat.isDirectory()) {
    await fs.mkdir(destinationPath, { recursive: true });
    const entries = await fs.readdir(sourcePath, { withFileTypes: true });
    for (const entry of entries) {
      await copyDirectoryNoSymlinks(path.join(sourcePath, entry.name), path.join(destinationPath, entry.name));
    }
    return;
  }
  if (!stat.isFile()) return;
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.copyFile(sourcePath, destinationPath);
}

function isPathInsideRoot(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function managedSkillBindingMatches(binding: {
  runtimeType: string;
  bindingType: string;
  bindingPayload: unknown;
}, managedSkill: Pick<CodexManagedSkillRecord, "id" | "skillName">): boolean {
  if (binding.runtimeType !== "codex" || binding.bindingType !== "codex_skill") return false;
  const payload = asRecord(binding.bindingPayload);
  return payload.managedSkillId === managedSkill.id || payload.skillName === managedSkill.skillName;
}

async function hashSkillDirectory(rootPath: string): Promise<string> {
  const normalizedRoot = path.resolve(rootPath);
  const hash = createHash("sha1");

  const walk = async (currentPath: string) => {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      const relativePath = path.relative(normalizedRoot, entryPath).replace(/\\/g, "/");
      const stat = await fs.lstat(entryPath);
      if (stat.isSymbolicLink()) {
        throw new Error("Skill directory cannot contain symlinks");
      }
      if (entry.isDirectory()) {
        hash.update(`dir:${relativePath}\n`);
        await walk(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      hash.update(`file:${relativePath}:${stat.size}\n`);
      hash.update(await fs.readFile(entryPath));
      hash.update("\n");
    }
  };

  await walk(normalizedRoot);
  return hash.digest("hex");
}

async function moveDirectoryToArchive(input: {
  sourcePath: string;
  activeRoot: string;
  archiveRoot: string;
}): Promise<string | undefined> {
  const sourcePath = path.resolve(input.sourcePath);
  const activeRoot = path.resolve(input.activeRoot);
  if (!isPathInsideRoot(sourcePath, activeRoot)) {
    throw new Error("Skill path is outside the managed skills root");
  }
  const stat = await fs.lstat(sourcePath).catch(() => null);
  if (!stat) return undefined;
  if (stat.isSymbolicLink()) {
    throw new Error("Refusing to remove a symlinked skill directory");
  }
  if (!stat.isDirectory()) {
    throw new Error("Skill path is not a directory");
  }

  const relativePath = path.relative(activeRoot, sourcePath);
  const parentRelativePath = path.dirname(relativePath);
  const destinationName = `${path.basename(sourcePath)}-${Date.now()}-${hashText(sourcePath)}`;
  const destinationPath = path.join(
    path.resolve(input.archiveRoot),
    parentRelativePath === "." ? "" : parentRelativePath,
    destinationName
  );
  await fs.rm(destinationPath, { recursive: true, force: true });
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  try {
    await fs.rename(sourcePath, destinationPath);
  } catch (error) {
    const code = typeof error === "object" && error !== null ? (error as { code?: string }).code : undefined;
    if (code !== "EXDEV") throw error;
    await copyDirectoryNoSymlinks(sourcePath, destinationPath);
    await fs.rm(sourcePath, { recursive: true, force: true });
  }
  return destinationPath;
}

async function resolveSkillDirectoryPath(sourcePath: string): Promise<string> {
  const normalized = path.resolve(sourcePath);
  const stat = await fs.lstat(normalized).catch(() => null);
  if (!stat) {
    throw new Error("Skill directory does not exist");
  }
  if (stat.isSymbolicLink()) {
    throw new Error("Skill directory cannot be a symlink");
  }
  const skillDirectory = stat.isFile() && path.basename(normalized) === "SKILL.md" ? path.dirname(normalized) : normalized;
  const skillMdPath = path.join(skillDirectory, "SKILL.md");
  const skillMdStat = await fs.lstat(skillMdPath).catch(() => null);
  if (!skillMdStat || !skillMdStat.isFile()) {
    throw new Error("Selected directory does not contain SKILL.md");
  }
  if (skillMdStat.isSymbolicLink()) {
    throw new Error("SKILL.md cannot be a symlink");
  }
  return skillDirectory;
}

function createSkillMarkdown(input: {
  skillName: string;
  displayName: string;
  description: string;
  prompt: string;
}): string {
  return `---
name: ${input.skillName}
description: ${yamlString(input.description)}
---

# ${input.displayName}

Use this skill when the user wants to repeat the workflow described below or asks to automate a similar task.

## Source request

${input.prompt}

## Workflow

1. Identify the user's concrete goal and expected output.
2. Reuse existing project files and conventions before creating new files.
3. Automate repetitive steps with scripts when the same operation may be repeated.
4. Put temporary verification files in the project temp directory when a project temp directory exists.
5. Validate the final output before responding.

## Response style

- Start with the result and next action.
- Explain why important decisions were made and how they affect the user.
- Ask only when missing information would make the output unsafe or unusable.
`;
}

export class CodexSkillService {
  private readonly draftRoot: string;
  private readonly publishedSkillsRoot: string;
  private readonly archivedSkillsRoot: string;

  constructor(
    private readonly dependencies: {
      repository: CodexSkillRepository;
      skillPackages: SkillPackageRepository;
      agentModes: AgentModeRepository;
      skillCatalog?: {
        ensureManagedSkillEntry(input: {
          skill: CodexManagedSkillRecord;
          defaultLocale?: string;
          initialTranslation?: SkillCatalogLocalizedContent;
        }): Promise<unknown>;
      };
    },
    options: CodexSkillServiceOptions
  ) {
    this.draftRoot = path.resolve(options.draftRoot);
    this.publishedSkillsRoot = path.resolve(options.publishedSkillsRoot);
    this.archivedSkillsRoot = path.join(path.dirname(this.publishedSkillsRoot), "skill-archive");
  }

  async createDraft(input: CreateDraftInput): Promise<CodexSkillDraftRecord> {
    const prompt = trimOrUndefined(input.prompt);
    if (!prompt) throw new Error("请描述要沉淀成 skill 的流程");
    const skillName = skillNameFromPrompt(prompt);
    const displayName = displayNameFromPrompt(prompt);
    const description = `Automates a reusable workflow requested by the user: ${firstLine(prompt, 120)}`;
    const draftIdSeed = `${Date.now()}-${hashText(`${input.actor.id}:${prompt}`)}`;
    const draftPath = path.join(this.draftRoot, sanitizePathSegment(draftIdSeed, "draft"));

    await fs.mkdir(draftPath, { recursive: true });
    await fs.writeFile(
      path.join(draftPath, "SKILL.md"),
      createSkillMarkdown({
        skillName,
        displayName,
        description,
        prompt
      }),
      "utf8"
    );

    const validation = await this.validateSkillDirectory(draftPath);
    return this.dependencies.repository.createDraft({
      organizationId: input.actor.organizationId,
      createdByUserId: input.actor.id,
      createdByDisplayName: input.actor.displayName,
      createdByEmail: input.actor.email,
      sourceThreadId: input.sourceThreadId,
      requestedPrompt: prompt,
      skillName,
      slug: slugify(skillName),
      displayName,
      description,
      status: "pending_review",
      version: "1.0.0",
      draftPath,
      validation,
      metadata: {
        generator: "agent-studio-skill-draft-v1",
        modeId: trimOrUndefined(input.modeId)
      }
    });
  }

  async createDraftFromDirectory(input: CreateDraftFromDirectoryInput): Promise<CodexSkillDraftRecord> {
    const sourceDirectoryPath = await resolveSkillDirectoryPath(input.sourceDirectoryPath);
    const skillMd = await fs.readFile(path.join(sourceDirectoryPath, "SKILL.md"), "utf8");
    const metadata = parseSkillMetadata(skillMd);
    const sourceFolderName = path.basename(sourceDirectoryPath);
    const skillName = metadata.name ?? sourceFolderName;
    const displayName = metadata.name ?? sourceFolderName;
    const description = metadata.description;
    const requestedPrompt =
      trimOrUndefined(input.requestedPrompt) ?? `Imported Codex skill generated with skill-creator from ${sourceFolderName}`;
    const draftIdSeed = `${Date.now()}-${hashText(`${input.actor.id}:${sourceDirectoryPath}:${requestedPrompt}`)}`;
    const draftPath = path.join(this.draftRoot, sanitizePathSegment(draftIdSeed, "draft"));

    await fs.rm(draftPath, { recursive: true, force: true });
    await copyDirectoryNoSymlinks(sourceDirectoryPath, draftPath);

    const validation = await this.validateSkillDirectory(draftPath);
    return this.dependencies.repository.createDraft({
      organizationId: input.actor.organizationId,
      createdByUserId: input.actor.id,
      createdByDisplayName: input.actor.displayName,
      createdByEmail: input.actor.email,
      sourceThreadId: input.sourceThreadId,
      requestedPrompt,
      skillName,
      slug: slugify(skillName),
      displayName,
      description,
      status: "pending_review",
      version: "1.0.0",
      draftPath,
      validation,
      metadata: {
        generator: "skill-creator-import-v1",
        modeId: trimOrUndefined(input.modeId),
        sourceDirectoryPath
      }
    });
  }

  async installSkillFromDirectory(input: InstallSkillFromDirectoryInput): Promise<CodexManagedSkillRecord> {
    const sourceDirectoryPath = await resolveSkillDirectoryPath(input.sourceDirectoryPath);
    const validation = await this.validateSkillDirectory(sourceDirectoryPath);
    if (!validation.ok) {
      throw new Error(`Skill 校验失败：${validation.errors.join("; ")}`);
    }

    const skillMd = await fs.readFile(path.join(sourceDirectoryPath, "SKILL.md"), "utf8");
    const metadata = parseSkillMetadata(skillMd);
    const sourceFolderName = path.basename(sourceDirectoryPath);
    const skillName = trimOrUndefined(validation.metadata?.name) ?? metadata.name ?? sourceFolderName;
    if (!skillName) throw new Error("Skill 缺少 name");

    const checksum = await hashSkillDirectory(sourceDirectoryPath);
    const existing = await this.dependencies.repository.findManagedSkillByName({
      organizationId: input.actor.organizationId,
      ownerUserId: input.actor.id,
      scope: "private",
      skillName
    });
    const slug = slugify(skillName);
    const destinationPath = path.join(
      this.publishedSkillsRoot,
      "user",
      sanitizePathSegment(input.actor.organizationId ?? "global", "global"),
      sanitizePathSegment(input.actor.id, "user"),
      slug
    );
    const tempPath = `${destinationPath}.tmp-${Date.now()}`;
    await fs.rm(tempPath, { recursive: true, force: true });
    await copyDirectoryNoSymlinks(sourceDirectoryPath, tempPath);
    await fs.rm(destinationPath, { recursive: true, force: true });
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.rename(tempPath, destinationPath);

    const version =
      existing && existing.checksum && existing.checksum !== checksum
        ? bumpPatchVersion(existing.version)
        : existing?.version || "1.0.0";
    const publishedAt = new Date();
    const requestedPrompt =
      trimOrUndefined(input.requestedPrompt) ?? `Installed Codex skill generated from ${sourceFolderName}`;
    const managedSkill = await this.dependencies.repository.upsertManagedSkill({
      organizationId: input.actor.organizationId,
      ownerUserId: input.actor.id,
      scope: "private",
      skillName,
      slug,
      displayName: metadata.name ?? sourceFolderName,
      description: validation.metadata?.description ?? metadata.description,
      status: "active",
      version,
      checksum,
      publishedPath: destinationPath,
      createdByUserId: existing?.createdByUserId ?? input.actor.id,
      createdByDisplayName: existing?.createdByDisplayName ?? input.actor.displayName,
      createdByEmail: existing?.createdByEmail ?? input.actor.email,
      lastEditedByUserId: input.actor.id,
      publishedByUserId: input.actor.id,
      publishedByDisplayName: input.actor.displayName,
      metadata: {
        ...(existing && typeof existing.metadata === "object" && existing.metadata !== null
          ? (existing.metadata as Record<string, unknown>)
          : {}),
        generator: "skill-creator-install-v1",
        requestedPrompt,
        sourceThreadId: trimOrUndefined(input.sourceThreadId),
        sourceDirectoryPath,
        sourceThreadRelativePath: trimOrUndefined(input.sourceRelativePath),
        modeId: trimOrUndefined(input.modeId),
        installedAt: publishedAt.toISOString()
      },
      publishedAt
    });
    await this.ensureManagedSkillCatalogEntry(managedSkill, destinationPath);
    return managedSkill;
  }

  async reviseDraft(input: ReviseDraftInput): Promise<CodexSkillDraftRecord> {
    const draft = await this.requireDraft(input.draftId);
    if (draft.createdByUserId !== input.actor.id) {
      throw new Error("无权修改该 skill 草稿");
    }
    if (draft.status === "published" || draft.status === "archived") {
      throw new Error("已发布或已归档的 skill 不能直接修改，请创建新版本草稿");
    }
    const instruction = trimOrUndefined(input.instruction);
    if (!instruction) throw new Error("请描述要修改的内容");

    const skillMdPath = path.join(draft.draftPath, "SKILL.md");
    const current = await fs.readFile(skillMdPath, "utf8");
    const next = `${current.trim()}\n\n## Revision request\n\n${instruction}\n`;
    await fs.writeFile(skillMdPath, next, "utf8");
    const validation = await this.validateSkillDirectory(draft.draftPath);
    return this.dependencies.repository.updateDraft(draft.id, {
      status: "pending_review",
      validation,
      reviewNote: "",
      reviewedByUserId: "",
      reviewedByDisplayName: "",
      metadata: {
        ...(typeof draft.metadata === "object" && draft.metadata !== null ? (draft.metadata as Record<string, unknown>) : {}),
        lastRevisionByUserId: input.actor.id,
        lastRevisionAt: new Date().toISOString()
      }
    });
  }

  async createNewVersionDraft(input: CreateNewVersionDraftInput): Promise<CodexSkillDraftRecord> {
    const sourceDraft = await this.requireDraft(input.draftId);
    if (sourceDraft.createdByUserId !== input.actor.id) {
      throw new Error("无权修改该 skill");
    }
    if (sourceDraft.status !== "published") {
      throw new Error("只有已发布的 skill 才需要创建新版本草稿");
    }
    const instruction = trimOrUndefined(input.instruction);
    if (!instruction) throw new Error("请描述新版本要修改什么");

    const sourcePath = trimOrUndefined(sourceDraft.publishedPath) ?? sourceDraft.draftPath;
    if (!(await pathExists(sourcePath))) {
      throw new Error("已发布 skill 文件不存在，无法创建新版本草稿");
    }

    const nextVersion = bumpPatchVersion(sourceDraft.version);
    const draftIdSeed = `${Date.now()}-${hashText(`${input.actor.id}:${sourceDraft.id}:${instruction}`)}`;
    const draftPath = path.join(this.draftRoot, sanitizePathSegment(draftIdSeed, "draft"));
    await fs.rm(draftPath, { recursive: true, force: true });
    await copyDirectoryNoSymlinks(sourcePath, draftPath);

    const skillMdPath = path.join(draftPath, "SKILL.md");
    const current = await fs.readFile(skillMdPath, "utf8");
    await fs.writeFile(
      skillMdPath,
      `${current.trim()}\n\n## Requested changes for version ${nextVersion}\n\n${instruction}\n`,
      "utf8"
    );

    const metadata = asRecord(sourceDraft.metadata);
    const validation = await this.validateSkillDirectory(draftPath);
    return this.dependencies.repository.createDraft({
      organizationId: sourceDraft.organizationId ?? input.actor.organizationId,
      createdByUserId: input.actor.id,
      createdByDisplayName: input.actor.displayName,
      createdByEmail: input.actor.email,
      sourceThreadId: sourceDraft.sourceThreadId,
      sourceManagedSkillId: stringFromMetadata(sourceDraft.metadata, "managedSkillId"),
      requestedPrompt: instruction,
      skillName: sourceDraft.skillName,
      slug: sourceDraft.slug,
      displayName: sourceDraft.displayName,
      description: sourceDraft.description,
      status: "pending_review",
      version: nextVersion,
      draftPath,
      validation,
      metadata: {
        ...metadata,
        generator: "agent-studio-skill-draft-v1",
        revisionOfDraftId: sourceDraft.id,
        previousVersion: sourceDraft.version,
        sourcePublishedPath: sourceDraft.publishedPath
      }
    });
  }

  async getDraftForPortal(input: { actor: Actor; draftId: string }): Promise<CodexSkillDraftRecord> {
    const draft = await this.requireDraft(input.draftId);
    if (draft.createdByUserId !== input.actor.id) {
      throw new Error("无权查看该 skill 草稿");
    }
    return draft;
  }

  async listDraftsForPortal(actor: Actor): Promise<CodexSkillDraftRecord[]> {
    return this.dependencies.repository.listDrafts({
      organizationId: actor.organizationId,
      createdByUserId: actor.id,
      take: 50
    });
  }

  async listDraftsForAdmin(input?: { organizationId?: string; status?: string }): Promise<CodexSkillDraftRecord[]> {
    return this.dependencies.repository.listDrafts({
      organizationId: input?.organizationId,
      status: input?.status,
      take: 200
    });
  }

  async listManagedSkills(input?: { organizationId?: string }): Promise<CodexManagedSkillRecord[]> {
    return this.dependencies.repository.listManagedSkills({
      organizationId: input?.organizationId
    });
  }

  async listManagedSkillsForPortal(actor: Actor): Promise<CodexManagedSkillRecord[]> {
    return this.dependencies.repository.listManagedSkills({
      organizationId: actor.organizationId,
      ownerUserId: actor.id
    });
  }

  async readManagedSkillMdForAdmin(input: {
    skillId: string;
    organizationId?: string;
  }): Promise<{ skill: CodexManagedSkillRecord; content: string }> {
    const skill = await this.dependencies.repository.getManagedSkill(input.skillId);
    if (!skill) throw new Error("skill 不存在");
    if (input.organizationId && skill.organizationId && input.organizationId !== skill.organizationId) {
      throw new Error("不能查看其他组织的 skill");
    }
    const sourceDirectoryPath = await resolveSkillDirectoryPath(skill.publishedPath);
    const content = await fs.readFile(path.join(sourceDirectoryPath, "SKILL.md"), "utf8");
    return { skill, content };
  }

  async setManagedSkillStatus(input: {
    actor: Actor;
    skillId: string;
    status: "active" | "disabled" | "archived";
  }): Promise<CodexManagedSkillRecord> {
    const current = await this.dependencies.repository.getManagedSkill(input.skillId);
    if (!current) throw new Error("skill 不存在");
    return this.dependencies.repository.updateManagedSkill(current.id, {
      status: input.status,
      reviewedByUserId: input.actor.id,
      reviewedByDisplayName: input.actor.displayName,
      metadata: {
        ...(typeof current.metadata === "object" && current.metadata !== null ? (current.metadata as Record<string, unknown>) : {}),
        lastStatusChangedAt: new Date().toISOString(),
        lastStatusChangedByUserId: input.actor.id
      }
    });
  }

  async uninstallPrivateManagedSkill(input: RemoveManagedSkillInput): Promise<CodexManagedSkillRecord> {
    const current = await this.dependencies.repository.getManagedSkill(input.skillId);
    if (!current) throw new Error("skill 不存在");
    if (current.scope !== "private") {
      throw new Error("只有个人安装的 skill 可以由用户卸载");
    }
    if (current.ownerUserId !== input.actor.id) {
      throw new Error("无权卸载该 skill");
    }
    if (input.actor.organizationId && current.organizationId && input.actor.organizationId !== current.organizationId) {
      throw new Error("不能卸载其他组织的 skill");
    }
    return this.removeManagedSkillRecord({
      actor: input.actor,
      current,
      action: "user_uninstall",
      reason: input.reason
    });
  }

  async removeManagedSkillByAdmin(input: RemoveManagedSkillInput): Promise<CodexManagedSkillRecord> {
    const current = await this.dependencies.repository.getManagedSkill(input.skillId);
    if (!current) throw new Error("skill 不存在");
    if (input.actor.organizationId && current.organizationId && input.actor.organizationId !== current.organizationId) {
      throw new Error("不能删除其他组织的 skill");
    }
    return this.removeManagedSkillRecord({
      actor: input.actor,
      current,
      action: "admin_remove",
      reason: input.reason
    });
  }

  async shareManagedSkillToAgentModes(input: ShareManagedSkillInput): Promise<{
    managedSkill: CodexManagedSkillRecord;
    skillPackage: SkillPackageRecord;
  }> {
    const agentModeIds = Array.from(new Set((input.agentModeIds ?? []).map((id) => trimOrUndefined(id)).filter(Boolean))) as string[];
    if (agentModeIds.length === 0) {
      throw new Error("请选择至少一个 Agent Mode 作为共享范围");
    }

    const current = await this.dependencies.repository.getManagedSkill(input.skillId);
    if (!current) throw new Error("skill 不存在");
    if (input.actor.organizationId && current.organizationId && input.actor.organizationId !== current.organizationId) {
      throw new Error("不能共享其他组织的 skill");
    }
    const organizationId = current.organizationId ?? input.actor.organizationId;
    if (current.status !== "active") {
      throw new Error("只有 Active skill 可以共享");
    }

    const sourceDirectoryPath = await resolveSkillDirectoryPath(current.publishedPath);
    const validation = await this.validateSkillDirectory(sourceDirectoryPath);
    if (!validation.ok) {
      throw new Error(`Skill 校验失败：${validation.errors.join("; ")}`);
    }

    const skillMd = await fs.readFile(path.join(sourceDirectoryPath, "SKILL.md"), "utf8");
    const metadata = parseSkillMetadata(skillMd);
    const skillName = validation.metadata?.name ?? metadata.name ?? current.skillName;
    if (!skillName) throw new Error("Skill 缺少 name");
    const slug = slugify(skillName);
    const destinationPath = path.join(
      this.publishedSkillsRoot,
      "managed",
      sanitizePathSegment(organizationId ?? "global", "global"),
      slug
    );

    if (path.resolve(sourceDirectoryPath) !== path.resolve(destinationPath)) {
      const tempPath = `${destinationPath}.tmp-${Date.now()}`;
      await fs.rm(tempPath, { recursive: true, force: true });
      await copyDirectoryNoSymlinks(sourceDirectoryPath, tempPath);
      await fs.rm(destinationPath, { recursive: true, force: true });
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.rename(tempPath, destinationPath);
    }

    const checksum = await hashSkillDirectory(destinationPath);
    const existingShared = await this.dependencies.repository.findManagedSkillByName({
      organizationId,
      ownerUserId: current.ownerUserId,
      scope: "agent_mode",
      skillName
    });
    const version =
      existingShared && existingShared.checksum && existingShared.checksum !== checksum
        ? bumpPatchVersion(existingShared.version)
        : existingShared?.version || current.version || "1.0.0";
    const publishedAt = new Date();
    const currentMetadata = asRecord(current.metadata);
    const existingMetadata = asRecord(existingShared?.metadata);
    const managedSkill = await this.dependencies.repository.upsertManagedSkill({
      organizationId,
      ownerUserId: current.ownerUserId,
      scope: "agent_mode",
      skillName,
      slug,
      displayName: current.displayName || metadata.name || skillName,
      description: validation.metadata?.description ?? metadata.description ?? current.description,
      status: "active",
      version,
      checksum,
      publishedPath: destinationPath,
      sourceDraftId: current.sourceDraftId,
      createdByUserId: current.createdByUserId,
      createdByDisplayName: current.createdByDisplayName,
      createdByEmail: current.createdByEmail,
      lastEditedByUserId: current.lastEditedByUserId ?? current.ownerUserId,
      reviewedByUserId: input.actor.id,
      reviewedByDisplayName: input.actor.displayName,
      publishedByUserId: input.actor.id,
      publishedByDisplayName: input.actor.displayName,
      metadata: {
        ...existingMetadata,
        ...currentMetadata,
        generator: "skill-creator-share-v1",
        promotedFromManagedSkillId: current.id,
        promotedFromScope: current.scope,
        sourceDirectoryPath,
        sourceThreadId: stringFromMetadata(currentMetadata, "sourceThreadId")
      },
      publishedAt
    });
    await this.ensureManagedSkillCatalogEntry(managedSkill, destinationPath);

    const skillPackage = await this.ensureSkillPackageBinding({
      organizationId: managedSkill.organizationId,
      sourceId: managedSkill.id,
      sourceSlug: managedSkill.slug,
      displayName: managedSkill.displayName,
      managedSkillId: managedSkill.id,
      skillName,
      skillDescription: managedSkill.description,
      skillPackageId: input.skillPackageId,
      activationPrompt: input.activationPrompt
    });

    await this.ensureAgentModeBindings({
      sourceMetadata: managedSkill.metadata,
      skillPackageId: skillPackage.id,
      agentModeIds
    });

    return { managedSkill, skillPackage };
  }

  private async removeManagedSkillRecord(input: {
    actor: Actor;
    current: CodexManagedSkillRecord;
    action: "user_uninstall" | "admin_remove";
    reason?: string;
  }): Promise<CodexManagedSkillRecord> {
    if (input.current.status === "archived") {
      return input.current;
    }
    const removedAt = new Date();
    const previousMetadata = asRecord(input.current.metadata);
    const archivedPath = await moveDirectoryToArchive({
      sourcePath: input.current.publishedPath,
      activeRoot: this.publishedSkillsRoot,
      archiveRoot: this.archivedSkillsRoot
    });

    if (input.current.scope !== "private") {
      await this.removeManagedSkillFromSkillPackages(input.current);
    }

    return this.dependencies.repository.updateManagedSkill(input.current.id, {
      status: "archived",
      ...(archivedPath ? { publishedPath: archivedPath } : {}),
      reviewedByUserId: input.actor.id,
      reviewedByDisplayName: input.actor.displayName,
      metadata: {
        ...previousMetadata,
        removalAction: input.action,
        removedAt: removedAt.toISOString(),
        removedByUserId: input.actor.id,
        removedByDisplayName: input.actor.displayName,
        removalReason: trimOrUndefined(input.reason),
        previousPublishedPath: input.current.publishedPath,
        archivedPath
      }
    });
  }

  private async removeManagedSkillFromSkillPackages(managedSkill: CodexManagedSkillRecord): Promise<void> {
    const packages = await this.dependencies.skillPackages.list();
    for (const skillPackage of packages) {
      let changed = false;
      const nextItems = [];
      for (const item of skillPackage.items) {
        const nextBindings = item.runtimeBindings
          .filter((binding) => !managedSkillBindingMatches(binding, managedSkill))
          .map((binding) => ({
            runtimeType: binding.runtimeType,
            bindingType: binding.bindingType,
            bindingPayload: binding.bindingPayload
          }));
        if (nextBindings.length !== item.runtimeBindings.length) {
          changed = true;
        }
        if (nextBindings.length === 0) {
          continue;
        }
        nextItems.push({
          capabilityKey: item.capabilityKey,
          description: item.description,
          runtimeBindings: nextBindings
        });
      }
      if (changed) {
        await this.dependencies.skillPackages.replaceItems(skillPackage.id, nextItems);
      }
    }
  }

  async readDraftSkillMd(draftId: string): Promise<{ draft: CodexSkillDraftRecord; content: string }> {
    const draft = await this.requireDraft(draftId);
    const content = await fs.readFile(path.join(draft.draftPath, "SKILL.md"), "utf8");
    return { draft, content };
  }

  async updateDraftSkillMd(input: {
    actor: Actor;
    draftId: string;
    content: string;
  }): Promise<CodexSkillDraftRecord> {
    const draft = await this.requireDraft(input.draftId);
    if (draft.status === "published" || draft.status === "archived") {
      throw new Error("已发布或已归档的 skill 不能直接修改");
    }
    await fs.writeFile(path.join(draft.draftPath, "SKILL.md"), input.content, "utf8");
    const validation = await this.validateSkillDirectory(draft.draftPath);
    const metadata = parseSkillMetadata(input.content);
    return this.dependencies.repository.updateDraft(draft.id, {
      skillName: metadata.name ?? draft.skillName,
      slug: slugify(metadata.name ?? draft.slug),
      displayName: metadata.name ?? draft.displayName,
      description: metadata.description ?? draft.description,
      status: "pending_review",
      validation,
      metadata: {
        ...(typeof draft.metadata === "object" && draft.metadata !== null ? (draft.metadata as Record<string, unknown>) : {}),
        lastEditedByUserId: input.actor.id,
        lastEditedAt: new Date().toISOString()
      }
    });
  }

  async rejectDraft(input: { actor: Actor; draftId: string; reviewNote?: string }): Promise<CodexSkillDraftRecord> {
    const draft = await this.requireDraft(input.draftId);
    if (draft.status === "published") throw new Error("已发布的 skill 草稿不能驳回");
    return this.dependencies.repository.updateDraft(draft.id, {
      status: "rejected",
      reviewNote: input.reviewNote,
      reviewedByUserId: input.actor.id,
      reviewedByDisplayName: input.actor.displayName
    });
  }

  async requestChanges(input: { actor: Actor; draftId: string; reviewNote?: string }): Promise<CodexSkillDraftRecord> {
    const draft = await this.requireDraft(input.draftId);
    if (draft.status === "published") throw new Error("已发布的 skill 草稿不能要求修改");
    return this.dependencies.repository.updateDraft(draft.id, {
      status: "changes_requested",
      reviewNote: input.reviewNote,
      reviewedByUserId: input.actor.id,
      reviewedByDisplayName: input.actor.displayName
    });
  }

  async publishDraft(input: PublishDraftInput): Promise<{
    draft: CodexSkillDraftRecord;
    managedSkill: CodexManagedSkillRecord;
    skillPackage?: SkillPackageRecord;
  }> {
    const draft = await this.requireDraft(input.draftId);
    if (draft.status === "published") throw new Error("该 skill 草稿已经发布");
    const validation = await this.validateSkillDirectory(draft.draftPath);
    if (!validation.ok) {
      await this.dependencies.repository.updateDraft(draft.id, { validation });
      throw new Error(`Skill 校验失败：${validation.errors.join("; ")}`);
    }
    const skillName = validation.metadata?.name ?? draft.skillName;
    if (!skillName) throw new Error("Skill 缺少 name");
    const slug = slugify(skillName);
    const destinationPath = path.join(
      this.publishedSkillsRoot,
      "managed",
      sanitizePathSegment(draft.organizationId ?? "global", "global"),
      slug
    );
    const tempPath = `${destinationPath}.tmp-${Date.now()}`;
    await fs.rm(tempPath, { recursive: true, force: true });
    await copyDirectoryNoSymlinks(draft.draftPath, tempPath);
    await fs.rm(destinationPath, { recursive: true, force: true });
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.rename(tempPath, destinationPath);

    const publishedAt = new Date();
    const checksum = await hashSkillDirectory(draft.draftPath);
    const managedSkill = await this.dependencies.repository.upsertManagedSkill({
      organizationId: draft.organizationId,
      ownerUserId: draft.createdByUserId,
      scope: "agent_mode",
      skillName,
      slug,
      displayName: draft.displayName || skillName,
      description: validation.metadata?.description ?? draft.description,
      status: "active",
      version: draft.version || "1.0.0",
      checksum,
      publishedPath: destinationPath,
      sourceDraftId: draft.id,
      createdByUserId: draft.createdByUserId,
      createdByDisplayName: draft.createdByDisplayName,
      createdByEmail: draft.createdByEmail,
      lastEditedByUserId: draft.createdByUserId,
      reviewedByUserId: input.actor.id,
      reviewedByDisplayName: input.actor.displayName,
      publishedByUserId: input.actor.id,
      publishedByDisplayName: input.actor.displayName,
      metadata: {
        draftId: draft.id,
        reviewNote: trimOrUndefined(input.reviewNote),
        sourceThreadId: draft.sourceThreadId
      },
      publishedAt
    });
    await this.ensureManagedSkillCatalogEntry(managedSkill, destinationPath);

    const draftMetadata = asRecord(draft.metadata);
    const skillPackage = await this.ensureSkillPackageBinding({
      organizationId: draft.organizationId,
      sourceId: draft.id,
      sourceSlug: draft.slug,
      displayName: draft.displayName,
      managedSkillId: managedSkill.id,
      skillName,
      skillDescription: validation.metadata?.description ?? draft.description,
      skillPackageId: input.skillPackageId ?? stringFromMetadata(draftMetadata, "skillPackageId"),
      activationPrompt: input.activationPrompt
    });

    await this.ensureAgentModeBindings({
      sourceMetadata: draft.metadata,
      skillPackageId: skillPackage.id,
      agentModeIds: input.agentModeIds
    });

    const updatedDraft = await this.dependencies.repository.updateDraft(draft.id, {
      skillName,
      slug,
      description: validation.metadata?.description ?? draft.description,
      status: "published",
      validation,
      reviewNote: input.reviewNote,
      reviewedByUserId: input.actor.id,
      reviewedByDisplayName: input.actor.displayName,
      publishedByUserId: input.actor.id,
      publishedByDisplayName: input.actor.displayName,
      publishedAt,
      publishedPath: destinationPath,
      metadata: {
        ...draftMetadata,
        managedSkillId: managedSkill.id,
        skillPackageId: skillPackage.id
      }
    });

    return {
      draft: updatedDraft,
      managedSkill,
      skillPackage
    };
  }

  async validateSkillDirectory(rootPath: string): Promise<CodexSkillValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const normalizedRoot = path.resolve(rootPath);
    const skillMdPath = path.join(normalizedRoot, "SKILL.md");
    const skillMdExists = await pathExists(skillMdPath);
    if (!skillMdExists) {
      errors.push("缺少 SKILL.md");
      return { ok: false, errors, warnings };
    }

    let fileCount = 0;
    let totalBytes = 0;
    let hasScripts = false;

    const walk = async (currentPath: string) => {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(currentPath, entry.name);
        const relative = path.relative(normalizedRoot, entryPath);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
          errors.push(`非法路径：${relative}`);
          continue;
        }
        const stat = await fs.lstat(entryPath);
        if (stat.isSymbolicLink()) {
          errors.push(`禁止 symlink：${relative}`);
          continue;
        }
        if (entry.isDirectory()) {
          if (relative === "scripts" || relative.startsWith(`scripts${path.sep}`)) hasScripts = true;
          await walk(entryPath);
          continue;
        }
        if (!entry.isFile()) continue;
        fileCount += 1;
        totalBytes += stat.size;
      }
    };

    await walk(normalizedRoot);

    const skillMd = await fs.readFile(skillMdPath, "utf8");
    const lines = skillMd.split(/\r?\n/);
    if (lines.length > MAX_SKILL_MD_LINES) warnings.push(`SKILL.md 超过 ${MAX_SKILL_MD_LINES} 行，建议拆分 references`);
    const metadata = parseSkillMetadata(skillMd);
    if (!metadata.name) errors.push("SKILL.md frontmatter 缺少 name");
    if (!metadata.description) errors.push("SKILL.md frontmatter 缺少 description");
    if (metadata.name && !SAFE_SKILL_NAME_RE.test(metadata.name)) {
      errors.push("SKILL.md name 只能包含字母、数字、点、下划线和连字符，长度 2-64");
    }
    if (metadata.name?.startsWith(".system") || metadata.name === "skill-creator") {
      errors.push("禁止覆盖系统 skill");
    }
    if (hasScripts) {
      warnings.push("包含 scripts 目录，发布前请确认脚本安全性");
    }

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      metadata: {
        name: metadata.name,
        description: metadata.description,
        hasScripts,
        fileCount,
        totalBytes
      }
    };
  }

  private async requireDraft(draftId: string): Promise<CodexSkillDraftRecord> {
    const draft = await this.dependencies.repository.getDraft(draftId);
    if (!draft) throw new Error("skill 草稿不存在");
    return draft;
  }

  private async ensureManagedSkillCatalogEntry(skill: CodexManagedSkillRecord, directoryPath: string): Promise<void> {
    if (!this.dependencies.skillCatalog) return;
    const presentation = await readInitialSkillPresentation({
      directoryPath,
      skillName: skill.skillName,
      displayName: skill.displayName,
      description: skill.description
    });
    await this.dependencies.skillCatalog.ensureManagedSkillEntry({
      skill,
      defaultLocale: presentation.defaultLocale,
      initialTranslation: presentation.content
    });
  }

  private async ensureSkillPackageBinding(input: {
    organizationId?: string;
    sourceId: string;
    sourceSlug?: string;
    displayName?: string;
    managedSkillId: string;
    skillName: string;
    skillDescription?: string;
    skillPackageId?: string;
    activationPrompt?: string;
  }): Promise<SkillPackageRecord> {
    const activationPrompt =
      trimOrUndefined(input.activationPrompt) ??
      `当用户需要执行 ${input.displayName || input.skillName} 这类可复用流程时使用该 skill。`;
    let skillPackage = input.skillPackageId ? await this.dependencies.skillPackages.get(input.skillPackageId) : undefined;
    if (!skillPackage) {
      skillPackage = await this.dependencies.skillPackages.create({
        organizationId: input.organizationId,
        name: `${input.displayName || input.skillName} Skill Package`,
        slug: `skill-${input.sourceSlug || slugify(input.skillName)}-${hashText(input.sourceId)}`,
        description: input.skillDescription,
        status: "active",
        visibleToUsers: true
      });
    }

    const existingItems = (skillPackage.items ?? []).map((item) => ({
      capabilityKey: item.capabilityKey,
      description: item.description,
      runtimeBindings: item.runtimeBindings.map((binding) => ({
        runtimeType: binding.runtimeType,
        bindingType: binding.bindingType,
        bindingPayload: binding.bindingPayload
      }))
    }));
    const withoutThisSkill = existingItems.filter(
      (item) =>
        !item.runtimeBindings.some((binding) => {
          if (binding.runtimeType !== "codex" || binding.bindingType !== "codex_skill") return false;
          const payload = binding.bindingPayload as Record<string, unknown> | null;
          if (!payload || typeof payload !== "object") return false;
          return payload.managedSkillId === input.managedSkillId || payload.skillName === input.skillName;
        })
    );
    const nextItems = [
      ...withoutThisSkill,
      {
        capabilityKey: `codex-skill:${input.skillName}`,
        description: input.skillDescription,
        runtimeBindings: [
          {
            runtimeType: "codex",
            bindingType: "codex_skill",
            bindingPayload: {
              managedSkillId: input.managedSkillId,
              skillName: input.skillName,
              activationPrompt
            }
          }
        ]
      }
    ];
    return this.dependencies.skillPackages.replaceItems(skillPackage.id, nextItems);
  }

  private async ensureAgentModeBindings(input: {
    sourceMetadata?: unknown;
    skillPackageId: string;
    agentModeIds?: string[];
  }): Promise<void> {
    const metadata = asRecord(input.sourceMetadata);
    const metadataModeId = typeof metadata.modeId === "string" ? trimOrUndefined(metadata.modeId) : undefined;
    const agentModeIds = Array.from(new Set([...(input.agentModeIds ?? []), ...(metadataModeId ? [metadataModeId] : [])]));
    for (const agentModeId of agentModeIds) {
      const mode = await this.dependencies.agentModes.get(agentModeId);
      if (!mode) continue;
      const nextIds = Array.from(new Set([...mode.skillPackages.map((item) => item.skillPackageId), input.skillPackageId]));
      await this.dependencies.agentModes.replaceSkillPackages(mode.id, nextIds);
    }
  }
}
