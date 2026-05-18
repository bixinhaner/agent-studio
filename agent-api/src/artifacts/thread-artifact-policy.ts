import type { SystemSettingsArtifactAccess } from "../system-settings/types.js";

export type ArtifactAccessActor = {
  id: string;
  userType?: string;
  role?: string;
  organizationId?: string;
  membershipType?: string;
  departmentIds?: string[];
};

export type ResolvedArtifactAccessPolicy = Omit<SystemSettingsArtifactAccess, "rules"> & {
  allowedExtensions: string[];
};

const POLICY_OVERRIDE_KEYS = [
  "enabled",
  "previewEnabled",
  "downloadEnabled",
  "autoRegisterGeneratedFiles",
  "maxFileBytes",
  "retentionDays",
  "allowedExtensions"
] as const;

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeExtension(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

function normalizeExtensions(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeExtension(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function ruleMatchesActor(rule: SystemSettingsArtifactAccess["rules"][number], actor: ArtifactAccessActor): boolean {
  const subjectId = trimOrUndefined(rule.subjectId);
  if (!subjectId) return false;
  if (rule.subjectType === "user_type") return trimOrUndefined(actor.userType) === subjectId;
  if (rule.subjectType === "organization") return trimOrUndefined(actor.organizationId) === subjectId;
  if (rule.subjectType === "role") return trimOrUndefined(actor.role) === subjectId;
  if (rule.subjectType === "membership_type") return trimOrUndefined(actor.membershipType) === subjectId;
  if (rule.subjectType === "department") return (actor.departmentIds ?? []).includes(subjectId);
  if (rule.subjectType === "user") return trimOrUndefined(actor.id) === subjectId;
  return false;
}

export function resolveArtifactAccessPolicy(
  config: SystemSettingsArtifactAccess,
  actor: ArtifactAccessActor
): ResolvedArtifactAccessPolicy {
  const resolved: ResolvedArtifactAccessPolicy = {
    enabled: config.enabled,
    previewEnabled: config.previewEnabled,
    downloadEnabled: config.downloadEnabled,
    autoRegisterGeneratedFiles: config.autoRegisterGeneratedFiles,
    maxFileBytes: config.maxFileBytes,
    retentionDays: config.retentionDays,
    allowedExtensions: normalizeExtensions(config.allowedExtensions),
    blockHiddenPaths: config.blockHiddenPaths,
    blockUserUploadDirectory: config.blockUserUploadDirectory,
    blockKnowledgeSetCopies: config.blockKnowledgeSetCopies,
    secretScanEnabled: config.secretScanEnabled
  };

  for (const rule of config.rules) {
    if (!ruleMatchesActor(rule, actor)) continue;
    for (const key of POLICY_OVERRIDE_KEYS) {
      const value = rule[key];
      if (value === undefined) continue;
      if (key === "allowedExtensions") {
        resolved.allowedExtensions = normalizeExtensions(value as string[]);
        continue;
      }
      (resolved as Record<string, unknown>)[key] = value;
    }
  }

  return resolved;
}
