export type ScheduleFrequency = "daily" | "weekdays" | "weekly" | "monthly";

export type ScheduleRule = {
  frequency: ScheduleFrequency;
  /** 0 = Sunday … 6 = Saturday; used by weekly schedules. */
  weekdays?: number[];
  dayOfMonth?: number | null;
  /** Local wall-clock time in HH:MM. */
  timeOfDay: string;
  timezone: string;
};

export const SCHEDULE_FREQUENCIES: readonly ScheduleFrequency[] = ["daily", "weekdays", "weekly", "monthly"];

const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimeOfDay(value: string): boolean {
  return TIME_OF_DAY_PATTERN.test(value);
}

export function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short"
    });
    formatterCache.set(timezone, formatter);
  }
  return formatter;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localPartsAt(instant: Date, timezone: string): LocalParts & { second: number } {
  const parts = formatterFor(timezone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "0";
  return {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    hour: Number(read("hour")) % 24,
    minute: Number(read("minute")),
    second: Number(read("second")),
    weekday: WEEKDAY_INDEX[read("weekday")] ?? 0
  };
}

function timezoneOffsetMs(instant: Date, timezone: string): number {
  const local = localPartsAt(instant, timezone);
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Converts a local wall-clock time in `timezone` to a UTC instant. */
export function zonedWallTimeToUtc(
  input: { year: number; month: number; day: number; hour: number; minute: number },
  timezone: string
): Date {
  const guess = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute);
  const firstOffset = timezoneOffsetMs(new Date(guess), timezone);
  const candidate = guess - firstOffset;
  const secondOffset = timezoneOffsetMs(new Date(candidate), timezone);
  return new Date(secondOffset === firstOffset ? candidate : guess - secondOffset);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function matchesRule(rule: ScheduleRule, date: { year: number; month: number; day: number; weekday: number }): boolean {
  switch (rule.frequency) {
    case "daily":
      return true;
    case "weekdays":
      return date.weekday >= 1 && date.weekday <= 5;
    case "weekly": {
      const weekdays = rule.weekdays?.length ? rule.weekdays : [1];
      return weekdays.includes(date.weekday);
    }
    case "monthly": {
      const wanted = Math.min(Math.max(rule.dayOfMonth ?? 1, 1), 31);
      // Short months run on their last day instead of being skipped.
      return date.day === Math.min(wanted, daysInMonth(date.year, date.month));
    }
    default:
      return false;
  }
}

/** Returns the first scheduled instant strictly after `after`. */
export function computeNextRunAt(rule: ScheduleRule, after: Date): Date {
  if (!isValidTimeOfDay(rule.timeOfDay)) throw new Error(`Invalid time of day: ${rule.timeOfDay}`);
  const timezone = isValidTimezone(rule.timezone) ? rule.timezone : "Asia/Shanghai";
  const [hour, minute] = rule.timeOfDay.split(":").map(Number);
  const start = localPartsAt(after, timezone);
  const cursor = new Date(Date.UTC(start.year, start.month - 1, start.day));
  for (let index = 0; index < 400; index += 1) {
    const date = {
      year: cursor.getUTCFullYear(),
      month: cursor.getUTCMonth() + 1,
      day: cursor.getUTCDate(),
      weekday: cursor.getUTCDay()
    };
    if (matchesRule(rule, date)) {
      const instant = zonedWallTimeToUtc({ ...date, hour, minute }, timezone);
      if (instant.getTime() > after.getTime()) return instant;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  throw new Error("Unable to compute the next run time");
}
