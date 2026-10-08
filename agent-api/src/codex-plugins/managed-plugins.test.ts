import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error The deploy-time sync script is plain ESM without type declarations.
import * as syncScript from "../../../scripts/shared-runtime/sync-codex-plugins.mjs";
import {
  inspectManagedPlugins,
  installedVisualizeSkillUsesDurableDirectory,
  pluginContractProblems,
  pluginDigest,
  readManagedPluginSyncReport
} from "./managed-plugins.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const repoPlugins = path.join(repoRoot, "scripts", "shared-runtime", "codex-plugins");
const roots: string[] = [];

async function tempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "managed-plugins-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

type SyncReport = { plugins: Array<{ name: string; status: string; installedVersion: string | null; detail?: string }> };
const syncPlugins = syncScript.syncPlugins as (
  args: Record<string, unknown>,
  runCodex: (args: Record<string, unknown>, codexArgs: string[]) => void
) => SyncReport;

/** A base CODEX_HOME with the July 2026 visualize 1.0.14 installed from a local marketplace. */
async function legacyInstall(root: string) {
  const marketplace = path.join(root, "marketplace");
  const home = path.join(root, "home");
  const legacy = path.join(marketplace, "plugins", "visualize");
  await fs.cp(path.join(repoPlugins, "visualize"), legacy, { recursive: true });
  const manifestPath = path.join(legacy, ".codex-plugin", "plugin.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  await fs.writeFile(manifestPath, JSON.stringify({ ...manifest, version: "1.0.14" }));
  const skillPath = path.join(legacy, "skills", "visualize", "SKILL.md");
  await fs.writeFile(skillPath, (await fs.readFile(skillPath, "utf8")).replace(".agent-studio/visualizations/", ".codex/visualizations/"));
  await fs.mkdir(path.join(marketplace, ".agents", "plugins"), { recursive: true });
  await fs.writeFile(path.join(marketplace, ".agents", "plugins", "marketplace.json"), JSON.stringify({ name: "agentstudio-office", plugins: [] }));
  await fs.cp(legacy, path.join(home, "plugins", "cache", "agentstudio-office", "visualize", "1.0.14"), { recursive: true });
  await fs.writeFile(
    path.join(home, "config.toml"),
    `[plugins."visualize@agentstudio-office"]\nenabled = true\n\n[marketplaces.agentstudio-office]\nsource_type = "local"\nsource = "${marketplace}"\n`
  );
  return { marketplace, home };
}

/** Mimics `codex plugin add`: copies the marketplace plugin into the cache, replacing older versions. */
function fakeCodexAdd(marketplace: string) {
  return (args: Record<string, unknown>, codexArgs: string[]) => {
    expect(codexArgs).toEqual(["plugin", "add", "visualize@agentstudio-office"]);
    const source = path.join(marketplace, "plugins", "visualize");
    const version = syncScript.readPluginVersion(source) as string;
    const cacheRoot = path.join(String(args.codexHome), "plugins", "cache", "agentstudio-office", "visualize");
    fsSync.rmSync(cacheRoot, { recursive: true, force: true });
    fsSync.cpSync(source, path.join(cacheRoot, version), { recursive: true });
  };
}

describe("repository-managed Codex plugins", () => {
  it("ships a visualize skill that writes where the backend serves visualizations", async () => {
    await expect(pluginContractProblems("visualize", path.join(repoPlugins, "visualize"))).resolves.toEqual([]);
    const skill = await fs.readFile(path.join(repoPlugins, "visualize", "skills", "visualize", "SKILL.md"), "utf8");
    expect(skill).not.toContain(".codex/visualizations");
  });

  it("computes the same digest as the deploy sync script", async () => {
    const dir = path.join(repoPlugins, "visualize");
    await expect(pluginDigest(dir)).resolves.toBe(syncScript.pluginDigest(dir));
  });

  it("upgrades a legacy install, records state, and reports it in sync", async () => {
    const root = await tempRoot();
    const { marketplace, home } = await legacyInstall(root);
    await expect(installedVisualizeSkillUsesDurableDirectory(home)).resolves.toBe(false);
    await expect(inspectManagedPlugins({ codexHome: home, sourceRoot: repoPlugins })).resolves.toEqual([
      expect.objectContaining({ name: "visualize", inSync: false, installedVersions: ["1.0.14"], problems: [expect.stringContaining(".agent-studio/visualizations")] })
    ]);

    const check = syncPlugins({ source: repoPlugins, codexHome: home, marketplace: "agentstudio-office", check: true }, () => {
      throw new Error("check mode must not install");
    });
    expect(check.plugins).toEqual([expect.objectContaining({ name: "visualize", status: "outdated" })]);

    const report = syncPlugins({ source: repoPlugins, codexHome: home, marketplace: "agentstudio-office", check: false }, fakeCodexAdd(marketplace));
    expect(report.plugins).toEqual([expect.objectContaining({ name: "visualize", status: "updated", installedVersion: "1.0.14-agentstudio.1" })]);
    const marketplaceManifest = JSON.parse(await fs.readFile(path.join(marketplace, ".agents", "plugins", "marketplace.json"), "utf8"));
    expect(marketplaceManifest.plugins).toEqual([expect.objectContaining({ name: "visualize", source: { source: "local", path: "./plugins/visualize" } })]);

    await expect(inspectManagedPlugins({ codexHome: home, sourceRoot: repoPlugins })).resolves.toEqual([
      { name: "visualize", expectedVersion: "1.0.14-agentstudio.1", installedVersions: ["1.0.14-agentstudio.1"], inSync: true, problems: [] }
    ]);
    const again = syncPlugins({ source: repoPlugins, codexHome: home, marketplace: "agentstudio-office", check: false }, () => {
      throw new Error("an up-to-date plugin must not be reinstalled");
    });
    expect(again.plugins).toEqual([expect.objectContaining({ status: "current" })]);
  });

  it("restores the marketplace copy when the install fails", async () => {
    const root = await tempRoot();
    const { marketplace, home } = await legacyInstall(root);
    const before = await pluginDigest(path.join(marketplace, "plugins", "visualize"));
    const report = syncPlugins({ source: repoPlugins, codexHome: home, marketplace: "agentstudio-office", check: false }, () => {
      throw new Error("codex exited with 1");
    });
    expect(report.plugins).toEqual([expect.objectContaining({ status: "failed", installedVersion: "1.0.14", detail: "codex exited with 1" })]);
    await expect(pluginDigest(path.join(marketplace, "plugins", "visualize"))).resolves.toBe(before);
    await expect(fs.readdir(path.join(marketplace, "plugins"))).resolves.toEqual(["visualize"]);
  });

  it("reads the sync state file written by the deploy", async () => {
    const root = await tempRoot();
    await fs.writeFile(
      path.join(root, "codex-plugins.json"),
      JSON.stringify({
        checkedAt: "2026-10-08T05:00:00.000Z",
        plugins: [
          { name: "visualize", version: "1.0.14-agentstudio.1", installedVersion: "1.0.14", status: "failed", detail: "boom" },
          { name: "bad", status: "weird" }
        ]
      })
    );
    await expect(readManagedPluginSyncReport(root)).resolves.toEqual({
      checkedAt: "2026-10-08T05:00:00.000Z",
      plugins: [{ name: "visualize", version: "1.0.14-agentstudio.1", installedVersion: "1.0.14", status: "failed", detail: "boom" }]
    });
    await expect(readManagedPluginSyncReport(path.join(root, "missing"))).resolves.toBeNull();
  });
});
