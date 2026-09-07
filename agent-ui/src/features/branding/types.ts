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
  primaryColor: string;
  accentColor: string;
};

export type PublicBrandIdentity = {
  id?: string;
  key: string;
  custom: boolean;
  externalOnly: boolean;
  accessRequestEnabled: boolean;
  billingEnabled: boolean;
  accessSalesContactLabel: string;
  supportEmail?: string;
  supportUrl?: string;
  privacyUrl?: string;
  termsUrl?: string;
  billingMerchantName?: string;
  billingSupportEmail?: string;
};

export type PublicPortalWelcomeSuggestion = {
  label: string;
  prompt: string;
};

export type PublicPortalBehavior = {
  portalDefaultLocale: "browser" | "en" | "zh-CN";
  portalLanguageSwitcherEnabled: boolean;
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
  brand: PublicBrandIdentity;
  adminConsole: PublicAdminConsoleConfig;
  behavior: PublicPortalBehavior;
  publishedAt?: string;
};

export type PublicAdminConsoleConfig = {
  showOperationsAndConversationMenus: boolean;
};

export const DEFAULT_ADMIN_CONSOLE_CONFIG: PublicAdminConsoleConfig = {
  showOperationsAndConversationMenus: true
};

export const DEFAULT_BRANDING: PublicBranding = {
  platformName: "Workspace",
  headerSubtitle: "Enterprise Agent Platform",
  internalLoginCopy: "Sign in to continue.",
  externalLoginCopy: "Welcome. Sign in to continue.",
  logoUrl: "",
  iconUrl: "",
  loginBackgroundUrl: "",
  portalWelcomeIllustrationUrl: "",
  assistantName: "AI Assistant",
  assistantAvatarUrl: "",
  primaryColor: "#FF4614",
  accentColor: "#FF833D"
};

export const DEFAULT_BRAND_IDENTITY: PublicBrandIdentity = {
  key: "default",
  custom: false,
  externalOnly: false,
  accessRequestEnabled: true,
  billingEnabled: true,
  accessSalesContactLabel: "Sales Contact"
};

export const DEFAULT_PORTAL_BEHAVIOR: PublicPortalBehavior = {
  portalDefaultLocale: "browser",
  portalLanguageSwitcherEnabled: true,
  portalWelcomeMessageDesktop: "Hello, I'm your {{assistantName}}. Ask about products, versions, deployment, alarms, or troubleshooting.",
  portalWelcomeMessageMobile: "Ask about products, versions, deployment, alarms, or troubleshooting.",
  portalWelcomeSuggestions: [
    {
      label: "Check product & version fit",
      prompt: "Help me identify the correct product line, model, software branch, and version scope for this scenario. If key context is missing, ask for the minimum details needed before giving a conclusion."
    },
    {
      label: "Review deployment plan",
      prompt: "Review this deployment or configuration plan. Point out mismatches, risks, and the recommended next steps based on official product guidance."
    },
    {
      label: "Analyze alarm or KPI issue",
      prompt: "Analyze this alarm, KPI, log, or fault symptom. Explain likely causes, the recommended troubleshooting path, and what information is still needed."
    },
    {
      label: "Recommend solution design",
      prompt: "Recommend a product or solution approach for this customer scenario, including suitable products, deployment considerations, and key constraints."
    }
  ],
  answerFeedback: {
    enabledForExternalUsers: true,
    enabledForInternalUsers: false,
    prompt: "Was this answer helpful?"
  }
};
