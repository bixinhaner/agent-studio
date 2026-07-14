import { describe, expect, it, vi } from "vitest";

import { lockSecurityDomainsBeforeNavigation, visibleAdminSectionIds } from "./AdminShell";

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

describe("AdminShell security domain navigation", () => {
  it("locks the security domain before navigating to another section", async () => {
    const lock = vi.fn(async () => undefined);

    await lockSecurityDomainsBeforeNavigation("security-domains", "users", lock);

    expect(lock).toHaveBeenCalledOnce();
  });

  it("does not lock for navigation outside the security domain", async () => {
    const lock = vi.fn(async () => undefined);

    await lockSecurityDomainsBeforeNavigation("users", "analytics", lock);

    expect(lock).not.toHaveBeenCalled();
  });
});
