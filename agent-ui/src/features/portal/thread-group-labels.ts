import { type PortalLocale } from "./i18n";
import { type ThreadOut } from "./portal-api-types";

export function formatThreadGroupLabel(value: string | undefined, locale: PortalLocale, referenceDate = new Date()): string {
  if (!value) return "";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  const dayMs = 24 * 60 * 60 * 1000;
  const currentDay = new Date(referenceDate);
  currentDay.setHours(0, 0, 0, 0);
  const targetDay = new Date(at);
  targetDay.setHours(0, 0, 0, 0);
  let diffDays = Math.floor((currentDay.getTime() - targetDay.getTime()) / dayMs);
  if (diffDays < 0) diffDays = 0;
  if (diffDays === 0) return locale === "zh-CN" ? "今天" : "Today";
  if (diffDays === 1) return locale === "zh-CN" ? "昨天" : "Yesterday";
  if (diffDays <= 7) return locale === "zh-CN" ? "最近 7 天" : "Last 7 days";
  if (diffDays <= 30) return locale === "zh-CN" ? "最近 30 天" : "Last 30 days";
  const year = targetDay.getFullYear();
  const month = String(targetDay.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export const RELATIVE_THREAD_GROUP_LABELS: ReadonlyArray<Record<PortalLocale, string>> = [
  { en: "Today", "zh-CN": "今天" },
  { en: "Yesterday", "zh-CN": "昨天" },
  { en: "Last 7 days", "zh-CN": "最近 7 天" },
  { en: "Last 30 days", "zh-CN": "最近 30 天" }
];

export function relocalizeThreadGroupLabel(value: string, locale: PortalLocale): string {
  const labels = RELATIVE_THREAD_GROUP_LABELS.find((item) => item.en === value || item["zh-CN"] === value);
  return labels?.[locale] ?? value;
}

export function rememberThreadGroupHeader(
  groupHeaderByRemoteId: Record<string, string>,
  thread: Pick<ThreadOut, "id" | "external_id">,
  groupLabel: string,
  localThreadId?: string
): void {
  if (!groupLabel) return;
  const keys = [thread.id, thread.external_id, localThreadId]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  for (const key of keys) {
    groupHeaderByRemoteId[key] = groupLabel;
  }
}

export function resolveThreadGroupHeader(
  groupHeaderByRemoteId: Record<string, string>,
  remoteId: string,
  externalId: string,
  localId: string
): string {
  return groupHeaderByRemoteId[remoteId] || groupHeaderByRemoteId[externalId] || groupHeaderByRemoteId[localId] || "";
}

export function clearThreadGroupHeaderLabel(groupHeaderByRemoteId: Record<string, string>, groupLabel: string): void {
  if (!groupLabel) return;
  for (const [key, label] of Object.entries(groupHeaderByRemoteId)) {
    if (label === groupLabel) {
      delete groupHeaderByRemoteId[key];
    }
  }
}
