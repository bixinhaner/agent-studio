import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PortalI18nProvider } from "../i18n";
import { PortalTopBar } from "./PortalTopBar";

vi.mock("../../branding/BrandingProvider", () => ({
  useBranding: () => ({
    branding: {
      platformName: "Bailey",
      headerSubtitle: "Enterprise Agent Platform",
      logoUrl: "",
      iconUrl: ""
    }
  })
}));

vi.mock("../../branding/BrandMark", () => ({
  BrandMark: () => <span>Bailey</span>
}));

beforeEach(() => {
  window.localStorage.setItem("agent-studio.portal.locale.v1", "en");
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("PortalTopBar language menu", () => {
  it("opens on hover and changes language without a toggle tooltip", async () => {
    render(
      <PortalI18nProvider>
        <PortalTopBar
          sessionRailCollapsed={false}
          onToggleRail={vi.fn()}
          onOpenAdvancedSettings={vi.fn()}
          onToggleDrawer={vi.fn()}
          showRuntimeSummary={false}
          showAdvancedSettings={false}
          showRightPanelToggle={false}
        />
      </PortalI18nProvider>
    );

    const trigger = screen.getByRole("button", { name: "Select language" });
    fireEvent.mouseEnter(trigger);

    const chineseOption = await screen.findByText("简体中文");
    expect(screen.getByText("English")).toBeTruthy();
    fireEvent.click(chineseOption);

    await waitFor(() => {
      expect(document.documentElement.lang).toBe("zh-CN");
      expect(screen.getByRole("button", { name: "选择语言" })).toBeTruthy();
    });
  });

  it("opens from the keyboard", async () => {
    render(
      <PortalI18nProvider>
        <PortalTopBar
          sessionRailCollapsed={false}
          onToggleRail={vi.fn()}
          onOpenAdvancedSettings={vi.fn()}
          onToggleDrawer={vi.fn()}
          showRuntimeSummary={false}
          showAdvancedSettings={false}
          showRightPanelToggle={false}
        />
      </PortalI18nProvider>
    );

    const trigger = screen.getByRole("button", { name: "Select language" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    expect(await screen.findByText("简体中文")).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });
});
