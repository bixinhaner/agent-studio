import { afterEach, describe, expect, it, vi } from "vitest";

import { applyDocumentBranding, BRANDING_STORAGE_KEY, readStoredBrandingResponse } from "../runtime";
import { resolveBrandingAssetUrl } from "../asset-url";
import { DEFAULT_ADMIN_CONSOLE_CONFIG, DEFAULT_BRAND_IDENTITY, DEFAULT_BRANDING } from "../types";

describe("branding runtime", () => {
  afterEach(() => {
    window.localStorage.clear();
    document.title = "";
    document.documentElement.style.removeProperty("--auth-brand-background-image");
    document.documentElement.style.removeProperty("--brand-primary");
    document.documentElement.style.removeProperty("--brand-accent");
    document.documentElement.style.removeProperty("--brand-primary-rgb");
    document.documentElement.style.removeProperty("--brand-accent-rgb");
    for (const icon of Array.from(document.querySelectorAll('link[rel~="icon"]'))) {
      icon.remove();
    }
    vi.unstubAllEnvs();
  });

  it("applies title, favicon, and auth background from branding", () => {
    applyDocumentBranding({
      ...DEFAULT_BRANDING,
      platformName: "Bailey",
      logoUrl: "/assets/bailey-logo.png",
      iconUrl: "/assets/bailey-icon.png",
      loginBackgroundUrl: "/assets/bailey-login-bg.png",
      portalWelcomeIllustrationUrl: "/assets/bailey-welcome.png",
      assistantName: "Bailey"
    });

    const icon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    expect(document.title).toBe("Bailey");
    expect(icon?.href).toContain("/assets/bailey-icon.png");
    expect(
      document.documentElement.style.getPropertyValue("--auth-brand-background-image")
    ).toBe('url("/assets/bailey-login-bg.png")');
    expect(document.documentElement.style.getPropertyValue("--brand-primary")).toBe(DEFAULT_BRANDING.primaryColor);
    expect(document.documentElement.style.getPropertyValue("--brand-accent")).toBe(DEFAULT_BRANDING.accentColor);
    expect(document.documentElement.style.getPropertyValue("--brand-primary-rgb")).toBe("255 70 20");
    expect(document.documentElement.style.getPropertyValue("--brand-accent-rgb")).toBe("255 131 61");
  });

  it("publishes RGB channels for brand-colored shadows and motion", () => {
    applyDocumentBranding({
      ...DEFAULT_BRANDING,
      primaryColor: "#0066FF",
      accentColor: "#2CCFF0"
    });

    expect(document.documentElement.style.getPropertyValue("--brand-primary-rgb")).toBe("0 102 255");
    expect(document.documentElement.style.getPropertyValue("--brand-accent-rgb")).toBe("44 207 240");
  });

  it("resolves uploaded branding assets through the API base", () => {
    vi.stubEnv("VITE_AGENT_API_BASE", "https://api.example.com/");

    const iconPath = "/public-api/branding/assets/icon-0123456789abcdef01234567.png";
    const backgroundPath = "/public-api/branding/assets/login-background-0123456789abcdef01234567.webp";
    expect(resolveBrandingAssetUrl(iconPath)).toBe("https://api.example.com/public-api/branding/assets/icon-0123456789abcdef01234567.png");
    expect(resolveBrandingAssetUrl("/assets/bailey-logo.png")).toBe("/assets/bailey-logo.png");

    applyDocumentBranding({
      ...DEFAULT_BRANDING,
      platformName: "Bailey",
      iconUrl: iconPath,
      loginBackgroundUrl: backgroundPath
    });

    const icon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    expect(icon?.href).toBe("https://api.example.com/public-api/branding/assets/icon-0123456789abcdef01234567.png");
    expect(
      document.documentElement.style.getPropertyValue("--auth-brand-background-image")
    ).toBe('url("https://api.example.com/public-api/branding/assets/login-background-0123456789abcdef01234567.webp")');
  });

  it("does not use logo or icon assets as the auth background fallback", () => {
    applyDocumentBranding({
      ...DEFAULT_BRANDING,
      logoUrl: "/assets/bailey-logo.png",
      iconUrl: "/assets/bailey-icon.png",
      loginBackgroundUrl: ""
    });

    expect(
      document.documentElement.style.getPropertyValue("--auth-brand-background-image")
    ).toBe("none");
  });

  it("normalizes cached branding responses before reuse", () => {
    window.localStorage.setItem(
      BRANDING_STORAGE_KEY,
      JSON.stringify({
        branding: {
          platformName: " Bailey ",
          externalLoginCopy: "Welcome aboard."
        },
        behavior: {}
      })
    );

    expect(readStoredBrandingResponse()).toEqual({
      branding: {
        ...DEFAULT_BRANDING,
        platformName: "Bailey",
        externalLoginCopy: "Welcome aboard."
      },
      brand: DEFAULT_BRAND_IDENTITY,
      adminConsole: DEFAULT_ADMIN_CONSOLE_CONFIG,
      behavior: expect.objectContaining({
        portalWelcomeMessageDesktop: expect.any(String),
        portalWelcomeMessageMobile: expect.any(String),
        portalWelcomeSuggestions: expect.any(Array)
      }),
      publishedAt: undefined
    });
  });

  it("preserves the published admin navigation visibility setting", () => {
    window.localStorage.setItem(
      BRANDING_STORAGE_KEY,
      JSON.stringify({
        branding: {},
        adminConsole: { showOperationsAndConversationMenus: false },
        behavior: {}
      })
    );

    expect(readStoredBrandingResponse()?.adminConsole.showOperationsAndConversationMenus).toBe(false);
  });
});
