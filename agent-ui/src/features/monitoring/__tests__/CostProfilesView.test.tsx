import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createCostProfile, fetchCostProfiles, updateCostProfile } from "../api";
import { CostProfilesView } from "../CostProfilesView";

vi.mock("../api");

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

describe("CostProfilesView", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (fetchCostProfiles as any).mockResolvedValue({
      costProfiles: [
        {
          id: "profile-gpt55",
          model: "gpt-5.5",
          inputTokenPrice: "5.000000",
          cachedInputTokenPrice: "0.500000",
          outputTokenPrice: "30.000000",
          internalCostMultiplier: "1.0000",
          isActive: true
        }
      ]
    });
    (createCostProfile as any).mockResolvedValue({
      costProfile: {
        id: "profile-gpt55",
        model: "gpt-5.5",
        inputTokenPrice: "5.000000",
        cachedInputTokenPrice: "0.500000",
        outputTokenPrice: "30.000000",
        internalCostMultiplier: "1.0000",
        isActive: true
      }
    });
    (updateCostProfile as any).mockResolvedValue({});
  });

  it("prefills the GPT-5.5 pricing preset and can switch to another official preset", async () => {
    render(<CostProfilesView />);

    await waitFor(() => expect(fetchCostProfiles).toHaveBeenCalled());

    const presetSelect = screen.getByLabelText("价格预设") as HTMLSelectElement;
    const modelInput = screen.getByLabelText("模型") as HTMLInputElement;
    const inputPriceInput = screen.getByLabelText("输入 / 1M tokens (USD)") as HTMLInputElement;
    const cachedInputPriceInput = screen.getByLabelText("缓存输入 / 1M tokens (USD)") as HTMLInputElement;
    const outputPriceInput = screen.getByLabelText("输出 / 1M tokens (USD)") as HTMLInputElement;

    expect(presetSelect.value).toBe("gpt-5.5");
    expect(modelInput.value).toBe("gpt-5.5");
    expect(inputPriceInput.value).toBe("5.000000");
    expect(cachedInputPriceInput.value).toBe("0.500000");
    expect(outputPriceInput.value).toBe("30.000000");

    fireEvent.change(presetSelect, { target: { value: "gpt-5.4" } });

    expect(presetSelect.value).toBe("gpt-5.4");
    expect(modelInput.value).toBe("gpt-5.4");
    expect(inputPriceInput.value).toBe("2.500000");
    expect(cachedInputPriceInput.value).toBe("0.250000");
    expect(outputPriceInput.value).toBe("15.000000");
  });

  it("switches to custom mode after manual edits and submits the overridden pricing", async () => {
    render(<CostProfilesView />);

    await waitFor(() => expect(fetchCostProfiles).toHaveBeenCalled());

    const presetSelect = screen.getByLabelText("价格预设") as HTMLSelectElement;
    const inputPriceInput = screen.getByLabelText("输入 / 1M tokens (USD)") as HTMLInputElement;

    fireEvent.change(inputPriceInput, { target: { value: "9.999999" } });

    expect(presetSelect.value).toBe("custom");

    fireEvent.click(screen.getByRole("button", { name: "保存模型定价" }));

    await waitFor(() =>
      expect(createCostProfile).toHaveBeenCalledWith({
        model: "gpt-5.5",
        inputTokenPrice: "9.999999",
        cachedInputTokenPrice: "0.500000",
        outputTokenPrice: "30.000000",
        internalCostMultiplier: "1.0000"
      })
    );
  });
});
