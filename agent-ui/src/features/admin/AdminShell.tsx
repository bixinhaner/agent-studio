import { useEffect, useState } from "react";
import { Alert, Button, Card, Space, Spin, Statistic, Tag, Typography } from "antd";

import { fetchAdminOverview } from "./api";
import { AdminNav, type AdminNavSection } from "./AdminNav";
import { DepartmentTreeView } from "./DepartmentTreeView";
import { OrgSyncView } from "./OrgSyncView";
import { RolesView } from "../rbac/RolesView";
import type { AdminOverview } from "./types";
import { AlertCenterView } from "../monitoring/AlertCenterView";
import { CostProfilesView } from "../monitoring/CostProfilesView";
import { MonitoringOverviewView } from "../monitoring/MonitoringOverviewView";
import { QuotaRulesView } from "../monitoring/QuotaRulesView";
import { ResourceAccessLogView } from "../monitoring/ResourceAccessLogView";
import { IntegrationCenterShell } from "../integration-center/IntegrationCenterShell";
import { ResourceCenterShell } from "../resources-center/ResourceCenterShell";
import { CapabilityCenterShell } from "../capability-center/CapabilityCenterShell";
import { UsageRankingsView } from "../monitoring/UsageRankingsView";
import { UsersView } from "./UsersView";
import { SystemSettingsShell } from "../system-settings/SystemSettingsShell";
import { BroadcastAdminView } from "../collaboration/BroadcastAdminView";
import type { AuthUser } from "../auth/api";
import { UserIdentitySummary } from "../auth/UserIdentitySummary";

const SECTION_META: Record<AdminNavSection, { title: string; description: string }> = {
  overview: {
    title: "平台概览",
    description: "统一查看平台规模、运行状态和基础接入健康。"
  },
  users: {
    title: "用户治理",
    description: "管理用户身份、状态与同步信息，保障组织成员可控可审计。"
  },
  resources: {
    title: "资源配置中心",
    description: "集中维护工作区、知识集与资源绑定关系。"
  },
  capabilities: {
    title: "能力配置总览",
    description: "统一管理 Agent 模式、技能包与运行策略。"
  },
  integrations: {
    title: "集成中心",
    description: "配置第三方平台接入并跟踪连接健康状态。"
  },
  broadcasts: {
    title: "广播管理",
    description: "维护系统广播模板与触达配置，保证公告发布有序可追踪。"
  },
  "system-settings": {
    title: "系统设置",
    description: "管理平台默认行为、策略开关与发布版本。"
  },
  organization: {
    title: "组织同步",
    description: "查看部门树和同步任务，确保组织数据一致。"
  },
  rbac: {
    title: "角色权限",
    description: "维护角色模板和授权矩阵，统一权限治理。"
  },
  monitoring: {
    title: "审计监控",
    description: "追踪请求、成本、配额、告警与资源访问轨迹。"
  }
};

function OverviewCard(props: { overview: AdminOverview | null; loading: boolean; errorText: string }) {
  return (
    <Card className="admin-card antd-admin-card">
      <Typography.Title level={4} className="admin-card-heading">
        运行概览
      </Typography.Title>
      {props.loading ? <Spin size="small" /> : null}
      {props.errorText ? (
        <Alert
          type="error"
          showIcon
          className="admin-alert-inline"
          message={props.errorText}
        />
      ) : null}
      {props.overview ? (
        <Space direction="vertical" size={16} className="admin-full-width">
          <div className="admin-metric-grid">
            <Card size="small" className="admin-metric-card">
              <Statistic title="用户" value={props.overview.counts.users} />
            </Card>
            <Card size="small" className="admin-metric-card">
              <Statistic title="线程" value={props.overview.counts.threads} />
            </Card>
            <Card size="small" className="admin-metric-card">
              <Statistic title="活跃会话" value={props.overview.counts.activeSessions} />
            </Card>
          </div>
          {props.overview.integrations?.zendesk ? (
            <div className="admin-integration-note">
              <Tag color={props.overview.integrations.zendesk.ready ? "success" : "warning"}>
                Zendesk {props.overview.integrations.zendesk.ready ? "已就绪" : "待补配置"}
              </Tag>
            </div>
          ) : null}
        </Space>
      ) : null}
    </Card>
  );
}

function ConsolePulse(props: { overview: AdminOverview | null; loading: boolean }) {
  return (
    <div className="admin-console-pulse">
      <Card size="small" className="admin-console-pulse-card">
        <Statistic title="用户" value={props.loading ? "-" : props.overview?.counts.users ?? "-"} />
      </Card>
      <Card size="small" className="admin-console-pulse-card">
        <Statistic title="线程" value={props.loading ? "-" : props.overview?.counts.threads ?? "-"} />
      </Card>
      <Card size="small" className="admin-console-pulse-card">
        <Statistic title="活跃会话" value={props.loading ? "-" : props.overview?.counts.activeSessions ?? "-"} />
      </Card>
    </div>
  );
}

export function AdminShell(props: { currentUser?: AuthUser; onOpenPortal?: () => void }) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [section, setSection] = useState<AdminNavSection>("overview");
  const currentSectionMeta = SECTION_META[section];

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setErrorText("");
      try {
        const next = await fetchAdminOverview();
        if (active) setOverview(next);
      } catch (error) {
        if (active) setErrorText(error instanceof Error ? error.message : "加载管理概览失败");
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="admin-shell admin-shell-layout">
      <Card className="admin-card admin-shell-sidebar" styles={{ body: { padding: 20 } }}>
        <div className="admin-shell-brand">
          <span className="admin-shell-brand-mark" aria-hidden="true">
            AS
          </span>
          <div>
            <p className="auth-eyebrow">Agent Studio Admin</p>
            <Typography.Title level={3} className="admin-shell-title">
              管理控制台
            </Typography.Title>
          </div>
        </div>
        <p className="admin-description">统一管理用户、权限、资源、运行策略、系统设置和平台监控。</p>
        {props.currentUser ? <UserIdentitySummary user={props.currentUser} /> : null}
        {props.onOpenPortal ? (
          <div className="shell-switch-row">
            <Button type="default" className="shell-switch-btn" onClick={props.onOpenPortal}>
              进入工作台
            </Button>
          </div>
        ) : null}
        <AdminNav section={section} onChange={setSection} />
      </Card>

      <main className="admin-main-content">
        <Card className="admin-card admin-console-banner" styles={{ body: { padding: 20 } }}>
          <div>
            <p className="auth-eyebrow">当前分区</p>
            <div className="admin-banner-meta">
              <Tag color="blue">{currentSectionMeta.title}</Tag>
              <Tag>本地时区展示</Tag>
            </div>
            <Typography.Title level={1} className="admin-banner-title">
              {currentSectionMeta.title}
            </Typography.Title>
            <p>{currentSectionMeta.description}</p>
          </div>
          <ConsolePulse overview={overview} loading={loading} />
        </Card>

        <div className="admin-main-panels">
          {section === "overview" ? <OverviewCard overview={overview} loading={loading} errorText={errorText} /> : null}
          {section === "users" ? <UsersView /> : null}
          {section === "resources" ? <ResourceCenterShell /> : null}
          {section === "capabilities" ? <CapabilityCenterShell /> : null}
          {section === "integrations" ? <IntegrationCenterShell /> : null}
          {section === "broadcasts" ? <BroadcastAdminView /> : null}
          {section === "system-settings" ? <SystemSettingsShell /> : null}
          {section === "rbac" ? <RolesView /> : null}
          {section === "organization" ? (
            <div className="admin-stack-grid">
              <DepartmentTreeView />
              <OrgSyncView />
            </div>
          ) : null}
          {section === "monitoring" ? (
            <div className="monitoring-shell">
              <MonitoringOverviewView />
              <UsageRankingsView />
              <ResourceAccessLogView />
              <QuotaRulesView />
              <AlertCenterView />
              <CostProfilesView />
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}

export default AdminShell;
