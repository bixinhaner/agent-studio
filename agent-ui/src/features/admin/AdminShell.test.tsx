import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  fetchAdminOverview: vi.fn()
}));

vi.mock("./DepartmentTreeView", () => ({
  DepartmentTreeView: () => <section>部门树</section>
}));

vi.mock("./UsersView", () => ({
  UsersView: () => <section>用户管理</section>
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

vi.mock("../resources-center/ResourceCenterShell", () => ({
  ResourceCenterShell: () => (
    <section>
      <h2>资源中心面板</h2>
    </section>
  )
}));

vi.mock("../capability-center/CapabilityCenterShell", () => ({
  CapabilityCenterShell: () => (
    <section>
      <h2>能力配置中心</h2>
    </section>
  )
}));

vi.mock("../integration-center/IntegrationCenterShell", () => ({
  IntegrationCenterShell: () => (
    <section>
      <h2>集成中心面板</h2>
    </section>
  )
}));

import { AdminShell } from "./AdminShell";
import { fetchAdminOverview } from "./api";

const mockedFetchAdminOverview = vi.mocked(fetchAdminOverview);

describe("AdminShell", () => {
  beforeEach(() => {
    mockedFetchAdminOverview.mockReset();
  });

  it("switches between overview, users, resources, capabilities, integrations, rbac, organization, and monitoring views", async () => {
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
    fireEvent.click(screen.getByRole("tab", { name: "资源配置中心" }));
    expect(await screen.findByText("资源中心面板")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "能力配置中心" }));
    expect(await screen.findByRole("heading", { name: "能力配置中心" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "集成中心" }));
    expect(await screen.findByRole("heading", { name: "集成中心面板" })).toBeTruthy();
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

  it("navigates from the admin shell into the resource center", async () => {
    mockedFetchAdminOverview.mockResolvedValue({
      counts: {
        users: 7,
        threads: 13,
        activeSessions: 3
      }
    });

    render(<AdminShell />);

    fireEvent.click(await screen.findByRole("tab", { name: "资源配置中心" }));
    expect(await screen.findByText("资源中心面板")).toBeTruthy();
  });

  it("navigates from the admin shell into the capability center", async () => {
    mockedFetchAdminOverview.mockResolvedValue({
      counts: {
        users: 7,
        threads: 13,
        activeSessions: 3
      }
    });

    render(<AdminShell />);

    fireEvent.click(await screen.findByRole("tab", { name: "能力配置中心" }));
    expect(await screen.findByRole("heading", { name: "能力配置中心" })).toBeTruthy();
  });

  it("navigates from the admin shell into the integration center", async () => {
    mockedFetchAdminOverview.mockResolvedValue({
      counts: {
        users: 7,
        threads: 13,
        activeSessions: 3
      }
    });

    render(<AdminShell />);

    fireEvent.click(await screen.findByRole("tab", { name: "集成中心" }));
    expect(await screen.findByRole("heading", { name: "集成中心面板" })).toBeTruthy();
  });
});
