import fs from "node:fs/promises";
import path from "node:path";

export type ToolRuntimeEnvPaths = {
  root: string;
  home: string;
  cache: string;
  config: string;
  codexRuntimeLink: string;
};

export function toolRuntimeEnvPaths(workspace?: string): ToolRuntimeEnvPaths | undefined {
  const normalized = workspace?.trim();
  if (!normalized) return undefined;
  const root = path.join(normalized, ".agent-studio", "tmp");
  return {
    root,
    home: path.join(root, "home"),
    cache: path.join(root, "cache"),
    config: path.join(root, "config"),
    codexRuntimeLink: path.join(
      root,
      "home",
      ".cache",
      "codex-runtimes",
      "codex-primary-runtime"
    )
  };
}

async function ensureDirectorySymlink(linkPath: string, targetPath: string): Promise<void> {
  await fs.mkdir(path.dirname(linkPath), { recursive: true });
  try {
    const current = await fs.lstat(linkPath);
    if (current.isSymbolicLink()) {
      const resolved = path.resolve(path.dirname(linkPath), await fs.readlink(linkPath));
      if (resolved === path.resolve(targetPath)) return;
      await fs.unlink(linkPath);
    } else {
      throw new Error(`runtime mapping path is occupied by a non-symlink: ${linkPath}`);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }
  await fs.symlink(targetPath, linkPath, "dir");
}

export async function ensureToolRuntimeEnvDirs(
  workspace?: string,
  sharedCodexRuntimeRoot?: string
): Promise<ToolRuntimeEnvPaths | undefined> {
  const paths = toolRuntimeEnvPaths(workspace);
  if (!paths) return undefined;
  await Promise.all([
    fs.mkdir(paths.home, { recursive: true }),
    fs.mkdir(paths.cache, { recursive: true }),
    fs.mkdir(paths.config, { recursive: true })
  ]);
  const sharedRuntime = sharedCodexRuntimeRoot?.trim();
  if (sharedRuntime) {
    const stat = await fs.stat(sharedRuntime).catch(() => undefined);
    if (!stat?.isDirectory()) {
      throw new Error(`shared Codex runtime is missing or is not a directory: ${sharedRuntime}`);
    }
    await ensureDirectorySymlink(paths.codexRuntimeLink, sharedRuntime);
  }
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
