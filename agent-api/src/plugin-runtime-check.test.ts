import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const tempRoots: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const checker = path.join(repoRoot, "scripts", "check-plugin-runtime.mjs");

async function makeTempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("plugin runtime checker", () => {
  it("discovers historical cached plugins and validates shared Node packages", async () => {
    const root = await makeTempDir("agent-studio-plugin-check-");
    const pluginRoot = path.join(root, "plugins", "cache", "marketplace", "presentations", "1.0.0");
    const nodeModules = path.join(root, "runtime", "node_modules");
    const artifactRoot = path.join(nodeModules, "@oai", "artifact-tool");
    await fs.mkdir(path.join(pluginRoot, ".codex-plugin"), { recursive: true });
    await fs.mkdir(path.join(pluginRoot, "skills", "presentations"), { recursive: true });
    await fs.mkdir(path.join(artifactRoot, "dist", "node"), { recursive: true });
    await fs.writeFile(
      path.join(pluginRoot, ".codex-plugin", "plugin.json"),
      JSON.stringify({ name: "presentations" })
    );
    await fs.writeFile(path.join(pluginRoot, "skills", "presentations", "SKILL.md"), "# Presentations\n");
    await fs.writeFile(
      path.join(artifactRoot, "package.json"),
      JSON.stringify({ name: "@oai/artifact-tool", version: "2.8.0" })
    );
    await fs.writeFile(path.join(artifactRoot, "dist", "node", "artifact_tool.mjs"), "export {};\n");
    const requirements = path.join(root, "requirements.json");
    await fs.writeFile(
      requirements,
      JSON.stringify({
        schemaVersion: 1,
        plugins: {
          presentations: {
            nodePackages: [
              {
                name: "@oai/artifact-tool",
                minimumVersion: "2.7.3",
                entrypoints: ["dist/node/artifact_tool.mjs"]
              }
            ]
          }
        }
      })
    );

    const result = spawnSync(
      process.execPath,
      [
        checker,
        "--plugin-root",
        root,
        "--requirements",
        requirements,
        "--node-modules",
        nodeModules
      ],
      { encoding: "utf8" }
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      checkedPluginVersions: 1,
      installedPlugins: ["presentations"],
      problems: [],
      runtimeCheckedPlugins: ["presentations"]
    });
  });

  it("fails when an installed plugin dependency is missing", async () => {
    const root = await makeTempDir("agent-studio-plugin-check-missing-");
    const skillRoot = path.join(root, "skills", "spreadsheets");
    await fs.mkdir(skillRoot, { recursive: true });
    await fs.writeFile(path.join(skillRoot, "SKILL.md"), "# Spreadsheets\n");
    const requirements = path.join(root, "requirements.json");
    await fs.writeFile(
      requirements,
      JSON.stringify({
        schemaVersion: 1,
        plugins: {
          spreadsheets: {
            nodePackages: [{ name: "@oai/artifact-tool" }]
          }
        }
      })
    );

    const result = spawnSync(
      process.execPath,
      [checker, "--plugin-root", root, "--requirements", requirements],
      { encoding: "utf8" }
    );

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).problems).toContain("shared Node runtime path was not provided");
  });

  it("validates registered shared capabilities before a plugin is materialized", async () => {
    const root = await makeTempDir("agent-studio-plugin-check-registered-");
    const requirements = path.join(root, "requirements.json");
    await fs.writeFile(
      requirements,
      JSON.stringify({
        schemaVersion: 1,
        plugins: {
          presentations: {
            nodePackages: [{ name: "@oai/artifact-tool" }]
          }
        }
      })
    );

    const result = spawnSync(
      process.execPath,
      [checker, "--plugin-root", root, "--requirements", requirements, "--all-registered"],
      { encoding: "utf8" }
    );

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      installedPlugins: [],
      runtimeCheckedPlugins: ["presentations"],
      problems: ["shared Node runtime path was not provided"]
    });
  });
});
