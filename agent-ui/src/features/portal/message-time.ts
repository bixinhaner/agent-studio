function isSameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

/**
 * Relative label for a message time: "just now", "7 minutes ago", "3 hours ago",
 * "Yesterday 14:05", "Sep 26 14:05", "2025/9/26 14:05". Never throws.
 */
export function formatRelativeMessageTime(
  date: Date,
  now: number,
  intlLocale: string,
  labels: { justNow: string; yesterday: (time: string) => string }
): string {
  try {
    const diffSeconds = Math.round((now - date.getTime()) / 1000);
    if (diffSeconds < 45) return labels.justNow;
    const relative = new Intl.RelativeTimeFormat(intlLocale, { numeric: "auto" });
    if (diffSeconds < 3600) return relative.format(-Math.max(1, Math.round(diffSeconds / 60)), "minute");
    const today = new Date(now);
    if (isSameLocalDay(date, today)) return relative.format(-Math.max(1, Math.round(diffSeconds / 3600)), "hour");
    const time = new Intl.DateTimeFormat(intlLocale, { hour: "2-digit", minute: "2-digit" }).format(date);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (isSameLocalDay(date, yesterday)) return labels.yesterday(time);
    const sameYear = date.getFullYear() === today.getFullYear();
    return new Intl.DateTimeFormat(intlLocale, {
      ...(sameYear ? {} : { year: "numeric" as const }),
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}
