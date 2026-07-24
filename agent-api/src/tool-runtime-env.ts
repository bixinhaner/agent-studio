import fs from "node:fs/promises";
import path from "node:path";

export type ToolRuntimeEnvPaths = {
  root: string;
  home: string;
  cache: string;
  config: string;
  codexRuntimeLink: string;
};

export const TOOL_RUNTIME_FRESHNESS_HINT = [
  "内部运行提示：当前请求使用的已安装 Skill 和插件运行时已在请求开始前重新校验并映射。",
  "不要沿用本对话中过去关于组件缺失、依赖不可用或编辑环境未恢复的结论。",
  "当用户再次请求创建、编辑、转换或解析文件时，必须重新读取对应的已安装 Skill，并基于当前运行时实际尝试。",
  "编辑已有文件时优先复用对话中已知的原文件路径或附件；只有本次尝试返回错误后，才能说明当前能力不可用。",
  "这些是内部执行要求，不要向用户解释运行时、依赖、Skill 或插件状态。"
].join("\n");

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

async function ensureSharedNodePackageLink(linkPath: string, targetPath: string): Promise<void> {
  await fs.mkdir(path.dirname(linkPath), { recursive: true });
  try {
    const current = await fs.lstat(linkPath);
    if (!current.isSymbolicLink()) return;
    const resolved = path.resolve(path.dirname(linkPath), await fs.readlink(linkPath));
    if (resolved === path.resolve(targetPath)) return;
    await fs.unlink(linkPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }
  await fs.symlink(targetPath, linkPath, "dir");
}

async function ensureSharedNodeModuleLinks(workspace: string, sharedRuntimeRoot: string): Promise<void> {
  const sharedNodeModules = path.join(sharedRuntimeRoot, "dependencies", "node", "node_modules");
  const stat = await fs.stat(sharedNodeModules).catch(() => undefined);
  if (!stat?.isDirectory()) {
    throw new Error(`shared Node runtime is missing or is not a directory: ${sharedNodeModules}`);
  }

  const workspaceNodeModules = path.join(workspace, "node_modules");
  await fs.mkdir(workspaceNodeModules, { recursive: true });
  for (const entry of await fs.readdir(sharedNodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const sharedEntry = path.join(sharedNodeModules, entry.name);
    if (!entry.name.startsWith("@")) {
      await ensureSharedNodePackageLink(path.join(workspaceNodeModules, entry.name), sharedEntry);
      continue;
    }

    const workspaceScope = path.join(workspaceNodeModules, entry.name);
    await fs.mkdir(workspaceScope, { recursive: true });
    for (const scopedEntry of await fs.readdir(sharedEntry, { withFileTypes: true })) {
      if (!scopedEntry.isDirectory() && !scopedEntry.isSymbolicLink()) continue;
      await ensureSharedNodePackageLink(
        path.join(workspaceScope, scopedEntry.name),
        path.join(sharedEntry, scopedEntry.name)
      );
    }
  }
}

export async function ensureToolRuntimeEnvDirs(
  workspace?: string,
  sharedCodexRuntimeRoot?: string
): Promise<ToolRuntimeEnvPaths | undefined> {
  const workspaceRoot = workspace?.trim();
  if (!workspaceRoot) return undefined;
  const paths = toolRuntimeEnvPaths(workspaceRoot)!;
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
    await ensureSharedNodeModuleLinks(workspaceRoot, sharedRuntime);
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
