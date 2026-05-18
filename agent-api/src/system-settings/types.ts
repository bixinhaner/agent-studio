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
const artifactExtensionSchema = z.string().trim().regex(/^\.[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/, {
  message: "must start with a dot and contain only letters, numbers, underscores, or hyphens"
});
const artifactAccessOverrideSchema = z
  .object({
    enabled: z.boolean().optional(),
    previewEnabled: z.boolean().optional(),
    downloadEnabled: z.boolean().optional(),
    autoRegisterGeneratedFiles: z.boolean().optional(),
    maxFileBytes: positiveIntegerSchema.optional(),
    retentionDays: positiveIntegerSchema.optional(),
    allowedExtensions: z.array(artifactExtensionSchema).max(80).optional()
  })
  .strict();

export const systemSettingsBrandingSchema = z.object({
  platformName: z.string().trim().min(1),
  headerSubtitle: z.string().trim().min(1),
  internalLoginCopy: z.string().trim().min(1),
  externalLoginCopy: z.string().trim().min(1),
  logoUrl: brandAssetRefOrEmptySchema,
  iconUrl: brandAssetRefOrEmptySchema,
  loginBackgroundUrl: brandAssetRefOrEmptySchema.default(""),
  portalWelcomeIllustrationUrl: brandAssetRefOrEmptySchema.default(""),
  assistantName: z.string().trim().min(1).default("AI Assistant"),
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

export const systemSettingsArtifactAccessRuleSchema = artifactAccessOverrideSchema
  .extend({
    id: z.string().trim().max(80).optional(),
    label: z.string().trim().max(120).optional(),
    subjectType: z.enum(["user_type", "organization", "role", "membership_type", "department", "user"]),
    subjectId: z.string().trim().min(1).max(200)
  })
  .strict();

export const systemSettingsArtifactAccessSchema = z
  .object({
    enabled: z.boolean(),
    previewEnabled: z.boolean(),
    downloadEnabled: z.boolean(),
    autoRegisterGeneratedFiles: z.boolean(),
    maxFileBytes: positiveIntegerSchema,
    retentionDays: positiveIntegerSchema,
    allowedExtensions: z.array(artifactExtensionSchema).min(1).max(80),
    blockHiddenPaths: z.boolean(),
    blockUserUploadDirectory: z.boolean(),
    blockKnowledgeSetCopies: z.boolean(),
    secretScanEnabled: z.boolean(),
    rules: z.array(systemSettingsArtifactAccessRuleSchema).max(100)
  })
  .strict();

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

export const systemSettingsAnswerFeedbackSchema = z.object({
  enabledForExternalUsers: z.boolean().default(true),
  enabledForInternalUsers: z.boolean().default(false),
  prompt: z.string().trim().min(1).max(160).default("Was this answer helpful?")
});

export const systemSettingsBehaviorSchema = z.object({
  markdown: z.string().trim().min(1),
  portalWelcomeMessageDesktop: z.string().trim().min(1),
  portalWelcomeMessageMobile: z.string().trim().min(1),
  portalWelcomeSuggestions: z.array(
    z.object({
      label: z.string().trim().min(1).max(120),
      prompt: z.string().trim().min(1).max(4000)
    })
  ).max(8),
  answerFeedback: systemSettingsAnswerFeedbackSchema.default({
    enabledForExternalUsers: true,
    enabledForInternalUsers: false,
    prompt: "Was this answer helpful?"
  })
});

export const systemSettingsPayloadSchema = z
  .object({
    branding: systemSettingsBrandingSchema,
    platformDefaults: systemSettingsPlatformDefaultsSchema,
    retention: systemSettingsRetentionSchema,
    uploads: systemSettingsUploadsSchema,
    artifactAccess: systemSettingsArtifactAccessSchema,
    safety: systemSettingsSafetySchema,
    organizationDefaults: systemSettingsOrganizationDefaultsSchema,
    behavior: systemSettingsBehaviorSchema
  })
  .strict();

export const systemSettingsBrandingPatchSchema = systemSettingsBrandingSchema.partial();
export const systemSettingsPlatformDefaultsPatchSchema = systemSettingsPlatformDefaultsSchema.partial();
export const systemSettingsRetentionPatchSchema = systemSettingsRetentionSchema.partial();
export const systemSettingsUploadsPatchSchema = systemSettingsUploadsBaseSchema.partial();
export const systemSettingsArtifactAccessPatchSchema = systemSettingsArtifactAccessSchema.partial();
export const systemSettingsSafetyPatchSchema = systemSettingsSafetySchema.partial();
export const systemSettingsOrganizationDefaultsPatchSchema = systemSettingsOrganizationDefaultsSchema.partial();
export const systemSettingsBehaviorPatchSchema = systemSettingsBehaviorSchema.partial();

export const systemSettingsPayloadPatchSchema = z
  .object({
    branding: systemSettingsBrandingPatchSchema.optional(),
    platformDefaults: systemSettingsPlatformDefaultsPatchSchema.optional(),
    retention: systemSettingsRetentionPatchSchema.optional(),
    uploads: systemSettingsUploadsPatchSchema.optional(),
    artifactAccess: systemSettingsArtifactAccessPatchSchema.optional(),
    safety: systemSettingsSafetyPatchSchema.optional(),
    organizationDefaults: systemSettingsOrganizationDefaultsPatchSchema.optional(),
    behavior: systemSettingsBehaviorPatchSchema.optional()
  })
  .strict();

export type SystemSettingsBranding = z.infer<typeof systemSettingsBrandingSchema>;
export type SystemSettingsPlatformDefaults = z.infer<typeof systemSettingsPlatformDefaultsSchema>;
export type SystemSettingsRetention = z.infer<typeof systemSettingsRetentionSchema>;
export type SystemSettingsUploads = z.infer<typeof systemSettingsUploadsSchema>;
export type SystemSettingsArtifactAccess = z.infer<typeof systemSettingsArtifactAccessSchema>;
export type SystemSettingsArtifactAccessRule = z.infer<typeof systemSettingsArtifactAccessRuleSchema>;
export type SystemSettingsSafety = z.infer<typeof systemSettingsSafetySchema>;
export type SystemSettingsOrganizationDefaults = z.infer<typeof systemSettingsOrganizationDefaultsSchema>;
export type SystemSettingsAnswerFeedback = z.infer<typeof systemSettingsAnswerFeedbackSchema>;
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
    internalLoginCopy: "Sign in to continue.",
    externalLoginCopy: "Welcome. Sign in to continue.",
    logoUrl: "",
    iconUrl: "",
    loginBackgroundUrl: "",
    portalWelcomeIllustrationUrl: "",
    assistantName: "AI Assistant",
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
  artifactAccess: {
    enabled: false,
    previewEnabled: true,
    downloadEnabled: true,
    autoRegisterGeneratedFiles: true,
    maxFileBytes: 25 * 1024 * 1024,
    retentionDays: 30,
    allowedExtensions: [
      ".txt",
      ".md",
      ".markdown",
      ".csv",
      ".tsv",
      ".json",
      ".yaml",
      ".yml",
      ".pdf",
      ".docx",
      ".xlsx",
      ".pptx",
      ".png",
      ".jpg",
      ".jpeg",
      ".webp"
    ],
    blockHiddenPaths: true,
    blockUserUploadDirectory: true,
    blockKnowledgeSetCopies: true,
    secretScanEnabled: true,
    rules: []
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
    ],
    answerFeedback: {
      enabledForExternalUsers: true,
      enabledForInternalUsers: false,
      prompt: "Was this answer helpful?"
    }
  }
} satisfies SystemSettingsPayload;

export function createDefaultSystemSettingsPayload(): SystemSettingsPayload {
  return systemSettingsPayloadSchema.parse(DEFAULT_SYSTEM_SETTINGS_PAYLOAD);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeBehaviorPatch(value: unknown): unknown {
  if (!isPlainObject(value)) {
    return value;
  }
  const next = { ...value };
  delete next.welcomeSummary;
  delete next.usageSummary;
  return next;
}

function sanitizeBrandingPatch(value: unknown): unknown {
  if (!isPlainObject(value)) {
    return value;
  }
  const next: Record<string, unknown> = { ...value };
  const legacyLoginCopy = typeof next.loginCopy === "string" ? next.loginCopy.trim() : "";
  if (legacyLoginCopy) {
    if (typeof next.internalLoginCopy !== "string" || !next.internalLoginCopy.trim()) {
      next.internalLoginCopy = legacyLoginCopy;
    }
    if (typeof next.externalLoginCopy !== "string" || !next.externalLoginCopy.trim()) {
      next.externalLoginCopy = DEFAULT_SYSTEM_SETTINGS_PAYLOAD.branding.externalLoginCopy;
    }
  }
  delete next.loginCopy;
  return next;
}

function sanitizeSystemSettingsPayloadLike(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) {
    return {};
  }
  const next = { ...value };
  if ("branding" in next) {
    next.branding = sanitizeBrandingPatch(next.branding);
  }
  if ("behavior" in next) {
    next.behavior = sanitizeBehaviorPatch(next.behavior);
  }
  return next;
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

export function parseSystemSettingsPayloadPatch(value: unknown): SystemSettingsPayloadPatch {
  return systemSettingsPayloadPatchSchema.parse(sanitizeSystemSettingsPayloadLike(value));
}

export function normalizeSystemSettingsPayload(value: unknown): SystemSettingsPayload {
  const patch = parseSystemSettingsPayloadPatch(value);
  return mergeSystemSettingsPayload(createDefaultSystemSettingsPayload(), patch);
}
