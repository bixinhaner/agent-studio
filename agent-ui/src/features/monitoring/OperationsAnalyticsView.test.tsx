import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { fetchOperationsInsights } from "./api";
import { OperationsAnalyticsView } from "./OperationsAnalyticsView";
import type { OperationsInsightsResponse } from "./types";

vi.mock("./api", () => ({
  fetchOperationsInsights: vi.fn()
}));

const response: OperationsInsightsResponse = {
  filters: {
    days: 30,
    timeZone: "Asia/Shanghai",
    sessionPage: 1,
    sessionPageSize: 20
  },
  window: {
    from: "2026-06-27T12:57:00.000Z",
    to: "2026-07-27T12:57:00.000Z",
    timeZone: "Asia/Shanghai"
  },
  options: {
    organizations: [],
    models: [],
    paths: [],
    entries: []
  },
  summary: {
    totalOrganizations: 12,
    totalUsers: 126,
    totalSessions: 1128,
    totalRequests: 4414,
    inputTokens: 1000,
    cachedInputTokens: 800,
    cacheWriteTokens: 0,
    outputTokens: 100,
    totalTokens: 1100,
    estimatedCost: "2.000000",
    internalCost: "0.200000",
    incompleteCostRequestCount: 0,
    successfulRequestCount: 4300,
    failedRequestCount: 100,
    cancelledRequestCount: 14,
    successRate: 0.977273,
    avgRequestsPerSession: 3.91,
    avgTokensPerSession: 1,
    avgInternalCostPerSession: "0.000177",
    avgTokensPerRequest: 0.25,
    avgInternalCostPerRequest: "0.000045",
    cacheShare: 0.8
  },
  securityReview: {
    reviewJobCount: 274,
    successfulReviewCount: 272,
    recoveredReviewCount: 20,
    unsuccessfulReviewCount: 2,
    failedAttemptCount: 63,
    affectedThreadCount: 60,
    affectedUserCount: 37,
    inputTokens: 6000,
    cachedInputTokens: 1700,
    outputTokens: 214,
    totalTokens: 6214,
    estimatedCost: "6.231710",
    internalCost: "0.623167"
  },
  trends: [
    {
      day: "2026-07-26",
      organizationCount: 2,
      userCount: 30,
      sessionCount: 60,
      requestCount: 210,
      totalTokens: 900,
      estimatedCost: "1.000000",
      internalCost: "0.100000",
      successfulRequestCount: 190,
      failedRequestCount: 10,
      cancelledRequestCount: 10,
      successRate: 0.95,
      cacheShare: 0.912,
      quotaUsedPercent: null,
      quotaDeltaPercent: null,
      quotaResetAt: null,
      quotaResetEarly: false
    },
    {
      day: "2026-07-27",
      organizationCount: 1,
      userCount: 3,
      sessionCount: 4,
      requestCount: 2,
      totalTokens: 200,
      estimatedCost: "1.000000",
      internalCost: "0.100000",
      successfulRequestCount: 0,
      failedRequestCount: 0,
      cancelledRequestCount: 2,
      successRate: null,
      cacheShare: 0.5,
      quotaUsedPercent: null,
      quotaDeltaPercent: null,
      quotaResetAt: null,
      quotaResetEarly: false
    }
  ],
  breakdowns: {
    paths: [],
    models: [],
    entries: []
  },
  organizations: [],
  users: [],
  sessions: {
    items: [],
    page: 1,
    pageSize: 20,
    totalItems: 0,
    totalPages: 0
  }
};

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OperationsAnalyticsView", () => {
  it("keeps security review metrics in a dedicated tab and explains retries", async () => {
    vi.mocked(fetchOperationsInsights).mockResolvedValue(response);
    render(<OperationsAnalyticsView />);

    const securityTab = await screen.findByRole("tab", { name: "安全审核" });
    expect(screen.queryByText("安全审核开销")).toBeNull();

    fireEvent.click(securityTab);

    expect(await screen.findByText("安全审核开销")).toBeTruthy();
    expect(screen.getByText("重试后成功")).toBeTruthy();
    expect(screen.getByText("窗口内未成功")).toBeTruthy();
    expect(screen.getByText("尝试次数，可与成功任务重叠")).toBeTruthy();
  });

  it("shows the answer success rate and cache share per day", async () => {
    vi.mocked(fetchOperationsInsights).mockResolvedValue(response);
    render(<OperationsAnalyticsView />);

    const table = await screen.findByRole("table");
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual(expect.arrayContaining(["成功率", "缓存占比"]));

    // Newest day first; a day with only user stops has no success rate.
    const rateColumn = headers.indexOf("成功率");
    const cacheColumn = headers.indexOf("缓存占比");
    const [, latest, earlier] = within(table).getAllByRole("row").map((row) => within(row).queryAllByRole("cell").map((cell) => cell.textContent));
    expect(latest[0]).toBe("2026-07-27");
    expect(latest[rateColumn]).toBe("—");
    expect(latest[cacheColumn]).toBe("50.0%");
    expect(earlier[rateColumn]).toBe("95.0%失败 10");
    expect(earlier[cacheColumn]).toBe("91.2%");

    expect(screen.getByText("97.7%")).toBeTruthy();
    expect(screen.getByRole("img", { name: /回答成功率，2 天/ })).toBeTruthy();
  });

  it("bypasses the server cache only when the refresh button is used", async () => {
    vi.mocked(fetchOperationsInsights).mockResolvedValue(response);
    render(<OperationsAnalyticsView />);
    await screen.findByRole("table");
    expect(vi.mocked(fetchOperationsInsights).mock.calls[0][0]).toMatchObject({ refresh: false });

    fireEvent.click(screen.getByRole("button", { name: "重新拉取" }));
    await vi.waitFor(() => expect(fetchOperationsInsights).toHaveBeenCalledTimes(2));
    expect(vi.mocked(fetchOperationsInsights).mock.calls[1][0]).toMatchObject({ refresh: true });
  });
});
