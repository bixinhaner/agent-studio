import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { InstalledPluginService } from "./installed-plugin-service.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("InstalledPluginService", () => {
  it("returns only enabled allowlisted plugins and reads manifest content", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "installed-plugins-"));
    roots.push(root);
    const pluginPath = path.join(root, "documents");
    await fs.mkdir(path.join(pluginPath, ".codex-plugin"), { recursive: true });
    await fs.mkdir(path.join(pluginPath, "skills", "documents"), { recursive: true });
    await fs.writeFile(path.join(pluginPath, ".codex-plugin", "plugin.json"), JSON.stringify({
      name: "documents",
      version: "1.2.3",
      description: "Create documents",
      skills: "./skills/",
      interface: {
        displayName: "Documents",
        shortDescription: "Create files",
        capabilities: ["Interactive", "Write"],
        defaultPrompt: ["Create a memo"]
      }
    }));
    const executable = path.join(root, "fake-codex");
    await fs.writeFile(executable, `#!/bin/sh
printf '%s\\n' '${`documents@office installed, enabled 1.2.3 ${pluginPath}`}'
printf '%s\\n' 'slack@office installed, enabled 1.0.0 /tmp/slack'
printf '%s\\n' 'pdf@office not installed /tmp/pdf'
`);
    await fs.chmod(executable, 0o755);

    const service = new InstalledPluginService({ baseHome: root, executable, cacheTtlMs: 0 });
    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({
        name: "documents",
        pluginRef: "documents@office",
        version: "1.2.3",
        displayName: "Documents",
        capabilities: ["Interactive", "Write"],
        defaultPrompts: ["Create a memo"],
        skillNames: ["documents"],
        readiness: "degraded",
        visibleToUsers: true,
        capabilityHealth: expect.arrayContaining([
          expect.objectContaining({ id: "local-documents", status: "ready" }),
          expect.objectContaining({ id: "connected-documents", status: "unavailable" })
        ])
      })
    ]);
  });

  it("ignores remote catalog rows and unreadable manifests instead of failing the whole list", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "installed-plugins-"));
    roots.push(root);
    const pluginPath = path.join(root, "documents");
    await fs.mkdir(path.join(pluginPath, ".codex-plugin"), { recursive: true });
    await fs.writeFile(path.join(pluginPath, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "documents", version: "1.2.3" }));
    const executable = path.join(root, "fake-codex");
    // Shape of `codex plugin list` on Codex 0.169.0: a remote marketplace whose SOURCE is a catalog id.
    await fs.writeFile(executable, `#!/bin/sh
printf '%s\\n' 'PLUGIN                        STATUS              VERSION  SOURCE'
printf '%s\\n' '${`documents@agentstudio-office  installed, enabled  1.2.3    ${pluginPath}`}'
printf '%s\\n' 'Marketplace \`openai-curated-remote\`'
printf '%s\\n' 'Remote catalog'
printf '%s\\n' 'visualize@openai-curated-remote  installed, enabled  1.0.89  plugin_connector_1p_e27075fa9af48191968b90b68ab08ba3'
printf '%s\\n' '${`pdf@agentstudio-office  installed, enabled  1.0.0  ${path.join(root, "missing-pdf")}`}'
`);
    await fs.chmod(executable, 0o755);

    const service = new InstalledPluginService({ baseHome: root, executable, cacheTtlMs: 0 });
    const records = await service.list();
    expect(records.map((record) => record.pluginRef)).toEqual(["documents@agentstudio-office"]);
  });

  it("lists local plugins only and serves the last good list when the CLI fails", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "installed-plugins-"));
    roots.push(root);
    const pluginPath = path.join(root, "documents");
    await fs.mkdir(path.join(pluginPath, ".codex-plugin"), { recursive: true });
    await fs.writeFile(path.join(pluginPath, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "documents", version: "1.2.3" }));
    const argsFile = path.join(root, "args");
    const failFlag = path.join(root, "fail");
    const executable = path.join(root, "fake-codex");
    await fs.writeFile(executable, `#!/bin/sh
echo "$@" > '${argsFile}'
if [ -f '${failFlag}' ]; then exit 1; fi
printf '%s\\n' '${`documents@agentstudio-office  installed, enabled  1.2.3  ${pluginPath}`}'
`);
    await fs.chmod(executable, 0o755);

    const service = new InstalledPluginService({ baseHome: root, executable, cacheTtlMs: 0 });
    const [first, second] = await Promise.all([service.list(), service.list()]);
    expect(first.map((record) => record.pluginRef)).toEqual(["documents@agentstudio-office"]);
    expect(second).toEqual(first);
    expect((await fs.readFile(argsFile, "utf8")).trim()).toBe("plugin list -c features.remote_plugin=false");

    await fs.writeFile(failFlag, "");
    expect((await service.list()).map((record) => record.pluginRef)).toEqual(["documents@agentstudio-office"]);
    await expect(new InstalledPluginService({ baseHome: root, executable, cacheTtlMs: 0 }).list()).resolves.toEqual([]);
  });

  async function visualizeFixture(input: { installedVersion: string; installedSkill: string; repoSkill: string; repoVersion: string }) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "installed-plugins-"));
    roots.push(root);
    const writePlugin = async (dir: string, version: string, skill: string) => {
      await fs.mkdir(path.join(dir, ".codex-plugin"), { recursive: true });
      await fs.mkdir(path.join(dir, "skills", "visualize"), { recursive: true });
      await fs.writeFile(path.join(dir, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "visualize", version, skills: "./skills/" }));
      await fs.writeFile(path.join(dir, "skills", "visualize", "SKILL.md"), skill);
    };
    const marketplacePlugin = path.join(root, "marketplace", "plugins", "visualize");
    const home = path.join(root, "home");
    const repo = path.join(root, "repo");
    await writePlugin(marketplacePlugin, input.installedVersion, input.installedSkill);
    await writePlugin(path.join(home, "plugins", "cache", "agentstudio-office", "visualize", input.installedVersion), input.installedVersion, input.installedSkill);
    await writePlugin(path.join(repo, "visualize"), input.repoVersion, input.repoSkill);
    const executable = path.join(root, "fake-codex");
    await fs.writeFile(executable, `#!/bin/sh
printf '%s\\n' 'visualize@agentstudio-office installed, enabled ${input.installedVersion} ${marketplacePlugin}'
`);
    await fs.chmod(executable, 0o755);
    return new InstalledPluginService({ baseHome: home, executable, cacheTtlMs: 0, managedPluginSourceRoot: repo });
  }

  const goodSkill = 'Write `<title>.html` in `.agent-studio/visualizations/`.\n::codex-inline-vis{file="<title>.html"}\n';
  const legacySkill = 'Write in `.codex/visualizations/YYYY/MM/DD/<thread-id>`.\n::codex-inline-vis{file="<title>.html"}\n';

  it("reports visualize as unavailable when the installed skill writes outside the served directory", async () => {
    const service = await visualizeFixture({
      installedVersion: "1.0.14",
      installedSkill: legacySkill,
      repoVersion: "1.0.14-agentstudio.1",
      repoSkill: goodSkill
    });
    const [visualize] = await service.list();
    expect(visualize.readiness).toBe("unavailable");
    expect(visualize.capabilityHealth).toEqual([
      expect.objectContaining({ id: "inline-visualization", status: "unavailable", detail: expect.stringContaining(".agent-studio/visualizations") }),
      expect.objectContaining({ id: "repository-sync", status: "unavailable", detail: expect.stringContaining("仓库 1.0.14-agentstudio.1，已安装 1.0.14") })
    ]);
  });

  it("reports visualize as ready when the installed files match the repository copy", async () => {
    const service = await visualizeFixture({
      installedVersion: "1.0.14-agentstudio.1",
      installedSkill: goodSkill,
      repoVersion: "1.0.14-agentstudio.1",
      repoSkill: goodSkill
    });
    const [visualize] = await service.list();
    expect(visualize.readiness).toBe("ready");
    expect(visualize.capabilityHealth.map((capability) => [capability.id, capability.status])).toEqual([
      ["inline-visualization", "ready"],
      ["repository-sync", "ready"]
    ]);
  });
});
