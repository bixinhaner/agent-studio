import { describe, expect, it, vi } from "vitest";

import type { CostProfileRecord } from "../persistence/cost-profile-repository.js";
import { HolidayCalendarSync, applyHolidayYears, holidayYearsToSync, parseHolidayCnYear } from "./holiday-calendar-sync.js";
import { normalizeTimeOfDayPricing, pricingPeriodAt, type TimeOfDayPricing } from "./time-of-day-pricing.js";

const year2026 = {
  year: 2026,
  days: [
    { name: "国庆节", date: "2026-10-01", isOffDay: true },
    { name: "国庆节", date: "2026-10-02", isOffDay: true },
    { name: "国庆节", date: "2026-10-10", isOffDay: false }
  ]
};
const year2027Unpublished = { year: 2027, days: [] };

const base: TimeOfDayPricing = {
  timezone: "Asia/Shanghai",
  offPeakMultiplier: 0.5,
  peakWindows: [{ weekdays: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" }],
  offPeakDates: ["2025-12-31", "2026-05-01", "2027-01-01"],
  holidaySync: { source: "holiday-cn", includeWorkdays: false }
};

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

function profileStore(pricing: TimeOfDayPricing) {
  let profile = { id: "p1", model: "deepseek-flash", timeOfDayPricing: pricing } as CostProfileRecord;
  return {
    get current() {
      return profile;
    },
    async list() {
      return [profile];
    },
    async getById() {
      return profile;
    },
    async update(input: { id: string; changes: { timeOfDayPricing?: unknown } }) {
      profile = { ...profile, timeOfDayPricing: normalizeTimeOfDayPricing(input.changes.timeOfDayPricing) ?? undefined };
      return profile;
    }
  };
}

describe("holiday calendar sync", () => {
  it("parses holiday-cn years and treats an empty year as not yet published", () => {
    expect(parseHolidayCnYear(2026, year2026)).toEqual({ year: 2026, offDays: ["2026-10-01", "2026-10-02"], workdays: ["2026-10-10"] });
    expect(parseHolidayCnYear(2027, year2027Unpublished)).toBeNull();
    expect(() => parseHolidayCnYear(2026, { year: 2025, days: [] })).toThrow("格式不符");
    expect(() => parseHolidayCnYear(2026, { year: 2026, days: [{ date: "2027-01-01", isOffDay: true }] })).toThrow("无法识别");
  });

  it("replaces only published years, keeps the others, and adds make-up workdays only when asked", () => {
    const parsed = [parseHolidayCnYear(2026, year2026), null];
    const synced = applyHolidayYears(base, parsed, "2026-10-21T00:00:00.000Z");
    expect(synced.offPeakDates).toEqual(["2025-12-31", "2026-10-01", "2026-10-02", "2027-01-01"]);
    expect(synced.workdayDates).toBeUndefined();
    expect(synced.holidaySync).toEqual({ source: "holiday-cn", includeWorkdays: false, syncedAt: "2026-10-21T00:00:00.000Z", syncedYears: [2026] });

    const withWorkdays = applyHolidayYears({ ...base, holidaySync: { source: "holiday-cn", includeWorkdays: true } }, parsed, "2026-10-21T00:00:00.000Z");
    expect(withWorkdays.workdayDates).toEqual(["2026-10-10"]);
    expect(pricingPeriodAt(normalizeTimeOfDayPricing(withWorkdays), new Date("2026-10-10T02:00:00Z")).period).toBe("peak");
  });

  it("syncs the current and next China year", () => {
    expect(holidayYearsToSync(new Date("2026-12-31T17:00:00Z"))).toEqual([2027, 2028]);
    expect(holidayYearsToSync(new Date("2026-10-21T00:00:00Z"))).toEqual([2026, 2027]);
  });

  it("falls back to the mirror and saves the calendar into the profile", async () => {
    const store = profileStore(base);
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("raw.githubusercontent.com")) throw new Error("timeout");
      return jsonResponse(url.includes("2026.json") ? year2026 : year2027Unpublished);
    });
    const sync = new HolidayCalendarSync({ costProfiles: store, fetchFn, now: () => new Date("2026-10-21T00:00:00Z") });
    await sync.syncAll();
    expect(fetchFn).toHaveBeenCalledWith("https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/2026.json", expect.anything());
    expect(store.current.timeOfDayPricing?.offPeakDates).toEqual(["2025-12-31", "2026-10-01", "2026-10-02", "2027-01-01"]);
    expect(store.current.timeOfDayPricing?.holidaySync?.syncedYears).toEqual([2026]);
  });

  it("keeps every date and records the error when the calendar cannot be fetched", async () => {
    const store = profileStore(base);
    const sync = new HolidayCalendarSync({
      costProfiles: store,
      fetchFn: async () => jsonResponse({}, 503),
      now: () => new Date("2026-10-21T00:00:00Z")
    });
    await expect(sync.syncProfile("p1")).rejects.toThrow("节假日数据获取失败");
    expect(store.current.timeOfDayPricing?.offPeakDates).toEqual(base.offPeakDates);
    expect(store.current.timeOfDayPricing?.holidaySync).toMatchObject({ lastErrorAt: "2026-10-21T00:00:00.000Z" });
    expect(store.current.timeOfDayPricing?.holidaySync?.lastError).toContain("HTTP 503");
  });
});
