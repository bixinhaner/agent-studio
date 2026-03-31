import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WritingWorkbenchPanel } from "./WritingWorkbenchPanel";

describe("WritingWorkbenchPanel", () => {
  it("renders C/D priorities before extra tools", () => {
    render(<WritingWorkbenchPanel onUsePrompt={vi.fn()} />);
    expect(screen.getByText("结构化产出")).toBeTruthy();
    expect(screen.getByText("会话生成文档")).toBeTruthy();
    expect(screen.getByText("更多写作工具")).toBeTruthy();
  });
});

