import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildToolRuntimeEnv,
  ensureToolRuntimeEnvDirs,
  TOOL_RUNTIME_FRESHNESS_HINT,
  toolRuntimeEnvPaths
} from "./tool-runtime-env.js";

const tempRoots: string[] = [];

async function makeTempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("tool runtime env", () => {
  it("requires retrial after a historical plugin runtime failure", () => {
    expect(TOOL_RUNTIME_FRESHNESS_HINT).toContain("不要沿用本对话中过去");
    expect(TOOL_RUNTIME_FRESHNESS_HINT).toContain("必须重新读取对应的已安装 Skill");
    expect(TOOL_RUNTIME_FRESHNESS_HINT).toContain("只有本次尝试返回错误后");
  });

  it("creates writable home and XDG directories under workspace temp", async () => {
    const workspace = await makeTempDir("agent-studio-tool-runtime-");
    const paths = await ensureToolRuntimeEnvDirs(workspace);

    expect(paths).toEqual({
      root: path.join(workspace, ".agent-studio", "tmp"),
      home: path.join(workspace, ".agent-studio", "tmp", "home"),
      cache: path.join(workspace, ".agent-studio", "tmp", "cache"),
      config: path.join(workspace, ".agent-studio", "tmp", "config"),
      codexRuntimeLink: path.join(
        workspace,
        ".agent-studio",
        "tmp",
        "home",
        ".cache",
        "codex-runtimes",
        "codex-primary-runtime"
      )
    });
    await expect(fs.stat(paths!.home)).resolves.toBeTruthy();
    await expect(fs.stat(paths!.cache)).resolves.toBeTruthy();
    await expect(fs.stat(paths!.config)).resolves.toBeTruthy();
  });

  it("injects only generic tool cache environment variables", async () => {
    const workspace = await makeTempDir("agent-studio-tool-runtime-env-");
    const env = buildToolRuntimeEnv({ workspace });

    expect(env).toEqual({
      HOME: path.join(workspace, ".agent-studio", "tmp", "home"),
      XDG_CACHE_HOME: path.join(workspace, ".agent-studio", "tmp", "cache"),
      XDG_CONFIG_HOME: path.join(workspace, ".agent-studio", "tmp", "config")
    });
    expect(env).not.toHaveProperty("CODEX_HOME");
  });

  it("maps the shared Codex runtime into an isolated workspace home", async () => {
    const workspace = await makeTempDir("agent-studio-tool-runtime-link-");
    const sharedRuntime = await makeTempDir("agent-studio-shared-codex-runtime-");

    const paths = await ensureToolRuntimeEnvDirs(workspace, sharedRuntime);
    await expect(fs.realpath(paths!.codexRuntimeLink)).resolves.toBe(await fs.realpath(sharedRuntime));

    await ensureToolRuntimeEnvDirs(workspace, sharedRuntime);
    await expect(fs.realpath(paths!.codexRuntimeLink)).resolves.toBe(await fs.realpath(sharedRuntime));
  });

  it("repairs a stale shared Codex runtime symlink", async () => {
    const workspace = await makeTempDir("agent-studio-tool-runtime-stale-");
    const previousRuntime = await makeTempDir("agent-studio-shared-codex-previous-");
    const nextRuntime = await makeTempDir("agent-studio-shared-codex-next-");

    const paths = await ensureToolRuntimeEnvDirs(workspace, previousRuntime);
    await ensureToolRuntimeEnvDirs(workspace, nextRuntime);

    await expect(fs.realpath(paths!.codexRuntimeLink)).resolves.toBe(await fs.realpath(nextRuntime));
  });

  it("fails clearly when the shared Codex runtime is missing", async () => {
    const workspace = await makeTempDir("agent-studio-tool-runtime-missing-");

    await expect(
      ensureToolRuntimeEnvDirs(workspace, path.join(workspace, "missing-runtime"))
    ).rejects.toThrow("shared Codex runtime is missing");
  });

  it("does not inject env without workspace", async () => {
    expect(toolRuntimeEnvPaths()).toBeUndefined();
    expect(await ensureToolRuntimeEnvDirs()).toBeUndefined();
    expect(buildToolRuntimeEnv({})).toEqual({});
  });
});
