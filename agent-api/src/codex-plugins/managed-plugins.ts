import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { INLINE_VISUALIZATION_DIR } from "../artifacts/inline-visualization-artifact.js";

/**
 * Codex plugins kept in the repository and installed by
 * `scripts/shared-runtime/sync-codex-plugins.mjs` during deploys. The services run
 * with `agent-api` of the live checkout as working directory.
 */
export const MANAGED_PLUGIN_MARKETPLACE = "agentstudio-office";
export const MANAGED_PLUGIN_SYNC_STATE_FILE = "codex-plugins.json";

export function defaultManagedPluginSourceRoot(): string {
  return path.resolve(process.cwd(), "..", "scripts", "shared-runtime", "codex-plugins");
}

/** Must match `IGNORED_NAMES` in sync-codex-plugins.mjs so both sides compute the same digest. */
const IGNORED_NAMES = new Set([".codex-remote-plugin-install.json", ".DS_Store"]);

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (directory: string) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (IGNORED_NAMES.has(entry.name) || entry.name.startsWith("._")) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile()) files.push(path.relative(root, target).split(path.sep).join("/"));
    }
  };
  await walk(root);
  return files.sort();
}

export async function pluginDigest(root: string): Promise<string | null> {
  const files = await listFiles(root).catch(() => null);
  if (!files) return null;
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    hash.update(await fs.readFile(path.join(root, file)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function readPluginVersion(pluginRoot: string): Promise<string | null> {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof manifest.version === "string" && manifest.version.trim() ? manifest.version.trim() : null;
  } catch {
    return null;
  }
}

async function installedVersions(codexHome: string, marketplace: string, name: string): Promise<string[]> {
  const entries = await fs
    .readdir(path.join(codexHome, "plugins", "cache", marketplace, name), { withFileTypes: true })
    .catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

export function installedPluginDirectory(codexHome: string, marketplace: string, name: string, version: string): string {
  return path.join(codexHome, "plugins", "cache", marketplace, name, version);
}

export type ManagedPluginStatus = {
  name: string;
  /** Version of the repository copy. */
  expectedVersion: string | null;
  installedVersions: string[];
  /** The installed files equal the repository copy. */
  inSync: boolean;
  /** Plugin-specific contract problems of the installed copy (empty when fine). */
  problems: string[];
};

export type ManagedPluginSyncReport = {
  checkedAt: string;
  plugins: Array<{
    name: string;
    version: string | null;
    installedVersion: string | null;
    status: "current" | "updated" | "failed" | "outdated";
    detail?: string;
  }>;
};

/**
 * Contract checks for what the agent-studio host needs from a plugin. The visualize
 * skill must send fragments to the directory the backend serves; in July 2026 it
 * pointed at the read-only `.codex` tree and every visualization 404ed.
 */
export async function pluginContractProblems(name: string, installedDir: string): Promise<string[]> {
  if (name !== "visualize") return [];
  const skill = await fs.readFile(path.join(installedDir, "skills", "visualize", "SKILL.md"), "utf8").catch(() => null);
  if (skill === null) return ["缺少 skills/visualize/SKILL.md"];
  const problems: string[] = [];
  if (!skill.includes(INLINE_VISUALIZATION_DIR)) {
    problems.push(`Skill 未指向 ${INLINE_VISUALIZATION_DIR}，生成的可视化无法展示`);
  }
  if (!skill.includes("::codex-inline-vis")) problems.push("Skill 缺少 ::codex-inline-vis 指令说明");
  return problems;
}

export async function inspectManagedPlugins(input: {
  codexHome: string;
  sourceRoot?: string;
  marketplace?: string;
}): Promise<ManagedPluginStatus[]> {
  const sourceRoot = input.sourceRoot ?? defaultManagedPluginSourceRoot();
  const marketplace = input.marketplace ?? MANAGED_PLUGIN_MARKETPLACE;
  const entries = await fs.readdir(sourceRoot, { withFileTypes: true }).catch(() => []);
  const names = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
  return Promise.all(
    names.map(async (name): Promise<ManagedPluginStatus> => {
      const sourceDir = path.join(sourceRoot, name);
      const expectedVersion = await readPluginVersion(sourceDir);
      const versions = await installedVersions(input.codexHome, marketplace, name);
      const installedDir = expectedVersion
        ? installedPluginDirectory(input.codexHome, marketplace, name, expectedVersion)
        : undefined;
      const [sourceDigest, installedDigest] = await Promise.all([
        pluginDigest(sourceDir),
        installedDir ? pluginDigest(installedDir) : Promise.resolve(null)
      ]);
      const contractDir = installedDir && installedDigest ? installedDir : versions.length
        ? installedPluginDirectory(input.codexHome, marketplace, name, versions[versions.length - 1])
        : undefined;
      return {
        name,
        expectedVersion,
        installedVersions: versions,
        inSync: Boolean(sourceDigest && installedDigest && sourceDigest === installedDigest),
        problems: contractDir ? await pluginContractProblems(name, contractDir) : ["未安装"]
      };
    })
  );
}

export async function readManagedPluginSyncReport(stateRoot: string): Promise<ManagedPluginSyncReport | null> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(stateRoot, MANAGED_PLUGIN_SYNC_STATE_FILE), "utf8")) as Record<
      string,
      unknown
    >;
    if (typeof raw.checkedAt !== "string" || !Array.isArray(raw.plugins)) return null;
    const statuses = new Set(["current", "updated", "failed", "outdated"]);
    return {
      checkedAt: raw.checkedAt,
      plugins: raw.plugins.flatMap((item) => {
        const plugin = item as Record<string, unknown>;
        if (typeof plugin.name !== "string" || !statuses.has(String(plugin.status))) return [];
        return [
          {
            name: plugin.name,
            version: typeof plugin.version === "string" ? plugin.version : null,
            installedVersion: typeof plugin.installedVersion === "string" ? plugin.installedVersion : null,
            status: plugin.status as ManagedPluginSyncReport["plugins"][number]["status"],
            ...(typeof plugin.detail === "string" ? { detail: plugin.detail } : {})
          }
        ];
      })
    };
  } catch {
    return null;
  }
}

const VISUALIZE_CONTRACT_CACHE_MS = 60_000;
let visualizeContractCache: { codexHome: string; expiresAt: number; ok: boolean } | undefined;

/**
 * Whether every installed visualize version already tells the model where to write.
 * When it does not (sync failed, old plugin), the runtime keeps a per-turn hint so
 * visualizations still land in the served directory.
 */
export async function installedVisualizeSkillUsesDurableDirectory(codexHome: string): Promise<boolean> {
  const now = Date.now();
  if (visualizeContractCache?.codexHome === codexHome && visualizeContractCache.expiresAt > now) {
    return visualizeContractCache.ok;
  }
  const versions = await installedVersions(codexHome, MANAGED_PLUGIN_MARKETPLACE, "visualize");
  let ok = versions.length > 0;
  for (const version of versions) {
    const problems = await pluginContractProblems(
      "visualize",
      installedPluginDirectory(codexHome, MANAGED_PLUGIN_MARKETPLACE, "visualize", version)
    );
    if (problems.length) ok = false;
  }
  visualizeContractCache = { codexHome, expiresAt: now + VISUALIZE_CONTRACT_CACHE_MS, ok };
  return ok;
}
