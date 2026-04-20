export type PublicBranding = {
  platformName: string;
  headerSubtitle: string;
  loginCopy: string;
  logoUrl: string;
  iconUrl: string;
  assistantName: string;
  assistantAvatarUrl: string;
};

export type PublicBrandingResponse = {
  branding: PublicBranding;
  publishedAt?: string;
};

export const DEFAULT_BRANDING: PublicBranding = {
  platformName: "Agent Studio",
  headerSubtitle: "Enterprise Agent Platform",
  loginCopy: "Sign in with DingTalk to continue.",
  logoUrl: "",
  iconUrl: "",
  assistantName: "Baicells AI Assistant",
  assistantAvatarUrl: ""
};
