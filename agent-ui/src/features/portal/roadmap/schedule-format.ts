import type { PortalMessageKey } from "../i18n";
import type { ScheduledTask } from "./api";

type Translate = (key: PortalMessageKey, values?: Record<string, string | number>) => string;

export function describeSchedule(
  task: Pick<ScheduledTask, "frequency" | "weekdays" | "day_of_month" | "time_of_day">,
  t: Translate
): string {
  const time = task.time_of_day;
  switch (task.frequency) {
    case "daily":
      return t("tasks.scheduleDaily", { time });
    case "weekdays":
      return t("tasks.scheduleWeekdays", { time });
    case "weekly": {
      const days = [...task.weekdays]
        .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
        .map((day) => t(`tasks.weekday.${day}` as PortalMessageKey))
        .join("、");
      return t("tasks.scheduleWeekly", { days, time });
    }
    case "monthly":
      return t("tasks.scheduleMonthly", { day: task.day_of_month ?? 1, time });
    default:
      return time;
  }
}

export function formatDateTime(value: string | null | undefined, intlLocale: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(intlLocale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

export function formatDuration(ms: number, locale: string): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const zh = locale === "zh-CN";
  if (hours > 0) return zh ? `${hours} 小时 ${minutes % 60} 分` : `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return zh ? `${minutes} 分 ${seconds % 60} 秒` : `${minutes}m ${seconds % 60}s`;
  return zh ? `${seconds} 秒` : `${seconds}s`;
}

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
  } catch {
    return "Asia/Shanghai";
  }
}
