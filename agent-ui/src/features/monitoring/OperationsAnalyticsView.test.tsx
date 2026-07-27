import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  trends: [],
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
});
