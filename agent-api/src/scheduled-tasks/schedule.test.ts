import { expect, test } from "vitest";

import { computeNextRunAt, zonedWallTimeToUtc } from "./schedule.js";

test("daily schedule in Asia/Shanghai returns the same day when time has not passed", () => {
  const after = new Date("2026-10-01T00:00:00Z"); // 08:00 Shanghai
  const next = computeNextRunAt({ frequency: "daily", timeOfDay: "09:30", timezone: "Asia/Shanghai" }, after);
  expect(next.toISOString()).toBe("2026-10-01T01:30:00.000Z");
});

test("daily schedule rolls over to the next day after the time has passed", () => {
  const after = new Date("2026-10-01T01:30:00Z");
  const next = computeNextRunAt({ frequency: "daily", timeOfDay: "09:30", timezone: "Asia/Shanghai" }, after);
  expect(next.toISOString()).toBe("2026-10-02T01:30:00.000Z");
});

test("weekdays schedule skips the weekend", () => {
  const friday = new Date("2026-10-02T02:00:00Z"); // Fri 10:00 Shanghai
  const next = computeNextRunAt({ frequency: "weekdays", timeOfDay: "09:00", timezone: "Asia/Shanghai" }, friday);
  expect(next.toISOString()).toBe("2026-10-05T01:00:00.000Z");
});

test("weekly schedule honors selected weekdays", () => {
  const after = new Date("2026-10-01T00:00:00Z"); // Thursday
  const next = computeNextRunAt(
    { frequency: "weekly", weekdays: [1, 3], timeOfDay: "18:00", timezone: "Asia/Shanghai" },
    after
  );
  expect(next.toISOString()).toBe("2026-10-05T10:00:00.000Z");
});

test("monthly schedule clamps to the last day of short months", () => {
  const after = new Date("2026-11-01T00:00:00Z");
  const next = computeNextRunAt(
    { frequency: "monthly", dayOfMonth: 31, timeOfDay: "08:00", timezone: "Asia/Shanghai" },
    after
  );
  expect(next.toISOString()).toBe("2026-11-30T00:00:00.000Z");
});

test("daylight saving time zones map wall time correctly", () => {
  const summer = zonedWallTimeToUtc({ year: 2026, month: 7, day: 1, hour: 9, minute: 0 }, "America/New_York");
  const winter = zonedWallTimeToUtc({ year: 2026, month: 12, day: 1, hour: 9, minute: 0 }, "America/New_York");
  expect(summer.toISOString()).toBe("2026-07-01T13:00:00.000Z");
  expect(winter.toISOString()).toBe("2026-12-01T14:00:00.000Z");
});
