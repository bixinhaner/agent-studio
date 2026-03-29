import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  fetchAdminOverview: vi.fn()
}));

vi.mock("../rbac/RolesView", () => ({
  RolesView: () => <section>角色列表</section>
}));

import { AdminShell } from "./AdminShell";
import { fetchAdminOverview } from "./api";

const mockedFetchAdminOverview = vi.mocked(fetchAdminOverview);

describe("AdminShell", () => {
  beforeEach(() => {
    mockedFetchAdminOverview.mockReset();
  });

  it("switches between overview, users, rbac, and organization views", async () => {
    mockedFetchAdminOverview.mockResolvedValue({
      counts: {
        users: 7,
        threads: 13,
        activeSessions: 3
      }
    });

    render(<AdminShell />);

    expect(await screen.findByText("运行概览")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "用户" }));
    expect(await screen.findByText("用户管理")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "角色权限" }));
    expect(await screen.findByText("角色列表")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "组织同步" }));
    expect(await screen.findByText("同步任务")).toBeTruthy();
  });
});
