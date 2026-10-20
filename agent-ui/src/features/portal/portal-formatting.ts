import { portalAssistantErrorMessageKey } from "./assistant-error-notice";
import { type PortalMessageKey } from "./i18n";

export const DIRECT_MESSAGE_TEXT_MAX_CHARS = 20_000;
export const GENERIC_PROCESS_ERROR_DETAIL =
  "The request could not be completed. Please try again. If the issue continues, contact your workspace admin.";
export const GENERIC_TOOL_ERROR_DETAIL = "A background tool step needs attention. Please try again or contact your workspace admin.";
export const GENERIC_EXECUTION_ERROR_DETAIL = "A background execution step needs attention. Please try again or contact your workspace admin.";

export type PortalTranslate = (key: PortalMessageKey, values?: Record<string, string | number>) => string;

export function formatAssistantErrorNotice(detail: string, code: string | undefined, t: PortalTranslate): string {
  return t(portalAssistantErrorMessageKey(detail, code));
}

export function formatUserLocalDateTime(value?: string | null): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(parsed);
}

export function coerceDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isSameLocalDate(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function formatPortalMessageTime(value: unknown, referenceDate = new Date()): { label: string; fullLabel: string; iso: string } | null {
  const date = coerceDate(value);
  if (!date) return null;

  const label = new Intl.DateTimeFormat(undefined, {
    ...(isSameLocalDate(date, referenceDate) ? {} : { dateStyle: "medium" as const }),
    timeStyle: "short"
  }).format(date);
  const fullLabel = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);

  return {
    label,
    fullLabel,
    iso: date.toISOString()
  };
}

export function userSafeProcessDetail(detail: string, fallback = GENERIC_PROCESS_ERROR_DETAIL): string {
  return detail.trim() ? fallback : "";
}
