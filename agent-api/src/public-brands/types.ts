import { z } from "zod";

const brandKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(50)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "key must use lowercase letters, numbers, and hyphens");

const hostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .transform((value) => value.replace(/\.$/, ""))
  .refine((value) => {
    try {
      const parsed = new URL(`https://${value}`);
      return parsed.hostname === value && !parsed.port && !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  }, "hostname is invalid");

const optionalHttpUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .nullable()
  .transform((value) => value || null)
  .refine((value) => {
    if (!value) return true;
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
      return false;
    }
  }, "URL must use http or https");

const assetUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .nullable()
  .transform((value) => value || null)
  .refine((value) => !value || value.startsWith("/") || /^https?:\/\//i.test(value), "asset URL is invalid");

const suggestionSchema = z.object({
  label: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(2000)
});

const optionalEmailSchema = z
  .string()
  .trim()
  .email("email is invalid")
  .optional()
  .nullable()
  .transform((value) => value || null);

const emailDomainSchema = hostnameSchema;

const replacementRuleSchema = z.object({
  source: z.string().trim().min(1).max(200),
  target: z.string().trim().max(200),
  mode: z.enum(["replace", "remove"])
});

export const publicBrandInputSchema = z
  .object({
    key: brandKeySchema,
    name: z.string().trim().min(1).max(100),
    status: z.enum(["active", "disabled"]),
    primaryBaseUrl: optionalHttpUrlSchema,
    primaryColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "primaryColor must be a hex color"),
    accentColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "accentColor must be a hex color"),
    platformName: z.string().trim().min(1).max(100),
    headerSubtitle: z.string().trim().min(1).max(160),
    externalLoginCopy: z.string().trim().min(1).max(300),
    logoUrl: assetUrlSchema,
    iconUrl: assetUrlSchema,
    loginBackgroundUrl: assetUrlSchema,
    portalWelcomeIllustrationUrl: assetUrlSchema,
    assistantName: z.string().trim().min(1).max(100),
    assistantAvatarUrl: assetUrlSchema,
    portalWelcomeMessageDesktop: z.string().trim().min(1).max(500),
    portalWelcomeMessageMobile: z.string().trim().min(1).max(300),
    portalWelcomeSuggestions: z.array(suggestionSchema).max(8),
    answerFeedbackEnabled: z.boolean(),
    answerFeedbackPrompt: z.string().trim().min(1).max(200),
    externalOnly: z.boolean(),
    employeeEmailDomains: z.array(emailDomainSchema).max(50).default([]),
    accessRequestEnabled: z.boolean(),
    accessSalesContactLabel: z.string().trim().min(1).max(120),
    billingEnabled: z.boolean(),
    billingSuccessUrl: optionalHttpUrlSchema,
    billingCancelUrl: optionalHttpUrlSchema,
    billingPortalUrl: optionalHttpUrlSchema,
    supportEmail: optionalEmailSchema,
    supportUrl: optionalHttpUrlSchema,
    privacyUrl: optionalHttpUrlSchema,
    termsUrl: optionalHttpUrlSchema,
    emailFromName: z.string().trim().min(1).max(120),
    emailFromAddress: optionalEmailSchema,
    emailReplyTo: optionalEmailSchema,
    emailSenderVerified: z.boolean(),
    billingMerchantName: z.string().trim().max(120).optional().nullable().transform((value) => value || null),
    billingSupportEmail: optionalEmailSchema,
    paymentAccountMode: z.enum(["shared", "connected"]),
    paymentStripeAccountId: z.string().trim().max(120).optional().nullable().transform((value) => value || null),
    paymentAccountReady: z.boolean(),
    resourceBindingMode: z.enum(["brand_managed", "organization_policy"]),
    agentModeId: z.string().trim().max(200).optional().nullable().transform((value) => value || null),
    knowledgeSetIds: z.array(z.string().trim().min(1)).max(50),
    knowledgeIsolationMode: z.enum(["direct", "brand_projection"]),
    knowledgeReplacementRules: z.array(replacementRuleSchema).max(100),
    outputProtectionEnabled: z.boolean(),
    outputForbiddenTerms: z.array(z.string().trim().min(1).max(200)).max(100),
    subscriptionPlanIds: z.array(z.string().trim().min(1)).max(50),
    domains: z
      .array(z.object({ hostname: hostnameSchema, status: z.enum(["active", "disabled"]), isPrimary: z.boolean() }))
      .min(1)
      .max(20),
    organizationIds: z.array(z.string().trim().min(1)).max(1000)
  })
  .superRefine((value, context) => {
    const activeDomains = value.domains.filter((domain) => domain.status === "active");
    if (activeDomains.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["domains"], message: "at least one active domain is required" });
    }
    if (value.domains.filter((domain) => domain.isPrimary).length !== 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["domains"], message: "exactly one primary domain is required" });
    }
    if (value.domains.find((domain) => domain.isPrimary)?.status !== "active") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["domains"], message: "the primary domain must be active" });
    }
    if (value.paymentAccountMode === "connected" && !value.paymentStripeAccountId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["paymentStripeAccountId"], message: "connected payments require a Stripe account ID" });
    }
    if (value.knowledgeIsolationMode === "brand_projection" && value.knowledgeReplacementRules.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["knowledgeReplacementRules"], message: "brand projection requires at least one replacement rule" });
    }
    if (value.outputProtectionEnabled && value.outputForbiddenTerms.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["outputForbiddenTerms"], message: "output protection requires at least one forbidden term" });
    }
  });

export type PublicBrandInput = z.infer<typeof publicBrandInputSchema>;

export type PublicBrandDomainRecord = {
  id: string;
  hostname: string;
  status: string;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PublicBrandRecord = {
  id: string;
  key: string;
  name: string;
  status: string;
  primaryBaseUrl?: string;
  primaryColor: string;
  accentColor: string;
  platformName: string;
  headerSubtitle: string;
  externalLoginCopy: string;
  logoUrl?: string;
  iconUrl?: string;
  loginBackgroundUrl?: string;
  portalWelcomeIllustrationUrl?: string;
  assistantName: string;
  assistantAvatarUrl?: string;
  portalWelcomeMessageDesktop: string;
  portalWelcomeMessageMobile: string;
  portalWelcomeSuggestions: Array<{ label: string; prompt: string }>;
  answerFeedbackEnabled: boolean;
  answerFeedbackPrompt: string;
  externalOnly: boolean;
  employeeEmailDomains: string[];
  employeeOrganizationId?: string;
  accessRequestEnabled: boolean;
  accessSalesContactLabel: string;
  billingEnabled: boolean;
  billingSuccessUrl?: string;
  billingCancelUrl?: string;
  billingPortalUrl?: string;
  supportEmail?: string;
  supportUrl?: string;
  privacyUrl?: string;
  termsUrl?: string;
  emailFromName: string;
  emailFromAddress?: string;
  emailReplyTo?: string;
  emailSenderVerified: boolean;
  billingMerchantName?: string;
  billingSupportEmail?: string;
  paymentAccountMode: "shared" | "connected";
  paymentStripeAccountId?: string;
  paymentAccountReady: boolean;
  resourceBindingMode: "brand_managed" | "organization_policy";
  agentModeId?: string;
  knowledgeSetIds: string[];
  knowledgeIsolationMode: "direct" | "brand_projection";
  knowledgeReplacementRules: Array<{ source: string; target: string; mode: "replace" | "remove" }>;
  knowledgeProjectionStorage: Record<string, string>;
  knowledgeProjectionStatus: "not_required" | "pending" | "building" | "ready" | "failed";
  knowledgeProjectionItemCount: number;
  knowledgeProjectionAt?: string;
  knowledgeProjectionError?: string;
  outputProtectionEnabled: boolean;
  outputForbiddenTerms: string[];
  subscriptionPlanIds: string[];
  createdByUserId?: string;
  updatedByUserId?: string;
  createdAt: string;
  updatedAt: string;
  domains: PublicBrandDomainRecord[];
  organizationIds: string[];
};

export type PublicBrandReadiness = {
  ready: boolean;
  checks: Array<{ key: string; ok: boolean; detail: string }>;
};
