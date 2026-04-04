import {
  LayoutDashboard,
  Activity,
  Bell,
  Users,
  Network,
  ShieldCheck,
  Database,
  Wrench,
  Component,
  Settings,
  MessageSquareText,
  Search,
  Menu,
  RefreshCcw,
  Command,
  PanelLeftClose,
  PanelLeftOpen
} from "lucide-react";
import { Alert, Breadcrumb, Button, ConfigProvider, Drawer, Input, Space, Spin, Modal, List } from "antd";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { AuthUser } from "../auth/api";
import { UserIdentitySummary } from "../auth/UserIdentitySummary";
import { fetchAdminOverview } from "./api";
import type { AdminOverview, AdminSection } from "./types";

import { ADMIN_PREMIUM_THEME } from "./admin-theme";
import "./admin-console.css";

const MonitoringShellLazy = lazy(() => import("../monitoring/MonitoringShell").then((module) => ({ default: module.MonitoringShell })));
const BroadcastAdminViewLazy = lazy(() =>
  import("../collaboration/BroadcastAdminView").then((module) => ({ default: module.BroadcastAdminView }))
);
const ConversationAuditViewLazy = lazy(() =>
  import("./ConversationAuditView").then((module) => ({ default: module.ConversationAuditView }))
);
const UsersViewLazy = lazy(() => import("./UsersView").then((module) => ({ default: module.UsersView })));
const DepartmentTreeViewLazy = lazy(() =>
  import("./DepartmentTreeView").then((module) => ({ default: module.DepartmentTreeView }))
);
const OrgSyncViewLazy = lazy(() => import("./OrgSyncView").then((module) => ({ default: module.OrgSyncView })));
const RolesViewLazy = lazy(() => import("../rbac/RolesView").then((module) => ({ default: module.RolesView })));
const ResourceCenterShellLazy = lazy(() =>
  import("../resources-center/ResourceCenterShell").then((module) => ({ default: module.ResourceCenterShell }))
);
const CapabilityCenterShellLazy = lazy(() =>
  import("../capability-center/CapabilityCenterShell").then((module) => ({ default: module.CapabilityCenterShell }))
);
const IntegrationCenterShellLazy = lazy(() =>
  import("../integration-center/IntegrationCenterShell").then((module) => ({ default: module.IntegrationCenterShell }))
);
const SystemSettingsShellLazy = lazy(() =>
  import("../system-settings/SystemSettingsShell").then((module) => ({ default: module.SystemSettingsShell }))
);

type AdminConsoleSection = AdminSection | "broadcasts";
type AdminConsoleGroup = "operations" | "governance" | "runtime";

type AdminSectionMeta = {
  id: AdminConsoleSection;
  title: string;
  description: string;
  scope: string;
  cadence: string;
  group: AdminConsoleGroup;
  keywords: string[];
  icon: ReactNode;
};

type AdminGroupMeta = {
  id: AdminConsoleGroup;
  label: string;
  description: string;
};

type AdminNavigationGroupView = AdminGroupMeta & {
  items: AdminSectionMeta[];
};

const ADMIN_HASH_PREFIX = "#admin/";

const GROUPS: AdminGroupMeta[] = [
  { id: "operations", label: "运营总览", description: "平台状态、监控告警与广播运营。" },
  { id: "governance", label: "组织治理", description: "用户、组织结构和权限审计。" },
  { id: "runtime", label: "运行能力", description: "资源、能力、集成和系统默认策略。" }
];

const SECTION_ORDER: AdminConsoleSection[] = [
  "overview", "conversations", "monitoring", "broadcasts",
  "users", "organization", "rbac",
  "resources", "capabilities", "integrations", "system-settings"
];

const SECTION_META: Record<AdminConsoleSection, AdminSectionMeta> = {
  overview: { id: "overview", title: "平台概览", description: "统一查看平台规模、活跃状态与核心运营指标。", scope: "全局管理域", cadence: "建议每小时刷新", group: "operations", keywords: ["概览", "运营", "dashboard"], icon: <LayoutDashboard size={18} /> },
  conversations: { id: "conversations", title: "审计工作台", description: "统一查看用户会话、反馈记录与 API 调用轨迹。", scope: "会话与 API 调用", cadence: "建议持续巡检", group: "operations", keywords: ["会话", "审计", "api"], icon: <MessageSquareText size={18} /> },
  monitoring: { id: "monitoring", title: "审计监控", description: "追踪请求、成本、配额、告警和资源访问轨迹。", scope: "运行审计", cadence: "建议持续观察", group: "operations", keywords: ["监控", "告警", "成本"], icon: <Activity size={18} /> },
  broadcasts: { id: "broadcasts", title: "广播管理", description: "维护系统广播模板与触达策略。", scope: "运营触达", cadence: "按活动排期维护", group: "operations", keywords: ["广播", "公告", "触达"], icon: <Bell size={18} /> },
  users: { id: "users", title: "用户治理", description: "管理用户状态、身份资料与本地治理字段。", scope: "身份与成员", cadence: "建议每日巡检", group: "governance", keywords: ["用户", "成员", "账号"], icon: <Users size={18} /> },
  organization: { id: "organization", title: "组织同步", description: "查看部门树与同步任务，定位组织数据偏差。", scope: "组织架构", cadence: "按同步任务节奏", group: "governance", keywords: ["组织", "部门", "同步"], icon: <Network size={18} /> },
  rbac: { id: "rbac", title: "角色权限", description: "维护角色模板和权限矩阵，保障授权可追溯。", scope: "权限体系", cadence: "建议双周审计", group: "governance", keywords: ["角色", "权限", "RBAC"], icon: <ShieldCheck size={18} /> },
  resources: { id: "resources", title: "资料集", description: "集中维护资料集、文件来源与资源授权策略。", scope: "资源与授权", cadence: "按项目变更维护", group: "runtime", keywords: ["资源", "资料集"], icon: <Database size={18} /> },
  capabilities: { id: "capabilities", title: "智能体配置", description: "统一管理 Agent 模式、技能包和运行策略。", scope: "运行能力", cadence: "按发布节奏更新", group: "runtime", keywords: ["能力", "mode", "skill"], icon: <Wrench size={18} /> },
  integrations: { id: "integrations", title: "集成中心", description: "配置第三方平台连接并追踪实例健康状态。", scope: "外部平台连接", cadence: "建议每周复核", group: "runtime", keywords: ["集成", "dingtalk", "zendesk"], icon: <Component size={18} /> },
  "system-settings": { id: "system-settings", title: "系统配置", description: "维护平台默认参数、策略开关和版本发布记录。", scope: "平台默认参数", cadence: "变更前评审后发布", group: "runtime", keywords: ["系统", "配置"], icon: <Settings size={18} /> }
};

function sectionFromHash(hash: string): AdminConsoleSection | null {
  if (!hash.startsWith(ADMIN_HASH_PREFIX)) return null;
  const value = decodeURIComponent(hash.slice(ADMIN_HASH_PREFIX.length)).trim();
  if (!SECTION_ORDER.includes(value as AdminConsoleSection)) return null;
  return value as AdminConsoleSection;
}

function formatMetricValue(value: number | undefined): string {
  if (!Number.isFinite(value ?? NaN)) return "--";
  return new Intl.NumberFormat("zh-CN").format(value ?? 0);
}

function AdminSectionLazyFallback() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 64 }}>
      <Spin size="large" />
    </div>
  );
}

function OverviewWorkspace(props: { overview: AdminOverview | null; loading: boolean }) {
  return (
    <div className="admin-card">
      <h3 style={{ marginBottom: 16, fontSize: 18, fontWeight: 600 }}>平台概览</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <div style={{ padding: 16, background: 'rgba(0,0,0,0.02)', borderRadius: 12 }}>
          <div style={{ color: 'var(--admin-color-subtle)', fontSize: 13 }}>用户规模</div>
          <div style={{ fontSize: 24, fontWeight: 600, marginTop: 4 }}>{props.loading ? "..." : formatMetricValue(props.overview?.counts.users)}</div>
        </div>
        <div style={{ padding: 16, background: 'rgba(0,0,0,0.02)', borderRadius: 12 }}>
          <div style={{ color: 'var(--admin-color-subtle)', fontSize: 13 }}>活跃会话</div>
          <div style={{ fontSize: 24, fontWeight: 600, marginTop: 4 }}>{props.loading ? "..." : formatMetricValue(props.overview?.counts.activeSessions)}</div>
        </div>
        <div style={{ padding: 16, background: 'rgba(0,0,0,0.02)', borderRadius: 12 }}>
          <div style={{ color: 'var(--admin-color-subtle)', fontSize: 13 }}>总线程数</div>
          <div style={{ fontSize: 24, fontWeight: 600, marginTop: 4 }}>{props.loading ? "..." : formatMetricValue(props.overview?.counts.threads)}</div>
        </div>
      </div>
    </div>
  );
}

function AdminSectionContent(props: { section: AdminConsoleSection; overview: AdminOverview | null; loading: boolean }) {
  switch (props.section) {
    case "overview": return <OverviewWorkspace overview={props.overview} loading={props.loading} />;
    case "users": return <Suspense fallback={<AdminSectionLazyFallback />}><UsersViewLazy /></Suspense>;
    case "conversations": return <Suspense fallback={<AdminSectionLazyFallback />}><ConversationAuditViewLazy /></Suspense>;
    case "resources": return <Suspense fallback={<AdminSectionLazyFallback />}><ResourceCenterShellLazy /></Suspense>;
    case "capabilities": return <Suspense fallback={<AdminSectionLazyFallback />}><CapabilityCenterShellLazy /></Suspense>;
    case "integrations": return <Suspense fallback={<AdminSectionLazyFallback />}><IntegrationCenterShellLazy /></Suspense>;
    case "broadcasts": return <Suspense fallback={<AdminSectionLazyFallback />}><BroadcastAdminViewLazy /></Suspense>;
    case "system-settings": return <Suspense fallback={<AdminSectionLazyFallback />}><SystemSettingsShellLazy /></Suspense>;
    case "rbac": return <Suspense fallback={<AdminSectionLazyFallback />}><RolesViewLazy /></Suspense>;
    case "organization": return <div style={{ display: 'flex', gap: 24 }}><Suspense fallback={<AdminSectionLazyFallback />}><DepartmentTreeViewLazy /></Suspense><Suspense fallback={<AdminSectionLazyFallback />}><OrgSyncViewLazy /></Suspense></div>;
    case "monitoring": return <Suspense fallback={<AdminSectionLazyFallback />}><MonitoringShellLazy /></Suspense>;
    default: return null;
  }
}

export function AdminShell(props: { currentUser?: AuthUser; onOpenPortal?: () => void; onSignOut?: () => void }) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<AdminConsoleSection>(() => {
    if (typeof window === "undefined") return "overview";
    return sectionFromHash(window.location.hash) ?? "overview";
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [cmdSearch, setCmdSearch] = useState("");

  const currentSectionMeta = SECTION_META[section];
  const currentGroupMeta = GROUPS.find((item) => item.id === currentSectionMeta.group) ?? GROUPS[0];

  useEffect(() => {
    fetchAdminOverview().then(setOverview).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      const fromHash = sectionFromHash(window.location.hash);
      if (fromHash) setSection(fromHash);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const nextHash = `${ADMIN_HASH_PREFIX}${encodeURIComponent(section)}`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", nextHash);
    }
  }, [section]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleNavClick = (id: AdminConsoleSection) => {
    setSection(id);
    setCmdPaletteOpen(false);
  };

  const filteredCmdItems = useMemo(() => {
    const query = cmdSearch.toLowerCase();
    return Object.values(SECTION_META).filter(item => 
      item.title.toLowerCase().includes(query) || 
      item.description.toLowerCase().includes(query) ||
      item.keywords.some(k => k.toLowerCase().includes(query))
    );
  }, [cmdSearch]);

  return (
    <ConfigProvider theme={ADMIN_PREMIUM_THEME}>
      <div className="admin-console-root">
        {/* Sidebar */}
        <aside className={`admin-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="admin-sidebar-header">
            <div className="admin-brand" style={{ display: sidebarCollapsed ? 'none' : 'flex' }}>
              <div className="admin-brand-icon">AS</div>
              <span>Agent Studio</span>
            </div>
            {sidebarCollapsed && <div className="admin-brand-icon" style={{ margin: '0 auto' }}>AS</div>}
          </div>
          <div className="admin-sidebar-content">
            {GROUPS.map(group => (
              <div key={group.id} style={{ marginBottom: 24 }}>
                {!sidebarCollapsed && (
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--admin-color-subtle)', marginBottom: 8, paddingLeft: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {group.label}
                  </div>
                )}
                {SECTION_ORDER.map(secId => {
                  const meta = SECTION_META[secId];
                  if (meta.group !== group.id) return null;
                  return (
                    <div 
                      key={meta.id} 
                      className={`admin-menu-item ${section === meta.id ? 'active' : ''}`}
                      onClick={() => handleNavClick(meta.id)}
                      title={sidebarCollapsed ? meta.title : undefined}
                    >
                      {meta.icon}
                      {!sidebarCollapsed && <span>{meta.title}</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </aside>

        {/* Main Content */}
        <main className="admin-main">
          {/* Topbar */}
          <header className="admin-topbar">
            <div className="admin-topbar-left">
              <Button 
                type="text" 
                icon={sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />} 
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                style={{ color: 'var(--admin-color-subtle)' }}
              />
              <Breadcrumb 
                items={[
                  { title: currentGroupMeta.label },
                  { title: currentSectionMeta.title }
                ]}
              />
            </div>
            <div className="admin-topbar-right">
              <button className="admin-cmd-trigger" onClick={() => setCmdPaletteOpen(true)}>
                <Search size={14} />
                <span>Search or jump to...</span>
                <span className="admin-cmd-kbd">⌘K</span>
              </button>
              {props.currentUser && <UserIdentitySummary user={props.currentUser} compact onSignOut={props.onSignOut} />}
            </div>
          </header>

          {/* Scrollable Area */}
          <div className="admin-content-scroll">
            <div className="admin-page-header">
              <h1 className="admin-page-title">{currentSectionMeta.title}</h1>
              <p className="admin-page-desc">{currentSectionMeta.description}</p>
            </div>
            <AdminSectionContent section={section} overview={overview} loading={loading} />
          </div>
        </main>

        {/* Command Palette Modal */}
        <Modal
          open={cmdPaletteOpen}
          onCancel={() => setCmdPaletteOpen(false)}
          footer={null}
          closable={false}
          width={600}
          bodyStyle={{ padding: 0 }}
          style={{ top: 100 }}
        >
          <div style={{ padding: 16, borderBottom: '1px solid var(--admin-color-border)' }}>
            <Input 
              prefix={<Search size={18} style={{ color: 'var(--admin-color-subtle)' }} />}
              placeholder="Search features, settings..." 
              variant="borderless"
              size="large"
              autoFocus
              value={cmdSearch}
              onChange={e => setCmdSearch(e.target.value)}
              style={{ fontSize: 18 }}
            />
          </div>
          <List
            dataSource={filteredCmdItems}
            style={{ maxHeight: 400, overflow: 'auto' }}
            renderItem={item => (
              <List.Item 
                className="admin-menu-item"
                style={{ margin: '8px 16px', border: 'none' }}
                onClick={() => handleNavClick(item.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
                  <div style={{ padding: 8, background: 'var(--admin-color-bg)', borderRadius: 8 }}>
                    {item.icon}
                  </div>
                  <div>
                    <div style={{ fontWeight: 500, color: 'var(--admin-color-text)' }}>{item.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--admin-color-subtle)' }}>{item.description}</div>
                  </div>
                </div>
              </List.Item>
            )}
          />
        </Modal>
      </div>
    </ConfigProvider>
  );
}

export default AdminShell;
