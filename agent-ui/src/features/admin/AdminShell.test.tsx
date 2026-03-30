import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  fetchAdminOverview: vi.fn()
}));

vi.mock("./DepartmentTreeView", () => ({
  DepartmentTreeView: () => <section>部门树</section>
}));

vi.mock("./OrgSyncView", () => ({
  OrgSyncView: () => <section>同步任务</section>
}));

vi.mock("../rbac/RolesView", () => ({
  RolesView: () => <section>角色列表</section>
}));

vi.mock("../monitoring/MonitoringOverviewView", () => ({
  MonitoringOverviewView: () => <section>平台总览</section>
}));

vi.mock("../monitoring/UsageRankingsView", () => ({
  UsageRankingsView: () => <section>使用排行</section>
}));

vi.mock("../monitoring/ResourceAccessLogView", () => ({
  ResourceAccessLogView: () => <section>资源访问日志</section>
}));

vi.mock("../monitoring/QuotaRulesView", () => ({
  QuotaRulesView: () => <section>配额规则</section>
}));

vi.mock("../monitoring/AlertCenterView", () => ({
  AlertCenterView: () => <section>告警中心</section>
}));

vi.mock("../monitoring/CostProfilesView", () => ({
  CostProfilesView: () => <section>模型定价</section>
}));

import { AdminShell } from "./AdminShell";
import { fetchAdminOverview } from "./api";

const mockedFetchAdminOverview = vi.mocked(fetchAdminOverview);

describe("AdminShell", () => {
  beforeEach(() => {
    mockedFetchAdminOverview.mockReset();
  });

  it("switches between overview, users, rbac, organization, and monitoring views", async () => {
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
    fireEvent.click(screen.getByRole("tab", { name: "审计监控" }));
    expect(await screen.findByText("平台总览")).toBeTruthy();
    expect(screen.getByText("使用排行")).toBeTruthy();
    expect(screen.getByText("资源访问日志")).toBeTruthy();
    expect(screen.getByText("配额规则")).toBeTruthy();
    expect(screen.getByText("告警中心")).toBeTruthy();
    expect(screen.getByText("模型定价")).toBeTruthy();
  });

  it("navigates from the admin shell into the monitoring view", async () => {
    mockedFetchAdminOverview.mockResolvedValue({
      counts: {
        users: 7,
        threads: 13,
        activeSessions: 3
      }
    });

    render(<AdminShell />);

    fireEvent.click(await screen.findByRole("tab", { name: "审计监控" }));
    expect(await screen.findByText("平台总览")).toBeTruthy();
  });
});
