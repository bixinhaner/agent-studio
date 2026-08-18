import {
  BarChart3,
  Bell,
  BrainCircuit,
  ClipboardList,
  Component,
  CreditCard,
  Crown,
  Database,
  FileUser,
  LogOutIcon,
  LockKeyhole,
  Menu,
  MessageSquareText,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Palette,
  Search,
  Settings,
  ShieldCheck,
  Users,
  Wrench
} from "lucide-react";
import { Breadcrumb, Button, Col, ConfigProvider, Drawer, Input, List, Modal, Row, Spin } from "antd";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { useIsNarrowScreen } from "../../lib/use-is-narrow-screen";
import type { AuthUser } from "../auth/api";
import { UserIdentitySummary } from "../auth/UserIdentitySummary";
import { BrandMark } from "../branding/BrandMark";
import { useBranding } from "../branding/BrandingProvider";
import { ADMIN_PREMIUM_THEME } from "./admin-theme";
import { lockAdminSecurityDomains } from "./api";
import type { AdminSection } from "./types";
import "./admin-console.css";

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
const BillingWorkspaceLazy = lazy(() =>
  import("./BillingWorkspace").then((module) => ({ default: module.BillingWorkspace }))
);
const AccessRequestsWorkspaceLazy = lazy(() =>
  import("../access-requests/AccessRequestsWorkspace").then((module) => ({ default: module.AccessRequestsWorkspace }))
);
const UsersViewLazy = lazy(() => import("./UsersView").then((module) => ({ default: module.UsersView })));
const SecurityDomainsViewLazy = lazy(() =>
  import("./SecurityDomainsView").then((module) => ({ default: module.SecurityDomainsView }))
);
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
const CodexMemoryManagementViewLazy = lazy(() =>
  import("../codex-memory/CodexMemoryManagementView").then((module) => ({ default: module.CodexMemoryManagementView }))
);
const SkillCatalogManagementViewLazy = lazy(() =>
  import("../skills/SkillCatalogManagementView").then((module) => ({ default: module.SkillCatalogManagementView }))
);
const IntegrationCenterShellLazy = lazy(() =>
  import("../integration-center/IntegrationCenterShell").then((module) => ({ default: module.IntegrationCenterShell }))
);
const SystemSettingsShellLazy = lazy(() =>
  import("../system-settings/SystemSettingsShell").then((module) => ({ default: module.SystemSettingsShell }))
);
const BrandManagementViewLazy = lazy(() =>
  import("../public-brands/BrandManagementView").then((module) => ({ default: module.BrandManagementView }))
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
  { id: "operations", label: "运营总览", description: "平台状态、运营分析与广播运营。" },
  { id: "governance", label: "组织治理", description: "用户、组织结构和权限审计。" },
  { id: "runtime", label: "运行能力", description: "资源、能力、集成、用量治理和系统默认策略。" }
];

const SECTION_ORDER: AdminConsoleSection[] = [
  "analytics",
  "conversations",
  "subscriptions",
  "billing",
  "access-requests",
  "broadcasts",
  "users",
  "security-domains",
  "organization",
  "rbac",
  "resources",
  "capabilities",
  "codex-memory",
  "skill-drafts",
  "integrations",
  "brands",
  "system-settings"
];

const SECTION_META: Record<AdminConsoleSection, AdminSectionMeta> = {
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
  billing: {
    id: "billing",
    title: "计费与续费",
    description: "管理外部客户付款、自动续费、优惠码、赠送时长和邮件提醒。",
    scope: "订单与续费",
    cadence: "建议每日巡检",
    group: "operations",
    keywords: ["billing", "stripe", "支付", "续费", "优惠码", "邮件"],
    icon: <CreditCard size={18} />
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
  broadcasts: {
    id: "broadcasts",
    title: "运营触达",
    description: "配置邮件、站内信和钉钉触达，控制受众、测试和发送追踪。",
    scope: "运营触达",
    cadence: "按活动排期维护",
    group: "operations",
    keywords: ["广播", "公告", "触达", "邮件", "营销"],
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
  "security-domains": {
    id: "security-domains",
    title: "保密域",
    description: "按部门或用户隔离 Portal 会话、文件与工作区。",
    scope: "Portal 数据边界",
    cadence: "按组织变更维护",
    group: "governance",
    keywords: ["保密", "隔离", "security", "portal"],
    icon: <LockKeyhole size={18} />
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
  "codex-memory": {
    id: "codex-memory",
    title: "上下文与记忆",
    description: "统一管理企业上下文注入、Codex memory 开关和记忆文件。",
    scope: "运行上下文",
    cadence: "按运行策略维护",
    group: "runtime",
    keywords: ["memory", "memories", "记忆", "codex", "上下文", "企业上下文"],
    icon: <BrainCircuit size={18} />
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
  brands: {
    id: "brands",
    title: "品牌入口",
    description: "配置外部品牌域名、界面、能力、套餐和客户归属。",
    scope: "多品牌入口与客户分流",
    cadence: "按品牌上线与变更维护",
    group: "runtime",
    keywords: ["品牌", "域名", "入口", "Ranley", "branding"],
    icon: <Palette size={18} />
  },
  "system-settings": {
    id: "system-settings",
    title: "系统配置",
    description: "维护平台默认参数、用量治理策略和版本发布记录。",
    scope: "平台默认参数与治理策略",
    cadence: "变更前评审后发布",
    group: "runtime",
    keywords: ["系统", "配置", "定价", "配额", "告警", "用量"],
    icon: <Settings size={18} />
  }
};

const NAVIGATION_GROUPS: AdminNavigationGroupView[] = GROUPS.map((group) => ({
  ...group,
  items: SECTION_ORDER.map((sectionId) => SECTION_META[sectionId]).filter((item) => item.group === group.id)
}));

const SENSITIVE_ACTIVITY_SECTIONS = new Set<AdminConsoleSection>(["analytics", "conversations"]);

export function visibleAdminSectionIds(showOperationsAndConversationMenus: boolean): AdminConsoleSection[] {
  return showOperationsAndConversationMenus
    ? SECTION_ORDER
    : SECTION_ORDER.filter((section) => !SENSITIVE_ACTIVITY_SECTIONS.has(section));
}

export async function lockSecurityDomainsBeforeNavigation(
  currentSection: AdminConsoleSection,
  targetSection: AdminConsoleSection,
  lock: () => Promise<void> = lockAdminSecurityDomains
): Promise<void> {
  if (currentSection === "security-domains" && targetSection !== currentSection) {
    await lock();
  }
}

function sectionFromHash(hash: string): AdminConsoleSection | null {
  if (!hash.startsWith(ADMIN_HASH_PREFIX)) return null;
  const rawValue = hash.slice(ADMIN_HASH_PREFIX.length).split("?")[0] ?? "";
  const value = decodeURIComponent(rawValue).trim();
  if (value === "overview" || value === "monitoring") return "analytics";
  if (!SECTION_ORDER.includes(value as AdminConsoleSection)) return null;
  return value as AdminConsoleSection;
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
  visibleSections: Set<AdminConsoleSection>;
  collapsed: boolean;
  onNavigate: (section: AdminConsoleSection) => void;
}) {
  return (
    <div className="admin-sidebar-content">
      {NAVIGATION_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) => props.visibleSections.has(item.id))
      })).filter((group) => group.items.length > 0).map((group) => (
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

function AdminSectionContent(props: { section: AdminConsoleSection }) {
  switch (props.section) {
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
    case "security-domains":
      return (
        <Suspense fallback={<AdminSectionLazyFallback />}>
          <SecurityDomainsViewLazy />
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
    case "billing":
      return (
        <Suspense fallback={<AdminSectionLazyFallback />}>
          <BillingWorkspaceLazy />
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
    case "codex-memory":
      return (
        <Suspense fallback={<AdminSectionLazyFallback />}>
          <CodexMemoryManagementViewLazy />
        </Suspense>
      );
    case "skill-drafts":
      return (
        <Suspense fallback={<AdminSectionLazyFallback />}>
          <SkillCatalogManagementViewLazy />
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
    case "brands":
      return (
        <Suspense fallback={<AdminSectionLazyFallback />}>
          <BrandManagementViewLazy />
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
        <div className="admin-page-container admin-organization-sync-page">
          <Row gutter={[16, 16]} className="admin-organization-sync-layout">
              <Col xs={24} xl={10}>
                <Suspense fallback={<AdminSectionLazyFallback />}>
                  <DepartmentTreeViewLazy />
                </Suspense>
              </Col>
              <Col xs={24} xl={14}>
                <Suspense fallback={<AdminSectionLazyFallback />}>
                  <OrgSyncViewLazy />
                </Suspense>
              </Col>
          </Row>
        </div>
      );
    default:
      return null;
  }
}

export function AdminShell(props: { currentUser?: AuthUser; onOpenPortal?: () => void; onSignOut?: () => void }) {
  const { adminConsole, branding } = useBranding();
  const [section, setSection] = useState<AdminConsoleSection>(() => {
    if (typeof window === "undefined") return "analytics";
    return sectionFromHash(window.location.hash) ?? "analytics";
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [cmdSearch, setCmdSearch] = useState("");
  const isNarrowScreen = useIsNarrowScreen(1080);
  const visibleSectionIds = useMemo(
    () => visibleAdminSectionIds(adminConsole.showOperationsAndConversationMenus),
    [adminConsole.showOperationsAndConversationMenus]
  );
  const visibleSections = useMemo(() => new Set(visibleSectionIds), [visibleSectionIds]);

  useEffect(() => {
    document.body.classList.add("admin-console-mode");
    return () => {
      document.body.classList.remove("admin-console-mode");
    };
  }, []);

  useEffect(() => {
    if (!visibleSections.has(section)) {
      setSection(visibleSectionIds[0] ?? "system-settings");
    }
  }, [section, visibleSectionIds, visibleSections]);

  const currentSectionMeta = SECTION_META[section];
  const currentGroupMeta = GROUPS.find((item) => item.id === currentSectionMeta.group) ?? GROUPS[0];

  const navigateToSection = useCallback(
    async (targetSection: AdminConsoleSection) => {
      if (targetSection === section) {
        setCmdPaletteOpen(false);
        setMobileNavOpen(false);
        return;
      }
      try {
        await lockSecurityDomainsBeforeNavigation(section, targetSection);
      } catch (error) {
        window.history.replaceState(null, "", `${ADMIN_HASH_PREFIX}${encodeURIComponent(section)}`);
        Modal.error({
          title: "无法离开保密域",
          content: error instanceof Error ? `${error.message}。请重试。` : "锁定保密域失败，请重试。"
        });
        return;
      }
      setSection(targetSection);
      setCmdPaletteOpen(false);
      setMobileNavOpen(false);
    },
    [section]
  );

  useEffect(() => {
    const onHashChange = () => {
      const fromHash = sectionFromHash(window.location.hash);
      if (fromHash) void navigateToSection(fromHash);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [navigateToSection]);

  useEffect(() => {
    const nextHash = `${ADMIN_HASH_PREFIX}${encodeURIComponent(section)}`;
    if (sectionFromHash(window.location.hash) === section) {
      return;
    }
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
    void navigateToSection(targetSection);
  };

  const handleOpenPortal = async () => {
    try {
      await lockSecurityDomainsBeforeNavigation(section, "analytics");
    } catch (error) {
      Modal.error({
        title: "无法离开保密域",
        content: error instanceof Error ? `${error.message}。请重试。` : "锁定保密域失败，请重试。"
      });
      return;
    }
    props.onOpenPortal?.();
  };

  const filteredCmdItems = useMemo(() => {
    const query = cmdSearch.trim().toLowerCase();
    const visibleItems = Object.values(SECTION_META).filter((item) => visibleSections.has(item.id));
    if (!query) return visibleItems;
    return visibleItems.filter(
      (item) =>
        item.title.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query) ||
        item.keywords.some((keyword) => keyword.toLowerCase().includes(query))
    );
  }, [cmdSearch, visibleSections]);

  const brandLogoUrl = branding.logoUrl || branding.iconUrl;

  const drawerNavigation = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="admin-sidebar-header">
        <div className="admin-brand" style={{ display: "flex" }}>
          <BrandMark className="admin-brand-icon" imageClassName="admin-brand-image" name={branding.platformName} logoUrl={brandLogoUrl} />
          <span>{branding.platformName}</span>
        </div>
      </div>
      <AdminNavigation activeSection={section} visibleSections={visibleSections} collapsed={false} onNavigate={handleNavClick} />
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
            <AdminNavigation activeSection={section} visibleSections={visibleSections} collapsed={sidebarCollapsed} onNavigate={handleNavClick} />
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
                <Button style={{ borderRadius: "var(--admin-radius-full)" }} onClick={() => void handleOpenPortal()}>
                  返回工作台
                </Button>
              ) : null}
            </div>
          </header>

          <div className="admin-content-scroll">
            <AdminSectionContent section={section} />
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
