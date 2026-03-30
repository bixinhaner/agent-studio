import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  fetchMonitoringOverview: vi.fn()
}));

import { fetchMonitoringOverview } from "./api";
import { MonitoringOverviewView } from "./MonitoringOverviewView";

const mockedFetchMonitoringOverview = vi.mocked(fetchMonitoringOverview);

describe("MonitoringOverviewView", () => {
  beforeEach(() => {
    mockedFetchMonitoringOverview.mockReset();
  });

  it("renders platform totals and trend points", async () => {
    mockedFetchMonitoringOverview.mockResolvedValue({
      overview: {
        totalEstimatedCost: "15.000000",
        totalInternalCost: "9.000000",
        totalRequests: 12,
        totalUsageEvents: 3,
        totalResourceAccessLogs: 2,
        openAlertCount: 1,
        acknowledgedAlertCount: 1,
        notificationCount: 1
      },
      trends: [
        {
          rollupDate: "2026-03-29",
          requestCount: 12,
          successCount: 11,
          failureCount: 1,
          estimatedCost: "15.000000",
          internalCost: "9.000000"
        }
      ]
    });

    render(<MonitoringOverviewView />);

    expect(await screen.findByText("平台总览")).toBeTruthy();
    expect(screen.getAllByText("15.000000").length).toBeGreaterThan(0);
    expect(screen.getByText("2026-03-29")).toBeTruthy();
  });
});
