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
        readiness: "ready"
      })
    ]);
  });
});
