import { describe, expect, it } from "vitest";

import { isSkillPackageSelectable } from "./AgentSkillsPanel";
import type { SkillPackageRecord } from "./types";

function skillPackage(id: string, visibleToUsers: boolean): SkillPackageRecord {
  return {
    id,
    name: id === "public" ? "Public package" : "Admin package",
    slug: id,
    status: "active",
    visibleToUsers,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    items: []
  };
}

describe("AgentSkillsPanel", () => {
  it("only offers runtime-visible packages for a user-visible agent", () => {
    expect(isSkillPackageSelectable(skillPackage("public", true), true)).toBe(true);
    expect(isSkillPackageSelectable(skillPackage("admin", false), true)).toBe(false);
    expect(isSkillPackageSelectable(skillPackage("admin", false), false)).toBe(true);
  });
});
