import type { CostProfileRecord, CostProfileRepository } from "../persistence/cost-profile-repository.js";
import { normalizeTimeOfDayPricing, type TimeOfDayPricing } from "./time-of-day-pricing.js";

/**
 * Keeps peak/off-peak cost profiles in step with China's statutory holiday calendar. Billing never calls
 * out: this job copies the calendar into each profile's time_of_day_pricing, and pricing reads only that.
 *
 * Source: holiday-cn (github.com/NateScarlet/holiday-cn), regenerated from State Council notices. A year
 * the source has not published yet (empty "days") leaves that year's existing dates alone, and a failed
 * fetch only records lastError, so a source outage never removes holidays.
 */

export type HolidayYear = { year: number; offDays: string[]; workdays: string[] };

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const SOURCE_URLS = [
  (year: number) => `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`,
  (year: number) => `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`
];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 60 * 1000;

/** Returns the published days for a year, or null when the source has not published that year yet. */
export function parseHolidayCnYear(year: number, body: unknown): HolidayYear | null {
  const record = (body ?? {}) as { year?: unknown; days?: unknown };
  if (Number(record.year) !== year || !Array.isArray(record.days)) throw new Error(`holiday-cn ${year}.json 格式不符`);
  const days = record.days.map((item) => (item ?? {}) as { date?: unknown; isOffDay?: unknown });
  if (days.some((day) => typeof day.date !== "string" || !DATE.test(day.date) || !day.date.startsWith(`${year}-`) || typeof day.isOffDay !== "boolean")) {
    throw new Error(`holiday-cn ${year}.json 含有无法识别的日期`);
  }
  if (days.length === 0) return null;
  return {
    year,
    offDays: days.filter((day) => day.isOffDay).map((day) => day.date as string).sort(),
    workdays: days.filter((day) => !day.isOffDay).map((day) => day.date as string).sort()
  };
}

export async function fetchHolidayCnYear(year: number, fetchFn: FetchLike = fetch as unknown as FetchLike): Promise<HolidayYear | null> {
  const failures: string[] = [];
  for (const url of SOURCE_URLS.map((build) => build(year))) {
    try {
      const response = await fetchFn(url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return parseHolidayCnYear(year, await response.json());
    } catch (error) {
      failures.push(`${new URL(url).host}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`节假日数据获取失败（${failures.join("；")}）`);
}

/** Replaces the dates of each published year with the calendar's; other years are kept as they are. */
export function applyHolidayYears(pricing: TimeOfDayPricing, years: Array<HolidayYear | null>, syncedAt: string): TimeOfDayPricing {
  const published = years.filter((year): year is HolidayYear => year !== null);
  const includeWorkdays = pricing.holidaySync?.includeWorkdays === true;
  const replace = (current: string[] | undefined, pick: (year: HolidayYear) => string[]) => {
    const kept = (current ?? []).filter((date) => !published.some((year) => date.startsWith(`${year.year}-`)));
    return [...new Set([...kept, ...published.flatMap(pick)])].sort();
  };
  const offPeakDates = replace(pricing.offPeakDates, (year) => year.offDays);
  const workdayDates = includeWorkdays ? replace(pricing.workdayDates, (year) => year.workdays) : pricing.workdayDates ?? [];
  return {
    ...pricing,
    offPeakDates: offPeakDates.length > 0 ? offPeakDates : undefined,
    workdayDates: workdayDates.length > 0 ? workdayDates : undefined,
    holidaySync: {
      source: "holiday-cn",
      includeWorkdays,
      syncedAt,
      ...(published.length > 0 ? { syncedYears: published.map((year) => year.year) } : {})
    }
  };
}

/** Current and next year in China, so a newly published calendar is picked up before it starts. */
export function holidayYearsToSync(now: Date): number[] {
  const year = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric" }).format(now));
  return [year, year + 1];
}

export class HolidayCalendarSync {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly options: {
      costProfiles: Pick<CostProfileRepository, "list" | "getById" | "update">;
      fetchFn?: FetchLike;
      now?: () => Date;
      logger?: Pick<Console, "info" | "warn">;
    }
  ) {}

  start(): void {
    if (this.timer) return;
    const tick = () => {
      void this.syncAll().finally(() => {
        this.timer = setTimeout(tick, SYNC_INTERVAL_MS);
        this.timer.unref?.();
      });
    };
    this.timer = setTimeout(tick, FIRST_RUN_DELAY_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async syncAll(): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      const profiles = (await this.options.costProfiles.list()).filter((profile) => profile.timeOfDayPricing?.holidaySync);
      for (const profile of profiles) {
        await this.syncProfile(profile.id).catch(() => undefined);
      }
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Syncs one profile now. Throws (after recording lastError) when the calendar cannot be fetched. */
  async syncProfile(profileId: string): Promise<CostProfileRecord> {
    const now = (this.options.now ?? (() => new Date()))();
    const before = await this.options.costProfiles.getById(profileId);
    if (!before?.timeOfDayPricing?.holidaySync) throw new Error("该定价未开启节假日自动同步");
    let years: Array<HolidayYear | null>;
    try {
      years = await Promise.all(holidayYearsToSync(now).map((year) => fetchHolidayCnYear(year, this.options.fetchFn)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.logger?.warn(`holiday calendar sync failed for ${before.model}: ${message}`);
      const latest = (await this.options.costProfiles.getById(profileId)) ?? before;
      if (latest.timeOfDayPricing?.holidaySync) {
        await this.options.costProfiles.update({
          id: profileId,
          changes: {
            timeOfDayPricing: {
              ...latest.timeOfDayPricing,
              holidaySync: { ...latest.timeOfDayPricing.holidaySync, lastError: message, lastErrorAt: now.toISOString() }
            }
          }
        });
      }
      throw error;
    }
    // Re-read so an admin edit made while fetching is not overwritten.
    const latest = await this.options.costProfiles.getById(profileId);
    if (!latest?.timeOfDayPricing?.holidaySync) throw new Error("该定价已关闭节假日自动同步");
    const next = normalizeTimeOfDayPricing(applyHolidayYears(latest.timeOfDayPricing, years, now.toISOString()));
    const updated = await this.options.costProfiles.update({ id: profileId, changes: { timeOfDayPricing: next } });
    const added = (next?.offPeakDates ?? []).filter((date) => !latest.timeOfDayPricing?.offPeakDates?.includes(date));
    if (added.length > 0) this.options.logger?.info(`holiday calendar sync added ${added.length} off-peak date(s) to ${latest.model}`);
    return updated;
  }
}
