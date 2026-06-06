import { constants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { NativeCodexSkillService } from "./native-codex-skill-service.js";

describe("NativeCodexSkillService", () => {
  it("keeps the Codex system skills directory writable in session homes", async () => {
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

      await expect(fs.access(path.join(sessionHome, "skills", ".system"), constants.W_OK)).resolves.toBeUndefined();
    } finally {
      await fs.chmod(path.join(tempRoot, "session-homes", "thread-1", "skills"), 0o755).catch(() => undefined);
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
