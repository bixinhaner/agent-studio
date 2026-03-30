import { useEffect, useState } from "react";

import { fetchAdminOverview } from "./api";
import { AdminNav } from "./AdminNav";
import { DepartmentTreeView } from "./DepartmentTreeView";
import { OrgSyncView } from "./OrgSyncView";
import { RolesView } from "../rbac/RolesView";
import type { AdminOverview, AdminSection } from "./types";
import { AlertCenterView } from "../monitoring/AlertCenterView";
import { CostProfilesView } from "../monitoring/CostProfilesView";
import { MonitoringOverviewView } from "../monitoring/MonitoringOverviewView";
import { QuotaRulesView } from "../monitoring/QuotaRulesView";
import { ResourceAccessLogView } from "../monitoring/ResourceAccessLogView";
import { UsageRankingsView } from "../monitoring/UsageRankingsView";
import { UsersView } from "./UsersView";

function OverviewCard(props: { overview: AdminOverview | null; loading: boolean; errorText: string }) {
  return (
    <section className="admin-card">
      <h2>运行概览</h2>
      {props.loading ? <p>加载中...</p> : null}
      {props.errorText ? <p className="err-text">{props.errorText}</p> : null}
      {props.overview ? (
        <>
          <dl className="admin-metrics">
            <div>
              <dt>用户</dt>
              <dd>{props.overview.counts.users}</dd>
            </div>
            <div>
              <dt>线程</dt>
              <dd>{props.overview.counts.threads}</dd>
            </div>
            <div>
              <dt>活跃会话</dt>
              <dd>{props.overview.counts.activeSessions}</dd>
            </div>
          </dl>
          {props.overview.integrations?.zendesk ? (
            <div className="admin-integration-note">
              Zendesk：{props.overview.integrations.zendesk.ready ? "已就绪" : "待补配置"}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export function AdminShell() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [section, setSection] = useState<AdminSection>("overview");

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
      <section className="admin-card">
        <p className="auth-eyebrow">Agent Studio Admin</p>
        <h1>管理控制台</h1>
        <p className="admin-description">统一查看运行状态、用户治理、角色权限、钉钉组织同步和运营监控。</p>
        <AdminNav section={section} onChange={setSection} />
      </section>
      {section === "overview" ? <OverviewCard overview={overview} loading={loading} errorText={errorText} /> : null}
      {section === "users" ? <UsersView /> : null}
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
  );
}

export default AdminShell;
