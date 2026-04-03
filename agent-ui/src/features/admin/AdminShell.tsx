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
  ArrowRight
} from "lucide-react";
import { Alert, Breadcrumb, Button, Card, Drawer, Input, Space, Spin, Statistic, Tag, Typography, ConfigProvider } from "antd";
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
  {
    id: "operations",
    label: "运营总览",
    description: "平台状态、监控告警与广播运营。"
  },
  {
    id: "governance",
    label: "组织治理",
    description: "用户、组织结构和权限审计。"
  },
  {
    id: "runtime",
    label: "运行能力",
    description: "资源、能力、集成和系统默认策略。"
  }
];

const SECTION_ORDER: AdminConsoleSection[] = [
  "overview",
  "conversations",
  "monitoring",
  "broadcasts",
  "users",
  "organization",
  "rbac",
  "resources",
  "capabilities",
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
    keywords: ["概览", "运营", "数据看板", "dashboard"],
    icon: <LayoutDashboard size={18} />
  },
  conversations: {
    id: "conversations",
    title: "审计工作台",
    description: "统一查看用户会话、反馈记录与 API 调用轨迹。",
    scope: "会话、反馈与 API 调用",
    cadence: "建议持续巡检",
    group: "operations",
    keywords: ["会话", "对话", "thread", "feedback", "审计", "api", "ip"],
    icon: <MessageSquareText size={18} />
  },
  monitoring: {
    id: "monitoring",
    title: "审计监控",
    description: "追踪请求、成本、配额、告警和资源访问轨迹。",
    scope: "运行审计",
    cadence: "建议持续观察",
    group: "operations",
    keywords: ["审计", "监控", "告警", "成本", "配额"],
    icon: <Activity size={18} />
  },
  broadcasts: {
    id: "broadcasts",
    title: "广播管理",
    description: "维护系统广播模板与触达策略，支持运营发布节奏。",
    scope: "运营触达",
    cadence: "按活动排期维护",
    group: "operations",
    keywords: ["广播", "公告", "触达", "通知"],
    icon: <Bell size={18} />
  },
  users: {
    id: "users",
    title: "用户治理",
    description: "管理用户状态、身份资料与本地治理字段。",
    scope: "身份与成员",
    cadence: "建议每日巡检",
    group: "governance",
    keywords: ["用户", "成员", "账号", "身份"],
    icon: <Users size={18} />
  },
  organization: {
    id: "organization",
    title: "组织同步",
    description: "查看部门树与同步任务，定位组织数据偏差。",
    scope: "组织架构",
    cadence: "按同步任务节奏",
    group: "governance",
    keywords: ["组织", "部门", "同步", "结构"],
    icon: <Network size={18} />
  },
  rbac: {
    id: "rbac",
    title: "角色权限",
    description: "维护角色模板和权限矩阵，保障授权可追溯。",
    scope: "权限体系",
    cadence: "建议双周审计",
    group: "governance",
    keywords: ["角色", "权限", "RBAC", "授权"],
    icon: <ShieldCheck size={18} />
  },
  resources: {
    id: "resources",
    title: "资源配置中心",
    description: "集中维护资料集、文件来源与资源授权策略。",
    scope: "资源与授权",
    cadence: "按项目变更维护",
    group: "runtime",
    keywords: ["资源", "资料集", "文件", "knowledge set"],
    icon: <Database size={18} />
  },
  capabilities: {
    id: "capabilities",
    title: "能力配置中心",
    description: "统一管理 Agent 模式、技能包和运行策略。",
    scope: "运行能力",
    cadence: "按发布节奏更新",
    group: "runtime",
    keywords: ["能力", "mode", "skill", "run profile"],
    icon: <Wrench size={18} />
  },
  integrations: {
    id: "integrations",
    title: "集成中心",
    description: "配置第三方平台连接并追踪实例健康状态。",
    scope: "外部平台连接",
    cadence: "建议每周复核",
    group: "runtime",
    keywords: ["集成", "dingtalk", "zendesk", "openai"],
    icon: <Component size={18} />
  },
  "system-settings": {
    id: "system-settings",
    title: "系统设置",
    description: "维护平台默认参数、策略开关和版本发布记录。",
    scope: "平台默认参数",
    cadence: "变更前评审后发布",
    group: "runtime",
    keywords: ["系统", "配置", "默认值", "发布"],
    icon: <Settings size={18} />
  }
};

function sectionFromHash(hash: string): AdminConsoleSection | null {
  if (!hash.startsWith(ADMIN_HASH_PREFIX)) return null;
  const value = decodeURIComponent(hash.slice(ADMIN_HASH_PREFIX.length)).trim();
  if (!SECTION_ORDER.includes(value as AdminConsoleSection)) return null;
  return value as AdminConsoleSection;
}

function formatLocalTimestamp(value: Date | null): string {
  if (!value) return "未刷新";
  return value.toLocaleString();
}

function nextSectionInOrder(current: AdminConsoleSection, offset: number): AdminConsoleSection {
  const index = SECTION_ORDER.indexOf(current);
  if (index < 0) return "overview";
  const length = SECTION_ORDER.length;
  const nextIndex = (index + offset + length) % length;
  return SECTION_ORDER[nextIndex] ?? "overview";
}

function AdminNavigationPanel(props: {
  section: AdminConsoleSection;
  search: string;
  onSearchChange(value: string): void;
  onSectionChange(section: AdminConsoleSection): void;
  groups: AdminNavigationGroupView[];
  currentUser?: AuthUser;
  onOpenPortal?: () => void;
  onSignOut?: () => void;
}) {
  return (
    <div className="admin-console-nav-surface">
      <div className="admin-console-nav-search">
        <Input
          id="admin-nav-search"
          value={props.search}
          onChange={(event) => props.onSearchChange(event.target.value)}
          allowClear
          placeholder="搜索功能（Cmd/Ctrl + K）"
          prefix={<Search size={16} />}
          aria-label="搜索管理功能"
        />
      </div>

      <div className="admin-console-nav-scroll">
        {props.groups.map((group) => (
          <section key={group.id} className="admin-console-nav-group">
            <div className="admin-console-nav-group-head">
              <h4>{group.label}</h4>
            </div>
            <div className="admin-console-nav-items">
              {group.items.map((item) => {
                const active = props.section === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    title={item.description}
                    className={active ? "admin-console-nav-item active" : "admin-console-nav-item"}
                    onClick={() => props.onSectionChange(item.id)}
                  >
                    <span className="admin-console-nav-item-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    <span className="admin-console-nav-item-copy">
                      <strong>{item.title}</strong>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        {props.groups.length === 0 ? <div className="admin-console-nav-empty">未匹配到管理功能，请调整搜索词。</div> : null}
      </div>

      <div className="admin-console-nav-foot">
        {props.currentUser ? <UserIdentitySummary user={props.currentUser} compact onSignOut={props.onSignOut} /> : null}
        {props.onOpenPortal ? (
          <Button block className="admin-console-portal-btn" onClick={props.onOpenPortal}>
            进入工作台
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function OverviewWorkspace(props: {
  overview: AdminOverview | null;
  loading: boolean;
  errorText: string;
  refreshedAt: Date | null;
  onRefresh(): void;
  onSectionChange(section: AdminConsoleSection): void;
}) {
  return (
    <div className="admin-console-overview-grid">
      <Card className="admin-card antd-admin-card">
        <div className="admin-console-overview-head">
          <div>
            <Typography.Title level={4} className="admin-card-heading">
              运行概览
            </Typography.Title>
            <Typography.Paragraph>平台级核心指标，统一按当前登录者本地时区展示。</Typography.Paragraph>
          </div>
          <Space wrap>
            <Tag color="blue">更新时间：{formatLocalTimestamp(props.refreshedAt)}</Tag>
            <Button icon={<RefreshCcw size={14} />} onClick={props.onRefresh} loading={props.loading}>
              刷新
            </Button>
          </Space>
        </div>
        {props.errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={props.errorText} /> : null}
        <div className="admin-console-overview-metrics">
          <Card size="small" className="admin-console-overview-metric-card">
            <Statistic title="用户" value={props.loading ? "-" : props.overview?.counts.users ?? "-"} />
          </Card>
          <Card size="small" className="admin-console-overview-metric-card">
            <Statistic title="线程" value={props.loading ? "-" : props.overview?.counts.threads ?? "-"} />
          </Card>
          <Card size="small" className="admin-console-overview-metric-card">
            <Statistic title="活跃会话" value={props.loading ? "-" : props.overview?.counts.activeSessions ?? "-"} />
          </Card>
        </div>
        {props.overview?.integrations?.zendesk ? (
          <div className="admin-console-overview-state">
            <Tag color={props.overview.integrations.zendesk.ready ? "success" : "warning"}>
              Zendesk {props.overview.integrations.zendesk.ready ? "已就绪" : "待补配置"}
            </Tag>
          </div>
        ) : null}
      </Card>

      <Card className="admin-card antd-admin-card">
        <Typography.Title level={4} className="admin-card-heading">
          功能地图
        </Typography.Title>
        <Typography.Paragraph>按功能域进入对应工作区，管理动线与交互遵循统一控制台结构。</Typography.Paragraph>
        <div className="admin-console-overview-map">
          {SECTION_ORDER.filter((item) => item !== "overview").map((item) => {
            const meta = SECTION_META[item];
            return (
              <button
                key={item}
                type="button"
                className="admin-console-overview-map-item"
                onClick={() => props.onSectionChange(item)}
              >
                <span className="admin-console-overview-map-icon" aria-hidden="true">
                  {meta.icon}
                </span>
                <span className="admin-console-overview-map-copy">
                  <strong>{meta.title}</strong>
                  <small>{meta.scope}</small>
                </span>
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function AdminSectionLazyFallback() {
  return (
    <div className="admin-workspace-loading">
      <Spin size="small" />
    </div>
  );
}

function AdminSectionContent(props: {
  section: AdminConsoleSection;
  overview: AdminOverview | null;
  loading: boolean;
  errorText: string;
  refreshedAt: Date | null;
  onRefresh(): void;
  onSectionChange(section: AdminConsoleSection): void;
}) {
  if (props.section === "overview") {
    return (
      <OverviewWorkspace
        overview={props.overview}
        loading={props.loading}
        errorText={props.errorText}
        refreshedAt={props.refreshedAt}
        onRefresh={props.onRefresh}
        onSectionChange={props.onSectionChange}
      />
    );
  }
  if (props.section === "users") {
    return (
      <Suspense fallback={<AdminSectionLazyFallback />}>
        <UsersViewLazy />
      </Suspense>
    );
  }
  if (props.section === "conversations") {
    return (
      <Suspense fallback={<AdminSectionLazyFallback />}>
        <ConversationAuditViewLazy />
      </Suspense>
    );
  }
  if (props.section === "resources") {
    return (
      <Suspense fallback={<AdminSectionLazyFallback />}>
        <ResourceCenterShellLazy />
      </Suspense>
    );
  }
  if (props.section === "capabilities") {
    return (
      <Suspense fallback={<AdminSectionLazyFallback />}>
        <CapabilityCenterShellLazy />
      </Suspense>
    );
  }
  if (props.section === "integrations") {
    return (
      <Suspense fallback={<AdminSectionLazyFallback />}>
        <IntegrationCenterShellLazy />
      </Suspense>
    );
  }
  if (props.section === "broadcasts") {
    return (
      <Suspense fallback={<AdminSectionLazyFallback />}>
        <BroadcastAdminViewLazy />
      </Suspense>
    );
  }
  if (props.section === "system-settings") {
    return (
      <Suspense fallback={<AdminSectionLazyFallback />}>
        <SystemSettingsShellLazy />
      </Suspense>
    );
  }
  if (props.section === "rbac") {
    return (
      <Suspense fallback={<AdminSectionLazyFallback />}>
        <RolesViewLazy />
      </Suspense>
    );
  }
  if (props.section === "organization") {
    return (
      <div className="admin-console-organization-grid">
        <Suspense fallback={<AdminSectionLazyFallback />}>
          <DepartmentTreeViewLazy />
        </Suspense>
        <Suspense fallback={<AdminSectionLazyFallback />}>
          <OrgSyncViewLazy />
        </Suspense>
      </div>
    );
  }
  return (
    <Suspense fallback={<AdminSectionLazyFallback />}>
      <MonitoringShellLazy />
    </Suspense>
  );
}

export function AdminShell(props: { currentUser?: AuthUser; onOpenPortal?: () => void; onSignOut?: () => void }) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [overviewRefreshedAt, setOverviewRefreshedAt] = useState<Date | null>(null);
  const [section, setSection] = useState<AdminConsoleSection>(() => {
    if (typeof window === "undefined") return "overview";
    return sectionFromHash(window.location.hash) ?? "overview";
  });
  const [navSearch, setNavSearch] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [compactLayout, setCompactLayout] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 1200px)").matches;
  });
  const mountedRef = useRef(true);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const timezoneLabel = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "本地时区", []);

  const currentSectionMeta = SECTION_META[section];
  const currentGroupMeta = GROUPS.find((item) => item.id === currentSectionMeta.group) ?? GROUPS[0];

  const filteredGroups = useMemo<AdminNavigationGroupView[]>(() => {
    const query = navSearch.trim().toLowerCase();
    return GROUPS.map((group) => {
      const items = SECTION_ORDER.map((sectionId) => SECTION_META[sectionId]).filter((item) => {
        if (item.group !== group.id) return false;
        if (!query) return true;
        const haystack = [item.title, item.description, item.scope, item.cadence, ...item.keywords].join(" ").toLowerCase();
        return haystack.includes(query);
      });
      return {
        ...group,
        items
      };
    }).filter((group) => group.items.length > 0);
  }, [navSearch]);

  const quickSwitches = useMemo(() => filteredGroups.flatMap((group) => group.items).slice(0, 6), [filteredGroups]);

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
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 1200px)");
    const onChange = (event: MediaQueryListEvent) => {
      setCompactLayout(event.matches);
    };
    setCompactLayout(media.matches);
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    }
    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHashChange = () => {
      const fromHash = sectionFromHash(window.location.hash);
      if (fromHash) setSection(fromHash);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextHash = `${ADMIN_HASH_PREFIX}${encodeURIComponent(section)}`;
    if (window.location.hash === nextHash) return;
    window.history.replaceState(
      window.history.state,
      document.title,
      `${window.location.pathname}${window.location.search}${nextHash}`
    );
  }, [section]);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
    if (compactLayout) {
      setMobileNavOpen(false);
    }
  }, [section, compactLayout]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKeydown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "k") {
        event.preventDefault();
        const input = document.querySelector<HTMLInputElement>("#admin-nav-search");
        input?.focus();
        input?.select();
        return;
      }
      if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
      if (key === "arrowleft") {
        event.preventDefault();
        setSection((current) => nextSectionInOrder(current, -1));
      } else if (key === "arrowright") {
        event.preventDefault();
        setSection((current) => nextSectionInOrder(current, 1));
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, []);

  return (
    <ConfigProvider theme={ADMIN_PREMIUM_THEME}>
      <div className="admin-console-root">
        <header className="admin-console-topbar">
          <div className="admin-console-topbar-left">
            {compactLayout ? (
              <Button
                type="text"
                icon={<Menu size={16} />}
                aria-label="打开导航"
                className="admin-console-menu-btn"
                onClick={() => setMobileNavOpen(true)}
              />
            ) : null}
            <div className="admin-console-brand">
              <span className="admin-console-brand-mark" aria-hidden="true">
                AS
              </span>
              <strong className="admin-console-brand-title">Agent Studio Console</strong>
            </div>
            <Breadcrumb
              className="admin-console-breadcrumb"
              items={[{ title: currentGroupMeta.label }, { title: currentSectionMeta.title }]}
            />
          </div>

          <div className="admin-console-topbar-actions">
            <Tag color="geekblue">时区：{timezoneLabel}</Tag>
            <Button icon={<RefreshCcw size={14} />} onClick={() => void loadOverview()} loading={loading}>
              刷新概览
            </Button>
            {props.onOpenPortal ? (
              <Button type="default" onClick={props.onOpenPortal}>
                工作台
              </Button>
            ) : null}
          </div>
        </header>

        <div className="admin-console-frame">
          {!compactLayout ? (
            <aside className="admin-console-nav">
              <AdminNavigationPanel
                section={section}
                search={navSearch}
                onSearchChange={setNavSearch}
                onSectionChange={setSection}
                groups={filteredGroups}
                currentUser={props.currentUser}
                onOpenPortal={props.onOpenPortal}
                onSignOut={props.onSignOut}
              />
            </aside>
          ) : null}

          <div className="admin-console-main" ref={contentRef}>
            <div className="admin-console-header">
              <div>
                <h2 className="admin-console-header-title">{currentSectionMeta.title}</h2>
                <p className="admin-console-header-desc">{currentSectionMeta.description}</p>
              </div>
            </div>
            <div className="admin-console-content">
              <AdminSectionContent
                section={section}
                overview={overview}
                loading={loading}
                errorText={errorText}
                refreshedAt={overviewRefreshedAt}
                onRefresh={() => void loadOverview()}
                onSectionChange={setSection}
              />
            </div>
          </div>
        </div>
        {compactLayout ? (
          <Drawer
            open={mobileNavOpen}
            onClose={() => setMobileNavOpen(false)}
            title="管理导航"
            placement="left"
            width={360}
            className="admin-console-nav-drawer"
          >
            <AdminNavigationPanel
              section={section}
              search={navSearch}
              onSearchChange={setNavSearch}
              onSectionChange={setSection}
              groups={filteredGroups}
              currentUser={props.currentUser}
              onOpenPortal={props.onOpenPortal}
              onSignOut={props.onSignOut}
            />
          </Drawer>
        ) : null}
      </div>
    </ConfigProvider>
  );
}

export default AdminShell;
