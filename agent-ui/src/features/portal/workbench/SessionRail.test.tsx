import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SessionRail } from "./SessionRail";

describe("SessionRail", () => {
  it("keeps new chat + search in rail header and user info in footer", () => {
    render(
      <SessionRail
        collapsed={false}
        userName="Portal User"
        onToggleCollapsed={vi.fn()}
        onCreateThread={vi.fn()}
        searchValue=""
        onSearchChange={vi.fn()}
      >
        <div>thread-list-slot</div>
      </SessionRail>
    );
    expect(screen.getByRole("button", { name: "新会话" })).toBeTruthy();
    expect(screen.getByPlaceholderText("搜索会话")).toBeTruthy();
    expect(screen.getByText("Portal User")).toBeTruthy();
  });
});

