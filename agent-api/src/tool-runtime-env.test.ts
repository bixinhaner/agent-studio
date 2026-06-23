import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildToolRuntimeEnv, ensureToolRuntimeEnvDirs, toolRuntimeEnvPaths } from "./tool-runtime-env.js";

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
  it("creates writable home and XDG directories under workspace temp", async () => {
    const workspace = await makeTempDir("agent-studio-tool-runtime-");
    const paths = await ensureToolRuntimeEnvDirs(workspace);

    expect(paths).toEqual({
      root: path.join(workspace, ".agent-studio", "tmp"),
      home: path.join(workspace, ".agent-studio", "tmp", "home"),
      cache: path.join(workspace, ".agent-studio", "tmp", "cache"),
      config: path.join(workspace, ".agent-studio", "tmp", "config")
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

  it("does not inject env without workspace", async () => {
    expect(toolRuntimeEnvPaths()).toBeUndefined();
    expect(await ensureToolRuntimeEnvDirs()).toBeUndefined();
    expect(buildToolRuntimeEnv({})).toEqual({});
  });
});
