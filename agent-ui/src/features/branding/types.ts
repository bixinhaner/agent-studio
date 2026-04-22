export type PublicBranding = {
  platformName: string;
  headerSubtitle: string;
  internalLoginCopy: string;
  externalLoginCopy: string;
  logoUrl: string;
  iconUrl: string;
  assistantName: string;
  assistantAvatarUrl: string;
};

export type PublicPortalWelcomeSuggestion = {
  label: string;
  prompt: string;
};

export type PublicPortalBehavior = {
  portalWelcomeMessageDesktop: string;
  portalWelcomeMessageMobile: string;
  portalWelcomeSuggestions: PublicPortalWelcomeSuggestion[];
};

export type PublicBrandingResponse = {
  branding: PublicBranding;
  behavior: PublicPortalBehavior;
  publishedAt?: string;
};

export const DEFAULT_BRANDING: PublicBranding = {
  platformName: "Celix",
  headerSubtitle: "Enterprise Agent Platform",
  internalLoginCopy: "Sign in with DingTalk to continue.",
  externalLoginCopy: "Welcome to the intelligent agent world of Celix.",
  logoUrl: "/celix-logo.png",
  iconUrl: "/celix-icon.png",
  assistantName: "Celix AI Assistant",
  assistantAvatarUrl: ""
};

export const DEFAULT_PORTAL_BEHAVIOR: PublicPortalBehavior = {
  portalWelcomeMessageDesktop: "Hello, I'm your {{assistantName}}. Ask about products, versions, deployment, alarms, or troubleshooting.",
  portalWelcomeMessageMobile: "Ask about products, versions, deployment, alarms, or troubleshooting.",
  portalWelcomeSuggestions: [
    {
      label: "Check product & version fit",
      prompt: "Help me identify the correct Baicells product line, model, software branch, and version scope for this scenario. If key context is missing, ask for the minimum details needed before giving a conclusion."
    },
    {
      label: "Review deployment plan",
      prompt: "Review this Baicells deployment or configuration plan. Point out mismatches, risks, and the recommended next steps based on official product guidance."
    },
    {
      label: "Analyze alarm or KPI issue",
      prompt: "Analyze this Baicells alarm, KPI, log, or fault symptom. Explain likely causes, the recommended troubleshooting path, and what information is still needed."
    },
    {
      label: "Recommend solution design",
      prompt: "Recommend a Baicells product or solution approach for this customer scenario, including suitable products, deployment considerations, and key constraints."
    }
  ]
};
