import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Space, Spin, Statistic, Tag, Typography } from "antd";

import { fetchAdminOverview } from "./api";
import { AdminNav, type AdminNavSection } from "./AdminNav";
import { DepartmentTreeView } from "./DepartmentTreeView";
import { OrgSyncView } from "./OrgSyncView";
import { RolesView } from "../rbac/RolesView";
import type { AdminOverview } from "./types";
import { IntegrationCenterShell } from "../integration-center/IntegrationCenterShell";
import { ResourceCenterShell } from "../resources-center/ResourceCenterShell";
import { CapabilityCenterShell } from "../capability-center/CapabilityCenterShell";
import { UsersView } from "./UsersView";
import { SystemSettingsShell } from "../system-settings/SystemSettingsShell";
import { BroadcastAdminView } from "../collaboration/BroadcastAdminView";
import type { AuthUser } from "../auth/api";
import { UserIdentitySummary } from "../auth/UserIdentitySummary";
import { MonitoringShell } from "../monitoring/MonitoringShell";

const SECTION_META: Record<AdminNavSection, { title: string; description: string; scope: string; cadence: string }> = {
  overview: {
    title: "平台概览",
    description: "统一查看平台规模、运行状态和基础接入健康。",
    scope: "全局管理域",
    cadence: "建议每小时刷新一次"
  },
  users: {
    title: "用户治理",
    description: "管理用户身份、状态与同步信息，保障组织成员可控可审计。",
    scope: "身份与组织",
    cadence: "建议每日巡检"
  },
  resources: {
    title: "资源配置中心",
    description: "集中维护工作区、知识集与资源绑定关系。",
    scope: "资源与授权",
    cadence: "按项目变更维护"
  },
  capabilities: {
    title: "能力配置总览",
    description: "统一管理 Agent 模式、技能包与运行策略。",
    scope: "运行能力",
    cadence: "按发布节奏更新"
  },
  integrations: {
    title: "集成中心",
    description: "配置第三方平台接入并跟踪连接健康状态。",
    scope: "外部平台连接",
    cadence: "建议每周复核"
  },
  broadcasts: {
    title: "广播管理",
    description: "维护系统广播模板与触达配置，保证公告发布有序可追踪。",
    scope: "运营触达",
    cadence: "按活动排期维护"
  },
  "system-settings": {
    title: "系统设置",
    description: "管理平台默认行为、策略开关与发布版本。",
    scope: "平台默认参数",
    cadence: "变更前评审后发布"
  },
  organization: {
    title: "组织同步",
    description: "查看部门树和同步任务，确保组织数据一致。",
    scope: "组织架构",
    cadence: "按同步任务节奏"
  },
  rbac: {
    title: "角色权限",
    description: "维护角色模板和授权矩阵，统一权限治理。",
    scope: "角色与权限",
    cadence: "建议双周审计"
  },
  monitoring: {
    title: "审计监控",
    description: "追踪请求、成本、配额、告警与资源访问轨迹。",
    scope: "运行审计",
    cadence: "建议实时关注"
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

function formatLocalTimestamp(value: Date | null): string {
  if (!value) return "未刷新";
  return value.toLocaleString();
}

function SectionContext(props: { section: AdminNavSection }) {
  const meta = SECTION_META[props.section];
  return (
    <Card size="small" className="admin-section-context-card">
      <div className="admin-section-context-grid">
        <article className="admin-section-context-item">
          <span className="admin-section-context-label">治理范围</span>
          <strong className="admin-section-context-value">{meta.scope}</strong>
        </article>
        <article className="admin-section-context-item">
          <span className="admin-section-context-label">巡检节奏</span>
          <strong className="admin-section-context-value">{meta.cadence}</strong>
        </article>
        <article className="admin-section-context-item">
          <span className="admin-section-context-label">系统品牌</span>
          <strong className="admin-section-context-value">Agent Studio</strong>
        </article>
      </div>
    </Card>
  );
}

export function AdminShell(props: { currentUser?: AuthUser; onOpenPortal?: () => void; onSignOut?: () => void }) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [overviewRefreshedAt, setOverviewRefreshedAt] = useState<Date | null>(null);
  const [section, setSection] = useState<AdminNavSection>("overview");
  const mountedRef = useRef(true);
  const mainContentRef = useRef<HTMLElement | null>(null);
  const currentSectionMeta = SECTION_META[section];

  const loadOverview = useCallback(async () => {
    if (!mountedRef.current) return;
    setLoading(true);
    setErrorText("");
    try {
      const next = await fetchAdminOverview();
      if (!mountedRef.current) return;
      setOverview(next);
      setOverviewRefreshedAt(new Date());
    } catch (error) {
      if (!mountedRef.current) return;
      setErrorText(error instanceof Error ? error.message : "加载管理概览失败");
    } finally {
      if (!mountedRef.current) return;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadOverview();
    return () => {
      mountedRef.current = false;
    };
  }, [loadOverview]);

  useEffect(() => {
    if (mainContentRef.current) {
      mainContentRef.current.scrollTop = 0;
    }
  }, [section]);

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
        {props.currentUser ? <UserIdentitySummary user={props.currentUser} onSignOut={props.onSignOut} /> : null}
        {props.onOpenPortal ? (
          <div className="shell-switch-row">
            <Button type="default" className="shell-switch-btn" onClick={props.onOpenPortal}>
              进入工作台
            </Button>
          </div>
        ) : null}
        <AdminNav section={section} onChange={setSection} />
      </Card>

      <main className="admin-main-content" ref={mainContentRef}>
        <Card className="admin-card admin-console-banner" styles={{ body: { padding: 20 } }}>
          <div className="admin-console-copy">
            <p className="auth-eyebrow">当前分区</p>
            <div className="admin-banner-meta">
              <Tag color="blue">{currentSectionMeta.title}</Tag>
              <Tag>{currentSectionMeta.scope}</Tag>
              <Tag>概览更新时间：{formatLocalTimestamp(overviewRefreshedAt)}</Tag>
            </div>
            <Typography.Title level={1} className="admin-banner-title">
              {currentSectionMeta.title}
            </Typography.Title>
            <p>{currentSectionMeta.description}</p>
            <div className="admin-banner-actions">
              <Button type="default" size="small" onClick={() => void loadOverview()} loading={loading}>
                刷新概览
              </Button>
              <Tag color="processing">本地时区展示</Tag>
            </div>
          </div>
          <ConsolePulse overview={overview} loading={loading} />
        </Card>
        <SectionContext section={section} />

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
          {section === "monitoring" ? <MonitoringShell /> : null}
        </div>
      </main>
    </div>
  );
}

export default AdminShell;
