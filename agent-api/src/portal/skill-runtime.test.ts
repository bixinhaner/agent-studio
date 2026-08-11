import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CODEX_RUNTIME_ERROR_CODE, CodexRuntimeUserError } from "../codex-runtime-user-error.js";
import {
  resolvePortalTurnSkillInputs,
  withExplicitSkillMentions
} from "./skill-runtime.js";

describe("portal Skill runtime", () => {
  it("resolves a selected managed Skill to its SKILL.md entrypoint", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "portal-turn-skill-"));
    try {
      const skillRoot = path.join(tempRoot, "siteapp-surge-support");
      await fs.mkdir(skillRoot, { recursive: true });
      await fs.writeFile(
        path.join(skillRoot, "SKILL.md"),
        "---\nname: siteapp-surge-support\ndescription: Inspect SiteApp\n---\n",
        "utf8"
      );

      const skillMdPath = await fs.realpath(path.join(skillRoot, "SKILL.md"));
      await expect(resolvePortalTurnSkillInputs([
        { name: "siteapp-surge-support", sourcePath: skillRoot }
      ])).resolves.toEqual([
        { name: "siteapp-surge-support", path: skillMdPath }
      ]);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects missing or mismatched managed Skill entrypoints before starting the turn", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "portal-turn-skill-invalid-"));
    try {
      await fs.writeFile(
        path.join(tempRoot, "SKILL.md"),
        "---\nname: another-skill\ndescription: Wrong package\n---\n",
        "utf8"
      );

      await expect(resolvePortalTurnSkillInputs([
        { name: "siteapp-surge-support", sourcePath: tempRoot }
      ])).rejects.toMatchObject({
        name: "CodexRuntimeUserError",
        code: CODEX_RUNTIME_ERROR_CODE.SKILL_LOAD_FAILED
      } satisfies Partial<CodexRuntimeUserError>);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("adds explicit Skill mentions without changing an existing mention", () => {
    expect(withExplicitSkillMentions("检查当前站点", [
      { name: "siteapp-surge-support" },
      { name: "documents" }
    ])).toBe("$siteapp-surge-support $documents\n\n检查当前站点");
    expect(withExplicitSkillMentions("$siteapp-surge-support 检查当前站点", [
      { name: "siteapp-surge-support" }
    ])).toBe("$siteapp-surge-support 检查当前站点");
  });

  it("keeps native Skills marker-only when they have no managed source path", async () => {
    await expect(resolvePortalTurnSkillInputs([
      { name: "skill-creator" }
    ])).resolves.toEqual([]);
  });
});
