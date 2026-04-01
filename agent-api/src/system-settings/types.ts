import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { DEFAULT_MODEL, REASONING_EFFORT_VALUES } from "../model-config.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultSessionWorkspaceRoot = path.resolve(moduleDir, "..", "..", "..", "sessions");

export const systemSettingsVersionStatusSchema = z.enum(["draft", "published"]);
export type SystemSettingsVersionStatus = z.infer<typeof systemSettingsVersionStatusSchema>;

function isValidUrl(value: string): boolean {
  if (value.length === 0) {
    return true;
  }
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

const urlOrEmptySchema = z.string().trim().refine(isValidUrl, {
  message: "must be an empty string or a valid URL"
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
  logoUrl: urlOrEmptySchema,
  iconUrl: urlOrEmptySchema
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
  markdown: z.string().trim().min(1)
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
    iconUrl: ""
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
    markdown: "## Platform Behavior\n\nDetailed guidance for admins and users."
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
