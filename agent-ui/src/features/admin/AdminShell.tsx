import {
  Activity,
  ArrowRight,
  BarChart3,
  Bell,
  ClipboardList,
  Component,
  Crown,
  Database,
  FileUser,
  LayoutDashboard,
  LogOutIcon,
  Menu,
  MessageSquareText,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  ShieldCheck,
  Users,
  Wrench
} from "lucide-react";
import { Breadcrumb, Button, Col, ConfigProvider, Drawer, Input, List, Modal, Row, Spin } from "antd";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { useIsNarrowScreen } from "../../lib/use-is-narrow-screen";
import type { AuthUser } from "../auth/api";
import { UserIdentitySummary } from "../auth/UserIdentitySummary";
import { BrandMark } from "../branding/BrandMark";
import { useBranding } from "../branding/BrandingProvider";
import { fetchAdminOverview } from "./api";
import { ADMIN_PREMIUM_THEME } from "./admin-theme";
import type { AdminOverview, AdminSection } from "./types";
import "./admin-console.css";

const MonitoringShellLazy = lazy(() =>
  import("../monitoring/MonitoringShell").then((module) => ({ default: module.MonitoringShell }))
);
const OperationsAnalyticsViewLazy = lazy(() =>
  import("../monitoring/OperationsAnalyticsView").then((module) => ({ default: module.OperationsAnalyticsView }))
);
const BroadcastAdminViewLazy = lazy(() =>
  import("../collaboration/BroadcastAdminView").then((module) => ({ default: module.BroadcastAdminView }))
);
const ConversationAuditViewLazy = lazy(() =>
  import("./ConversationAuditView").then((module) => ({ default: module.ConversationAuditView }))
);
const SubscriptionWorkspaceLazy = lazy(() =>
  import("./SubscriptionWorkspace").then((module) => ({ default: module.SubscriptionWorkspace }))
);
const AccessRequestsWorkspaceLazy = lazy(() =>
  import("../access-requests/AccessRequestsWorkspace").then((module) => ({ default: module.AccessRequestsWorkspace }))
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
const SkillDraftReviewViewLazy = lazy(() =>
  import("../skills/SkillDraftReviewView").then((module) => ({ default: module.SkillDraftReviewView }))
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
  "overview",
  "analytics",
  "conversations",
  "subscriptions",
  "access-requests",
  "monitoring",
  "broadcasts",
  "users",
  "organization",
  "rbac",
  "resources",
  "capabilities",
  "skill-drafts",
  "integrations",
  "system-settings"
];

const SECTION_META: Record<AdminConsoleSection, AdminSectionMeta> = {
  overview: {
    id: "overview",
    title: "平台概览",
    description: "统一查看平台规模、活跃状态与核心运营指标。",
    scope: "全局管理域",
    cadence: "建议每小时刷新",
    group: "operations",
    keywords: ["概览", "运营", "dashboard"],
    icon: <LayoutDashboard size={18} />
  },
  analytics: {
    id: "analytics",
    title: "运营分析",
    description: "按组织、用户、模型、路径和会话维度分析消耗与价值。",
    scope: "运营分析",
    cadence: "建议每日巡检",
    group: "operations",
    keywords: ["运营", "分析", "价值", "session"],
    icon: <BarChart3 size={18} />
  },
  conversations: {
    id: "conversations",
    title: "对话记录",
    description: "统一查看用户会话、反馈记录与 API 调用轨迹。",
    scope: "会话与 API 调用",
    cadence: "建议持续巡检",
    group: "operations",
    keywords: ["会话", "对话", "审计", "api"],
    icon: <MessageSquareText size={18} />
  },
  subscriptions: {
    id: "subscriptions",
    title: "订阅权益",
    description: "管理套餐、用户可用期、组织额度和被拦截的发问记录。",
    scope: "套餐与额度",
    cadence: "建议每日巡检",
    group: "operations",
    keywords: ["订阅", "额度", "套餐", "到期"],
    icon: <Crown size={18} />
  },
  "access-requests": {
    id: "access-requests",
    title: "访问申请",
    description: "处理公开试用申请、审核路由和开通动作。",
    scope: "申请单与开通",
    cadence: "建议持续跟进",
    group: "operations",
    keywords: ["trial", "access", "申请", "审核", "开通"],
    icon: <FileUser size={18} />
  },
  monitoring: {
    id: "monitoring",
    title: "审计监控",
    description: "追踪请求、成本、配额、告警和资源访问轨迹。",
    scope: "运行审计",
    cadence: "建议持续观察",
    group: "operations",
    keywords: ["监控", "告警", "成本"],
    icon: <Activity size={18} />
  },
  broadcasts: {
    id: "broadcasts",
    title: "广播管理",
    description: "维护系统广播模板与触达策略。",
    scope: "运营触达",
    cadence: "按活动排期维护",
    group: "operations",
    keywords: ["广播", "公告", "触达"],
    icon: <Bell size={18} />
  },
  users: {
    id: "users",
    title: "用户治理",
    description: "管理用户状态、身份资料与本地治理字段。",
    scope: "身份与成员",
    cadence: "建议每日巡检",
    group: "governance",
    keywords: ["用户", "成员", "账号"],
    icon: <Users size={18} />
  },
  organization: {
    id: "organization",
    title: "组织同步",
    description: "查看部门树与同步任务，定位组织数据偏差。",
    scope: "组织架构",
    cadence: "按同步任务节奏",
    group: "governance",
    keywords: ["组织", "部门", "同步"],
    icon: <Network size={18} />
  },
  rbac: {
    id: "rbac",
    title: "角色权限",
    description: "维护角色模板和权限矩阵，保障授权可追溯。",
    scope: "权限体系",
    cadence: "建议双周审计",
    group: "governance",
    keywords: ["角色", "权限", "RBAC"],
    icon: <ShieldCheck size={18} />
  },
  resources: {
    id: "resources",
    title: "资料集",
    description: "集中维护资料集、文件来源与资源授权策略。",
    scope: "资源与授权",
    cadence: "按项目变更维护",
    group: "runtime",
    keywords: ["资源", "资料集"],
    icon: <Database size={18} />
  },
  capabilities: {
    id: "capabilities",
    title: "智能体配置",
    description: "统一管理 Agent 模式、技能包和运行策略。",
    scope: "运行能力",
    cadence: "按发布节奏更新",
    group: "runtime",
    keywords: ["能力", "mode", "skill"],
    icon: <Wrench size={18} />
  },
  "skill-drafts": {
    id: "skill-drafts",
    title: "Skill 管理",
    description: "管理已安装 Skills，并审核需要共享发布的 skill 草稿。",
    scope: "Skill Registry 与审核发布",
    cadence: "建议随安装与提交实时处理",
    group: "runtime",
    keywords: ["skill", "技能", "审核", "发布", "草稿", "registry"],
    icon: <ClipboardList size={18} />
  },
  integrations: {
    id: "integrations",
    title: "集成中心",
    description: "配置第三方平台连接并追踪实例健康状态。",
    scope: "外部平台连接",
    cadence: "建议每周复核",
    group: "runtime",
    keywords: ["集成", "dingtalk", "zendesk"],
    icon: <Component size={18} />
  },
  "system-settings": {
    id: "system-settings",
    title: "系统配置",
    description: "维护平台默认参数、策略开关和版本发布记录。",
    scope: "平台默认参数",
    cadence: "变更前评审后发布",
    group: "runtime",
    keywords: ["系统", "配置"],
    icon: <Settings size={18} />
  }
};

const NAVIGATION_GROUPS: AdminNavigationGroupView[] = GROUPS.map((group) => ({
  ...group,
  items: SECTION_ORDER.map((sectionId) => SECTION_META[sectionId]).filter((item) => item.group === group.id)
}));

function sectionFromHash(hash: string): AdminConsoleSection | null {
  if (!hash.startsWith(ADMIN_HASH_PREFIX)) return null;
  const rawValue = hash.slice(ADMIN_HASH_PREFIX.length).split("?")[0] ?? "";
  const value = decodeURIComponent(rawValue).trim();
  if (!SECTION_ORDER.includes(value as AdminConsoleSection)) return null;
  return value as AdminConsoleSection;
}

function formatMetricValue(value: number | undefined): string {
  if (!Number.isFinite(value ?? Number.NaN)) return "--";
  return new Intl.NumberFormat("zh-CN").format(value ?? 0);
}

function getLocalTimeZoneLabel(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "本地时区";
  } catch {
    return "本地时区";
  }
}

function AdminSectionLazyFallback() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 64 }}>
      <Spin size="large" />
    </div>
  );
}

function AdminNavigation(props: {
  activeSection: AdminConsoleSection;
  collapsed: boolean;
  onNavigate: (section: AdminConsoleSection) => void;
}) {
  return (
    <div className="admin-sidebar-content">
      {NAVIGATION_GROUPS.map((group) => (
        <div key={group.id} style={{ marginBottom: 24 }}>
          {!props.collapsed ? (
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--admin-color-subtle)",
                marginBottom: 8,
                paddingLeft: 12,
                textTransform: "uppercase",
                letterSpacing: "0.05em"
              }}
            >
              {group.label}
            </div>
          ) : null}
          {group.items.map((item) => (
            <div
              key={item.id}
              className={`admin-menu-item ${props.activeSection === item.id ? "active" : ""}`}
              onClick={() => props.onNavigate(item.id)}
              title={props.collapsed ? item.title : undefined}
            >
              {item.icon}
              {!props.collapsed ? <span>{item.title}</span> : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function OverviewWorkspace(props: {
  overview: AdminOverview | null;
  loading: boolean;
  onNavigate: (section: AdminConsoleSection) => void;
}) {
  const stats = [
    {
      label: "用户规模",
      value: props.loading ? "..." : formatMetricValue(props.overview?.counts.users),
      meta: "纳管成员总数"
    },
    {
      label: "活跃会话",
      value: props.loading ? "..." : formatMetricValue(props.overview?.counts.activeSessions),
      meta: "当前有上下文活动的运行会话"
    },
    {
      label: "总线程数",
      value: props.loading ? "..." : formatMetricValue(props.overview?.counts.threads),
      meta: "平台累计沉淀的会话线程"
    },
    {
      label: "管理工作区",
      value: String(SECTION_ORDER.length - 1),
      meta: "覆盖运营、治理、运行三大域"
    }
  ];

  return (
    <div className="admin-page-container">
      <section className="admin-overview-hero">
        <div className="admin-overview-hero-copy">
          <span className="admin-overview-eyebrow">Control Tower</span>
          <div>
            <h1 className="admin-page-title">平台概览</h1>
            <p className="admin-page-desc">统一查看平台规模、活跃状态与核心运营指标。</p>
          </div>
          <p>
            这个入口现在承担整套管理控制台的导航职责。用户、权限、资料、能力、集成和系统配置都在同一壳层下切换，
            时间信息默认跟随当前用户本地时区显示。
          </p>
        </div>

        <div className="admin-overview-hero-metrics">
          <div className="admin-overview-hero-stat">
            <span>管理域</span>
            <strong>{GROUPS.length}</strong>
          </div>
          <div className="admin-overview-hero-stat">
            <span>导航工作区</span>
            <strong>{SECTION_ORDER.length - 1}</strong>
          </div>
          <div className="admin-overview-hero-stat">
            <span>当前时区</span>
            <strong style={{ fontSize: 20, lineHeight: 1.25 }}>{getLocalTimeZoneLabel()}</strong>
          </div>
          <div className="admin-overview-hero-stat">
            <span>巡检节奏</span>
            <strong style={{ fontSize: 20, lineHeight: 1.25 }}>持续值守</strong>
          </div>
        </div>
      </section>

      <div className="admin-page-summary-grid">
        {stats.map((item) => (
          <section key={item.label} className="admin-page-summary-card">
            <div className="admin-page-summary-label">{item.label}</div>
            <div className="admin-page-summary-value">{item.value}</div>
            <div className="admin-page-summary-meta">{item.meta}</div>
          </section>
        ))}
      </div>

      <div className="admin-overview-group-grid">
        {NAVIGATION_GROUPS.map((group) => (
          <section key={group.id} className="admin-overview-group-card">
            <div className="admin-overview-group-header">
              <div>
                <h3>{group.label}</h3>
                <p>{group.description}</p>
              </div>
              <span className="admin-overview-group-count">{group.items.filter((item) => item.id !== "overview").length} 项</span>
            </div>

            <div className="admin-overview-link-list">
              {group.items
                .filter((item) => item.id !== "overview")
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="admin-overview-link-card"
                    onClick={() => props.onNavigate(item.id)}
                  >
                    <span className="admin-overview-link-icon">{item.icon}</span>
                    <span>
                      <span className="admin-overview-link-title">{item.title}</span>
                      <span className="admin-overview-link-description">{item.description}</span>
                      <span className="admin-overview-link-meta">
                        <span>{item.scope}</span>
                        <span>{item.cadence}</span>
                      </span>
                    </span>
                    <ArrowRight size={16} style={{ color: "var(--admin-color-subtle)", marginTop: 2 }} />
                  </button>
                ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function AdminSectionContent(props: {
  section: AdminConsoleSection;
  overview: AdminOverview | null;
  loading: boolean;
  onNavigate: (section: AdminConsoleSection) => void;
}) {
  switch (props.section) {
    case "overview":
      return <OverviewWorkspace overview={props.overview} loading={props.loading} onNavigate={props.onNavigate} />;
    case "analytics":
      return (
        <Suspense fallback={<AdminSectionLazyFallback />}>
          <OperationsAnalyticsViewLazy />
        </Suspense>
      );
    case "users":
      return (
        <Suspense fallback={<AdminSectionLazyFallback />}>
          <UsersViewLazy />
        </Suspense>
      );
    case "conversations":
      return (
        <Suspense fallback={<AdminSectionLazyFallback />}>
          <ConversationAuditViewLazy />
        </Suspense>
      );
    case "subscriptions":
      return (
        <Suspense fallback={<AdminSectionLazyFallback />}>
          <SubscriptionWorkspaceLazy />
        </Suspense>
      );
    case "access-requests":
      return (
        <Suspense fallback={<AdminSectionLazyFallback />}>
          <AccessRequestsWorkspaceLazy />
        </Suspense>
      );
    case "resources":
      return (
        <Suspense fallback={<AdminSectionLazyFallback />}>
          <ResourceCenterShellLazy />
        </Suspense>
      );
    case "capabilities":
      return (
        <Suspense fallback={<AdminSectionLazyFallback />}>
          <CapabilityCenterShellLazy />
        </Suspense>
      );
    case "skill-drafts":
      return (
        <Suspense fallback={<AdminSectionLazyFallback />}>
          <SkillDraftReviewViewLazy />
        </Suspense>
      );
    case "integrations":
      return (
        <Suspense fallback={<AdminSectionLazyFallback />}>
          <IntegrationCenterShellLazy />
        </Suspense>
      );
    case "broadcasts":
      return (
        <Suspense fallback={<AdminSectionLazyFallback />}>
          <BroadcastAdminViewLazy />
        </Suspense>
      );
    case "system-settings":
      return (
        <Suspense fallback={<AdminSectionLazyFallback />}>
          <SystemSettingsShellLazy />
        </Suspense>
      );
    case "rbac":
      return (
        <Suspense fallback={<AdminSectionLazyFallback />}>
          <RolesViewLazy />
        </Suspense>
      );
    case "organization":
      return (
        <div className="admin-page-container">
          <div className="admin-page-header">
            <div>
              <h1 className="admin-page-title">组织同步</h1>
              <p className="admin-page-desc">查看部门树与同步任务，定位组织数据偏差。</p>
            </div>
          </div>
          <div style={{ marginTop: 4 }}>
            <Row gutter={[24, 24]}>
              <Col xs={24} lg={10}>
                <Suspense fallback={<AdminSectionLazyFallback />}>
                  <DepartmentTreeViewLazy />
                </Suspense>
              </Col>
              <Col xs={24} lg={14}>
                <Suspense fallback={<AdminSectionLazyFallback />}>
                  <OrgSyncViewLazy />
                </Suspense>
              </Col>
            </Row>
          </div>
        </div>
      );
    case "monitoring":
      return (
        <Suspense fallback={<AdminSectionLazyFallback />}>
          <MonitoringShellLazy />
        </Suspense>
      );
    default:
      return null;
  }
}

export function AdminShell(props: { currentUser?: AuthUser; onOpenPortal?: () => void; onSignOut?: () => void }) {
  const { branding } = useBranding();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<AdminConsoleSection>(() => {
    if (typeof window === "undefined") return "overview";
    return sectionFromHash(window.location.hash) ?? "overview";
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [cmdSearch, setCmdSearch] = useState("");
  const isNarrowScreen = useIsNarrowScreen(1080);

  const currentSectionMeta = SECTION_META[section];
  const currentGroupMeta = GROUPS.find((item) => item.id === currentSectionMeta.group) ?? GROUPS[0];

  useEffect(() => {
    let active = true;

    async function loadOverview() {
      setLoading(true);
      try {
        const next = await fetchAdminOverview();
        if (active) {
          setOverview(next);
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadOverview();
    return () => {
      active = false;
    };
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
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCmdPaletteOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!isNarrowScreen) {
      setMobileNavOpen(false);
    }
  }, [isNarrowScreen]);

  const handleNavClick = (targetSection: AdminConsoleSection) => {
    setSection(targetSection);
    setCmdPaletteOpen(false);
    setMobileNavOpen(false);
  };

  const filteredCmdItems = useMemo(() => {
    const query = cmdSearch.trim().toLowerCase();
    if (!query) return Object.values(SECTION_META);
    return Object.values(SECTION_META).filter(
      (item) =>
        item.title.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query) ||
        item.keywords.some((keyword) => keyword.toLowerCase().includes(query))
    );
  }, [cmdSearch]);

  const brandLogoUrl = branding.logoUrl || branding.iconUrl;

  const drawerNavigation = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="admin-sidebar-header">
        <div className="admin-brand" style={{ display: "flex" }}>
          <BrandMark className="admin-brand-icon" imageClassName="admin-brand-image" name={branding.platformName} logoUrl={brandLogoUrl} />
          <span>{branding.platformName}</span>
        </div>
      </div>
      <AdminNavigation activeSection={section} collapsed={false} onNavigate={handleNavClick} />
      <div className="admin-sidebar-footer" style={{ padding: 16, borderTop: '1px solid var(--admin-color-border)', marginTop: 'auto' }}>
        {props.currentUser ? <UserIdentitySummary user={props.currentUser} compact onSignOut={props.onSignOut} /> : null}
      </div>
    </div>
  );

  return (
    <ConfigProvider theme={ADMIN_PREMIUM_THEME}>
      <div className="admin-console-root">
        {!isNarrowScreen ? (
          <aside className={`admin-sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
            <div className="admin-sidebar-header">
              <div className="admin-brand" style={{ display: sidebarCollapsed ? "none" : "flex" }}>
                <BrandMark className="admin-brand-icon" imageClassName="admin-brand-image" name={branding.platformName} logoUrl={brandLogoUrl} />
                <span>{branding.platformName}</span>
              </div>
                {sidebarCollapsed ? (
                  <BrandMark
                    className="admin-brand-icon"
                    imageClassName="admin-brand-image"
                    name={branding.platformName}
                    logoUrl={brandLogoUrl}
                    style={{ margin: "0 auto" }}
                  />
                ) : null}
            </div>
            <AdminNavigation activeSection={section} collapsed={sidebarCollapsed} onNavigate={handleNavClick} />
            <div className={`admin-sidebar-footer ${sidebarCollapsed ? 'collapsed' : ''}`} style={{ borderTop: '1px solid var(--admin-color-border)', marginTop: 'auto' }}>
              {!sidebarCollapsed && props.currentUser ? (
                <div style={{ padding: 16 }}>
                  <UserIdentitySummary user={props.currentUser} compact onSignOut={props.onSignOut} />
                </div>
              ) : null}
              {sidebarCollapsed && props.currentUser && props.onSignOut ? (
                <div style={{ padding: '16px 0', display: 'flex', justifyContent: 'center' }}>
                  <Button type="text" icon={<LogOutIcon size={18} />} onClick={() => {
                    if (window.confirm("确认退出当前登录状态？")) props.onSignOut!();
                  }} title="退出登录" />
                </div>
              ) : null}
            </div>
          </aside>
        ) : null}

        <main className="admin-main">
          <header className="admin-topbar">
            <div className="admin-topbar-left">
              <Button
                type="text"
                icon={
                  isNarrowScreen ? (
                    <Menu size={18} />
                  ) : sidebarCollapsed ? (
                    <PanelLeftOpen size={18} />
                  ) : (
                    <PanelLeftClose size={18} />
                  )
                }
                onClick={() => {
                  if (isNarrowScreen) {
                    setMobileNavOpen(true);
                  } else {
                    setSidebarCollapsed((current) => !current);
                  }
                }}
                style={{ color: "var(--admin-color-subtle)" }}
              />
              <div className="admin-topbar-current">{currentSectionMeta.title}</div>
              <Breadcrumb items={[{ title: currentGroupMeta.label }, { title: currentSectionMeta.title }]} />
            </div>

            <div className="admin-topbar-right">
              <button className="admin-cmd-trigger" onClick={() => setCmdPaletteOpen(true)}>
                <Search size={14} />
                <span className="admin-cmd-label">Search or jump to management workspace...</span>
                <span className="admin-cmd-kbd">⌘K</span>
              </button>
              {props.onOpenPortal ? (
                <Button style={{ borderRadius: "var(--admin-radius-full)" }} onClick={props.onOpenPortal}>
                  返回工作台
                </Button>
              ) : null}
            </div>
          </header>

          <div className="admin-content-scroll">
            <AdminSectionContent
              section={section}
              overview={overview}
              loading={loading}
              onNavigate={handleNavClick}
            />
          </div>
        </main>

        <Drawer
          open={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          placement="left"
          width={320}
          closable={false}
          bodyStyle={{ padding: 0 }}
        >
          {drawerNavigation}
        </Drawer>

        <Modal
          open={cmdPaletteOpen}
          onCancel={() => setCmdPaletteOpen(false)}
          footer={null}
          closable={false}
          width={600}
          bodyStyle={{ padding: 0 }}
          style={{ top: 100 }}
        >
          <div style={{ padding: 16, borderBottom: "1px solid var(--admin-color-border)" }}>
            <Input
              prefix={<Search size={18} style={{ color: "var(--admin-color-subtle)" }} />}
              placeholder="Search features, settings..."
              variant="borderless"
              size="large"
              autoFocus
              value={cmdSearch}
              onChange={(event) => setCmdSearch(event.target.value)}
              style={{ fontSize: 18 }}
            />
          </div>
          <List
            dataSource={filteredCmdItems}
            style={{ maxHeight: 400, overflow: "auto" }}
            renderItem={(item) => (
              <List.Item
                className="admin-menu-item"
                style={{ margin: "8px 16px", border: "none" }}
                onClick={() => handleNavClick(item.id)}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
                  <div style={{ padding: 8, background: "var(--admin-color-bg)", borderRadius: 8 }}>{item.icon}</div>
                  <div>
                    <div style={{ fontWeight: 500, color: "var(--admin-color-text)" }}>{item.title}</div>
                    <div style={{ fontSize: 12, color: "var(--admin-color-subtle)" }}>{item.description}</div>
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
