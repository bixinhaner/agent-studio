import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildSharedPythonRuntimeEnv,
  ensureRuntimeWorkspaceTmp,
  sharedPythonRuntimeHint
} from "./shared-python-runtime.js";
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

describe("shared python runtime", () => {
  const enabledSettings: SystemSettingsPythonRuntime = {
    enabled: true,
    injectRuntimeHint: true,
    preferSharedPackages: true,
    sessionTmpEnabled: true,
    cleanupSessionArtifactsOlderThanDays: 14
  };

  it("injects shared python paths and workspace temp directory", async () => {
    const workspace = await makeTempDir("agent-studio-runtime-workspace-");
    const tmpDir = await ensureRuntimeWorkspaceTmp(workspace);
    const env = buildSharedPythonRuntimeEnv({
      settings: enabledSettings,
      workspace,
      paths: {
        runtimeRoot: "/shared/python/runtime",
        pipCacheRoot: "/shared/python/pip-cache",
        argosPackageRoot: "/shared/argos/packages",
        argosDownloadRoot: "/shared/argos/downloads"
      },
      baseEnv: {
        PYTHONPATH: "/existing/path"
      }
    });

    expect(tmpDir).toBe(path.join(workspace, ".agent-studio", "tmp"));
    expect(await fs.stat(tmpDir!)).toBeTruthy();
    expect(env.AGENT_STUDIO_SHARED_PYTHON_RUNTIME).toBe("1");
    expect(env.PYTHONPATH).toBe(`/shared/python/runtime${path.delimiter}/existing/path`);
    expect(env.PIP_CACHE_DIR).toBe("/shared/python/pip-cache");
    expect(env.ARGOS_PACKAGE_DIR).toBe("/shared/argos/packages");
    expect(env.ARGOS_DOWNLOAD_DIR).toBe("/shared/argos/downloads");
    expect(env.TMPDIR).toBe(tmpDir);
    expect(env.TEMP).toBe(tmpDir);
    expect(env.TMP).toBe(tmpDir);
  });

  it("does not inject anything when disabled", () => {
    expect(buildSharedPythonRuntimeEnv({
      settings: {
        ...enabledSettings,
        enabled: false
      },
      paths: {
        runtimeRoot: "/shared/python/runtime",
        pipCacheRoot: "/shared/python/pip-cache",
        argosPackageRoot: "/shared/argos/packages",
        argosDownloadRoot: "/shared/argos/downloads"
      }
    })).toEqual({});
  });

  it("generates a hidden runtime hint only when package preference is enabled", () => {
    expect(sharedPythonRuntimeHint(enabledSettings)).toContain("共享 Python Runtime");
    expect(sharedPythonRuntimeHint({ ...enabledSettings, injectRuntimeHint: false })).toBeUndefined();
    expect(sharedPythonRuntimeHint({ ...enabledSettings, preferSharedPackages: false })).toBeUndefined();
  });
});
