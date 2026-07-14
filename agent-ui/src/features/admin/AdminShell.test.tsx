import { describe, expect, it } from "vitest";

import { visibleAdminSectionIds } from "./AdminShell";

describe("AdminShell navigation visibility", () => {
  it("keeps operations analytics and conversations visible by default", () => {
    expect(visibleAdminSectionIds(true)).toEqual(expect.arrayContaining(["analytics", "conversations"]));
  });

  it("hides operations analytics and conversations together", () => {
    const sections = visibleAdminSectionIds(false);

    expect(sections).not.toContain("analytics");
    expect(sections).not.toContain("conversations");
    expect(sections).toContain("system-settings");
    expect(sections).toContain("security-domains");
  });
});
