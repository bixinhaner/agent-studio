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

async function makeSharedRuntime(prefix: string) {
  const root = await makeTempDir(prefix);
  await Promise.all([
    fs.mkdir(path.join(root, "dependencies", "node", "node_modules", "@oai", "artifact-tool"), {
      recursive: true
    }),
    fs.mkdir(path.join(root, "dependencies", "node", "node_modules", "lucide"), {
      recursive: true
    })
  ]);
  return root;
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
    const sharedRuntime = await makeSharedRuntime("agent-studio-shared-codex-runtime-");

    const paths = await ensureToolRuntimeEnvDirs(workspace, sharedRuntime);
    await expect(fs.realpath(paths!.codexRuntimeLink)).resolves.toBe(await fs.realpath(sharedRuntime));
    await expect(fs.realpath(path.join(workspace, "node_modules", "@oai", "artifact-tool"))).resolves.toBe(
      await fs.realpath(path.join(sharedRuntime, "dependencies", "node", "node_modules", "@oai", "artifact-tool"))
    );
    await expect(fs.realpath(path.join(workspace, "node_modules", "lucide"))).resolves.toBe(
      await fs.realpath(path.join(sharedRuntime, "dependencies", "node", "node_modules", "lucide"))
    );

    await ensureToolRuntimeEnvDirs(workspace, sharedRuntime);
    await expect(fs.realpath(paths!.codexRuntimeLink)).resolves.toBe(await fs.realpath(sharedRuntime));
  });

  it("repairs a stale shared Codex runtime symlink", async () => {
    const workspace = await makeTempDir("agent-studio-tool-runtime-stale-");
    const previousRuntime = await makeSharedRuntime("agent-studio-shared-codex-previous-");
    const nextRuntime = await makeSharedRuntime("agent-studio-shared-codex-next-");

    const paths = await ensureToolRuntimeEnvDirs(workspace, previousRuntime);
    await ensureToolRuntimeEnvDirs(workspace, nextRuntime);

    await expect(fs.realpath(paths!.codexRuntimeLink)).resolves.toBe(await fs.realpath(nextRuntime));
    await expect(fs.realpath(path.join(workspace, "node_modules", "@oai", "artifact-tool"))).resolves.toBe(
      await fs.realpath(path.join(nextRuntime, "dependencies", "node", "node_modules", "@oai", "artifact-tool"))
    );
  });

  it("preserves workspace-owned Node packages while mapping other shared packages", async () => {
    const workspace = await makeTempDir("agent-studio-tool-runtime-existing-package-");
    const sharedRuntime = await makeSharedRuntime("agent-studio-shared-codex-existing-package-");
    const workspaceLucide = path.join(workspace, "node_modules", "lucide");
    await fs.mkdir(workspaceLucide, { recursive: true });
    await fs.writeFile(path.join(workspaceLucide, "owner.txt"), "workspace");

    await ensureToolRuntimeEnvDirs(workspace, sharedRuntime);

    await expect(fs.readFile(path.join(workspaceLucide, "owner.txt"), "utf8")).resolves.toBe("workspace");
    expect((await fs.lstat(workspaceLucide)).isSymbolicLink()).toBe(false);
    expect((await fs.lstat(path.join(workspace, "node_modules", "@oai", "artifact-tool"))).isSymbolicLink()).toBe(
      true
    );
  });

  it("supports concurrent per-turn preparation for the same workspace", async () => {
    const workspace = await makeTempDir("agent-studio-tool-runtime-concurrent-");
    const sharedRuntime = await makeSharedRuntime("agent-studio-shared-codex-concurrent-");

    await Promise.all(
      Array.from({ length: 8 }, () => ensureToolRuntimeEnvDirs(workspace, sharedRuntime))
    );

    await expect(fs.realpath(path.join(workspace, "node_modules", "@oai", "artifact-tool"))).resolves.toBe(
      await fs.realpath(path.join(sharedRuntime, "dependencies", "node", "node_modules", "@oai", "artifact-tool"))
    );
    await expect(fs.realpath(path.join(workspace, "node_modules", "lucide"))).resolves.toBe(
      await fs.realpath(path.join(sharedRuntime, "dependencies", "node", "node_modules", "lucide"))
    );
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
