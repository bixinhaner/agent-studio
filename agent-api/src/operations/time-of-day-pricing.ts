/**
 * Peak/off-peak pricing for a cost profile. Profile prices are the peak (list) prices; outside
 * the peak windows, and on the listed off-peak dates (e.g. public holidays), every token price is
 * multiplied by offPeakMultiplier. Windows and dates are read in the given IANA time zone.
 */
export type TimeOfDayPeakWindow = {
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  weekdays: number[];
  /** "HH:MM", inclusive. */
  start: string;
  /** "HH:MM", exclusive. */
  end: string;
};

export type TimeOfDayPricing = {
  timezone: string;
  peakWindows: TimeOfDayPeakWindow[];
  offPeakMultiplier: number;
  /** "YYYY-MM-DD" dates that are off-peak all day. */
  offPeakDates?: string[];
};

export type PricingPeriod = {
  period: "peak" | "off_peak";
  multiplier: number;
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function minutes(value: string): number {
  const [hours, mins] = value.split(":").map(Number);
  return hours * 60 + mins;
}

function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Validates admin input; returns null for "no time-of-day pricing" and throws on malformed config. */
export function normalizeTimeOfDayPricing(value: unknown): TimeOfDayPricing | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("峰谷计价配置必须是对象");
  const record = value as Record<string, unknown>;
  const timezone = typeof record.timezone === "string" ? record.timezone.trim() : "";
  if (!timezone || !isValidTimeZone(timezone)) throw new Error("峰谷计价时区无效");
  const offPeakMultiplier = Number(record.offPeakMultiplier);
  if (!Number.isFinite(offPeakMultiplier) || offPeakMultiplier < 0) throw new Error("谷时价格系数无效");
  if (!Array.isArray(record.peakWindows) || record.peakWindows.length === 0) throw new Error("至少需要一个高峰时段");
  const peakWindows = record.peakWindows.map((item) => {
    const window = (item ?? {}) as Record<string, unknown>;
    const weekdays = Array.isArray(window.weekdays) ? window.weekdays.map(Number) : [];
    if (weekdays.length === 0 || weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) {
      throw new Error("高峰时段的星期必须是 1-7");
    }
    const start = String(window.start ?? "");
    const end = String(window.end ?? "");
    if (!TIME.test(start) || !TIME.test(end) || minutes(start) >= minutes(end)) {
      throw new Error("高峰时段必须是同一天内的 HH:MM 起止时间");
    }
    return { weekdays: [...new Set(weekdays)].sort(), start, end };
  });
  const offPeakDates = Array.isArray(record.offPeakDates) ? record.offPeakDates.map(String) : [];
  if (offPeakDates.some((date) => !DATE.test(date))) throw new Error("谷时日期必须是 YYYY-MM-DD");
  return {
    timezone,
    peakWindows,
    offPeakMultiplier,
    ...(offPeakDates.length > 0 ? { offPeakDates: [...new Set(offPeakDates)].sort() } : {})
  };
}

/** Peak or off-peak, and the price multiplier, for a usage event at the given instant. */
export function pricingPeriodAt(pricing: TimeOfDayPricing | null | undefined, at: Date): PricingPeriod {
  if (!pricing) return { period: "peak", multiplier: 1 };
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
  const weekday = WEEKDAYS[parts.weekday];
  const minuteOfDay = Number(parts.hour) * 60 + Number(parts.minute);
  const offPeak = { period: "off_peak" as const, multiplier: pricing.offPeakMultiplier };
  if (pricing.offPeakDates?.includes(date)) return offPeak;
  const inPeak = pricing.peakWindows.some(
    (window) => window.weekdays.includes(weekday) && minuteOfDay >= minutes(window.start) && minuteOfDay < minutes(window.end)
  );
  return inPeak ? { period: "peak", multiplier: 1 } : offPeak;
}

/** The time-of-day config recorded in a usage event's cost metadata, for repricing historical events. */
export function timeOfDayPricingFromMetadata(costMetadata: unknown): TimeOfDayPricing | undefined {
  const value = (costMetadata as Record<string, unknown> | null | undefined)?.timeOfDayPricing;
  try {
    return normalizeTimeOfDayPricing(value) ?? undefined;
  } catch {
    return undefined;
  }
}
