import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createCostProfile, fetchCostProfiles, syncCostProfileHolidays, updateCostProfile } from "../api";
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
          cacheWriteTokenPrice: "0.000000",
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
        cacheWriteTokenPrice: "0.000000",
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
    const longContextThresholdInput = screen.getByLabelText("长上下文阈值 (tokens)") as HTMLInputElement;

    expect(presetSelect.value).toBe("gpt-5.5");
    expect(modelInput.value).toBe("gpt-5.5");
    expect(inputPriceInput.value).toBe("5.000000");
    expect(cachedInputPriceInput.value).toBe("0.500000");
    expect(outputPriceInput.value).toBe("30.000000");
    expect(longContextThresholdInput.value).toBe("272000");

    fireEvent.change(presetSelect, { target: { value: "gpt-5.6-terra" } });

    expect(presetSelect.value).toBe("gpt-5.6-terra");
    expect(modelInput.value).toBe("gpt-5.6-terra");
    expect(inputPriceInput.value).toBe("2.500000");
    expect(cachedInputPriceInput.value).toBe("0.250000");
    expect(outputPriceInput.value).toBe("15.000000");
    expect(longContextThresholdInput.value).toBe("272000");
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
        cacheWriteTokenPrice: "0.000000",
        outputTokenPrice: "30.000000",
        longContextThresholdTokens: "272000",
        longContextInputMultiplier: "2.0000",
        longContextOutputMultiplier: "1.5000",
        internalCostMultiplier: "1.0000"
      })
    );
  });

  it("submits the DeepSeek preset with its peak/off-peak config", async () => {
    render(<CostProfilesView />);
    await waitFor(() => expect(fetchCostProfiles).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("价格预设"), { target: { value: "deepseek-flash" } });
    expect(screen.getByText("谷时 ×0.5")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存模型定价" }));

    await waitFor(() => expect(createCostProfile).toHaveBeenCalled());
    const input = (createCostProfile as any).mock.calls[0][0];
    expect(input).toMatchObject({ model: "deepseek-flash", inputTokenPrice: "0.300000", internalCostMultiplier: "1.0000" });
    expect(input.timeOfDayPricing).toMatchObject({
      timezone: "Asia/Shanghai",
      offPeakMultiplier: 0.5,
      peakWindows: [
        { weekdays: [1, 2, 3, 4, 5], start: "09:00", end: "12:00" },
        { weekdays: [1, 2, 3, 4, 5], start: "14:00", end: "18:00" }
      ]
    });
    expect(input.timeOfDayPricing.offPeakDates).toContain("2026-10-01");
    expect(input.timeOfDayPricing.workdayDates).toBeUndefined();
    expect(input.timeOfDayPricing.holidaySync).toEqual({ source: "holiday-cn", includeWorkdays: false });
  });

  it("enables peak/off-peak pricing on a saved profile and adds make-up workdays", async () => {
    render(<CostProfilesView />);
    await waitFor(() => expect(screen.getByRole("button", { name: "设置 gpt-5.5 峰谷计价" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "设置 gpt-5.5 峰谷计价" }));
    fireEvent.click(await screen.findByRole("switch", { name: "启用峰谷计价" }));
    fireEvent.click(screen.getByRole("button", { name: /填入 2026 年调休上班日/ }));
    fireEvent.click(screen.getByRole("button", { name: "高峰时段 1 周六" }));
    fireEvent.click(screen.getByRole("button", { name: "保存峰谷设置" }));

    await waitFor(() => expect(updateCostProfile).toHaveBeenCalled());
    const [profileId, changes] = (updateCostProfile as any).mock.calls[0];
    expect(profileId).toBe("profile-gpt55");
    expect(changes.timeOfDayPricing.workdayDates).toEqual(["2026-01-04", "2026-02-14", "2026-02-28", "2026-05-09", "2026-09-20", "2026-10-10"]);
    expect(changes.timeOfDayPricing.peakWindows[0].weekdays).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("blocks saving an invalid window and explains why", async () => {
    render(<CostProfilesView />);
    await waitFor(() => expect(screen.getByRole("button", { name: "设置 gpt-5.5 峰谷计价" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "设置 gpt-5.5 峰谷计价" }));
    fireEvent.click(await screen.findByRole("switch", { name: "启用峰谷计价" }));
    fireEvent.change(screen.getByLabelText("高峰时段 1 结束"), { target: { value: "08:00" } });
    fireEvent.click(screen.getByRole("button", { name: "保存峰谷设置" }));

    expect(await screen.findByText("高峰时段 1 的结束时间需要晚于开始时间（同一天内）。")).toBeTruthy();
    expect(updateCostProfile).not.toHaveBeenCalled();
  });

  it("turns on holiday auto-sync and syncs right after saving", async () => {
    (syncCostProfileHolidays as any).mockResolvedValue({
      costProfile: { id: "profile-gpt55", timeOfDayPricing: { holidaySync: { source: "holiday-cn", includeWorkdays: false, syncedYears: [2026] } } }
    });
    render(<CostProfilesView />);
    await waitFor(() => expect(screen.getByRole("button", { name: "设置 gpt-5.5 峰谷计价" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "设置 gpt-5.5 峰谷计价" }));
    fireEvent.click(await screen.findByRole("switch", { name: "启用峰谷计价" }));
    const autoSync = screen.getByRole("switch", { name: "自动同步中国法定节假日" });
    expect(autoSync.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("保存后立即同步一次。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存峰谷设置" }));

    await waitFor(() => expect(syncCostProfileHolidays).toHaveBeenCalledWith("profile-gpt55"));
    expect((updateCostProfile as any).mock.calls[0][1].timeOfDayPricing.holidaySync).toEqual({ source: "holiday-cn", includeWorkdays: false });
    expect(await screen.findByText("gpt-5.5 已按峰谷计价，新调用立即生效；已同步 2026 年法定节假日")).toBeTruthy();
  });

  it("shows a sync failure and keeps the dates", async () => {
    (fetchCostProfiles as any).mockResolvedValue({
      costProfiles: [
        {
          id: "profile-flash",
          model: "deepseek-flash",
          inputTokenPrice: "0.300000",
          cachedInputTokenPrice: "0.006000",
          cacheWriteTokenPrice: "0.000000",
          outputTokenPrice: "1.200000",
          internalCostMultiplier: "1.0000",
          isActive: true,
          timeOfDayPricing: {
            timezone: "Asia/Shanghai",
            offPeakMultiplier: 0.5,
            peakWindows: [{ weekdays: [1, 2, 3, 4, 5], start: "09:00", end: "12:00" }],
            offPeakDates: ["2026-10-01"],
            holidaySync: {
              source: "holiday-cn",
              includeWorkdays: false,
              syncedAt: "2026-10-20T00:00:00.000Z",
              lastError: "节假日数据获取失败（HTTP 503）",
              lastErrorAt: "2026-10-21T00:00:00.000Z"
            }
          }
        }
      ]
    });
    render(<CostProfilesView />);
    expect(await screen.findByText(/节假日同步失败/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "设置 deepseek-flash 峰谷计价" }));
    expect(await screen.findByText(/节假日数据获取失败（HTTP 503）。已保留现有日期/)).toBeTruthy();
  });
});

