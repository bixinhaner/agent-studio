import { describe, expect, it } from "vitest";

import { normalizeRequestHostname } from "./service.js";
import { publicBrandInputSchema } from "./types.js";

function validBrandInput() {
  return {
    key: "ranley",
    name: "Ranley",
    status: "active",
    primaryBaseUrl: "https://ranley.cloud-ran.ai",
    primaryColor: "#0066FF",
    accentColor: "#2CCFF0",
    platformName: "Ranley",
    headerSubtitle: "CloudRAN Technical Support",
    externalLoginCopy: "Sign in with your work email.",
    logoUrl: "/brands/ranley/ranley-logo.png",
    iconUrl: "/brands/ranley/assistant.png",
    loginBackgroundUrl: null,
    portalWelcomeIllustrationUrl: "/brands/ranley/assistant.png",
    assistantName: "Ranley",
    assistantAvatarUrl: "/brands/ranley/assistant.png",
    portalWelcomeMessageDesktop: "Hello, I'm {{assistantName}}.",
    portalWelcomeMessageMobile: "Ask Ranley.",
    portalWelcomeSuggestions: [{ label: "Troubleshoot", prompt: "Help me troubleshoot this issue." }],
    answerFeedbackEnabled: true,
    answerFeedbackPrompt: "Was this answer helpful?",
    externalOnly: true,
    employeeEmailDomains: ["cloud-ran.ai"],
    accessRequestEnabled: true,
    accessSalesContactLabel: "CloudRAN.AI Sales Contact",
    billingEnabled: true,
    billingSuccessUrl: "https://ranley.cloud-ran.ai/?billing=success",
    billingCancelUrl: "https://ranley.cloud-ran.ai/?billing=cancel",
    billingPortalUrl: "https://ranley.cloud-ran.ai/?billing=manage",
    emailFromName: "Ranley",
    emailFromAddress: "support@cloud-ran.ai",
    emailSenderVerified: true,
    paymentAccountMode: "connected",
    paymentStripeAccountId: "acct_ranley",
    paymentAccountReady: true,
    resourceBindingMode: "brand_managed",
    agentModeId: "mode-ranley",
    knowledgeSetIds: ["knowledge-ranley"],
    knowledgeIsolationMode: "brand_projection",
    knowledgeReplacementRules: [{ source: "Bailey", target: "Ranley", mode: "replace" }],
    outputProtectionEnabled: true,
    outputForbiddenTerms: ["Bailey", "Baicells"],
    subscriptionPlanIds: ["plan-trial"],
    domains: [{ hostname: "ranley.cloud-ran.ai", status: "active", isPrimary: true }],
    organizationIds: []
  };
}

describe("public brand configuration", () => {
  it("accepts one current active primary domain", () => {
    expect(publicBrandInputSchema.parse(validBrandInput())).toMatchObject({
      key: "ranley",
      domains: [{ hostname: "ranley.cloud-ran.ai", status: "active", isPrimary: true }]
    });
  });

  it("rejects a disabled primary domain", () => {
    expect(() => publicBrandInputSchema.parse({
      ...validBrandInput(),
      domains: [{ hostname: "ranley.cloud-ran.ai", status: "disabled", isPrimary: true }]
    })).toThrow("at least one active domain is required");
  });

  it("normalizes hostname and removes ports", () => {
    expect(normalizeRequestHostname("Ranley.Cloud-Ran.AI:443")).toBe("ranley.cloud-ran.ai");
  });
});
