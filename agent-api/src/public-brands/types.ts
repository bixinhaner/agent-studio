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
    accessRequestEnabled: z.boolean(),
    billingEnabled: z.boolean(),
    billingSuccessUrl: optionalHttpUrlSchema,
    billingCancelUrl: optionalHttpUrlSchema,
    billingPortalUrl: optionalHttpUrlSchema,
    agentModeId: z.string().trim().max(200).optional().nullable().transform((value) => value || null),
    knowledgeSetIds: z.array(z.string().trim().min(1)).max(50),
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
  accessRequestEnabled: boolean;
  billingEnabled: boolean;
  billingSuccessUrl?: string;
  billingCancelUrl?: string;
  billingPortalUrl?: string;
  agentModeId?: string;
  knowledgeSetIds: string[];
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
