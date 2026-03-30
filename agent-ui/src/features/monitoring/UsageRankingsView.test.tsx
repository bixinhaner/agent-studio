import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  fetchMonitoringRankings: vi.fn()
}));

import { fetchMonitoringRankings } from "./api";
import { UsageRankingsView } from "./UsageRankingsView";

const mockedFetchMonitoringRankings = vi.mocked(fetchMonitoringRankings);

describe("UsageRankingsView", () => {
  beforeEach(() => {
    mockedFetchMonitoringRankings.mockReset();
  });

  it("renders ranked users, departments, models, and features", async () => {
    mockedFetchMonitoringRankings.mockResolvedValue({
      rankings: {
        topUsers: [
          { userId: "user-1", requestCount: 2, estimatedCost: "5.000000", internalCost: "2.000000" }
        ],
        topDepartments: [
          { departmentId: "dept-rd", requestCount: 2, estimatedCost: "5.000000", internalCost: "2.000000" }
        ],
        topModels: [
          { model: "gpt-5.4", requestCount: 2, estimatedCost: "5.000000", internalCost: "2.000000" }
        ],
        topFeatures: [
          { featureType: "chat", requestCount: 2, estimatedCost: "5.000000", internalCost: "2.000000" }
        ]
      }
    });

    render(<UsageRankingsView />);

    expect(await screen.findByText("使用排行")).toBeTruthy();
    expect(screen.getByText("user-1")).toBeTruthy();
    expect(screen.getByText("dept-rd")).toBeTruthy();
    expect(screen.getByText("gpt-5.4")).toBeTruthy();
    expect(screen.getByText("chat")).toBeTruthy();
  });
});
