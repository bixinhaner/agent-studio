import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_VISIBLE_PLUGIN_NAMES = [
  "documents",
  "pdf",
  "presentations",
  "spreadsheets",
  "product-design",
  "visualize"
] as const;

type PluginManifest = {
  name?: unknown;
  version?: unknown;
  description?: unknown;
  skills?: unknown;
  interface?: {
    displayName?: unknown;
    shortDescription?: unknown;
    longDescription?: unknown;
    developerName?: unknown;
    category?: unknown;
    capabilities?: unknown;
    defaultPrompt?: unknown;
  };
};

export type InstalledPluginRecord = {
  name: string;
  pluginRef: string;
  marketplace: string;
  version: string;
  sourcePath: string;
  description?: string;
  displayName: string;
  shortDescription?: string;
  longDescription?: string;
  developerName?: string;
  category?: string;
  capabilities: string[];
  defaultPrompts: string[];
  skillNames: string[];
  enabled: true;
  readiness: "ready";
};

type InstalledPluginServiceOptions = {
  baseHome: string;
  executable?: string;
  visiblePluginNames?: string[];
  cacheTtlMs?: number;
};

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter((item): item is string => Boolean(item));
}

function parseInstalledPluginLine(line: string): {
  pluginRef: string;
  version: string;
  sourcePath: string;
} | undefined {
  const match = line.match(/^(\S+@\S+)\s+installed,\s*enabled\s+(\S+)\s+(.+?)\s*$/);
  if (!match) return undefined;
  return {
    pluginRef: match[1],
    version: match[2],
    sourcePath: match[3]
  };
}

async function listSkillNames(pluginPath: string, skillsPath: string | undefined): Promise<string[]> {
  const root = path.resolve(pluginPath, skillsPath ?? "skills");
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }));
}

export class InstalledPluginService {
  private readonly baseHome: string;
  private readonly executable: string;
  private readonly visiblePluginNames: Set<string>;
  private readonly cacheTtlMs: number;
  private cached?: { expiresAt: number; records: InstalledPluginRecord[] };

  constructor(options: InstalledPluginServiceOptions) {
    this.baseHome = path.resolve(options.baseHome);
    this.executable = text(options.executable) ?? "codex";
    this.visiblePluginNames = new Set(
      (options.visiblePluginNames?.length ? options.visiblePluginNames : [...DEFAULT_VISIBLE_PLUGIN_NAMES])
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean)
    );
    this.cacheTtlMs = options.cacheTtlMs ?? 30_000;
  }

  async list(): Promise<InstalledPluginRecord[]> {
    if (this.cached && this.cached.expiresAt > Date.now()) {
      return this.cached.records.map((record) => ({ ...record }));
    }

    const { stdout } = await execFileAsync(this.executable, ["plugin", "list"], {
      env: {
        ...process.env,
        CODEX_HOME: this.baseHome
      },
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024
    });
    const records: InstalledPluginRecord[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      const installed = parseInstalledPluginLine(line);
      if (!installed) continue;
      const separator = installed.pluginRef.lastIndexOf("@");
      const name = installed.pluginRef.slice(0, separator).trim();
      const marketplace = installed.pluginRef.slice(separator + 1).trim();
      if (!name || !marketplace || !this.visiblePluginNames.has(name.toLowerCase())) continue;

      const manifestPath = path.join(installed.sourcePath, ".codex-plugin", "plugin.json");
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as PluginManifest;
      const manifestName = text(manifest.name) ?? name;
      const manifestVersion = text(manifest.version) ?? installed.version;
      const interfaceConfig = manifest.interface ?? {};
      records.push({
        name: manifestName,
        pluginRef: installed.pluginRef,
        marketplace,
        version: manifestVersion,
        sourcePath: installed.sourcePath,
        description: text(manifest.description),
        displayName: text(interfaceConfig.displayName) ?? manifestName,
        shortDescription: text(interfaceConfig.shortDescription),
        longDescription: text(interfaceConfig.longDescription),
        developerName: text(interfaceConfig.developerName),
        category: text(interfaceConfig.category),
        capabilities: stringList(interfaceConfig.capabilities),
        defaultPrompts: stringList(interfaceConfig.defaultPrompt),
        skillNames: await listSkillNames(installed.sourcePath, text(manifest.skills)),
        enabled: true,
        readiness: "ready"
      });
    }

    const sorted = records.sort((left, right) => {
      const leftIndex = [...this.visiblePluginNames].indexOf(left.name.toLowerCase());
      const rightIndex = [...this.visiblePluginNames].indexOf(right.name.toLowerCase());
      return leftIndex - rightIndex || left.name.localeCompare(right.name);
    });
    this.cached = { expiresAt: Date.now() + this.cacheTtlMs, records: sorted };
    return sorted.map((record) => ({ ...record }));
  }
}
