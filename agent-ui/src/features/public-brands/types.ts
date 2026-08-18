export type PublicBrandSuggestion = {
  label: string;
  prompt: string;
};

export type PublicBrandDomain = {
  id?: string;
  hostname: string;
  status: "active" | "disabled";
  isPrimary: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type PublicBrandReadiness = {
  ready: boolean;
  checks: Array<{ key: string; ok: boolean; detail: string }>;
};

export type PublicBrandInput = {
  key: string;
  name: string;
  status: "active" | "disabled";
  primaryBaseUrl: string | null;
  primaryColor: string;
  accentColor: string;
  platformName: string;
  headerSubtitle: string;
  externalLoginCopy: string;
  logoUrl: string | null;
  iconUrl: string | null;
  loginBackgroundUrl: string | null;
  portalWelcomeIllustrationUrl: string | null;
  assistantName: string;
  assistantAvatarUrl: string | null;
  portalWelcomeMessageDesktop: string;
  portalWelcomeMessageMobile: string;
  portalWelcomeSuggestions: PublicBrandSuggestion[];
  answerFeedbackEnabled: boolean;
  answerFeedbackPrompt: string;
  externalOnly: boolean;
  accessRequestEnabled: boolean;
  billingEnabled: boolean;
  billingSuccessUrl: string | null;
  billingCancelUrl: string | null;
  billingPortalUrl: string | null;
  agentModeId: string | null;
  knowledgeSetIds: string[];
  subscriptionPlanIds: string[];
  domains: PublicBrandDomain[];
  organizationIds: string[];
};

export type PublicBrandRecord = PublicBrandInput & {
  id: string;
  createdByUserId?: string;
  updatedByUserId?: string;
  createdAt: string;
  updatedAt: string;
  readiness: PublicBrandReadiness;
};

export type PublicBrandLookups = {
  agentModes: Array<{ id: string; name: string; slug: string }>;
  knowledgeSets: Array<{ id: string; name: string; slug: string }>;
  plans: Array<{ id: string; name: string; slug: string; billingStatus: string }>;
  organizations: Array<{ id: string; name: string; slug: string; publicBrandId?: string | null; status: string }>;
};
