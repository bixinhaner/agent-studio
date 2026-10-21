import type { TimeOfDayPricing } from "./types";

/** Mirrors agent-api/src/operations/time-of-day-pricing.ts so the editor can preview what the server will bill. */

export const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"] as const;

/**
 * 国务院办公厅关于 2026 年部分节假日安排的通知（国办发明电〔2025〕7号）。
 * Holidays are listed in full; weekend days in them are already off-peak, so listing them is harmless.
 */
export const CN_HOLIDAYS_2026 = [
  ...dateRange("2026-01-01", "2026-01-03"),
  ...dateRange("2026-02-15", "2026-02-23"),
  ...dateRange("2026-04-04", "2026-04-06"),
  ...dateRange("2026-05-01", "2026-05-05"),
  ...dateRange("2026-06-19", "2026-06-21"),
  ...dateRange("2026-09-25", "2026-09-27"),
  ...dateRange("2026-10-01", "2026-10-07")
];
export const CN_MAKEUP_WORKDAYS_2026 = ["2026-01-04", "2026-02-14", "2026-02-28", "2026-05-09", "2026-09-20", "2026-10-10"];

/** DeepSeek: 北京时间周一至周五（不含法定节假日）9:00-12:00、14:00-18:00 为高峰，其余时段半价。 */
export const DEEPSEEK_TIME_OF_DAY_PRICING: TimeOfDayPricing = {
  timezone: "Asia/Shanghai",
  offPeakMultiplier: 0.5,
  peakWindows: [
    { weekdays: [1, 2, 3, 4, 5], start: "09:00", end: "12:00" },
    { weekdays: [1, 2, 3, 4, 5], start: "14:00", end: "18:00" }
  ],
  offPeakDates: CN_HOLIDAYS_2026
};

export const TIMEZONE_OPTIONS = ["Asia/Shanghai", "UTC", "Asia/Singapore", "Asia/Jakarta", "America/Los_Angeles", "America/New_York", "Europe/London"];

function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let day = new Date(`${start}T00:00:00Z`); day <= new Date(`${end}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + 1)) {
    out.push(day.toISOString().slice(0, 10));
  }
  return out;
}

export function minutesOf(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Returns the first problem in Chinese, or "" when the server will accept the config. */
export function validateTimeOfDayPricing(pricing: TimeOfDayPricing): string {
  if (!pricing.timezone.trim() || !isValidTimeZone(pricing.timezone.trim())) return "时区无效，请使用 IANA 时区，例如 Asia/Shanghai。";
  if (!Number.isFinite(pricing.offPeakMultiplier) || pricing.offPeakMultiplier < 0) return "谷时价格系数需要是不小于 0 的数字。";
  if (pricing.peakWindows.length === 0) return "至少需要一个高峰时段；不需要峰谷计价时请关闭开关。";
  for (const [index, window] of pricing.peakWindows.entries()) {
    if (window.weekdays.length === 0) return `高峰时段 ${index + 1} 至少要选择一天。`;
    if (!/^\d{2}:\d{2}$/.test(window.start) || !/^\d{2}:\d{2}$/.test(window.end) || minutesOf(window.start) >= minutesOf(window.end)) {
      return `高峰时段 ${index + 1} 的结束时间需要晚于开始时间（同一天内）。`;
    }
  }
  const clash = (pricing.workdayDates ?? []).find((date) => (pricing.offPeakDates ?? []).includes(date));
  if (clash) return `${clash} 不能同时是节假日和调休上班日。`;
  return "";
}

export function pricingPeriodAt(pricing: TimeOfDayPricing, at: Date): { peak: boolean; localTime: string; date: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: pricing.timezone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value])
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const localTime = `${parts.hour}:${parts.minute}`;
  if (pricing.offPeakDates?.includes(date)) return { peak: false, localTime, date };
  const weekday = pricing.workdayDates?.includes(date) ? 1 : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday) + 1;
  const minute = minutesOf(localTime);
  const peak = pricing.peakWindows.some(
    (window) => window.weekdays.includes(weekday) && minute >= minutesOf(window.start) && minute < minutesOf(window.end)
  );
  return { peak, localTime, date };
}

export function summarizeTimeOfDayPricing(pricing: TimeOfDayPricing): string {
  const parts = [pricing.timezone, `${pricing.peakWindows.length} 个高峰时段`];
  if (pricing.offPeakDates?.length) parts.push(`节假日 ${pricing.offPeakDates.length} 天`);
  if (pricing.workdayDates?.length) parts.push(`调休 ${pricing.workdayDates.length} 天`);
  return parts.join(" · ");
}

export function formatMultiplier(value: number): string {
  return `×${new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value)}`;
}
