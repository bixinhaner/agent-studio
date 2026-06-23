import fs from "node:fs/promises";
import path from "node:path";

export type ToolRuntimeEnvPaths = {
  root: string;
  home: string;
  cache: string;
  config: string;
};

export function toolRuntimeEnvPaths(workspace?: string): ToolRuntimeEnvPaths | undefined {
  const normalized = workspace?.trim();
  if (!normalized) return undefined;
  const root = path.join(normalized, ".agent-studio", "tmp");
  return {
    root,
    home: path.join(root, "home"),
    cache: path.join(root, "cache"),
    config: path.join(root, "config")
  };
}

export async function ensureToolRuntimeEnvDirs(workspace?: string): Promise<ToolRuntimeEnvPaths | undefined> {
  const paths = toolRuntimeEnvPaths(workspace);
  if (!paths) return undefined;
  await Promise.all([
    fs.mkdir(paths.home, { recursive: true }),
    fs.mkdir(paths.cache, { recursive: true }),
    fs.mkdir(paths.config, { recursive: true })
  ]);
  return paths;
}

export function buildToolRuntimeEnv(input: { workspace?: string }): Record<string, string> {
  const paths = toolRuntimeEnvPaths(input.workspace);
  if (!paths) return {};
  return {
    HOME: paths.home,
    XDG_CACHE_HOME: paths.cache,
    XDG_CONFIG_HOME: paths.config
  };
}
