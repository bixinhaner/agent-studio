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
import { Alert, Breadcrumb, Button, ConfigProvider, Drawer, Input, Space, Spin } from "antd";
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

type AdminSectionStory = {
  eyebrow: string;
  headline: string;
  detail: string;
};

type AdminSignalTone = "primary" | "success" | "warning" | "neutral";

type AdminSignal = {
  label: string;
  value: string;
  detail: string;
  tone: AdminSignalTone;
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

const GROUP_ENTRY_SECTION: Record<AdminConsoleGroup, AdminConsoleSection> = {
  operations: "conversations",
  governance: "users",
  runtime: "resources"
};

const SECTION_STORY: Record<AdminConsoleSection, AdminSectionStory> = {
  overview: {
    eyebrow: "Platform Pulse",
    headline: "把平台状态读成一张精确、克制、可操作的控制面板。",
    detail: "先看到信号，再做判断。把用户规模、线程沉淀、会话活跃度和外部连接状态压缩到同一视角里。"
  },
  conversations: {
    eyebrow: "Audit Studio",
    headline: "把对话审计从纯日志表格，升级成可追踪的内容工作台。",
    detail: "围绕线程、反馈、转录和 API 轨迹组织信息，让定位问题与复盘体验像浏览时间线而不是翻数据库。"
  },
  monitoring: {
    eyebrow: "Operations Watch",
    headline: "把请求、成本、配额和告警汇成同一条运行叙事。",
    detail: "这里不是堆图表，而是把平台健康度、风险边界和动作入口收敛到一层清晰的监控语言。"
  },
  broadcasts: {
    eyebrow: "Announcement Engine",
    headline: "把系统广播做成可编排、可审阅、可追踪的运营面板。",
    detail: "统一处理内容、渠道与触达节奏，让广播像产品能力而不是零散表单。"
  },
  users: {
    eyebrow: "Identity Governance",
    headline: "把用户管理做成一张可信的身份地图，而不是一串平铺字段。",
    detail: "成员状态、身份属性和治理动作应该先被看懂，再被编辑。"
  },
  organization: {
    eyebrow: "Org Fabric",
    headline: "把组织结构与同步任务摆进同一画布，直接看见偏差发生在哪里。",
    detail: "左手是结构，右手是动作。组织同步页应该帮助你定位差异，而不是要求你记住上下文。"
  },
  rbac: {
    eyebrow: "Access Architecture",
    headline: "让角色与权限像架构图一样可读，而不是像配置表一样难接近。",
    detail: "授权体系需要清晰、可靠、低摩擦，既能做治理，也能让人快速理解影响范围。"
  },
  resources: {
    eyebrow: "Knowledge Operating System",
    headline: "把资料集管理做成一套可巡视、可维护、可委派的资源操作系统。",
    detail: "资料、来源、权限和状态必须在同一个界面语境里被理解，而不是拆散在若干普通卡片中。"
  },
  capabilities: {
    eyebrow: "Capability Craft",
    headline: "把 Mode、Skill 和 Run Profile 重新编排成一套像产品装配台的体验。",
    detail: "这里要体现系统能力的组合关系，而不是仅仅列出资源名字。"
  },
  integrations: {
    eyebrow: "Connection Fabric",
    headline: "让第三方平台接入看起来像经营一个连接层，而不是维护若干配置表。",
    detail: "实例状态、授权绑定、校验历史和调用语义应该形成清晰的纵深。"
  },
  "system-settings": {
    eyebrow: "Control Surface",
    headline: "把系统设置做成高信任控制面，而不是危险的后台表单集合。",
    detail: "草稿、发布和预览要有明确层次，让每次变更都像一次受控发布。"
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

function formatMetricValue(value: number | undefined): string {
  if (!Number.isFinite(value ?? NaN)) return "--";
  return new Intl.NumberFormat("zh-CN").format(value ?? 0);
}

function nextSectionInOrder(current: AdminConsoleSection, offset: number): AdminConsoleSection {
  const index = SECTION_ORDER.indexOf(current);
  if (index < 0) return "overview";
  const length = SECTION_ORDER.length;
  const nextIndex = (index + offset + length) % length;
  return SECTION_ORDER[nextIndex] ?? "overview";
}

function SectionShortcutCard(props: {
  item: AdminSectionMeta;
  compact?: boolean;
  onSelect(section: AdminConsoleSection): void;
}) {
  return (
    <button
      type="button"
      className={props.compact ? "admin-console-switch-card compact" : "admin-console-switch-card"}
      onClick={() => props.onSelect(props.item.id)}
    >
      <span className="admin-console-switch-card-icon" aria-hidden="true">
        {props.item.icon}
      </span>
      <span className="admin-console-switch-card-copy">
        <strong>{props.item.title}</strong>
        <small>{props.item.description}</small>
      </span>
      <span className="admin-console-switch-card-arrow" aria-hidden="true">
        <ArrowRight size={16} />
      </span>
    </button>
  );
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
  const platformMetrics = [
    {
      label: "用户规模",
      value: props.loading ? "..." : formatMetricValue(props.overview?.counts.users),
      detail: "已纳入统一身份治理"
    },
    {
      label: "线程沉淀",
      value: props.loading ? "..." : formatMetricValue(props.overview?.counts.threads),
      detail: "持续累积的会话资产"
    },
    {
      label: "活跃会话",
      value: props.loading ? "..." : formatMetricValue(props.overview?.counts.activeSessions),
      detail: "当前仍在流转的实时交互"
    }
  ];
  const zendeskStatus = props.overview?.integrations?.zendesk;

  return (
    <div className="admin-console-overview-grid">
      <article className="admin-overview-panel admin-overview-panel-primary">
        <div className="admin-overview-panel-head">
          <div>
            <span className="admin-console-section-kicker">Executive Snapshot</span>
            <h2 className="admin-overview-panel-title">平台关键状态应该先给判断，再给动作。</h2>
            <p className="admin-overview-panel-copy">把规模、活跃度和外部连接准备度浓缩成一眼可读的控制面，所有时间均跟随当前登录者本地时区。</p>
          </div>
          <div className="admin-overview-head-actions">
            <span className="admin-console-pill neutral">刷新于 {formatLocalTimestamp(props.refreshedAt)}</span>
            <Button icon={<RefreshCcw size={14} />} onClick={props.onRefresh} loading={props.loading}>
              刷新
            </Button>
          </div>
        </div>
        {props.errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={props.errorText} /> : null}
        <div className="admin-overview-mosaic">
          {platformMetrics.map((metric) => (
            <article key={metric.label} className="admin-overview-metric-tile">
              <span className="admin-overview-metric-label">{metric.label}</span>
              <strong className="admin-overview-metric-value">{metric.value}</strong>
              <small className="admin-overview-metric-detail">{metric.detail}</small>
            </article>
          ))}
          <article className="admin-overview-status-tile">
            <span className="admin-overview-metric-label">外部连接</span>
            <strong className="admin-overview-status-value">
              {zendeskStatus ? (zendeskStatus.ready ? "Ready" : "Review") : "Pending"}
            </strong>
            <small className="admin-overview-metric-detail">
              {zendeskStatus
                ? zendeskStatus.ready
                  ? "Zendesk 凭据与校验状态正常。"
                  : `Zendesk 仍缺少 ${zendeskStatus.missing.length || 1} 项关键配置。`
                : "尚未建立外部支持系统状态快照。 "}
            </small>
            <div className="admin-overview-status-tags">
              <span className={zendeskStatus?.ready ? "admin-console-pill success" : "admin-console-pill warning"}>
                Zendesk {zendeskStatus?.ready ? "已就绪" : "待校验"}
              </span>
            </div>
          </article>
        </div>
      </article>

      <article className="admin-overview-panel admin-overview-panel-map">
        <div className="admin-overview-panel-head compact">
          <div>
            <span className="admin-console-section-kicker">Action Atlas</span>
            <h2 className="admin-overview-panel-title">把常用管理动作改造成可直接切换的工作区地图。</h2>
          </div>
        </div>
        <div className="admin-overview-action-grid">
          {SECTION_ORDER.filter((item) => item !== "overview").map((item) => {
            const meta = SECTION_META[item];
            return <SectionShortcutCard key={item} item={meta} onSelect={props.onSectionChange} />;
          })}
        </div>
      </article>

      <article className="admin-overview-panel admin-overview-panel-groups">
        <div className="admin-overview-panel-head compact">
          <div>
            <span className="admin-console-section-kicker">Operating Lanes</span>
            <h2 className="admin-overview-panel-title">用三条主线组织控制台，而不是把页面平铺成目录。</h2>
          </div>
        </div>
        <div className="admin-overview-group-grid">
          {GROUPS.map((group) => {
            const entrySection = GROUP_ENTRY_SECTION[group.id];
            const sectionCount = SECTION_ORDER.filter((sectionId) => SECTION_META[sectionId].group === group.id).length;
            return (
              <button
                key={group.id}
                type="button"
                className="admin-overview-group-card"
                onClick={() => props.onSectionChange(entrySection)}
              >
                <div>
                  <span className="admin-overview-group-label">{group.label}</span>
                  <strong className="admin-overview-group-title">{SECTION_META[entrySection].title}</strong>
                  <p className="admin-overview-group-copy">{group.description}</p>
                </div>
                <div className="admin-overview-group-foot">
                  <span className="admin-console-pill neutral">{sectionCount} 个模块</span>
                  <ArrowRight size={16} />
                </div>
              </button>
            );
          })}
        </div>
      </article>
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
  const currentSectionStory = SECTION_STORY[section];

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

  const quickSwitches = useMemo(
    () => filteredGroups.flatMap((group) => group.items).filter((item) => item.id !== section).slice(0, 5),
    [filteredGroups, section]
  );
  const platformSignals = useMemo<AdminSignal[]>(() => {
    const zendeskStatus = overview?.integrations?.zendesk;
    return [
      {
        label: "平台用户",
        value: loading ? "..." : formatMetricValue(overview?.counts.users),
        detail: "统一身份体系下的成员规模",
        tone: "primary"
      },
      {
        label: "线程资产",
        value: loading ? "..." : formatMetricValue(overview?.counts.threads),
        detail: "沉淀中的工作与知识上下文",
        tone: "neutral"
      },
      {
        label: "活跃会话",
        value: loading ? "..." : formatMetricValue(overview?.counts.activeSessions),
        detail: "当前仍在运行或交互中的会话",
        tone: "neutral"
      },
      {
        label: "外部连接",
        value: zendeskStatus ? (zendeskStatus.ready ? "Ready" : "Review") : "Pending",
        detail: zendeskStatus
          ? zendeskStatus.ready
            ? "Zendesk 已进入可用状态"
            : "Zendesk 仍需要补齐配置"
          : "尚未建立连接健康快照",
        tone: zendeskStatus?.ready ? "success" : zendeskStatus ? "warning" : "neutral"
      }
    ];
  }, [loading, overview]);
  const stageKeywords = useMemo(() => currentSectionMeta.keywords.slice(0, 4), [currentSectionMeta]);

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
      <div className="admin-console-root" data-group={currentGroupMeta.id} data-section={section}>
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
            <span className="admin-console-pill neutral">时区 · {timezoneLabel}</span>
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
            <section className="admin-console-stage-hero">
              <div className="admin-console-stage-hero-copy">
                <span className="admin-console-section-kicker">{currentSectionStory.eyebrow}</span>
                <h1 className="admin-console-stage-title">{currentSectionStory.headline}</h1>
                <p className="admin-console-stage-summary">{currentSectionStory.detail}</p>
                <div className="admin-console-pill-row">
                  <span className="admin-console-pill">{currentSectionMeta.scope}</span>
                  <span className="admin-console-pill">{currentSectionMeta.cadence}</span>
                  <span className="admin-console-pill">模块 · {currentSectionMeta.title}</span>
                  <span className="admin-console-pill neutral">更新 · {formatLocalTimestamp(overviewRefreshedAt)}</span>
                </div>
              </div>
              <aside className="admin-console-command-deck">
                <div className="admin-console-command-head">
                  <div>
                    <span className="admin-console-command-kicker">Mission Control</span>
                    <h2 className="admin-console-command-title">所有子页都应该从信号开始，而不是从冰冷表单开始。</h2>
                  </div>
                  <Button icon={<RefreshCcw size={14} />} onClick={() => void loadOverview()} loading={loading}>
                    同步状态
                  </Button>
                </div>
                <div className="admin-console-signal-grid">
                  {platformSignals.map((signal) => (
                    <article key={signal.label} className="admin-console-signal-card" data-tone={signal.tone}>
                      <span className="admin-console-signal-label">{signal.label}</span>
                      <strong className="admin-console-signal-value">{signal.value}</strong>
                      <small className="admin-console-signal-detail">{signal.detail}</small>
                    </article>
                  ))}
                </div>
                {errorText ? (
                  <div className="admin-console-inline-notice" role="alert">
                    {errorText}
                  </div>
                ) : null}
              </aside>
            </section>

            {quickSwitches.length ? (
              <section className="admin-console-switchboard" aria-label="快捷跳转">
                <div className="admin-console-switchboard-head">
                  <div>
                    <span className="admin-console-section-kicker">Quick Switch</span>
                    <h2 className="admin-console-switchboard-title">保持方向感，不要在管理台里迷路。</h2>
                  </div>
                  <p className="admin-console-switchboard-copy">根据当前分组与搜索词，推荐几个最可能连续访问的模块。</p>
                </div>
                <div className="admin-console-switchboard-grid">
                  {quickSwitches.map((item) => (
                    <SectionShortcutCard key={item.id} item={item} compact onSelect={setSection} />
                  ))}
                </div>
              </section>
            ) : null}

            <div className="admin-console-content">
              <section className="admin-console-stage">
                <div className="admin-console-stage-head">
                  <div>
                    <span className="admin-console-stage-caption">{currentGroupMeta.label}</span>
                    <h2 className="admin-console-stage-heading">{currentSectionMeta.title}</h2>
                    <p className="admin-console-stage-detail">{currentSectionMeta.description}</p>
                  </div>
                  <div className="admin-console-stage-tag-row">
                    {stageKeywords.map((keyword) => (
                      <span key={keyword} className="admin-console-pill subtle">
                        {keyword}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="admin-console-stage-content">
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
              </section>
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
