import { z } from "zod";
import type { ZendeskCacheCleanupResult, ZendeskRunRecord, ZendeskSetupGuide } from "../zendesk/types.js";
import type { ZendeskAiReviewEmailReminderSendResult } from "../zendesk/ai-review-email-reminder-service.js";

export const integrationTypeSchema = z.enum(["dingtalk", "zendesk", "openai_codex", "openai_compatible_api", "crest_crm"]);
export type IntegrationType = z.infer<typeof integrationTypeSchema>;

export const integrationStatusSchema = z.enum(["draft", "active", "disabled", "error"]);
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;

export const integrationTriggerTypeSchema = z.enum(["manual", "automatic"]);
export type IntegrationTriggerType = z.infer<typeof integrationTriggerTypeSchema>;

export const integrationValidationStatusSchema = z.enum(["success", "failed"]);
export type IntegrationValidationStatus = z.infer<typeof integrationValidationStatusSchema>;

export const integrationPolicySubjectTypeSchema = z.enum(["role", "department", "user"]);
export type IntegrationPolicySubjectType = z.infer<typeof integrationPolicySubjectTypeSchema>;

export const integrationPolicyEffectSchema = z.enum(["allow", "deny"]);
export type IntegrationPolicyEffect = z.infer<typeof integrationPolicyEffectSchema>;

export const integrationPolicyResourceType = "integration_instance" as const;

const identifierSchema = z
  .string()
  .trim()
  .min(1, "identifier is required");

export const integrationBindingSchema = z.object({
  targetType: identifierSchema,
  targetId: identifierSchema,
  bindingType: identifierSchema,
  bindingPayload: z.unknown().optional()
});

export const integrationBindingsUpdateSchema = z.object({
  bindings: z.array(integrationBindingSchema)
});

export const integrationZendeskManualRunSchema = z.object({
  ticket_id: z.union([z.number().int().positive(), z.string().trim().min(1)])
});

export const integrationZendeskCacheCleanupQuerySchema = z.object({
  retention_days: z.coerce.number().int().min(1).max(365).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
});

export const integrationZendeskCacheCleanupRunSchema = integrationZendeskCacheCleanupQuerySchema.extend({
  confirm: z.literal(true)
});

export const integrationZendeskAiReviewEmailReminderSchema = z.object({
  mode: z.enum(["test", "live"]),
  test_email: z.string().trim().email().optional()
});

const secretLikeKeyPattern = /(api[_-]?key|access[_-]?token|token|client[_-]?secret|webhook[_-]?signing[_-]?secret|secret)/i;

function collectSecretLikeConfigKeys(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectSecretLikeConfigKeys(item, `${path}[${index}]`));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const hits: string[] = [];
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (secretLikeKeyPattern.test(key)) {
      hits.push(nextPath);
    }
    hits.push(...collectSecretLikeConfigKeys(nested, nextPath));
  }
  return hits;
}

function sanitizeSecretLikeConfigValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSecretLikeConfigValue(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (secretLikeKeyPattern.test(key)) {
      continue;
    }
    sanitized[key] = sanitizeSecretLikeConfigValue(nested);
  }
  return sanitized;
}

const recordSchema = z.record(z.string(), z.unknown());
const integrationConfigSchema = recordSchema.superRefine((value, ctx) => {
  const secretLikeKeys = [...new Set(collectSecretLikeConfigKeys(value))];
  if (secretLikeKeys.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `config must not contain secret-like keys: ${secretLikeKeys.join(", ")}`
    });
  }
});

export const integrationListQuerySchema = z.object({
  type: integrationTypeSchema.optional()
});

export const integrationExternalApiUsageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).optional(),
  take: z.coerce.number().int().min(1).max(200).optional()
});

export const integrationInstanceBaseSchema = z.object({
  type: integrationTypeSchema,
  slug: identifierSchema,
  name: identifierSchema,
  description: z.string().trim().min(1).optional().nullable(),
  status: integrationStatusSchema.optional(),
  organizationId: z.string().trim().min(1).optional().nullable(),
  config: integrationConfigSchema.optional(),
  secretState: z.unknown().optional()
});

export const integrationInstanceUpdateSchema = z.object({
  name: identifierSchema.optional(),
  slug: identifierSchema.optional(),
  description: z.string().trim().min(1).optional().nullable(),
  status: integrationStatusSchema.optional(),
  config: integrationConfigSchema.optional(),
  secretState: z.unknown().optional()
});

export const integrationPoliciesUpdateSchema = z
  .object({
    roleAllowIds: z.array(identifierSchema).optional(),
    roleDenyIds: z.array(identifierSchema).optional(),
    departmentAllowIds: z.array(identifierSchema).optional(),
    departmentDenyIds: z.array(identifierSchema).optional(),
    userAllowIds: z.array(identifierSchema).optional(),
    userDenyIds: z.array(identifierSchema).optional(),
    policies: z
      .array(
        z.object({
          subjectType: integrationPolicySubjectTypeSchema,
          subjectId: identifierSchema,
          effect: integrationPolicyEffectSchema
        })
      )
      .optional()
  })
  .strict();

export type IntegrationInstanceBaseInput = z.infer<typeof integrationInstanceBaseSchema>;
export type IntegrationInstanceUpdateInput = z.infer<typeof integrationInstanceUpdateSchema>;
export type IntegrationPoliciesUpdateInput = z.infer<typeof integrationPoliciesUpdateSchema>;
export type IntegrationBindingsUpdateInput = z.infer<typeof integrationBindingsUpdateSchema>;
export type IntegrationZendeskManualRunInput = z.infer<typeof integrationZendeskManualRunSchema>;
export type IntegrationZendeskCacheCleanupQuery = z.infer<typeof integrationZendeskCacheCleanupQuerySchema>;
export type IntegrationZendeskCacheCleanupRunInput = z.infer<typeof integrationZendeskCacheCleanupRunSchema>;

export type IntegrationPolicyInput = {
  subjectType: IntegrationPolicySubjectType;
  subjectId: string;
  effect: IntegrationPolicyEffect;
};

export type IntegrationPolicySummary = {
  allow: {
    roles: string[];
    departments: string[];
    users: string[];
  };
  deny: {
    roles: string[];
    departments: string[];
    users: string[];
  };
};

export type IntegrationListItem = {
  id: string;
  organizationId?: string;
  type: IntegrationType;
  slug: string;
  name: string;
  description?: string;
  status: IntegrationStatus | string;
  isSystemSingleton: boolean;
  createdAt: string;
  updatedAt: string;
  config?: Record<string, unknown>;
  secretState: {
    hasSecrets: boolean;
    rotatedAt?: string;
    rotatedByUserId?: string;
  };
};

export type IntegrationValidationItem = {
  id: string;
  triggerType: IntegrationTriggerType | string;
  status: IntegrationValidationStatus | string;
  summary?: unknown;
  detail?: unknown;
  triggeredByUserId?: string;
  createdAt: string;
};

export type IntegrationDetail = {
  instance: IntegrationListItem;
  config: Record<string, unknown>;
  secretState: IntegrationListItem["secretState"];
  validationHistory: {
    items: IntegrationValidationItem[];
  };
  bindings: {
    items: Array<{
      id: string;
      targetType: string;
      targetId: string;
      bindingType: string;
      bindingPayload: unknown;
      createdAt: string;
      updatedAt: string;
    }>;
  };
  policies: {
    items: Array<IntegrationPolicyInput>;
    summary: IntegrationPolicySummary;
  };
  zendesk?: {
    ready: boolean;
    missing: string[];
    setup: ZendeskSetupGuide;
    runs: ZendeskRunRecord[];
  };
};

export type IntegrationValidationResult = {
  validation: IntegrationValidationItem;
  detail: IntegrationDetail;
};

export type IntegrationZendeskRunResult = {
  result: {
    status: string;
    detail: string;
    runId: string;
    commentId?: number;
    requesterCommentId?: number;
    decision?: string;
  };
  detail: IntegrationDetail;
};

export type IntegrationZendeskCacheCleanupResult = {
  result: ZendeskCacheCleanupResult;
};

export type IntegrationZendeskAiReviewEmailReminderResult = {
  result: ZendeskAiReviewEmailReminderSendResult;
};

export type IntegrationPoliciesResult = {
  items: Array<IntegrationPolicyInput>;
  summary: IntegrationPolicySummary;
};

export type IntegrationBindingInput = z.infer<typeof integrationBindingSchema>;

export type IntegrationBindingsResult = {
  items: Array<{
    id: string;
    targetType: string;
    targetId: string;
    bindingType: string;
    bindingPayload: unknown;
    createdAt: string;
    updatedAt: string;
  }>;
};

export function createEmptyPolicySummary(): IntegrationPolicySummary {
  return {
    allow: { roles: [], departments: [], users: [] },
    deny: { roles: [], departments: [], users: [] }
  };
}

export function sanitizeIntegrationConfigForRead(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeSecretLikeConfigValue(value);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) {
    return {};
  }
  return sanitized as Record<string, unknown>;
}

export { collectSecretLikeConfigKeys };
