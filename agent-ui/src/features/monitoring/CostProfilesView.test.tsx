import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  fetchCostProfiles: vi.fn()
}));

import { fetchCostProfiles } from "./api";
import { CostProfilesView } from "./CostProfilesView";

const mockedFetchCostProfiles = vi.mocked(fetchCostProfiles);

describe("CostProfilesView", () => {
  beforeEach(() => {
    mockedFetchCostProfiles.mockReset();
  });

  it("renders model pricing and multipliers", async () => {
    mockedFetchCostProfiles.mockResolvedValue({
      costProfiles: [
        {
          id: "profile-1",
          model: "gpt-5.4",
          inputTokenPrice: "0.010000",
          cachedInputTokenPrice: "0.002000",
          outputTokenPrice: "0.020000",
          internalCostMultiplier: "1.2000",
          isActive: true
        }
      ]
    });

    render(<CostProfilesView />);

    expect(await screen.findByText("模型定价")).toBeTruthy();
    expect(screen.getByText("gpt-5.4")).toBeTruthy();
    expect(screen.getByText("1.2000")).toBeTruthy();
  });
});
