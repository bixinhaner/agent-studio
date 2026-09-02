import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { RuntimeModeSnapshot } from "../../modes/types";
import { fetchPortalManagedSkillSharing, updatePortalManagedSkillSharing } from "../../skills/api";
import {
  PortalSelectedSkillBar,
  PortalSkillPicker,
  SKILL_SHARING_ANNOUNCEMENT_ID
} from "./SkillPicker";

vi.mock("../../skills/api", () => ({
  fetchPortalManagedSkillSharing: vi.fn(),
  updatePortalManagedSkillSharing: vi.fn()
}));

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

const dingtalkSkill: Skill = {
  ...documentsSkill,
  id: "system:dingtalk",
  name: "dingtalk",
  label: "钉钉",
  description: "使用当前钉钉账号完成工作",
  presentation: {
    ...documentsSkill.presentation,
    displayName: "钉钉",
    summary: "使用当前钉钉账号处理联系人、群聊、日程、待办、文档和云盘等工作",
    examplePrompts: ["查看我今天的日程和待办。"],
    iconKey: "dingtalk"
  }
};

const privateSkill: Skill = {
  ...outageSkill,
  id: "managed:private-report",
  managedSkillId: "private-report",
  name: "private-report",
  label: "个人报告",
  scope: "private",
  sharing: {
    isOwner: true,
    sharedWithCount: 0,
    ownerUserId: "owner-1",
    ownerDisplayName: "Owner"
  },
  presentation: {
    ...outageSkill.presentation,
    displayName: "个人报告",
    summary: "生成个人定制报告"
  }
};

const createSkill: Skill = {
  ...outageSkill,
  id: "managed:skill-creator",
  managedSkillId: "skill-creator",
  name: "skill-creator",
  label: "Skill 创建与优化",
  scope: "platform",
  sharing: undefined,
  presentation: {
    ...outageSkill.presentation,
    displayName: "Skill 创建与优化",
    summary: "创建或更新可复用 Skill",
    shortcutKey: "create_skill"
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PortalSkillPicker", () => {
  it("keeps a brand-color fallback when the picker is rendered in a document-level portal", () => {
    const workbenchCss = readFileSync(
      resolve(process.cwd(), "src/features/portal/workbench/workbench.css"),
      "utf8"
    );
    expect(workbenchCss).toContain(
      "--skill-accent: var(--workbench-accent, var(--brand-primary, #FF4614));"
    );
  });

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
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /选择 Skill|Choose a Skill/ })).toBeNull());
    expect(fillPrompt).not.toHaveBeenCalled();
  });

  it("enables the Skill before filling its example into the composer", async () => {
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
    fireEvent.click(await screen.findByRole("button", { name: /填入示例|Use example/ }));

    await waitFor(() => expect(setSkills).toHaveBeenCalledWith(["power-outage-report"]));
    expect(setSkills.mock.invocationCallOrder[0]).toBeLessThan(fillPrompt.mock.invocationCallOrder[0]);
    expect(fillPrompt).toHaveBeenCalledWith("生成上周华东地区的停电报表。");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /选择 Skill|Choose a Skill/ })).toBeNull());
  });

  it("keeps the enable action available when a selectable Skill has no examples", async () => {
    const setSkills = vi.fn().mockResolvedValue(undefined);
    const skillWithoutExamples: Skill = {
      ...outageSkill,
      id: "managed:tp-generator",
      name: "tp-generator",
      presentation: { ...outageSkill.presentation, displayName: "TP Generator", examplePrompts: [] }
    };
    render(
      <PortalSkillPicker
        availableSkills={[skillWithoutExamples]}
        automaticSkills={[]}
        enabledSkillIds={[]}
        recentSkillIds={[]}
        onEnabledSkillIdsChange={setSkills}
        onFillPrompt={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /选择 Skill|Choose a Skill/ }));
    fireEvent.click(await screen.findByRole("button", { name: /TP Generator/ }));
    expect(screen.queryByRole("button", { name: /填入示例|Use example/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /启用 Skill|Enable Skill/ }));

    await waitFor(() => expect(setSkills).toHaveBeenCalledWith(["managed:tp-generator"]));
  });

  it("keeps the picker open and does not fill the prompt when enabling fails", async () => {
    const setSkills = vi.fn().mockRejectedValue(new Error("保存失败"));
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
    fireEvent.click(await screen.findByRole("button", { name: /填入示例|Use example/ }));

    expect((await screen.findByRole("alert")).textContent).toContain("保存失败");
    expect(screen.getByRole("dialog", { name: /选择 Skill|Choose a Skill/ })).toBeTruthy();
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
    await waitFor(() => expect(fillPrompt).toHaveBeenCalledWith("把这份提纲整理成正式 Word 文档。"));
    expect(setSkills).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /选择 Skill|Choose a Skill/ })).toBeNull());
  });

  it("presents Dingtalk as one automatic capability without exposing its technical name", async () => {
    const setSkills = vi.fn();
    const fillPrompt = vi.fn();
    render(
      <PortalSkillPicker
        availableSkills={[]}
        automaticSkills={[dingtalkSkill]}
        enabledSkillIds={[]}
        recentSkillIds={[]}
        onEnabledSkillIdsChange={setSkills}
        onFillPrompt={fillPrompt}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /选择 Skill|Choose a Skill/ }));
    expect(await screen.findAllByText("钉钉")).not.toHaveLength(0);
    expect(document.querySelector('[data-icon="dingtalk"]')).toBeTruthy();
    expect(document.querySelector("code")?.textContent).not.toBe("dingtalk");
    expect(screen.queryByRole("button", { name: /启用 Skill|Enable Skill/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /复制.*dingtalk|copy.*dingtalk/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /填入示例|Use example/ }));
    await waitFor(() => expect(fillPrompt).toHaveBeenCalledWith("查看我今天的日程和待办。"));
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

  it("lets the owner directly share one private Skill with selected members", async () => {
    vi.mocked(fetchPortalManagedSkillSharing).mockResolvedValue({
      skillId: "private-report",
      ownerUserId: "owner-1",
      owner: { userId: "owner-1", displayName: "Skill Owner", email: "owner@example.com" },
      members: [],
      availableMembers: [
        { userId: "member-1", displayName: "Member One", email: "member1@example.com" },
        { userId: "member-2", displayName: "Member Two", email: "member2@example.com" }
      ]
    });
    vi.mocked(updatePortalManagedSkillSharing).mockResolvedValue({
      skillId: "private-report",
      ownerUserId: "owner-1",
      owner: { userId: "owner-1", displayName: "Skill Owner", email: "owner@example.com" },
      members: [{ userId: "member-1", displayName: "Member One", email: "member1@example.com" }],
      availableMembers: [
        { userId: "member-1", displayName: "Member One", email: "member1@example.com" },
        { userId: "member-2", displayName: "Member Two", email: "member2@example.com" }
      ]
    });
    render(
      <PortalSkillPicker
        availableSkills={[privateSkill]}
        automaticSkills={[]}
        enabledSkillIds={[]}
        recentSkillIds={[]}
        onEnabledSkillIdsChange={vi.fn()}
        onFillPrompt={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /选择 Skill|Choose a Skill/ }));
    fireEvent.click(await screen.findByRole("button", { name: /个人报告/ }));
    fireEvent.click(screen.getByRole("button", { name: /共享给成员|Share with members/ }));
    expect(await screen.findByText("Skill Owner")).toBeTruthy();
    expect(await screen.findByText("Member One")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Member One/ }));
    fireEvent.click(screen.getByRole("button", { name: /保存共享|Save sharing/ }));

    await waitFor(() => expect(updatePortalManagedSkillSharing).toHaveBeenCalledWith({
      id: "private-report",
      userIds: ["member-1"]
    }));
    expect(await screen.findByText(/已保存，Skill 已共享给 1 人|Saved\. Skill shared with 1 people/)).toBeTruthy();
  });

  it("announces Skill sharing once and opens the owner sharing flow from the feature action", async () => {
    const dismissAnnouncement = vi.fn();
    vi.mocked(fetchPortalManagedSkillSharing).mockResolvedValue({
      skillId: "private-report",
      ownerUserId: "owner-1",
      owner: { userId: "owner-1", displayName: "Skill Owner", email: "owner@example.com" },
      members: [],
      availableMembers: []
    });
    render(
      <PortalSkillPicker
        availableSkills={[privateSkill, createSkill]}
        automaticSkills={[]}
        enabledSkillIds={[]}
        recentSkillIds={[]}
        onEnabledSkillIdsChange={vi.fn()}
        onFillPrompt={vi.fn()}
        featureAnnouncements={{
          enabled: true,
          dismissedIds: [],
          onDismiss: dismissAnnouncement
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /选择 Skill|Choose a Skill/ }));
    expect(await screen.findByText(/现在可以共享 Skill 了|You can now share Skills/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /我的|Mine/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /去看看|Take a look/ }));

    expect(dismissAnnouncement).toHaveBeenCalledWith(SKILL_SHARING_ANNOUNCEMENT_ID);
    await waitFor(() => expect(fetchPortalManagedSkillSharing).toHaveBeenCalledWith("private-report"));
    expect(await screen.findByText("Skill Owner")).toBeTruthy();
  });

  it("shows the announcement to an eligible user without a private Skill and leads to Skill creation", async () => {
    const dismissAnnouncement = vi.fn();
    render(
      <PortalSkillPicker
        availableSkills={[createSkill]}
        automaticSkills={[]}
        enabledSkillIds={[]}
        recentSkillIds={[]}
        onEnabledSkillIdsChange={vi.fn()}
        onFillPrompt={vi.fn()}
        featureAnnouncements={{
          enabled: true,
          dismissedIds: [],
          onDismiss: dismissAnnouncement
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /选择 Skill|Choose a Skill/ }));
    expect(await screen.findByText(/现在可以共享 Skill 了|You can now share Skills/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /去看看|Take a look/ }));

    expect(dismissAnnouncement).toHaveBeenCalledWith(SKILL_SHARING_ANNOUNCEMENT_ID);
    expect(screen.getAllByText("skill-creator").length).toBeGreaterThan(0);
    expect(screen.queryByText(/现在可以共享 Skill 了|You can now share Skills/)).toBeNull();
  });

  it("does not repeat a dismissed feature announcement", async () => {
    render(
      <PortalSkillPicker
        availableSkills={[privateSkill]}
        automaticSkills={[]}
        enabledSkillIds={[]}
        recentSkillIds={[]}
        onEnabledSkillIdsChange={vi.fn()}
        onFillPrompt={vi.fn()}
        featureAnnouncements={{
          enabled: true,
          dismissedIds: [SKILL_SHARING_ANNOUNCEMENT_ID],
          onDismiss: vi.fn()
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /选择 Skill|Choose a Skill/ }));
    expect(await screen.findByRole("dialog", { name: /选择 Skill|Choose a Skill/ })).toBeTruthy();
    expect(screen.queryByText(/现在可以共享 Skill 了|You can now share Skills/)).toBeNull();
  });
});
