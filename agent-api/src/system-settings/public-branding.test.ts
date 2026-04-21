import { describe, expect, it } from "vitest";

import { defaultPublicBehavior, resolvePublicBranding } from "./public-branding.js";
import { normalizeSystemSettingsPayload } from "./types.js";

describe("resolvePublicBranding", () => {
  it("returns published portal welcome content for public clients", async () => {
    const response = await resolvePublicBranding({
      async getCurrentPublished() {
        return {
          id: "settings-1",
          versionNumber: 2,
          revision: 4,
          status: "published",
          payload: normalizeSystemSettingsPayload({
            branding: {
              platformName: "Celix Workspace",
              headerSubtitle: "Operations",
              loginCopy: "Use SSO.",
              assistantName: "Celix",
              assistantAvatarUrl: "/assets/celix.png"
            },
            behavior: {
              portalWelcomeMessageDesktop: "Hello from {{assistantName}} on {{platformName}}.",
              portalWelcomeMessageMobile: "Hello from mobile.",
              portalWelcomeSuggestions: [
                {
                  label: "Check rollout readiness",
                  prompt: "Review this rollout plan and list the highest-risk gaps first."
                }
              ]
            }
          }),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          publishedAt: "2026-04-21T11:22:33.000Z"
        };
      }
    });

    expect(response.branding.platformName).toBe("Celix Workspace");
    expect(response.branding.assistantName).toBe("Celix");
    expect(response.branding.internalLoginCopy).toBe("Use SSO.");
    expect(response.branding.externalLoginCopy).toBe("Sign in with your work email or apply for trial access.");
    expect(response.behavior).toEqual({
      portalWelcomeMessageDesktop: "Hello from {{assistantName}} on {{platformName}}.",
      portalWelcomeMessageMobile: "Hello from mobile.",
      portalWelcomeSuggestions: [
        {
          label: "Check rollout readiness",
          prompt: "Review this rollout plan and list the highest-risk gaps first."
        }
      ]
    });
    expect(response.publishedAt).toBe("2026-04-21T11:22:33.000Z");
  });

  it("falls back to default portal welcome content when fields are missing", async () => {
    const normalized = normalizeSystemSettingsPayload({
      branding: {
        platformName: "Agent Studio"
      },
      behavior: {
        welcomeSummary: "legacy welcome",
        usageSummary: "legacy usage"
      }
    });

    expect(normalized.behavior.portalWelcomeMessageDesktop).toBe(
      defaultPublicBehavior().portalWelcomeMessageDesktop
    );
    expect(normalized.behavior.portalWelcomeMessageMobile).toBe(
      defaultPublicBehavior().portalWelcomeMessageMobile
    );
    expect(normalized.behavior.portalWelcomeSuggestions).toEqual(
      defaultPublicBehavior().portalWelcomeSuggestions
    );
    expect("welcomeSummary" in (normalized.behavior as Record<string, unknown>)).toBe(false);
    expect("usageSummary" in (normalized.behavior as Record<string, unknown>)).toBe(false);
  });
});
