import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { RuntimeModeSnapshot } from "../../modes/types";
import { PortalSelectedSkillBar, PortalSkillPicker } from "./SkillPicker";

type Skill = RuntimeModeSnapshot["availableSkills"][number];

const outageSkill: Skill = {
  id: "power-outage-report",
  name: "power-outage-report",
  label: "停电报告",
  description: "生成停电事件运营报表",
  system: false,
  scope: "team",
  presentation: {
    displayName: "停电分析报告",
    summary: "生成停电时长和次数的综合分析报告",
    useCases: ["统计停电影响范围"],
    usageSteps: ["选择报告周期", "确认统计范围"],
    examplePrompts: ["生成上周华东地区的停电报表。"],
    dataScope: "停电事件与影响用户",
    iconKey: "bolt",
    sortOrder: 10,
    requestedLocale: "zh-CN",
    resolvedLocale: "zh-CN"
  }
};

const documentsSkill: Skill = {
  ...outageSkill,
  id: "plugin:documents",
  name: "documents",
  label: "文档制作",
  description: "创建并检查 Word 文档",
  system: true,
  automatic: true,
  scope: "platform",
  presentation: {
    ...outageSkill.presentation,
    displayName: "文档制作",
    summary: "创建并检查 Word 文档",
    examplePrompts: ["把这份提纲整理成正式 Word 文档。"],
    iconKey: "document"
  }
};

beforeAll(() => {
  const getComputedStyle = window.getComputedStyle.bind(window);
  Object.defineProperty(window, "getComputedStyle", {
    configurable: true,
    value: (element: Element) => getComputedStyle(element)
  });
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

afterEach(cleanup);

describe("PortalSkillPicker", () => {
  it("opens the direct catalog and enables the selected Skill", async () => {
    const setSkills = vi.fn().mockResolvedValue(undefined);
    const fillPrompt = vi.fn();
    render(
      <PortalSkillPicker
        availableSkills={[outageSkill]}
        automaticSkills={[]}
        enabledSkillIds={[]}
        recentSkillIds={[]}
        onEnabledSkillIdsChange={setSkills}
        onFillPrompt={fillPrompt}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /选择 Skill|Choose a Skill/ }));
    expect(await screen.findByRole("dialog", { name: /选择 Skill|Choose a Skill/ })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /停电分析报告/ }));
    fireEvent.click(await screen.findByRole("button", { name: /启用 Skill|Enable Skill/ }));

    await waitFor(() => expect(setSkills).toHaveBeenCalledWith(["power-outage-report"]));
    expect(fillPrompt).not.toHaveBeenCalled();
  });

  it("lets the user remove an enabled Skill from the composer context bar", () => {
    const setSkills = vi.fn();
    render(
      <PortalSelectedSkillBar
        availableSkills={[outageSkill]}
        enabledSkillIds={["power-outage-report"]}
        onEnabledSkillIdsChange={setSkills}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /(?:停用|Disable) Skill power-outage-report/ }));
    expect(setSkills).toHaveBeenCalledWith([]);
  });

  it("shows automatic capabilities without an enable action", async () => {
    const setSkills = vi.fn();
    const fillPrompt = vi.fn();
    render(
      <PortalSkillPicker
        availableSkills={[]}
        automaticSkills={[documentsSkill]}
        enabledSkillIds={[]}
        recentSkillIds={[]}
        onEnabledSkillIdsChange={setSkills}
        onFillPrompt={fillPrompt}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /选择 Skill|Choose a Skill/ }));
    fireEvent.click(await screen.findByRole("button", { name: /文档制作/ }));
    expect(screen.queryByRole("button", { name: /启用 Skill|Enable Skill/ })).toBeNull();
    expect(screen.getAllByText(/自动启用|available automatically/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /填入示例|Use example/ }));
    expect(fillPrompt).toHaveBeenCalledWith("把这份提纲整理成正式 Word 文档。");
    expect(setSkills).not.toHaveBeenCalled();
  });

  it("reveals the localized purpose and summary when the composer chip is hovered", async () => {
    render(
      <PortalSelectedSkillBar
        availableSkills={[outageSkill]}
        enabledSkillIds={["power-outage-report"]}
        onEnabledSkillIdsChange={vi.fn()}
      />
    );

    const chipName = screen.getByText("power-outage-report");
    fireEvent.mouseEnter(chipName.closest(".portal-selected-skill-chip") as HTMLElement);

    expect(await screen.findByText("停电分析报告")).toBeTruthy();
    expect(screen.getByText("生成停电时长和次数的综合分析报告")).toBeTruthy();
  });
});
