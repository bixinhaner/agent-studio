import fs from "node:fs/promises";
import path from "node:path";

export type NativeCodexSkillRecord = {
  name: string;
  description?: string;
  sourcePath: string;
  relativePath: string;
  system: boolean;
};

export type MaterializedCodexSkillInput = {
  name: string;
  sourcePath?: string;
  relativePath?: string;
  system?: boolean;
};

type NativeCodexSkillServiceOptions = {
  baseHome: string;
  sessionHomeRoot: string;
};

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const MAX_SKILL_SCAN_DEPTH = 5;

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function sanitizePathSegment(value: string, fallback: string): string {
  const normalized = value
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
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
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    metadata[key] = value;
  }

  return {
    name: parseFrontmatterValue(metadata.name),
    description: parseFrontmatterValue(metadata.description)
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

async function replaceSymlinkOrCopy(sourcePath: string, destinationPath: string): Promise<void> {
  await fs.rm(destinationPath, { recursive: true, force: true });
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  try {
    await fs.symlink(sourcePath, destinationPath, "dir");
  } catch {
    await fs.cp(sourcePath, destinationPath, { recursive: true });
  }
}

async function chmodDirectories(rootPath: string, mode: number): Promise<void> {
  const stat = await fs.lstat(rootPath).catch(() => undefined);
  if (!stat || !stat.isDirectory()) return;
  await fs.chmod(rootPath, mode).catch(() => undefined);

  const entries = await fs.readdir(rootPath, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    await chmodDirectories(path.join(rootPath, entry.name), mode);
  }
}

async function linkFileIfPresent(sourcePath: string, destinationPath: string): Promise<void> {
  if (!(await pathExists(sourcePath))) return;
  await fs.rm(destinationPath, { recursive: true, force: true });
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  try {
    await fs.symlink(sourcePath, destinationPath);
  } catch {
    await fs.copyFile(sourcePath, destinationPath);
  }
}

export class NativeCodexSkillService {
  private readonly baseHome: string;
  private readonly skillsRoot: string;
  private readonly sessionHomeRoot: string;

  constructor(options: NativeCodexSkillServiceOptions) {
    this.baseHome = path.resolve(options.baseHome);
    this.skillsRoot = path.join(this.baseHome, "skills");
    this.sessionHomeRoot = path.resolve(options.sessionHomeRoot);
  }

  getBaseHome(): string {
    return this.baseHome;
  }

  getSkillsRoot(): string {
    return this.skillsRoot;
  }

  async list(): Promise<NativeCodexSkillRecord[]> {
    const records: NativeCodexSkillRecord[] = [];
    await this.collectSkills(this.skillsRoot, 0, records);

    const byName = new Map<string, NativeCodexSkillRecord>();
    for (const record of records) {
      if (!record.name || byName.has(record.name)) continue;
      byName.set(record.name, record);
    }

    return [...byName.values()].sort((left, right) => {
      if (left.system !== right.system) return Number(left.system) - Number(right.system);
      return left.name.localeCompare(right.name, "en", { sensitivity: "base", numeric: true });
    });
  }

  async materializeSessionHome(input: {
    scopeId: string;
    enabledSkills: MaterializedCodexSkillInput[];
  }): Promise<string> {
    const scopeId = sanitizePathSegment(input.scopeId, "session");
    const sessionHome = path.join(this.sessionHomeRoot, scopeId);
    const sessionSkillsRoot = path.join(sessionHome, "skills");
    const catalog = await this.list();
    const byName = new Map(catalog.map((skill) => [skill.name, skill] as const));
    const enabled: Array<{ name: string; sourcePath?: string; relativePath?: string; system: boolean }> = [];
    for (const skill of input.enabledSkills) {
      const name = trimOrUndefined(skill.name);
      if (!name) continue;
      enabled.push({
        name,
        sourcePath: trimOrUndefined(skill.sourcePath),
        relativePath: trimOrUndefined(skill.relativePath),
        system: skill.system === true
      });
    }

    await fs.mkdir(sessionHome, { recursive: true });
    await linkFileIfPresent(path.join(this.baseHome, "auth.json"), path.join(sessionHome, "auth.json"));
    await linkFileIfPresent(path.join(this.baseHome, "config.toml"), path.join(sessionHome, "config.toml"));
    await chmodDirectories(sessionSkillsRoot, 0o755);
    await fs.rm(sessionSkillsRoot, { recursive: true, force: true });
    await fs.mkdir(sessionSkillsRoot, { recursive: true });

    for (const requestedSkill of enabled) {
      if (requestedSkill.sourcePath) {
        const relativePath = requestedSkill.relativePath ?? sanitizePathSegment(requestedSkill.name, "skill");
        const visibleRelativePath = requestedSkill.system ? sanitizePathSegment(requestedSkill.name, "skill") : relativePath;
        await replaceSymlinkOrCopy(requestedSkill.sourcePath, path.join(sessionSkillsRoot, visibleRelativePath));
        if (requestedSkill.system && relativePath !== visibleRelativePath) {
          await replaceSymlinkOrCopy(requestedSkill.sourcePath, path.join(sessionSkillsRoot, relativePath));
        }
        continue;
      }

      const skill = byName.get(requestedSkill.name);
      if (!skill) continue;
      const visibleRelativePath = skill.system ? sanitizePathSegment(skill.name, "skill") : skill.relativePath;
      await replaceSymlinkOrCopy(skill.sourcePath, path.join(sessionSkillsRoot, visibleRelativePath));
      if (skill.system && skill.relativePath !== visibleRelativePath) {
        await replaceSymlinkOrCopy(skill.sourcePath, path.join(sessionSkillsRoot, skill.relativePath));
      }
    }

    // Codex auto-installs built-in .system skills into writable CODEX_HOME roots.
    // Lock this session skills root so only Agent Studio's selected links are visible.
    await chmodDirectories(sessionSkillsRoot, 0o555);
    return sessionHome;
  }

  private async collectSkills(currentPath: string, depth: number, records: NativeCodexSkillRecord[]): Promise<void> {
    if (depth > MAX_SKILL_SCAN_DEPTH) return;
    let entries;
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    const skillFilePath = path.join(currentPath, "SKILL.md");
    const skillFile = entries.find((entry) => entry.isFile() && entry.name === "SKILL.md");
    if (skillFile) {
      const content = await fs.readFile(skillFilePath, "utf8").catch(() => "");
      const metadata = parseSkillMetadata(content);
      const relativePath = path.relative(this.skillsRoot, currentPath).replace(/\\/g, "/");
      const fallbackName = path.basename(currentPath);
      const name = trimOrUndefined(metadata.name) ?? fallbackName;
      records.push({
        name,
        description: trimOrUndefined(metadata.description),
        sourcePath: currentPath,
        relativePath,
        system: relativePath === ".system" || relativePath.startsWith(".system/")
      });
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (depth === 0 && entry.name === "user") continue;
      await this.collectSkills(path.join(currentPath, entry.name), depth + 1, records);
    }
  }
}
