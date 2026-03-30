import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AdminNav } from "./AdminNav";

describe("AdminNav", () => {
  it("switches sections through button clicks", () => {
    const onChange = vi.fn();

    render(<AdminNav section="overview" onChange={onChange} />);

    fireEvent.click(screen.getByRole("tab", { name: "用户" }));
    fireEvent.click(screen.getByRole("tab", { name: "资源配置中心" }));
    fireEvent.click(screen.getByRole("tab", { name: "组织同步" }));
    fireEvent.click(screen.getByRole("tab", { name: "审计监控" }));

    expect(onChange).toHaveBeenNthCalledWith(1, "users");
    expect(onChange).toHaveBeenNthCalledWith(2, "resources");
    expect(onChange).toHaveBeenNthCalledWith(3, "organization");
    expect(onChange).toHaveBeenNthCalledWith(4, "monitoring");
  });
});
