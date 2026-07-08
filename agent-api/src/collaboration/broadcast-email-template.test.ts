import { describe, expect, it } from "vitest";

import { renderBroadcastEmail } from "./broadcast-email-template.js";

describe("renderBroadcastEmail", () => {
  it("renders portal-branded html with variables and no test marker", () => {
    const rendered = renderBroadcastEmail({
      branding: {
        platformName: "Bailey",
        headerSubtitle: "Enterprise Agent Platform",
        internalLoginCopy: "Sign in.",
        externalLoginCopy: "Welcome.",
        logoUrl: "/public-api/branding/assets/logo.png",
        iconUrl: "",
        loginBackgroundUrl: "",
        portalWelcomeIllustrationUrl: "",
        assistantName: "Bailey",
        assistantAvatarUrl: ""
      },
      portalBaseUrl: "https://bailey.baicells.com",
      recipient: {
        userId: "user-1",
        displayName: "Adriana",
        email: "adriana@example.com",
        status: "active",
        organizationName: "La Tienda",
        organizationType: "customer"
      },
      content: {
        subject: "{{assistant_name}} usage ideas for {{organization_name}}",
        bodyMarkdown: "Hi {{user_name}},\n\nContinue exploring {{platform_name}}.",
        ctaLabel: "Open {{assistant_name}}",
        ctaUrl: "/?utm_campaign=engagement",
        language: "en"
      }
    });

    expect(rendered.subject).toBe("Bailey usage ideas for La Tienda");
    expect(rendered.text).toContain("Hi Adriana");
    expect(rendered.html).toContain("https://bailey.baicells.com/public-api/branding/assets/logo.png");
    expect(rendered.html).toContain("https://bailey.baicells.com/?utm_campaign=engagement");
    expect(rendered.html).toContain("background:#FF4614");
    expect(rendered.html.toLowerCase()).not.toContain("test");
    expect(rendered.fingerprint).toHaveLength(64);
  });
});
