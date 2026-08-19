export type PublicBrandSuggestion = {
  label: string;
  prompt: string;
};

export type PublicBrandReplacementRule = {
  source: string;
  target: string;
  mode: "replace" | "remove";
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
  accessSalesContactLabel: string;
  billingEnabled: boolean;
  billingSuccessUrl: string | null;
  billingCancelUrl: string | null;
  billingPortalUrl: string | null;
  supportEmail: string | null;
  supportUrl: string | null;
  privacyUrl: string | null;
  termsUrl: string | null;
  emailFromName: string;
  emailFromAddress: string | null;
  emailReplyTo: string | null;
  emailSenderVerified: boolean;
  billingMerchantName: string | null;
  billingSupportEmail: string | null;
  paymentAccountMode: "shared" | "connected";
  paymentStripeAccountId: string | null;
  paymentAccountReady: boolean;
  resourceBindingMode: "brand_managed" | "organization_policy";
  agentModeId: string | null;
  knowledgeSetIds: string[];
  knowledgeIsolationMode: "direct" | "brand_projection";
  knowledgeReplacementRules: PublicBrandReplacementRule[];
  outputProtectionEnabled: boolean;
  outputForbiddenTerms: string[];
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
  knowledgeProjectionStorage: Record<string, string>;
  knowledgeProjectionStatus: "not_required" | "pending" | "building" | "ready" | "failed";
  knowledgeProjectionItemCount: number;
  knowledgeProjectionAt?: string;
  knowledgeProjectionError?: string;
  readiness: PublicBrandReadiness;
};

export type PublicBrandLookups = {
  agentModes: Array<{ id: string; name: string; slug: string }>;
  knowledgeSets: Array<{ id: string; name: string; slug: string; itemCount?: number }>;
  plans: Array<{ id: string; name: string; slug: string; billingStatus: string }>;
  organizations: Array<{ id: string; name: string; slug: string; publicBrandId?: string | null; status: string }>;
};

export type PublicBrandEmailTransport = {
  mode: "shared" | "smtp";
  smtpHost: string | null;
  smtpPort: number;
  smtpSecurity: "starttls" | "tls" | "none";
  smtpUsername: string | null;
  passwordConfigured: boolean;
  verificationStatus: "pending" | "verified" | "failed";
  smtpConnected: boolean;
  senderAccepted: boolean;
  deliveryAccepted: boolean;
  lastTestedAt: string | null;
  lastTestError: string | null;
  credentialsRotatedAt: string | null;
  updatedAt: string | null;
};

export type PublicBrandEmailTransportInput = Pick<
  PublicBrandEmailTransport,
  "mode" | "smtpHost" | "smtpPort" | "smtpSecurity" | "smtpUsername"
> & {
  smtpPassword?: string;
  clearPassword?: boolean;
};
