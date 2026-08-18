import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BRAND_PREVIEW_SCENES, BrandCustomerPreview } from "./BrandCustomerPreview";
import type { PublicBrandInput } from "./types";

const brand: PublicBrandInput = {
  key: "ranley",
  name: "Ranley",
  status: "active",
  primaryBaseUrl: "https://ranley.example.com",
  primaryColor: "#0066FF",
  accentColor: "#2CCFF0",
  platformName: "Ranley AI",
  headerSubtitle: "Enterprise AI Assistant",
  externalLoginCopy: "Sign in with your work email to continue.",
  logoUrl: "/assets/ranley-logo.png",
  iconUrl: "/assets/ranley-icon.png",
  loginBackgroundUrl: "/assets/ranley-login.png",
  portalWelcomeIllustrationUrl: "/assets/ranley-welcome.png",
  assistantName: "Ranley Assistant",
  assistantAvatarUrl: "/assets/ranley-assistant.png",
  portalWelcomeMessageDesktop: "Hello, I'm {{assistantName}}. How can I help?",
  portalWelcomeMessageMobile: "Ask {{assistantName}} anything.",
  portalWelcomeSuggestions: [{ label: "Summarize a document", prompt: "Summarize this document" }],
  answerFeedbackEnabled: true,
  answerFeedbackPrompt: "Was this answer helpful?",
  externalOnly: true,
  accessRequestEnabled: true,
  accessSalesContactLabel: "Account manager",
  billingEnabled: true,
  billingSuccessUrl: "https://ranley.example.com/billing/success",
  billingCancelUrl: "https://ranley.example.com/billing",
  billingPortalUrl: "https://billing.example.com",
  supportEmail: "help@ranley.example.com",
  supportUrl: "https://ranley.example.com/help",
  privacyUrl: "https://ranley.example.com/privacy",
  termsUrl: "https://ranley.example.com/terms",
  emailFromName: "Ranley Customer Care",
  emailFromAddress: "notifications@ranley.example.com",
  emailReplyTo: "help@ranley.example.com",
  emailSenderVerified: true,
  billingMerchantName: "Ranley Cloud Services",
  billingSupportEmail: "billing@ranley.example.com",
  paymentAccountMode: "shared",
  paymentStripeAccountId: null,
  paymentAccountReady: true,
  resourceBindingMode: "brand_managed",
  agentModeId: "agent-ranley",
  knowledgeSetIds: ["knowledge-ranley"],
  knowledgeIsolationMode: "brand_projection",
  knowledgeReplacementRules: [],
  outputProtectionEnabled: true,
  outputForbiddenTerms: ["Bailey"],
  subscriptionPlanIds: ["plan-team"],
  domains: [{ hostname: "ranley.example.com", status: "active", isPrimary: true }],
  organizationIds: ["org-ranley"]
};

afterEach(cleanup);

describe("BrandCustomerPreview", () => {
  it("renders every customer journey scene", () => {
    expect(BRAND_PREVIEW_SCENES.map((item) => item.value)).toEqual([
      "login",
      "portal",
      "conversation",
      "access",
      "billing",
      "email",
      "share"
    ]);

    for (const { value } of BRAND_PREVIEW_SCENES) {
      const { container, unmount } = render(
        <BrandCustomerPreview brand={brand} scene={value} device="desktop" planNames={["Team Plus"]} />
      );
      expect(container.querySelector(`[data-preview-scene="${value}"]`)).not.toBeNull();
      expect(screen.getByText("ranley.example.com")).toBeTruthy();
      unmount();
    }
  });

  it("uses the draft brand identity in portal, billing, and email previews", () => {
    const { container, rerender } = render(
      <BrandCustomerPreview brand={brand} scene="portal" device="mobile" planNames={["Team Plus"]} />
    );

    const frame = container.querySelector<HTMLElement>(".brand-preview-frame");
    expect(frame?.style.getPropertyValue("--preview-brand")).toBe("#0066FF");
    expect(frame?.style.getPropertyValue("--preview-accent")).toBe("#2CCFF0");
    expect(screen.getByText("Ask Ranley Assistant anything.")).toBeTruthy();

    rerender(<BrandCustomerPreview brand={brand} scene="billing" device="desktop" planNames={["Team Plus"]} />);
    expect(screen.getByText("Team Plus")).toBeTruthy();
    expect(screen.getByText("Ranley Cloud Services")).toBeTruthy();

    rerender(<BrandCustomerPreview brand={brand} scene="email" device="desktop" planNames={["Team Plus"]} />);
    expect(screen.getByText("Ranley Customer Care")).toBeTruthy();
    expect(screen.getByText("notifications@ranley.example.com")).toBeTruthy();
  });
});
