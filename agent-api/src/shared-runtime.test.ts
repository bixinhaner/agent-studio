import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildSharedRuntimeEnv,
  ensureRuntimeWorkspaceTmp,
  inspectSharedRuntime,
  sharedRuntimeHint,
  syncSharedRuntimeCleanupPolicy,
  tmpRetentionDays,
  type SharedRuntimePaths
} from "./shared-runtime.js";
import type { SystemSettingsPythonRuntime } from "./system-settings/types.js";

const tempRoots: string[] = [];

async function makeTempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const fixedPaths: SharedRuntimePaths = {
  pythonRoot: "/shared/python/runtime",
  pipCacheRoot: "/shared/python/pip-cache",
  argosPackageRoot: "/shared/argos/packages",
  argosDownloadRoot: "/shared/argos/downloads",
  cacheRoot: "/shared/cache",
  stateRoot: "/shared/state"
};

async function makeSharedRoot(): Promise<SharedRuntimePaths> {
  const root = await makeTempDir("agent-studio-shared-runtime-");
  return {
    pythonRoot: path.join(root, "python", "runtime"),
    pipCacheRoot: path.join(root, "python", "pip-cache"),
    argosPackageRoot: path.join(root, "argos", "packages"),
    argosDownloadRoot: path.join(root, "argos", "downloads"),
    cacheRoot: path.join(root, "cache"),
    stateRoot: path.join(root, "state")
  };
}

describe("shared runtime", () => {
  const enabledSettings: SystemSettingsPythonRuntime = {
    enabled: true,
    injectRuntimeHint: true,
    preferSharedPackages: true,
    sessionTmpEnabled: true,
    cleanupSessionArtifactsOlderThanDays: 14
  };

  it("injects shared python, tool caches and the workspace temp directory", async () => {
    const workspace = await makeTempDir("agent-studio-runtime-workspace-");
    const tmpDir = await ensureRuntimeWorkspaceTmp(workspace);
    const env = buildSharedRuntimeEnv({
      settings: enabledSettings,
      workspace,
      paths: fixedPaths,
      baseEnv: {
        PYTHONPATH: "/existing/path",
        PATH: ["/override/bin", "/usr/bin"].join(path.delimiter)
      }
    });

    expect(tmpDir).toBe(path.join(workspace, ".agent-studio", "tmp"));
    expect(await fs.stat(tmpDir!)).toBeTruthy();
    expect(env.AGENT_STUDIO_SHARED_RUNTIME).toBe("1");
    expect(env.AGENT_STUDIO_SHARED_PYTHON_RUNTIME).toBe("1");
    expect(env.PYTHONPATH).toBe(`/shared/python/runtime${path.delimiter}/existing/path`);
    expect(env.PIP_CACHE_DIR).toBe("/shared/python/pip-cache");
    expect(env.ARGOS_PACKAGE_DIR).toBe("/shared/argos/packages");
    expect(env.ARGOS_DOWNLOAD_DIR).toBe("/shared/argos/downloads");
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe("/shared/cache/ms-playwright");
    expect(env.npm_config_cache).toBe("/shared/cache/npm");
    expect(env.UV_CACHE_DIR).toBe("/shared/cache/uv");
    expect(env.UV_PYTHON_INSTALL_DIR).toBe("/shared/cache/uv-python");
    expect(env.HF_HUB_CACHE).toBe("/shared/cache/huggingface");
    expect(env.TMPDIR).toBe(tmpDir);
    expect(env.TEMP).toBe(tmpDir);
    expect(env.TMP).toBe(tmpDir);
  });

  it("appends the shared bin directory after existing PATH entries", () => {
    const env = buildSharedRuntimeEnv({
      settings: enabledSettings,
      paths: fixedPaths,
      baseEnv: { PATH: ["/override/bin", "/usr/bin"].join(path.delimiter) }
    });
    expect(env.PATH).toBe(["/override/bin", "/usr/bin", "/shared/python/runtime/bin"].join(path.delimiter));

    const again = buildSharedRuntimeEnv({ settings: enabledSettings, paths: fixedPaths, baseEnv: { PATH: env.PATH } });
    expect(again.PATH).toBe(env.PATH);
  });

  it("does not inject anything when disabled", () => {
    expect(
      buildSharedRuntimeEnv({
        settings: { ...enabledSettings, enabled: false },
        paths: fixedPaths
      })
    ).toEqual({});
  });

  it("skips the temp directory when session tmp is disabled", async () => {
    const workspace = await makeTempDir("agent-studio-runtime-workspace-");
    const env = buildSharedRuntimeEnv({
      settings: { ...enabledSettings, sessionTmpEnabled: false },
      workspace,
      paths: fixedPaths
    });
    expect(env.TMPDIR).toBeUndefined();
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe("/shared/cache/ms-playwright");
  });

  it("generates a hidden runtime hint only when package preference is enabled", () => {
    expect(sharedRuntimeHint(enabledSettings)).toContain("shared runtime");
    expect(sharedRuntimeHint(enabledSettings)).toContain("PLAYWRIGHT_BROWSERS_PATH");
    expect(sharedRuntimeHint({ ...enabledSettings, injectRuntimeHint: false })).toBeUndefined();
    expect(sharedRuntimeHint({ ...enabledSettings, preferSharedPackages: false })).toBeUndefined();
  });

  it("clamps temp retention to the range the cleaner accepts", () => {
    expect(tmpRetentionDays(enabledSettings)).toBe(14);
    expect(tmpRetentionDays({ ...enabledSettings, cleanupSessionArtifactsOlderThanDays: 1 })).toBe(3);
    expect(tmpRetentionDays({ ...enabledSettings, cleanupSessionArtifactsOlderThanDays: 3650 })).toBe(90);
    expect(tmpRetentionDays(undefined)).toBe(14);
  });

  it("writes the cleanup policy file only when retention changes", async () => {
    const paths = await makeSharedRoot();
    expect(await syncSharedRuntimeCleanupPolicy(enabledSettings, paths)).toBe(true);
    const policy = JSON.parse(await fs.readFile(path.join(paths.stateRoot, "cleanup-policy.json"), "utf8"));
    expect(policy).toMatchObject({ tmpRetentionDays: 14, workspaceCopyRetentionDays: 3 });

    expect(await syncSharedRuntimeCleanupPolicy(enabledSettings, paths)).toBe(false);
    expect(
      await syncSharedRuntimeCleanupPolicy({ ...enabledSettings, cleanupSessionArtifactsOlderThanDays: 30 }, paths)
    ).toBe(true);
    const updated = JSON.parse(await fs.readFile(path.join(paths.stateRoot, "cleanup-policy.json"), "utf8"));
    expect(updated.tmpRetentionDays).toBe(30);
  });

  it("reports capabilities, caches, the last cleanup run and gap coverage", async () => {
    const paths = await makeSharedRoot();
    await Promise.all([
      fs.mkdir(path.join(paths.pythonRoot, "matplotlib"), { recursive: true }),
      fs.mkdir(path.join(paths.pythonRoot, "bs4"), { recursive: true }),
      fs.mkdir(path.join(paths.cacheRoot, "ms-playwright", "chromium-1200"), { recursive: true }),
      fs.mkdir(paths.stateRoot, { recursive: true })
    ]);
    await fs.writeFile(path.join(paths.pythonRoot, "rarfile.py"), "");
    await fs.writeFile(
      path.join(paths.stateRoot, "cleanup-last-run.json"),
      JSON.stringify({
        finishedAt: "2026-10-08T19:40:00Z",
        dryRun: false,
        tmpRetentionDays: 14,
        workspaceCopyRetentionDays: 3,
        removedThreadTmp: 4,
        removedWorkspaceCopies: 10,
        skippedInUse: 1,
        freedBytes: 1024
      })
    );
    await fs.writeFile(
      path.join(paths.stateRoot, "runtime-gaps.json"),
      JSON.stringify({
        generatedAt: "2026-10-08T18:00:00Z",
        windowDays: 30,
        rolloutsScanned: 100,
        rolloutsWithGaps: 5,
        items: [
          { kind: "python", name: "matplotlib", threads: 3, occurrences: 4 },
          { kind: "python", name: "torch", threads: 2, occurrences: 2 },
          { kind: "shell", name: "ignored", threads: 1, occurrences: 1 }
        ],
        installs: [{ tool: "pip install", calls: 3, threads: 2 }],
        duplicateCaches: [{ name: "cache/ms-playwright", threads: 2, bytes: 2048 }]
      })
    );

    const status = await inspectSharedRuntime({ settings: enabledSettings, paths });

    const charts = status.capabilities.find((item) => item.key === "charts");
    expect(charts?.available).toContain("matplotlib");
    expect(charts?.status).toBe("partial");
    const web = status.capabilities.find((item) => item.key === "web");
    expect(web?.available).toEqual(expect.arrayContaining(["BeautifulSoup", "Chromium 浏览器"]));
    expect(status.capabilities.find((item) => item.key === "archives")?.available).toContain("rarfile");
    expect(status.caches.map((cache) => cache.envKey)).toEqual(
      expect.arrayContaining(["PIP_CACHE_DIR", "PLAYWRIGHT_BROWSERS_PATH", "npm_config_cache", "UV_CACHE_DIR"])
    );
    expect(status.caches.find((cache) => cache.key === "playwright")?.exists).toBe(true);
    expect(status.cleanup).toMatchObject({ tmpRetentionDays: 14, workspaceCopyRetentionDays: 3 });
    expect(status.cleanup.lastRun).toMatchObject({ removedThreadTmp: 4, removedWorkspaceCopies: 10, freedBytes: 1024 });
    expect(status.gaps?.items).toEqual([
      { kind: "python", name: "matplotlib", threads: 3, occurrences: 4, covered: true },
      { kind: "python", name: "torch", threads: 2, occurrences: 2, covered: false }
    ]);
    expect(status.gaps?.duplicateCaches[0]).toEqual({ name: "cache/ms-playwright", threads: 2, bytes: 2048 });
  });

  it("reports no cleanup run or gaps before the server jobs have written them", async () => {
    const paths = await makeSharedRoot();
    const status = await inspectSharedRuntime({ settings: enabledSettings, paths });
    expect(status.runtimeExists).toBe(false);
    expect(status.cleanup.lastRun).toBeNull();
    expect(status.gaps).toBeNull();
  });
});
