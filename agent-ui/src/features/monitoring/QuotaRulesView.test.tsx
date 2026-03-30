import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  createQuotaPolicy: vi.fn(),
  fetchQuotaPolicies: vi.fn()
}));

import { createQuotaPolicy, fetchQuotaPolicies } from "./api";
import { QuotaRulesView } from "./QuotaRulesView";

const mockedCreateQuotaPolicy = vi.mocked(createQuotaPolicy);
const mockedFetchQuotaPolicies = vi.mocked(fetchQuotaPolicies);

describe("QuotaRulesView", () => {
  beforeEach(() => {
    mockedCreateQuotaPolicy.mockReset();
    mockedFetchQuotaPolicies.mockReset();
  });

  it("saves a department quota override", async () => {
    mockedFetchQuotaPolicies.mockResolvedValue({
      quotaPolicies: [
        {
          id: "policy-1",
          scopeType: "platform",
          scopeId: "platform",
          featureType: "chat",
          model: null,
          metricType: "internal_cost",
          windowType: "daily",
          thresholdValue: "100.000000",
          enforcementMode: "soft_block",
          isActive: true
        }
      ]
    });
    mockedCreateQuotaPolicy.mockResolvedValue({
      quotaPolicy: {
        id: "policy-2",
        scopeType: "department",
        scopeId: "dept-rd",
        featureType: "chat",
        model: null,
        metricType: "internal_cost",
        windowType: "daily",
        thresholdValue: "250.000000",
        enforcementMode: "soft_block",
        isActive: true
      }
    });

    render(<QuotaRulesView />);

    fireEvent.change(await screen.findByLabelText("部门范围"), { target: { value: "dept-rd" } });
    fireEvent.change(screen.getByLabelText("阈值"), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: "保存配额规则" }));

    await waitFor(() => {
      expect(mockedCreateQuotaPolicy).toHaveBeenCalled();
    });
  });

  it("normalizes platform quota rules to the platform scope id", async () => {
    mockedFetchQuotaPolicies.mockResolvedValue({ quotaPolicies: [] });
    mockedCreateQuotaPolicy.mockResolvedValue({
      quotaPolicy: {
        id: "policy-3",
        scopeType: "platform",
        scopeId: "platform",
        featureType: "chat",
        model: null,
        metricType: "internal_cost",
        windowType: "daily",
        thresholdValue: "100.000000",
        enforcementMode: "soft_block",
        isActive: true
      }
    });

    render(<QuotaRulesView />);

    fireEvent.change(await screen.findByLabelText("作用域类型"), { target: { value: "platform" } });
    fireEvent.click(screen.getByRole("button", { name: "保存配额规则" }));

    await waitFor(() => {
      expect(mockedCreateQuotaPolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          scopeType: "platform",
          scopeId: "platform"
        })
      );
    });
  });
});
