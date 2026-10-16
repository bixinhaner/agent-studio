import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PORTAL_THEME_BOOT_ATTRIBUTE } from "./portal-theme-boot";
import { usePortalTheme } from "./use-portal-theme";

const STORAGE_KEY = "agent-studio.portal.theme.v1";

describe("usePortalTheme", () => {
  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute(PORTAL_THEME_BOOT_ATTRIBUTE);
    vi.unstubAllGlobals();
  });

  it("stores the account preference so the next first paint matches it", () => {
    window.localStorage.setItem(STORAGE_KEY, "dark");
    const { result } = renderHook(() => usePortalTheme("light"));

    expect(result.current.resolved).toBe("light");
    expect(document.documentElement.dataset.portalTheme).toBe("light");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("light");
  });

  it("clears the pre-paint dark mark once the real theme is applied", () => {
    window.localStorage.setItem(STORAGE_KEY, "dark");
    document.documentElement.setAttribute(PORTAL_THEME_BOOT_ATTRIBUTE, "dark");
    document.documentElement.style.backgroundColor = "#141518";

    renderHook(() => usePortalTheme());

    expect(document.documentElement.hasAttribute(PORTAL_THEME_BOOT_ATTRIBUTE)).toBe(false);
    expect(document.documentElement.style.backgroundColor).toBe("");
    expect(document.documentElement.dataset.portalTheme).toBe("dark");
  });
});
