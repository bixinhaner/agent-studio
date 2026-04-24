import { afterEach, describe, expect, it } from "vitest";

import { applyDocumentBranding, BRANDING_STORAGE_KEY, readStoredBrandingResponse } from "../runtime";
import { DEFAULT_BRANDING } from "../types";

describe("branding runtime", () => {
  afterEach(() => {
    window.localStorage.clear();
    document.title = "";
    document.documentElement.style.removeProperty("--auth-brand-background-image");
    for (const icon of Array.from(document.querySelectorAll('link[rel~="icon"]'))) {
      icon.remove();
    }
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
      behavior: expect.objectContaining({
        portalWelcomeMessageDesktop: expect.any(String),
        portalWelcomeMessageMobile: expect.any(String),
        portalWelcomeSuggestions: expect.any(Array)
      }),
      publishedAt: undefined
    });
  });
});
