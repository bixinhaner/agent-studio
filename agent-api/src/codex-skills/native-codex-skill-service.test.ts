import { constants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { NativeCodexSkillService } from "./native-codex-skill-service.js";

describe("NativeCodexSkillService", () => {
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
});
