import { type PortalSubscriptionStatus } from "./api";
import { formatUserLocalDateTime } from "./portal-formatting";

export function isSubscriptionAccessBlocked(status: PortalSubscriptionStatus | null | undefined): status is PortalSubscriptionStatus {
  return status?.accessState === "blocked";
}

export function buildSubscriptionResetLine(status: PortalSubscriptionStatus): string {
  const resetAt = formatUserLocalDateTime(status.cycleEndsAt);
  return resetAt ? `Next reset: ${resetAt}.` : "";
}

export function buildSubscriptionAccessNotice(status: PortalSubscriptionStatus | null | undefined): string {
  if (!status) return "AI request limit reached. Please wait for the next reset or contact your workspace admin.";
  const title = status.title ? (/[.!?。！？]$/.test(status.title) ? status.title : `${status.title}.`) : "";
  return [title, status.detail, buildSubscriptionResetLine(status), status.actionLabel]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(" ");
}

export function daysUntilSubscriptionExpiry(status: PortalSubscriptionStatus | null): number | null {
  if (!status?.expiresAt) return null;
  const date = new Date(status.expiresAt);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

export function shouldShowPortalSubscriptionReminder(status: PortalSubscriptionStatus | null): boolean {
  if (!status) return false;
  if (status.accessState === "blocked") return true;
  const days = daysUntilSubscriptionExpiry(status);
  return days !== null && days >= 0 && days <= 14;
}

export function portalSubscriptionReminderKey(status: PortalSubscriptionStatus | null): string {
  if (!shouldShowPortalSubscriptionReminder(status)) return "";
  return [status?.reasonCode ?? "expiring", status?.expiresAt ?? status?.title ?? "unknown"].join(":");
}
