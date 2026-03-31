import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AdvancedSettingsPanel } from "./AdvancedSettingsPanel";

describe("AdvancedSettingsPanel", () => {
  it("renders key runtime controls in on-demand panel", () => {
    render(
      <AdvancedSettingsPanel
        open
        onClose={vi.fn()}
        modelLabel="gpt-5.4"
        reasoningLabel="high"
      />
    );
    expect(screen.getByText("运行配置")).toBeTruthy();
    expect(screen.getByText("模型")).toBeTruthy();
    expect(screen.getByText("思考深度")).toBeTruthy();
  });
});
