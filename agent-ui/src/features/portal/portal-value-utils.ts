import { ApiError } from "../../lib/api";

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function shorten(text: string, max = 1000): string {
  const normalized = text.trim();
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}\n... (truncated)`;
}

export function detailFromUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function detailFromError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.detail || error.message || fallback;
  if (error instanceof Error) return error.message || fallback;
  const detail = detailFromUnknown(error).trim();
  return detail || fallback;
}

export function errorCodeFromUnknown(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code || error.reasonCode : undefined;
}
