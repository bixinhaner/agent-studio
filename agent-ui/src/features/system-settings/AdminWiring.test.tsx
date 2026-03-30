import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../admin/api", () => ({
  fetchAdminOverview: vi.fn()
}));

vi.mock("../admin/DepartmentTreeView", () => ({
  DepartmentTreeView: () => <section>部门树</section>
}));

vi.mock("../admin/UsersView", () => ({
  UsersView: () => <section>用户管理</section>
}));

vi.mock("../admin/OrgSyncView", () => ({
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

vi.mock("../system-settings/SystemSettingsShell", () => ({
  SystemSettingsShell: () => (
    <section>
      <h2>系统设置面板</h2>
    </section>
  )
}));

import { AdminNav } from "../admin/AdminNav";
import { AdminShell } from "../admin/AdminShell";
import { fetchAdminOverview } from "../admin/api";

const mockedFetchAdminOverview = vi.mocked(fetchAdminOverview);

describe("system settings admin wiring", () => {
  beforeEach(() => {
    mockedFetchAdminOverview.mockReset();
  });

  it("includes the system settings tab in the admin nav", () => {
    const onChange = vi.fn();

    render(<AdminNav section="overview" onChange={onChange} />);

    fireEvent.click(screen.getByRole("tab", { name: "系统设置" }));

    expect(onChange).toHaveBeenCalledWith("system-settings");
  });

  it("opens the system settings shell from the admin console", async () => {
    mockedFetchAdminOverview.mockResolvedValue({
      counts: {
        users: 7,
        threads: 13,
        activeSessions: 3
      }
    });

    render(<AdminShell />);

    fireEvent.click(await screen.findByRole("tab", { name: "系统设置" }));
    expect(await screen.findByText("系统设置面板")).toBeTruthy();
  });
});
