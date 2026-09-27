import { describe, expect, it } from "vitest";
import { formatRelativeMessageTime } from "./message-time";

const labels = { justNow: "刚刚", yesterday: (time: string) => `昨天 ${time}` };
const now = new Date(2026, 8, 28, 10, 0, 0).getTime();

describe("formatRelativeMessageTime", () => {
  it("covers every range without throwing", () => {
    const cases: Array<[Date, string | RegExp]> = [
      [new Date(now - 10_000), "刚刚"],
      [new Date(now - 7 * 60_000), /7/],
      [new Date(now - 3 * 3600_000), /3/],
      [new Date(2026, 8, 27, 14, 5), /^昨天 /],
      [new Date(2026, 8, 20, 14, 5), /20/],
      [new Date(2025, 0, 3, 9, 30), /2025/]
    ];
    for (const locale of ["zh-CN", "en-US"]) {
      for (const [date, expected] of cases) {
        const label = formatRelativeMessageTime(date, now, locale, labels);
        expect(label.length).toBeGreaterThan(0);
        if (locale === "zh-CN") expect(label).toMatch(expected);
      }
    }
  });
});
