import { describe, expect, it } from "vitest";

import { normalizeTimeOfDayPricing, pricingPeriodAt, timeOfDayPricingFromMetadata } from "./time-of-day-pricing.js";

// DeepSeek: peak 01:00-04:00 and 06:00-10:00 UTC on weekdays, i.e. 09:00-12:00 and 14:00-18:00 Beijing.
const deepseek = normalizeTimeOfDayPricing({
  timezone: "Asia/Shanghai",
  offPeakMultiplier: 0.5,
  peakWindows: [
    { weekdays: [1, 2, 3, 4, 5], start: "09:00", end: "12:00" },
    { weekdays: [1, 2, 3, 4, 5], start: "14:00", end: "18:00" }
  ],
  offPeakDates: ["2026-10-01"],
  workdayDates: ["2026-10-10"]
});

describe("time-of-day pricing", () => {
  it("is peak inside a weekday window and off-peak outside it, with exclusive window ends", () => {
    // 2026-10-21 is a Wednesday.
    expect(pricingPeriodAt(deepseek, new Date("2026-10-21T01:00:00Z"))).toEqual({ period: "peak", multiplier: 1 });
    expect(pricingPeriodAt(deepseek, new Date("2026-10-21T03:59:00Z"))).toEqual({ period: "peak", multiplier: 1 });
    expect(pricingPeriodAt(deepseek, new Date("2026-10-21T04:00:00Z"))).toEqual({ period: "off_peak", multiplier: 0.5 });
    expect(pricingPeriodAt(deepseek, new Date("2026-10-21T06:30:00Z"))).toEqual({ period: "peak", multiplier: 1 });
    expect(pricingPeriodAt(deepseek, new Date("2026-10-21T10:00:00Z"))).toEqual({ period: "off_peak", multiplier: 0.5 });
    expect(pricingPeriodAt(deepseek, new Date("2026-10-20T16:30:00Z"))).toEqual({ period: "off_peak", multiplier: 0.5 });
  });

  it("uses the configured time zone's weekday and date", () => {
    // Saturday 2026-10-24 09:30 Beijing is Saturday 01:30 UTC: weekend, off-peak.
    expect(pricingPeriodAt(deepseek, new Date("2026-10-24T01:30:00Z")).period).toBe("off_peak");
    // Monday 2026-10-26 09:30 Beijing is Monday 01:30 UTC; Sunday 23:30 UTC is still Sunday in UTC but Monday 07:30 Beijing (off-peak hour).
    expect(pricingPeriodAt(deepseek, new Date("2026-10-26T01:30:00Z")).period).toBe("peak");
    expect(pricingPeriodAt(deepseek, new Date("2026-10-25T23:30:00Z")).period).toBe("off_peak");
  });

  it("treats listed dates as off-peak all day", () => {
    // 2026-10-01 is a Thursday holiday.
    expect(pricingPeriodAt(deepseek, new Date("2026-10-01T02:00:00Z"))).toEqual({ period: "off_peak", multiplier: 0.5 });
  });

  it("prices a weekend make-up workday with the weekday windows", () => {
    // Saturday 2026-10-10 is a make-up workday: 10:00 Beijing is peak, 13:00 is not.
    expect(pricingPeriodAt(deepseek, new Date("2026-10-10T02:00:00Z")).period).toBe("peak");
    expect(pricingPeriodAt(deepseek, new Date("2026-10-10T05:00:00Z")).period).toBe("off_peak");
    expect(() => normalizeTimeOfDayPricing({ timezone: "UTC", offPeakMultiplier: 0.5,
      peakWindows: [{ weekdays: [1], start: "09:00", end: "12:00" }], offPeakDates: ["2026-10-10"], workdayDates: ["2026-10-10"] }))
      .toThrow("不能同时");
  });

  it("prices at list price without a config and rejects malformed configs", () => {
    expect(pricingPeriodAt(null, new Date())).toEqual({ period: "peak", multiplier: 1 });
    expect(normalizeTimeOfDayPricing(null)).toBeNull();
    expect(() => normalizeTimeOfDayPricing({ timezone: "Mars/Base", offPeakMultiplier: 0.5, peakWindows: [{ weekdays: [1], start: "09:00", end: "12:00" }] })).toThrow("时区");
    expect(() => normalizeTimeOfDayPricing({ timezone: "UTC", offPeakMultiplier: 0.5, peakWindows: [{ weekdays: [1], start: "12:00", end: "09:00" }] })).toThrow("高峰时段");
    expect(() => normalizeTimeOfDayPricing({ timezone: "UTC", offPeakMultiplier: -1, peakWindows: [{ weekdays: [1], start: "09:00", end: "12:00" }] })).toThrow("系数");
    expect(() => normalizeTimeOfDayPricing({ timezone: "UTC", offPeakMultiplier: 0.5, peakWindows: [{ weekdays: [8], start: "09:00", end: "12:00" }] })).toThrow("星期");
  });

  it("restores the config recorded in usage metadata and ignores broken ones", () => {
    expect(timeOfDayPricingFromMetadata({ timeOfDayPricing: deepseek })).toEqual(deepseek);
    expect(timeOfDayPricingFromMetadata({ timeOfDayPricing: { timezone: "x" } })).toBeUndefined();
    expect(timeOfDayPricingFromMetadata(undefined)).toBeUndefined();
  });
});
