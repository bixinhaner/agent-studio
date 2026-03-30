import type { SystemSettingsFieldErrors, SystemSettingsSection } from "./types";

export type ParsedSystemSettingsValidationError = {
  fieldErrors: SystemSettingsFieldErrors;
  summary: string;
};

function appendFieldError(fieldErrors: SystemSettingsFieldErrors, path: string, message: string) {
  const key = path.trim();
  if (!key) return;
  if (!fieldErrors[key]) {
    fieldErrors[key] = message;
    return;
  }
  if (fieldErrors[key] !== message) {
    fieldErrors[key] = `${fieldErrors[key]}; ${message}`;
  }
}

export function parseSystemSettingsValidationDetail(detail: string): ParsedSystemSettingsValidationError {
  const fieldErrors: SystemSettingsFieldErrors = {};
  const segments = detail
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const separatorIndex = segment.indexOf(":");
    if (separatorIndex < 0) {
      continue;
    }
    const path = segment.slice(0, separatorIndex).trim();
    const message = segment.slice(separatorIndex + 1).trim();
    if (!path || path === "body") {
      continue;
    }
    appendFieldError(fieldErrors, path, message || "无效值");
  }

  return {
    fieldErrors,
    summary: Object.keys(fieldErrors).length > 0 ? "请修正标红字段后再试" : detail
  };
}

export function sectionForFieldPath(path: string): SystemSettingsSection {
  if (path.startsWith("branding.") || path.startsWith("behavior.")) return "branding";
  if (path.startsWith("platformDefaults.")) return "model-defaults";
  if (path.startsWith("retention.") || path.startsWith("uploads.")) return "retention-upload";
  if (path.startsWith("safety.")) return "safety";
  if (path.startsWith("organizationDefaults.")) return "organization-defaults";
  return "publish-history";
}

export function firstSectionWithFieldErrors(fieldErrors: SystemSettingsFieldErrors): SystemSettingsSection | null {
  const firstPath = Object.keys(fieldErrors)[0];
  return firstPath ? sectionForFieldPath(firstPath) : null;
}

export function getFieldError(fieldErrors: SystemSettingsFieldErrors, path: string): string | undefined {
  return fieldErrors[path];
}
