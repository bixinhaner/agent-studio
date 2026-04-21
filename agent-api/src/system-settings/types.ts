import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { DEFAULT_MODEL, REASONING_EFFORT_VALUES } from "../model-config.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultSessionWorkspaceRoot = path.resolve(moduleDir, "..", "..", "..", "sessions");

export const systemSettingsVersionStatusSchema = z.enum(["draft", "published"]);
export type SystemSettingsVersionStatus = z.infer<typeof systemSettingsVersionStatusSchema>;

function isValidBrandAssetRef(value: string): boolean {
  if (value.length === 0) {
    return true;
  }
  if (value.startsWith("/") && !value.startsWith("//")) {
    return !/[\u0000-\u001f\u007f]/.test(value);
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const brandAssetRefOrEmptySchema = z.string().trim().refine(isValidBrandAssetRef, {
  message: "must be an empty string, an http(s) URL, or a root-relative path"
});

const positiveIntegerSchema = z.number().int().positive();
const systemSettingsUploadsBaseSchema = z.object({
  maxSingleFileBytes: positiveIntegerSchema,
  maxTotalUploadBytes: positiveIntegerSchema
});

export const systemSettingsBrandingSchema = z.object({
  platformName: z.string().trim().min(1),
  headerSubtitle: z.string().trim().min(1),
  loginCopy: z.string().trim().min(1),
  logoUrl: brandAssetRefOrEmptySchema,
  iconUrl: brandAssetRefOrEmptySchema,
  assistantName: z.string().trim().min(1).default("Baicells AI Assistant"),
  assistantAvatarUrl: brandAssetRefOrEmptySchema.default("")
});

export const systemSettingsPlatformDefaultsSchema = z.object({
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1),
  reasoningEffort: z.enum(REASONING_EFFORT_VALUES),
  sessionWorkspaceRoot: z.string().trim().min(1).default(defaultSessionWorkspaceRoot)
});

export const systemSettingsRetentionSchema = z.object({
  sessionDays: positiveIntegerSchema,
  attachmentDays: positiveIntegerSchema,
  alertDays: positiveIntegerSchema
});

export const systemSettingsUploadsSchema = systemSettingsUploadsBaseSchema.refine(
  (value) => value.maxTotalUploadBytes >= value.maxSingleFileBytes,
  {
    message: "maxTotalUploadBytes must be greater than or equal to maxSingleFileBytes",
    path: ["maxTotalUploadBytes"]
  }
);

export const systemSettingsSafetySchema = z.object({
  allowDangerFullAccess: z.boolean(),
  allowNetworkAccess: z.boolean(),
  allowLiveWebSearch: z.boolean(),
  allowCustomAdditionalDirectories: z.boolean(),
  allowFilesystemMutations: z.boolean()
});

export const systemSettingsOrganizationDefaultsSchema = z.object({
  orgSyncIntervalMinutes: positiveIntegerSchema.max(10080)
});

export const systemSettingsBehaviorSchema = z.object({
  welcomeSummary: z.string().trim().min(1),
  usageSummary: z.string().trim().min(1),
  markdown: z.string().trim().min(1),
  portalWelcomeMessageDesktop: z.string().trim().min(1),
  portalWelcomeMessageMobile: z.string().trim().min(1),
  portalWelcomeSuggestions: z.array(
    z.object({
      label: z.string().trim().min(1).max(120),
      prompt: z.string().trim().min(1).max(4000)
    })
  ).max(8)
});

export const systemSettingsPayloadSchema = z
  .object({
    branding: systemSettingsBrandingSchema,
    platformDefaults: systemSettingsPlatformDefaultsSchema,
    retention: systemSettingsRetentionSchema,
    uploads: systemSettingsUploadsSchema,
    safety: systemSettingsSafetySchema,
    organizationDefaults: systemSettingsOrganizationDefaultsSchema,
    behavior: systemSettingsBehaviorSchema
  })
  .strict();

export const systemSettingsBrandingPatchSchema = systemSettingsBrandingSchema.partial();
export const systemSettingsPlatformDefaultsPatchSchema = systemSettingsPlatformDefaultsSchema.partial();
export const systemSettingsRetentionPatchSchema = systemSettingsRetentionSchema.partial();
export const systemSettingsUploadsPatchSchema = systemSettingsUploadsBaseSchema.partial();
export const systemSettingsSafetyPatchSchema = systemSettingsSafetySchema.partial();
export const systemSettingsOrganizationDefaultsPatchSchema = systemSettingsOrganizationDefaultsSchema.partial();
export const systemSettingsBehaviorPatchSchema = systemSettingsBehaviorSchema.partial();

export const systemSettingsPayloadPatchSchema = z
  .object({
    branding: systemSettingsBrandingPatchSchema.optional(),
    platformDefaults: systemSettingsPlatformDefaultsPatchSchema.optional(),
    retention: systemSettingsRetentionPatchSchema.optional(),
    uploads: systemSettingsUploadsPatchSchema.optional(),
    safety: systemSettingsSafetyPatchSchema.optional(),
    organizationDefaults: systemSettingsOrganizationDefaultsPatchSchema.optional(),
    behavior: systemSettingsBehaviorPatchSchema.optional()
  })
  .strict();

export type SystemSettingsBranding = z.infer<typeof systemSettingsBrandingSchema>;
export type SystemSettingsPlatformDefaults = z.infer<typeof systemSettingsPlatformDefaultsSchema>;
export type SystemSettingsRetention = z.infer<typeof systemSettingsRetentionSchema>;
export type SystemSettingsUploads = z.infer<typeof systemSettingsUploadsSchema>;
export type SystemSettingsSafety = z.infer<typeof systemSettingsSafetySchema>;
export type SystemSettingsOrganizationDefaults = z.infer<typeof systemSettingsOrganizationDefaultsSchema>;
export type SystemSettingsBehavior = z.infer<typeof systemSettingsBehaviorSchema>;
export type SystemSettingsPortalWelcomeSuggestion = SystemSettingsBehavior["portalWelcomeSuggestions"][number];
export type SystemSettingsPayload = z.infer<typeof systemSettingsPayloadSchema>;
export type SystemSettingsPayloadPatch = z.infer<typeof systemSettingsPayloadPatchSchema>;

export type SystemSettingsVersionRecord = {
  id: string;
  versionNumber: number;
  revision: number;
  status: SystemSettingsVersionStatus;
  payload: SystemSettingsPayload;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  publishedByUserId?: string;
};

export type SystemSettingsPublishInput = {
  publishedByUserId: string;
};

export type DeepPartial<T> = T extends readonly (infer U)[]
  ? readonly DeepPartial<U>[]
  : T extends Array<infer U>
    ? Array<DeepPartial<U>>
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;

export const DEFAULT_SYSTEM_SETTINGS_PAYLOAD = {
  branding: {
    platformName: "Agent Studio",
    headerSubtitle: "Enterprise Agent Platform",
    loginCopy: "Sign in with DingTalk to continue.",
    logoUrl: "",
    iconUrl: "",
    assistantName: "Baicells AI Assistant",
    assistantAvatarUrl: ""
  },
  platformDefaults: {
    provider: "openai_codex",
    model: DEFAULT_MODEL,
    reasoningEffort: "high",
    sessionWorkspaceRoot: defaultSessionWorkspaceRoot
  },
  retention: {
    sessionDays: 30,
    attachmentDays: 30,
    alertDays: 14
  },
  uploads: {
    maxSingleFileBytes: 10 * 1024 * 1024,
    maxTotalUploadBytes: 50 * 1024 * 1024
  },
  safety: {
    allowDangerFullAccess: false,
    allowNetworkAccess: true,
    allowLiveWebSearch: true,
    allowCustomAdditionalDirectories: false,
    allowFilesystemMutations: true
  },
  organizationDefaults: {
    orgSyncIntervalMinutes: 24 * 60
  },
  behavior: {
    welcomeSummary: "Use approved resources and modes only.",
    usageSummary: "New sessions use published platform defaults.",
    markdown: "## Platform Behavior\n\nDetailed guidance for admins and users.",
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
  }
} satisfies SystemSettingsPayload;

export function createDefaultSystemSettingsPayload(): SystemSettingsPayload {
  return systemSettingsPayloadSchema.parse(DEFAULT_SYSTEM_SETTINGS_PAYLOAD);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergePlainObjects(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = result[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      result[key] = mergePlainObjects(current, value);
      continue;
    }
    result[key] = structuredClone(value);
  }
  return result;
}

export function mergeSystemSettingsPayload(
  base: SystemSettingsPayload,
  patch: SystemSettingsPayloadPatch
): SystemSettingsPayload {
  const merged = mergePlainObjects(base, patch);
  return systemSettingsPayloadSchema.parse(merged);
}

export function normalizeSystemSettingsPayload(value: unknown): SystemSettingsPayload {
  const patch = systemSettingsPayloadPatchSchema.parse(isPlainObject(value) ? value : {});
  return mergeSystemSettingsPayload(createDefaultSystemSettingsPayload(), patch);
}
