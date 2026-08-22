import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type NativeCodexSkillRecord = {
  name: string;
  description?: string;
  sourcePath: string;
  relativePath: string;
  system: boolean;
};

export type NativeCodexSkillContent = {
  skill: NativeCodexSkillRecord;
  content: string;
};

export type MaterializedCodexSkillInput = {
  name: string;
  sourcePath?: string;
  relativePath?: string;
  system?: boolean;
};

export type SharedPluginReconciliation = {
  changed: boolean;
  fingerprint: string;
  expectedPlugins: string[];
  mountedPlugins: string[];
};

export type CodexHomeCapabilityReconciliation = {
  changed: boolean;
  fingerprint: string;
  skillFingerprint: string;
  pluginFingerprint: string;
  expectedSkills: string[];
  mountedSkills: string[];
  expectedPlugins: string[];
  mountedPlugins: string[];
};

type NativeCodexSkillServiceOptions = {
  baseHome: string;
  sessionHomeRoot: string;
  sharedPluginMarketplaces?: string[];
  sharedPluginNames?: string[];
};

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const MAX_SKILL_SCAN_DEPTH = 5;
const DEFAULT_SHARED_PLUGIN_MARKETPLACES = ["agentstudio-office"];
const DEFAULT_SHARED_PLUGIN_NAMES = [
  "documents",
  "pdf",
  "presentations",
  "spreadsheets",
  "visualize"
];

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

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, (_key, currentValue) => {
      if (currentValue && typeof currentValue === "object" && !Array.isArray(currentValue)) {
        const record = currentValue as Record<string, unknown>;
        return Object.keys(record)
          .sort((left, right) => left.localeCompare(right))
          .reduce<Record<string, unknown>>((acc, key) => {
            acc[key] = record[key];
            return acc;
          }, {});
      }
      return currentValue;
    });
  } catch {
    return String(value);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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

type ResolvedMaterializedSkill = {
  name: string;
  sourcePath?: string;
  relativePath: string;
  visibleRelativePath: string;
  system: boolean;
  instructionDigest: string;
};

async function instructionDigestForSkill(sourcePath: string | undefined): Promise<string> {
  if (!sourcePath) return "missing";
  const content = await fs.readFile(path.join(sourcePath, "SKILL.md"), "utf8").catch(() => undefined);
  return content === undefined ? "missing" : sha256(content);
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

async function ensureRuntimeSkillDirectories(sessionSkillsRoot: string): Promise<void> {
  await fs.mkdir(sessionSkillsRoot, { recursive: true });
  await fs.chmod(sessionSkillsRoot, 0o755).catch(() => undefined);

  const systemSkillsRoot = path.join(sessionSkillsRoot, ".system");
  await fs.mkdir(systemSkillsRoot, { recursive: true });
  await chmodDirectories(systemSkillsRoot, 0o755);
}

async function readJsonFile(filePath: string): Promise<unknown | undefined> {
  const content = await fs.readFile(filePath, "utf8").catch(() => undefined);
  if (content === undefined) return undefined;
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return undefined;
  }
}

async function withDirectoryLock<T>(lockPath: string, run: () => Promise<T>): Promise<T> {
  const staleAfterMs = 10 * 60 * 1000;
  const startedAt = Date.now();
  while (true) {
    try {
      await fs.mkdir(lockPath);
      break;
    } catch (error) {
      const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "";
      if (code !== "EEXIST") throw error;
      const stat = await fs.stat(lockPath).catch(() => undefined);
      if (stat && Date.now() - stat.mtimeMs > staleAfterMs) {
        await fs.rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
        continue;
      }
      if (Date.now() - startedAt > staleAfterMs) {
        throw new Error(`Timed out waiting for Codex home materialization lock: ${lockPath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  try {
    return await run();
  } finally {
    await fs.rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function linkFileIfPresent(sourcePath: string, destinationPath: string): Promise<void> {
  if (!(await pathExists(sourcePath))) return;
  const destinationStat = await fs.lstat(destinationPath).catch(() => undefined);
  if (destinationStat?.isSymbolicLink()) {
    const target = await fs.readlink(destinationPath).catch(() => undefined);
    if (target && path.resolve(path.dirname(destinationPath), target) === path.resolve(sourcePath)) {
      return;
    }
  }
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
  private readonly sharedPluginMarketplaces: string[];
  private readonly sharedPluginNames: Set<string>;

  constructor(options: NativeCodexSkillServiceOptions) {
    this.baseHome = path.resolve(options.baseHome);
    this.skillsRoot = path.join(this.baseHome, "skills");
    this.sessionHomeRoot = path.resolve(options.sessionHomeRoot);
    this.sharedPluginMarketplaces = [
      ...new Set(
        (options.sharedPluginMarketplaces ?? DEFAULT_SHARED_PLUGIN_MARKETPLACES)
          .map((name) => trimOrUndefined(name))
          .filter((name): name is string => Boolean(name))
          .map((name) => sanitizePathSegment(name, "marketplace"))
      )
    ];
    this.sharedPluginNames = new Set(
      (options.sharedPluginNames ?? DEFAULT_SHARED_PLUGIN_NAMES)
        .map((name) => trimOrUndefined(name)?.toLowerCase())
        .filter((name): name is string => Boolean(name))
    );
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

  async readSkillContent(name: string): Promise<NativeCodexSkillContent> {
    const normalizedName = trimOrUndefined(name);
    if (!normalizedName) throw new Error("skill 名称不能为空");
    const skill = (await this.list()).find((item) => item.name === normalizedName);
    if (!skill) throw new Error("Codex Skill 不存在");
    const content = await fs.readFile(path.join(skill.sourcePath, "SKILL.md"), "utf8");
    return { skill, content };
  }

  async materializeSessionHome(input: {
    scopeId?: string;
    scopeSegments?: string[];
    enabledSkills: MaterializedCodexSkillInput[];
  }): Promise<string> {
    const scopeSegments = input.scopeSegments?.length
      ? input.scopeSegments.map((segment, index) => sanitizePathSegment(segment, index === 0 ? "scope" : "segment"))
      : [sanitizePathSegment(input.scopeId ?? "", "session")];
    const sessionHome = path.join(this.sessionHomeRoot, ...scopeSegments);
    await fs.mkdir(sessionHome, { recursive: true });
    await this.reconcileSessionHomeCapabilities({
      sessionHome,
      scopeSegments,
      enabledSkills: input.enabledSkills
    });
    return sessionHome;
  }

  async reconcileSessionHomeCapabilities(input: {
    sessionHome: string;
    scopeSegments?: string[];
    enabledSkills: MaterializedCodexSkillInput[];
  }): Promise<CodexHomeCapabilityReconciliation> {
    const sessionHome = path.resolve(input.sessionHome);
    await fs.mkdir(sessionHome, { recursive: true });
    return await withDirectoryLock(path.join(sessionHome, ".materialize.lock"), () =>
      this.reconcileSessionHomeCapabilitiesUnlocked({
        sessionHome,
        scopeSegments: input.scopeSegments,
        enabledSkills: input.enabledSkills
      })
    );
  }

  private async reconcileSessionHomeCapabilitiesUnlocked(input: {
    sessionHome: string;
    scopeSegments?: string[];
    enabledSkills: MaterializedCodexSkillInput[];
  }): Promise<CodexHomeCapabilityReconciliation> {
    const catalog = await this.list();
    const byName = new Map(catalog.map((skill) => [skill.name, skill] as const));
    const byRequestedName = new Map<string, MaterializedCodexSkillInput>();
    for (const skill of input.enabledSkills) {
      const name = trimOrUndefined(skill.name);
      if (name) byRequestedName.set(name, skill);
    }

    const resolvedSkills: ResolvedMaterializedSkill[] = [];
    for (const [name, requestedSkill] of byRequestedName) {
      const catalogSkill = byName.get(name);
      const sourcePath = trimOrUndefined(requestedSkill.sourcePath) ?? catalogSkill?.sourcePath;
      const system = requestedSkill.system === true || catalogSkill?.system === true;
      const relativePath =
        trimOrUndefined(requestedSkill.relativePath) ??
        catalogSkill?.relativePath ??
        sanitizePathSegment(name, "skill");
      resolvedSkills.push({
        name,
        sourcePath,
        relativePath,
        visibleRelativePath: system ? sanitizePathSegment(name, "skill") : relativePath,
        system,
        instructionDigest: await instructionDigestForSkill(sourcePath)
      });
    }
    resolvedSkills.sort((left, right) => left.name.localeCompare(right.name));

    const sessionSkillsRoot = path.join(input.sessionHome, "skills");
    const metadataDir = path.join(input.sessionHome, ".agent-studio");
    const manifestPath = path.join(metadataDir, "manifest.json");
    const currentManifest = await readJsonFile(manifestPath);
    const currentManifestRecord =
      currentManifest && typeof currentManifest === "object" && !Array.isArray(currentManifest)
        ? currentManifest as Record<string, unknown>
        : undefined;
    const pluginReconciliation = await this.reconcileSharedPluginCachesUnlocked(input.sessionHome);
    const skillSnapshot = resolvedSkills.map((skill) => ({
      name: skill.name,
      sourcePath: skill.sourcePath,
      relativePath: skill.relativePath,
      visibleRelativePath: skill.visibleRelativePath,
      system: skill.system,
      instructionDigest: skill.instructionDigest
    }));
    const skillFingerprint = sha256(stableJson(skillSnapshot));
    const fingerprint = sha256(stableJson({
      skills: skillFingerprint,
      plugins: pluginReconciliation.fingerprint
    }));
    const scopeSegments = input.scopeSegments?.length
      ? input.scopeSegments
      : Array.isArray(currentManifestRecord?.scopeSegments)
        ? currentManifestRecord.scopeSegments.filter((item): item is string => typeof item === "string")
        : [];
    const manifest = {
      version: 2,
      scopeSegments,
      enabledSkills: skillSnapshot,
      capabilityFingerprint: fingerprint,
      pluginFingerprint: pluginReconciliation.fingerprint
    };
    const previousSkillFingerprint =
      typeof currentManifestRecord?.capabilityFingerprint === "string"
        ? typeof currentManifestRecord?.enabledSkills === "object"
          ? sha256(stableJson(currentManifestRecord.enabledSkills))
          : undefined
        : undefined;
    const skillsChanged =
      previousSkillFingerprint !== skillFingerprint ||
      !(await pathExists(sessionSkillsRoot));

    await linkFileIfPresent(path.join(this.baseHome, "auth.json"), path.join(input.sessionHome, "auth.json"));
    await linkFileIfPresent(path.join(this.baseHome, "config.toml"), path.join(input.sessionHome, "config.toml"));

    if (skillsChanged) {
      await chmodDirectories(sessionSkillsRoot, 0o755);
      await fs.mkdir(sessionSkillsRoot, { recursive: true });
      for (const entry of await fs.readdir(sessionSkillsRoot, { withFileTypes: true }).catch(() => [])) {
        if (entry.name === ".system") continue;
        await fs.rm(path.join(sessionSkillsRoot, entry.name), { recursive: true, force: true });
      }
      for (const skill of resolvedSkills) {
        if (!skill.sourcePath || skill.instructionDigest === "missing") continue;
        await replaceSymlinkOrCopy(skill.sourcePath, path.join(sessionSkillsRoot, skill.visibleRelativePath));
        if (skill.system && skill.relativePath !== skill.visibleRelativePath) {
          await replaceSymlinkOrCopy(skill.sourcePath, path.join(sessionSkillsRoot, skill.relativePath));
        }
      }
    }

    // Codex 0.139+ may delete and rebuild skills/.system during bootstrap.
    // Keep the parent writable and never remove the runtime-owned .system cache
    // while reconciling Agent Studio-managed capabilities.
    await ensureRuntimeSkillDirectories(sessionSkillsRoot);
    const manifestChanged = stableJson(currentManifest) !== stableJson(manifest);
    if (manifestChanged) {
      await fs.mkdir(metadataDir, { recursive: true });
      await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    }

    return {
      changed: skillsChanged || pluginReconciliation.changed || manifestChanged,
      fingerprint,
      skillFingerprint,
      pluginFingerprint: pluginReconciliation.fingerprint,
      expectedSkills: resolvedSkills.map((skill) => skill.name),
      mountedSkills: resolvedSkills
        .filter((skill) => skill.sourcePath && skill.instructionDigest !== "missing")
        .map((skill) => skill.name),
      expectedPlugins: pluginReconciliation.expectedPlugins,
      mountedPlugins: pluginReconciliation.mountedPlugins
    };
  }

  async reconcileSharedPluginCaches(sessionHome: string): Promise<SharedPluginReconciliation> {
    const normalizedHome = path.resolve(sessionHome);
    await fs.mkdir(normalizedHome, { recursive: true });
    return await withDirectoryLock(path.join(normalizedHome, ".materialize.lock"), () =>
      this.reconcileSharedPluginCachesUnlocked(normalizedHome)
    );
  }

  private async reconcileSharedPluginCachesUnlocked(sessionHome: string): Promise<SharedPluginReconciliation> {
    const basePluginCacheRoot = path.join(this.baseHome, "plugins", "cache");
    const sessionPluginCacheRoot = path.join(sessionHome, "plugins", "cache");
    let changed = false;
    const expectedPlugins: string[] = [];
    const mountedPlugins: string[] = [];
    const pluginGenerations: Array<{ plugin: string; versions: string[] }> = [];
    for (const marketplace of this.sharedPluginMarketplaces) {
      const sourcePath = path.join(basePluginCacheRoot, marketplace);
      if (!(await pathExists(sourcePath))) continue;

      const destinationPath = path.join(sessionPluginCacheRoot, marketplace);
      const destinationStat = await fs.lstat(destinationPath).catch(() => undefined);
      if (destinationStat?.isSymbolicLink() || (destinationStat && !destinationStat.isDirectory())) {
        await fs.rm(destinationPath, { recursive: true, force: true });
        changed = true;
      }
      if (!destinationStat) changed = true;
      await fs.mkdir(destinationPath, { recursive: true });

      const sourceEntries = (await fs.readdir(sourcePath, { withFileTypes: true }).catch(() => []))
        .filter((entry) =>
          (entry.isDirectory() || entry.isSymbolicLink()) &&
          this.sharedPluginNames.has(entry.name.toLowerCase())
        );
      const expectedEntryNames = new Set(sourceEntries.map((entry) => entry.name));
      for (const entry of await fs.readdir(destinationPath, { withFileTypes: true }).catch(() => [])) {
        if (!expectedEntryNames.has(entry.name)) {
          await fs.rm(path.join(destinationPath, entry.name), { recursive: true, force: true });
          changed = true;
        }
      }
      for (const entry of sourceEntries) {
        const pluginId = `${marketplace}/${entry.name}`;
        expectedPlugins.push(pluginId);
        const pluginSourcePath = path.join(sourcePath, entry.name);
        const versions = (await fs.readdir(pluginSourcePath, { withFileTypes: true }).catch(() => []))
          .filter((version) => version.isDirectory() || version.isSymbolicLink())
          .map((version) => version.name)
          .sort((left, right) => left.localeCompare(right));
        pluginGenerations.push({ plugin: pluginId, versions });
        const pluginDestinationPath = path.join(destinationPath, entry.name);
        const pluginDestinationStat = await fs.lstat(pluginDestinationPath).catch(() => undefined);
        if (pluginDestinationStat?.isSymbolicLink()) {
          const target = await fs.readlink(pluginDestinationPath).catch(() => undefined);
          if (
            target &&
            path.resolve(path.dirname(pluginDestinationPath), target) === pluginSourcePath
          ) {
            mountedPlugins.push(pluginId);
            continue;
          }
        }
        await replaceSymlinkOrCopy(
          pluginSourcePath,
          pluginDestinationPath
        );
        changed = true;
        mountedPlugins.push(pluginId);
      }
    }
    expectedPlugins.sort((left, right) => left.localeCompare(right));
    mountedPlugins.sort((left, right) => left.localeCompare(right));
    pluginGenerations.sort((left, right) => left.plugin.localeCompare(right.plugin));
    return {
      changed,
      fingerprint: sha256(stableJson({ expectedPlugins, mountedPlugins, pluginGenerations })),
      expectedPlugins,
      mountedPlugins
    };
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
      // User-owned and managed skills are catalogued through CodexSkillRepository.
      // Scanning either subtree as native would expose the same skill a second time
      // and incorrectly label the managed copy as a platform skill.
      if (depth === 0 && (entry.name === "user" || entry.name === "managed")) continue;
      await this.collectSkills(path.join(currentPath, entry.name), depth + 1, records);
    }
  }
}
