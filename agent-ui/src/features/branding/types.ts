export type PublicBranding = {
  platformName: string;
  headerSubtitle: string;
  internalLoginCopy: string;
  externalLoginCopy: string;
  logoUrl: string;
  iconUrl: string;
  loginBackgroundUrl: string;
  portalWelcomeIllustrationUrl: string;
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
  answerFeedback: {
    enabledForExternalUsers: boolean;
    enabledForInternalUsers: boolean;
    prompt: string;
  };
};

export type PublicBrandingResponse = {
  branding: PublicBranding;
  behavior: PublicPortalBehavior;
  publishedAt?: string;
};

export const DEFAULT_BRANDING: PublicBranding = {
  platformName: "Agent Studio",
  headerSubtitle: "Enterprise Agent Platform",
  internalLoginCopy: "Sign in to continue.",
  externalLoginCopy: "Welcome. Sign in to continue.",
  logoUrl: "",
  iconUrl: "",
  loginBackgroundUrl: "",
  portalWelcomeIllustrationUrl: "",
  assistantName: "AI Assistant",
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
  ],
  answerFeedback: {
    enabledForExternalUsers: true,
    enabledForInternalUsers: false,
    prompt: "Was this answer helpful?"
  }
};
