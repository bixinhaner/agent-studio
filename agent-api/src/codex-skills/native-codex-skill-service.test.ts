import { constants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { NativeCodexSkillService } from "./native-codex-skill-service.js";

describe("NativeCodexSkillService", () => {
  it("reads SKILL.md content by the catalog skill name", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-studio-skill-content-"));
    try {
      const baseHome = path.join(tempRoot, "base-home");
      const skillRoot = path.join(baseHome, "skills", "support-triage");
      const content = "---\nname: support-triage\ndescription: Triage support requests\n---\n\n# Workflow\n";
      await fs.mkdir(skillRoot, { recursive: true });
      await fs.writeFile(path.join(skillRoot, "SKILL.md"), content, "utf8");

      const service = new NativeCodexSkillService({ baseHome, sessionHomeRoot: path.join(tempRoot, "sessions") });
      await expect(service.readSkillContent("support-triage")).resolves.toMatchObject({
        skill: { name: "support-triage", relativePath: "support-triage" },
        content
      });
      await expect(service.readSkillContent("missing")).rejects.toThrow("Codex Skill 不存在");
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps Codex runtime skill directories writable in session homes", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-studio-skills-"));
    try {
      const baseHome = path.join(tempRoot, "base-home");
      const sessionHomeRoot = path.join(tempRoot, "session-homes");
      await fs.mkdir(path.join(baseHome, "skills"), { recursive: true });

      const service = new NativeCodexSkillService({ baseHome, sessionHomeRoot });
      const sessionHome = await service.materializeSessionHome({
        scopeId: "thread-1",
        enabledSkills: []
      });

      await expect(fs.access(path.join(sessionHome, "skills"), constants.W_OK)).resolves.toBeUndefined();
      await expect(fs.access(path.join(sessionHome, "skills", ".system"), constants.W_OK)).resolves.toBeUndefined();
    } finally {
      await fs.chmod(path.join(tempRoot, "session-homes", "thread-1", "skills"), 0o755).catch(() => undefined);
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("materializes nested shared CODEX_HOME scopes without rebuilding unchanged skills", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-studio-shared-skills-"));
    const scopeSegments = ["org_1", "user_1", "agent-support-abc123"];
    try {
      const baseHome = path.join(tempRoot, "base-home");
      const sessionHomeRoot = path.join(tempRoot, "session-homes");
      await fs.mkdir(path.join(baseHome, "skills"), { recursive: true });

      const service = new NativeCodexSkillService({ baseHome, sessionHomeRoot });
      const sessionHome = await service.materializeSessionHome({
        scopeSegments,
        enabledSkills: []
      });
      const expectedHome = path.join(sessionHomeRoot, ...scopeSegments);
      expect(sessionHome).toBe(expectedHome);

      const runtimeCacheFile = path.join(sessionHome, "skills", ".system", "runtime-cache.txt");
      await fs.writeFile(runtimeCacheFile, "kept", "utf8");
      await fs.chmod(path.join(sessionHome, "skills", ".system"), 0o555);
      await fs.chmod(path.join(sessionHome, "skills"), 0o555);

      await service.materializeSessionHome({
        scopeSegments,
        enabledSkills: []
      });

      await expect(fs.readFile(runtimeCacheFile, "utf8")).resolves.toBe("kept");
      await expect(fs.access(path.join(sessionHome, "skills"), constants.W_OK)).resolves.toBeUndefined();
      await expect(fs.access(path.join(sessionHome, "skills", ".system"), constants.W_OK)).resolves.toBeUndefined();
    } finally {
      await fs.chmod(path.join(tempRoot, "session-homes", ...scopeSegments, "skills"), 0o755).catch(() => undefined);
      await fs.chmod(path.join(tempRoot, "session-homes", ...scopeSegments, "skills", ".system"), 0o755).catch(() => undefined);
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("shares platform plugin caches across isolated homes and repairs missing mounts", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-studio-shared-plugins-"));
    try {
      const baseHome = path.join(tempRoot, "base-home");
      const sessionHomeRoot = path.join(tempRoot, "session-homes");
      const sharedPluginRoot = path.join(baseHome, "plugins", "cache", "agentstudio-office");
      await fs.mkdir(path.join(baseHome, "skills"), { recursive: true });
      await fs.mkdir(path.join(sharedPluginRoot, "documents", "1.0.0"), { recursive: true });
      await fs.mkdir(path.join(sharedPluginRoot, "product-design", "1.0.0"), { recursive: true });
      await fs.writeFile(path.join(sharedPluginRoot, "documents", "1.0.0", "marker.txt"), "shared", "utf8");

      const service = new NativeCodexSkillService({ baseHome, sessionHomeRoot });
      const firstHome = await service.materializeSessionHome({ scopeId: "user-1", enabledSkills: [] });
      const secondHome = await service.materializeSessionHome({ scopeId: "user-2", enabledSkills: [] });
      const firstMount = path.join(firstHome, "plugins", "cache", "agentstudio-office");
      const secondMount = path.join(secondHome, "plugins", "cache", "agentstudio-office");
      expect((await fs.lstat(firstMount)).isDirectory()).toBe(true);
      expect((await fs.lstat(secondMount)).isDirectory()).toBe(true);
      await expect(fs.readFile(path.join(firstMount, "documents", "1.0.0", "marker.txt"), "utf8")).resolves.toBe("shared");
      await expect(fs.access(path.join(firstMount, "product-design"))).rejects.toThrow();

      await fs.rm(path.join(firstMount, "documents"), { recursive: true, force: true });
      await service.materializeSessionHome({ scopeId: "user-1", enabledSkills: [] });
      await expect(fs.readFile(path.join(firstMount, "documents", "1.0.0", "marker.txt"), "utf8")).resolves.toBe("shared");
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
