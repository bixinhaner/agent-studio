import { describe, expect, it } from "vitest";

import { formatListTimestamp, formatUsdAmount, plainTextPreview } from "./formatters";

describe("formatUsdAmount", () => {
  it("groups thousands and keeps precision proportional to the amount", () => {
    expect(formatUsdAmount("5765.746049")).toBe("USD 5,765.75");
    expect(formatUsdAmount("0.049024")).toBe("USD 0.0490");
    expect(formatUsdAmount("0.000123456")).toBe("USD 0.000123456");
    expect(formatUsdAmount(0)).toBe("USD 0.00");
    expect(formatUsdAmount(null)).toBe("USD 0.00");
    expect(formatUsdAmount("USD 1.00")).toBe("USD 1.00");
  });
});

describe("plainTextPreview", () => {
  it("strips markdown emphasis, headings, links and code", () => {
    expect(plainTextPreview("## 结论\n**基站** 已恢复，详见 [工单](https://x.test) 和 `cell-1`")).toBe("结论 基站 已恢复，详见 工单 和 cell-1");
  });

  it("drops fenced code and truncates", () => {
    expect(plainTextPreview("前言\n```ts\nconst a = 1;\n```\n后记")).toBe("前言 后记");
    expect(plainTextPreview("a".repeat(10), 5)).toBe("aaaa…");
  });

  it("removes dangling bold markers from truncated text", () => {
    expect(plainTextPreview("**未闭合的加粗")).toBe("未闭合的加粗");
  });
});

describe("formatListTimestamp", () => {
  it("shows time for today and a date otherwise", () => {
    const now = new Date(2026, 9, 6, 15, 0);
    expect(formatListTimestamp(new Date(2026, 9, 6, 9, 5).toISOString(), now)).toMatch(/09:05|9:05/);
    expect(formatListTimestamp(new Date(2026, 8, 4, 9, 5).toISOString(), now)).toMatch(/9/);
    expect(formatListTimestamp(new Date(2025, 8, 4).toISOString(), now)).toMatch(/2025/);
  });
});
