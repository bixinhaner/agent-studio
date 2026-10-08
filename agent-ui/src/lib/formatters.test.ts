import { describe, expect, it } from "vitest";

import { formatAdminDate, formatAdminDateTime, formatListTimestamp, formatUsdAmount, plainTextPreview } from "./formatters";

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

  it("drops inline visualization directives, including truncated ones", () => {
    expect(plainTextPreview('拖动滑块比较。\n\n::codex-inline-vis{file="clt.html"}\n\n样本均值方差')).toBe("拖动滑块比较。 样本均值方差");
    expect(plainTextPreview('拖动滑块比较。 ::codex-inline-vis{file="clt.html"} 样本均值方差')).toBe("拖动滑块比较。 样本均值方差");
    expect(plainTextPreview('拖动滑块比较。 ::codex-inline-vis{file="clt-sa')).toBe("拖动滑块比较。");
  });

  it("removes dangling bold markers from truncated text", () => {
    expect(plainTextPreview("**未闭合的加粗")).toBe("未闭合的加粗");
  });
});

describe("formatListTimestamp", () => {
  it("shows time for today and a date otherwise", () => {
    const now = new Date(2026, 9, 6, 15, 0);
    expect(formatListTimestamp(new Date(2026, 9, 6, 9, 5).toISOString(), now)).toBe("09:05");
    expect(formatListTimestamp(new Date(2026, 8, 4, 9, 5).toISOString(), now)).toBe("09-04");
    expect(formatListTimestamp(new Date(2025, 8, 4).toISOString(), now)).toBe("2025-09-04");
  });
});

describe("formatAdminDateTime", () => {
  it("formats local time in a fixed sortable shape", () => {
    const date = new Date(2026, 8, 4, 16, 35, 7);
    expect(formatAdminDateTime(date)).toBe("2026-09-04 16:35");
    expect(formatAdminDateTime(date.toISOString(), { seconds: true })).toBe("2026-09-04 16:35:07");
    expect(formatAdminDate(date)).toBe("2026-09-04");
  });

  it("falls back for empty or invalid input", () => {
    expect(formatAdminDateTime(null)).toBe("—");
    expect(formatAdminDateTime("", { fallback: "未记录" })).toBe("未记录");
    expect(formatAdminDateTime("not-a-date")).toBe("not-a-date");
    expect(formatAdminDate(undefined, "未设置")).toBe("未设置");
  });
});
