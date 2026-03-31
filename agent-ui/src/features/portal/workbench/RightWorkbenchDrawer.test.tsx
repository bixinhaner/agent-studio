import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RightWorkbenchDrawer } from "./RightWorkbenchDrawer";

describe("RightWorkbenchDrawer", () => {
  it("shows writing and collaboration tabs", () => {
    render(
      <RightWorkbenchDrawer
        open
        activeTab="writing"
        onClose={vi.fn()}
        onTabChange={vi.fn()}
        writingContent={<div>writing-content</div>}
        collaborationContent={<div>collaboration-content</div>}
      />
    );
    expect(screen.getByRole("tab", { name: "写作" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "协作" })).toBeTruthy();
  });
});

