import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PortalTopBar } from "./PortalTopBar";

describe("PortalTopBar", () => {
  it("renders minimal controls", () => {
    render(
      <PortalTopBar onToggleRail={vi.fn()} onOpenAdvancedSettings={vi.fn()} onOpenDrawer={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: "展开会话栏" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "高级设置" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "打开工作台抽屉" })).toBeTruthy();
  });
});

