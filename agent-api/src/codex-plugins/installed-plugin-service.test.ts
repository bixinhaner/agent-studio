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
