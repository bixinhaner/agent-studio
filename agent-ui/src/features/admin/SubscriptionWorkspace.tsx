import {
  Alert,
  Button,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Tooltip
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { Building2, Clock3, PencilLine, Plus, RefreshCw, Search, ShieldAlert, Trash2, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useIsNarrowScreen } from "../../lib/use-is-narrow-screen";
import {
  createAdminSubscriptionPlan,
  deleteAdminOrganizationSubscriptionGrant,
  deleteAdminUserSubscriptionGrant,
  fetchAdminSubscriptionDenials,
  fetchAdminSubscriptionOrganizations,
  fetchAdminSubscriptionPlans,
  fetchAdminSubscriptionUsers,
  patchAdminSubscriptionPlan,
  upsertAdminOrganizationSubscriptionGrant,
  upsertAdminUserSubscriptionGrant
} from "./api";
import type {
  AdminSubscriptionAccessStatus,
  AdminSubscriptionDenialRecord,
  AdminSubscriptionGrantInput,
  AdminSubscriptionGrantSummary,
  AdminSubscriptionOrganizationRecord,
  AdminSubscriptionPlan,
  AdminSubscriptionUserRecord
} from "./types";

type WorkspaceTab = "plans" | "users" | "organizations" | "denials";

type PlanFormState = {
  name: string;
  slug: string;
  description: string;
  status: string;
  monthlyCompletedTurnLimit: number | null;
  monthlyTokenLimit: number | null;
};

type GrantFormState = {
  planId: string;
  status: string;
  startsAt: string;
  expiresAt: string;
  cycleAnchorAt: string;
  completedTurnLimitOverride: number | null;
  tokenLimitOverride: number | null;
  note: string;
};

function formatLocalTime(value: string | null | undefined): string {
  if (!value) return "未设置";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "不限";
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatDateInput(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function toIsoOrNull(value: string): string | null {
  if (!value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function accessTagColor(status: AdminSubscriptionAccessStatus): string {
  switch (status) {
    case "available":
      return "success";
    case "paused":
      return "warning";
    case "scheduled":
      return "processing";
    case "expired":
    case "exhausted":
    case "restricted":
      return "error";
    default:
      return "default";
  }
}

function planStatusColor(status: string): string {
  return status === "active" ? "success" : "default";
}

function sourceTone(mode: string): "blue" | "cyan" | "gold" | "default" {
  switch (mode) {
    case "user":
      return "blue";
    case "organization":
      return "cyan";
    case "default_internal":
      return "gold";
    default:
      return "default";
  }
}

function userTypeLabel(userType: string): string {
  return userType === "internal_employee" ? "内部成员" : "外部成员";
}

function organizationTypeLabel(type: string | null | undefined): string {
  if (type === "internal") return "内部组织";
  if (type === "customer") return "外部组织";
  return type || "未归类组织";
}

function createPlanFormState(plan?: AdminSubscriptionPlan | null): PlanFormState {
  return {
    name: plan?.name ?? "",
    slug: plan?.slug ?? "",
    description: plan?.description ?? "",
    status: plan?.status ?? "active",
    monthlyCompletedTurnLimit: plan?.monthlyCompletedTurnLimit ?? null,
    monthlyTokenLimit: plan?.monthlyTokenLimit ?? null
  };
}

function createGrantFormState(grant?: AdminSubscriptionGrantSummary | null): GrantFormState {
  return {
    planId: grant?.planId ?? "",
    status: grant?.status ?? "active",
    startsAt: formatDateInput(grant?.startsAt ?? new Date().toISOString()),
    expiresAt: formatDateInput(grant?.expiresAt),
    cycleAnchorAt: formatDateInput(grant?.cycleAnchorAt ?? grant?.startsAt ?? new Date().toISOString()),
    completedTurnLimitOverride: grant?.completedTurnLimitOverride ?? null,
    tokenLimitOverride: grant?.tokenLimitOverride ?? null,
    note: grant?.note ?? ""
  };
}

function usageRatio(used: number, limit: number | null | undefined): number {
  if (limit === null || limit === undefined || limit <= 0) return 0;
  return Math.max(0, Math.min(100, (used / limit) * 100));
}

function buildGrantPayload(form: GrantFormState): AdminSubscriptionGrantInput {
  return {
    planId: form.planId || null,
    status: form.status,
    startsAt: toIsoOrNull(form.startsAt) ?? new Date().toISOString(),
    expiresAt: toIsoOrNull(form.expiresAt),
    cycleAnchorAt: toIsoOrNull(form.cycleAnchorAt),
    completedTurnLimitOverride: form.completedTurnLimitOverride,
    tokenLimitOverride: form.tokenLimitOverride,
    note: form.note.trim() || null
  };
}

function GrantUsagePanel(props: { grant: AdminSubscriptionGrantSummary | null; tokenLabel?: string }) {
  if (!props.grant) {
    return (
      <section className="subscription-usage-card">
        <div className="subscription-section-heading">当前进度</div>
        <div className="subscription-usage-empty">还没有单独配置记录，保存后会从这里看到本周期进度。</div>
      </section>
    );
  }

  const usage = props.grant.usage;
  if (!usage) {
    return (
      <section className="subscription-usage-card">
        <div className="subscription-section-heading">当前进度</div>
        <div className="subscription-usage-empty">{props.grant.access.description}</div>
      </section>
    );
  }

  return (
    <section className="subscription-usage-card">
      <div className="subscription-section-heading">当前进度</div>
      <div className="subscription-usage-range">
        本周期 {formatLocalTime(usage.cycleStartsAt)} 至 {formatLocalTime(usage.cycleEndsAt)}
      </div>
      <div className="subscription-usage-metrics">
        <div className="subscription-progress-row">
          <div>
            <strong>{usage.usedCompletedTurns}</strong>
            <span>已使用 AI Request</span>
          </div>
          <div>{props.grant.monthlyCompletedTurnLimit === null ? "不限" : `上限 ${props.grant.monthlyCompletedTurnLimit}`}</div>
        </div>
        <div className="subscription-progress-track">
          <span style={{ width: `${usageRatio(usage.usedCompletedTurns, props.grant.monthlyCompletedTurnLimit)}%` }} />
        </div>
        <div className="subscription-progress-row">
          <div>
            <strong>{new Intl.NumberFormat("zh-CN").format(usage.usedTokens)}</strong>
            <span>{props.tokenLabel ?? "已消耗服务额度"}</span>
          </div>
          <div>{props.grant.monthlyTokenLimit === null ? "不限" : `上限 ${formatCount(props.grant.monthlyTokenLimit)}`}</div>
        </div>
        <div className="subscription-progress-track">
          <span style={{ width: `${usageRatio(usage.usedTokens, props.grant.monthlyTokenLimit)}%` }} />
        </div>
      </div>
    </section>
  );
}

export function SubscriptionWorkspace() {
  const isNarrowScreen = useIsNarrowScreen(1100);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("plans");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");
  const [query, setQuery] = useState("");
  const [plans, setPlans] = useState<AdminSubscriptionPlan[]>([]);
  const [users, setUsers] = useState<AdminSubscriptionUserRecord[]>([]);
  const [organizations, setOrganizations] = useState<AdminSubscriptionOrganizationRecord[]>([]);
  const [denials, setDenials] = useState<AdminSubscriptionDenialRecord[]>([]);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<AdminSubscriptionPlan | null>(null);
  const [planForm, setPlanForm] = useState<PlanFormState>(createPlanFormState());
  const [savingPlan, setSavingPlan] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminSubscriptionUserRecord | null>(null);
  const [userGrantForm, setUserGrantForm] = useState<GrantFormState>(createGrantFormState());
  const [savingUserGrant, setSavingUserGrant] = useState(false);
  const [selectedOrganization, setSelectedOrganization] = useState<AdminSubscriptionOrganizationRecord | null>(null);
  const [organizationGrantForm, setOrganizationGrantForm] = useState<GrantFormState>(createGrantFormState());
  const [savingOrganizationGrant, setSavingOrganizationGrant] = useState(false);

  async function loadData(silent = false) {
    if (!silent) setLoading(true);
    setRefreshing(silent);
    setErrorText("");
    try {
      const [plansResponse, usersResponse, organizationsResponse, denialsResponse] = await Promise.all([
        fetchAdminSubscriptionPlans(),
        fetchAdminSubscriptionUsers(),
        fetchAdminSubscriptionOrganizations(),
        fetchAdminSubscriptionDenials()
      ]);
      setPlans(plansResponse.plans);
      setUsers(usersResponse.users);
      setOrganizations(organizationsResponse.organizations);
      setDenials(denialsResponse.events);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "加载订阅权益失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const summaryCards = useMemo(() => {
    return [
      {
        label: "已启用套餐",
        value: plans.filter((item) => item.status === "active").length,
        meta: "面向后台维护的标准方案"
      },
      {
        label: "用户单独配置",
        value: users.filter((item) => item.userGrant).length,
        meta: "为成员单独设置的可用期或额度"
      },
      {
        label: "组织已配置",
        value: organizations.filter((item) => item.grant).length,
        meta: "按组织统一生效的套餐与额度"
      },
      {
        label: "最近阻断",
        value: denials.length,
        meta: "最近 120 条因到期或额度触发的拦截"
      }
    ];
  }, [denials.length, organizations, plans, users]);

  const filteredPlans = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return plans;
    return plans.filter((plan) =>
      [plan.name, plan.slug, plan.description ?? ""].join(" ").toLowerCase().includes(normalizedQuery)
    );
  }, [plans, query]);

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return users;
    return users.filter((user) =>
      [
        user.displayName ?? "",
        user.email ?? "",
        user.organization?.name ?? "",
        user.source.label,
        user.source.planName ?? "",
        user.access.title
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [query, users]);

  const filteredOrganizations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return organizations;
    return organizations.filter((organization) =>
      [organization.name, organization.slug, organization.source.label, organization.source.planName ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [organizations, query]);

  const filteredDenials = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return denials;
    return denials.filter((item) =>
      [item.title, item.detail ?? "", item.user?.displayName ?? "", item.organization?.name ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [denials, query]);

  const userColumns = useMemo<ColumnsType<AdminSubscriptionUserRecord>>(
    () => [
      {
        title: "成员",
        key: "user",
        width: 260,
        render: (_value, record) => (
          <div className="subscription-entity-stack">
            <strong>{record.displayName || record.email || record.id}</strong>
            <span>{record.email || "未绑定邮箱"}</span>
            <span>{userTypeLabel(record.userType)}</span>
          </div>
        )
      },
      {
        title: "归属组织",
        key: "organization",
        width: 220,
        render: (_value, record) =>
          record.organization ? (
            <div className="subscription-entity-stack">
              <strong>{record.organization.name}</strong>
              <span>{organizationTypeLabel(record.organization.type)}</span>
            </div>
          ) : (
            <span className="subscription-muted">未归属组织</span>
          )
      },
      {
        title: "当前状态",
        key: "access",
        width: 360,
        render: (_value, record) => (
          <div className="subscription-entity-stack">
            <Space size={[6, 6]} wrap>
              <Tag color={accessTagColor(record.access.status)} style={{ borderRadius: 999 }}>
                {record.access.title}
              </Tag>
              <Tag color={sourceTone(record.source.mode)} style={{ borderRadius: 999 }}>
                {record.source.label}
              </Tag>
            </Space>
            <span>{record.access.description}</span>
          </div>
        )
      },
      {
        title: "到期时间",
        key: "expiresAt",
        width: 180,
        render: (_value, record) => <span>{formatLocalTime(record.userGrant?.expiresAt ?? record.organizationGrant?.expiresAt)}</span>
      },
      {
        title: "操作",
        key: "actions",
        width: 96,
        render: (_value, record) => (
          <Tooltip title="管理成员权益">
            <Button type="text" icon={<PencilLine size={16} />} onClick={() => {
              setSelectedUser(record);
              setUserGrantForm(createGrantFormState(record.userGrant));
            }} />
          </Tooltip>
        )
      }
    ],
    []
  );

  const organizationColumns = useMemo<ColumnsType<AdminSubscriptionOrganizationRecord>>(
    () => [
      {
        title: "组织",
        key: "organization",
        width: 280,
        render: (_value, record) => (
          <div className="subscription-entity-stack">
            <strong>{record.name}</strong>
            <span>
              {organizationTypeLabel(record.type)} · {record.memberCount} 人
            </span>
            <span>{record.slug}</span>
          </div>
        )
      },
      {
        title: "状态",
        key: "status",
        width: 360,
        render: (_value, record) => (
          <div className="subscription-entity-stack">
            <Space size={[6, 6]} wrap>
              <Tag color={accessTagColor(record.access.status)} style={{ borderRadius: 999 }}>
                {record.access.title}
              </Tag>
              <Tag color={sourceTone(record.source.mode)} style={{ borderRadius: 999 }}>
                {record.source.label}
              </Tag>
            </Space>
            <span>{record.access.description}</span>
          </div>
        )
      },
      {
        title: "当前方案",
        key: "plan",
        width: 180,
        render: (_value, record) => <span>{record.grant?.planName || "未单独设置"}</span>
      },
      {
        title: "到期时间",
        key: "expiresAt",
        width: 180,
        render: (_value, record) => <span>{formatLocalTime(record.grant?.expiresAt)}</span>
      },
      {
        title: "操作",
        key: "actions",
        width: 96,
        render: (_value, record) => (
          <Tooltip title="管理组织权益">
            <Button type="text" icon={<PencilLine size={16} />} onClick={() => {
              setSelectedOrganization(record);
              setOrganizationGrantForm(createGrantFormState(record.grant));
            }} />
          </Tooltip>
        )
      }
    ],
    []
  );

  const denialColumns = useMemo<ColumnsType<AdminSubscriptionDenialRecord>>(
    () => [
      {
        title: "时间",
        dataIndex: "createdAt",
        key: "createdAt",
        width: 190,
        render: (value: string) => <span>{formatLocalTime(value)}</span>
      },
      {
        title: "成员",
        key: "user",
        width: 240,
        render: (_value, record) => (
          <div className="subscription-entity-stack">
            <strong>{record.user?.displayName || record.user?.email || "未识别成员"}</strong>
            <span>{record.user?.email || "无邮箱信息"}</span>
          </div>
        )
      },
      {
        title: "组织",
        key: "organization",
        width: 220,
        render: (_value, record) => (
          <div className="subscription-entity-stack">
            <strong>{record.organization?.name || "未识别组织"}</strong>
            <span>{organizationTypeLabel(record.organization?.type)}</span>
          </div>
        )
      },
      {
        title: "原因",
        key: "reason",
        width: 420,
        render: (_value, record) => (
          <div className="subscription-entity-stack">
            <Tag color="error" style={{ borderRadius: 999, width: "fit-content" }}>
              {record.title}
            </Tag>
            <span>{record.detail || "未返回额外说明"}</span>
          </div>
        )
      }
    ],
    []
  );

  function openPlanModal(plan?: AdminSubscriptionPlan) {
    setEditingPlan(plan ?? null);
    setPlanForm(createPlanFormState(plan));
    setPlanModalOpen(true);
  }

  async function handleSavePlan() {
    if (!planForm.name.trim()) {
      setErrorText("请先填写套餐名称。");
      setSuccessText("");
      return;
    }
    setSavingPlan(true);
    setErrorText("");
    setSuccessText("");
    try {
      if (editingPlan) {
        await patchAdminSubscriptionPlan(editingPlan.id, {
          ...planForm,
          description: planForm.description.trim() || null
        });
        setSuccessText(`已更新套餐 ${planForm.name}。`);
      } else {
        await createAdminSubscriptionPlan({
          ...planForm,
          slug: planForm.slug.trim() || undefined,
          description: planForm.description.trim() || null
        });
        setSuccessText(`已创建套餐 ${planForm.name}。`);
      }
      setPlanModalOpen(false);
      await loadData(true);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存套餐失败");
    } finally {
      setSavingPlan(false);
    }
  }

  async function handleSaveUserGrant() {
    if (!selectedUser) return;
    setSavingUserGrant(true);
    setErrorText("");
    setSuccessText("");
    try {
      await upsertAdminUserSubscriptionGrant(selectedUser.id, buildGrantPayload(userGrantForm));
      setSuccessText(`已更新 ${selectedUser.displayName || selectedUser.email || "该成员"} 的可用期设置。`);
      setSelectedUser(null);
      await loadData(true);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存成员设置失败");
    } finally {
      setSavingUserGrant(false);
    }
  }

  async function handleRemoveUserGrant() {
    if (!selectedUser?.userGrant) return;
    if (!window.confirm("移除后将回到组织或默认规则，确认继续吗？")) return;
    setSavingUserGrant(true);
    setErrorText("");
    setSuccessText("");
    try {
      await deleteAdminUserSubscriptionGrant(selectedUser.id);
      setSuccessText(`已移除 ${selectedUser.displayName || selectedUser.email || "该成员"} 的单独配置。`);
      setSelectedUser(null);
      await loadData(true);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "移除成员配置失败");
    } finally {
      setSavingUserGrant(false);
    }
  }

  async function handleSaveOrganizationGrant() {
    if (!selectedOrganization) return;
    setSavingOrganizationGrant(true);
    setErrorText("");
    setSuccessText("");
    try {
      await upsertAdminOrganizationSubscriptionGrant(selectedOrganization.id, buildGrantPayload(organizationGrantForm));
      setSuccessText(`已更新 ${selectedOrganization.name} 的组织配置。`);
      setSelectedOrganization(null);
      await loadData(true);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存组织配置失败");
    } finally {
      setSavingOrganizationGrant(false);
    }
  }

  async function handleRemoveOrganizationGrant() {
    if (!selectedOrganization?.grant) return;
    if (!window.confirm("移除后会回到默认规则，确认继续吗？")) return;
    setSavingOrganizationGrant(true);
    setErrorText("");
    setSuccessText("");
    try {
      await deleteAdminOrganizationSubscriptionGrant(selectedOrganization.id);
      setSuccessText(`已移除 ${selectedOrganization.name} 的组织配置。`);
      setSelectedOrganization(null);
      await loadData(true);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "移除组织配置失败");
    } finally {
      setSavingOrganizationGrant(false);
    }
  }

  const activeCount = useMemo(() => {
    switch (activeTab) {
      case "plans":
        return filteredPlans.length;
      case "users":
        return filteredUsers.length;
      case "organizations":
        return filteredOrganizations.length;
      case "denials":
        return filteredDenials.length;
    }
  }, [activeTab, filteredDenials.length, filteredOrganizations.length, filteredPlans.length, filteredUsers.length]);

  return (
    <>
      <div className="admin-page-container subscription-page">
        <section className="subscription-hero subscription-page-block">
          <div className="subscription-hero-copy">
            <div className="subscription-hero-eyebrow">Subscription Studio</div>
            <div>
              <h1 className="admin-page-title">订阅权益</h1>
              <p className="admin-page-desc">把套餐、可用期和 AI Request 额度放到同一个工作区里管理，用户触发到期或额度上限时会被直接拦截。</p>
            </div>
            <div className="subscription-defaults">
              <div className="subscription-default-chip">
                <Building2 size={16} />
                <span>内部组织未单独配置时默认可继续使用</span>
              </div>
              <div className="subscription-default-chip subscription-default-chip-alert">
                <ShieldAlert size={16} />
                <span>外部组织未开通时默认不能继续提问</span>
              </div>
            </div>
          </div>
          <div className="subscription-summary-grid">
            {summaryCards.map((card) => (
              <section key={card.label} className="subscription-summary-card">
                <div className="subscription-summary-label">{card.label}</div>
                <div className="subscription-summary-value">{card.value}</div>
                <div className="subscription-summary-meta">{card.meta}</div>
              </section>
            ))}
          </div>
        </section>

        {errorText ? <Alert type="error" showIcon message={errorText} /> : null}
        {successText ? <Alert type="success" showIcon message={successText} /> : null}

        <section className="admin-card subscription-workbench">
          <div className="subscription-toolbar">
            <div className="subscription-toolbar-leading">
              <Input
                prefix={<Search size={16} style={{ color: "var(--admin-color-subtle)" }} />}
                placeholder="搜索套餐、成员、组织或阻断说明"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="subscription-search-input"
                style={{ width: isNarrowScreen ? "100%" : 360 }}
              />
              <Tag color="blue" style={{ borderRadius: 999, margin: 0 }}>
                当前命中 {activeCount} 条
              </Tag>
            </div>
            <Space>
              <Button icon={<RefreshCw size={16} />} onClick={() => void loadData(true)} loading={refreshing}>
                刷新
              </Button>
              {activeTab === "plans" ? (
                <Button type="primary" icon={<Plus size={16} />} onClick={() => openPlanModal()}>
                  新建套餐
                </Button>
              ) : null}
            </Space>
          </div>

          <Tabs
            activeKey={activeTab}
            onChange={(value) => setActiveTab(value as WorkspaceTab)}
            items={[
              { key: "plans", label: "套餐模板" },
              { key: "users", label: "用户订阅" },
              { key: "organizations", label: "组织订阅" },
              { key: "denials", label: "阻断记录" }
            ]}
          />

          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 72 }}>
              <Spin size="large" />
            </div>
          ) : null}

          {!loading && activeTab === "plans" ? (
            filteredPlans.length ? (
              <div className="subscription-plan-grid">
                {filteredPlans.map((plan) => (
                  <section key={plan.id} className="subscription-plan-card">
                    <div className="subscription-plan-card-header">
                      <div>
                        <h3>{plan.name}</h3>
                        <p>{plan.description || "可用于配置用户或组织的标准套餐。"}</p>
                      </div>
                      <Tag color={planStatusColor(plan.status)} style={{ borderRadius: 999, margin: 0 }}>
                        {plan.status === "active" ? "启用中" : "已停用"}
                      </Tag>
                    </div>
                    <div className="subscription-plan-metrics">
                      <div>
                        <span>每月 AI Request</span>
                        <strong>{formatCount(plan.monthlyCompletedTurnLimit)}</strong>
                      </div>
                      <div>
                        <span>每月服务额度</span>
                        <strong>{formatCount(plan.monthlyTokenLimit)}</strong>
                      </div>
                    </div>
                    <div className="subscription-plan-footer">
                      <div className="subscription-plan-assignments">
                        <span>{plan.assignmentCount.users} 位成员</span>
                        <span>{plan.assignmentCount.organizations} 个组织</span>
                      </div>
                      <Button type="text" icon={<PencilLine size={16} />} onClick={() => openPlanModal(plan)}>
                        编辑
                      </Button>
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <Empty description="还没有匹配的套餐模板。" />
            )
          ) : null}

          {!loading && activeTab === "users" ? (
            <Table
              className="subscription-table"
              rowKey="id"
              columns={userColumns}
              dataSource={filteredUsers}
              pagination={{ pageSize: 8, hideOnSinglePage: true }}
              scroll={{ x: 1120 }}
            />
          ) : null}

          {!loading && activeTab === "organizations" ? (
            <Table
              className="subscription-table"
              rowKey="id"
              columns={organizationColumns}
              dataSource={filteredOrganizations}
              pagination={{ pageSize: 8, hideOnSinglePage: true }}
              scroll={{ x: 1100 }}
            />
          ) : null}

          {!loading && activeTab === "denials" ? (
            <Table
              className="subscription-table"
              rowKey="id"
              columns={denialColumns}
              dataSource={filteredDenials}
              pagination={{ pageSize: 8, hideOnSinglePage: true }}
              scroll={{ x: 1080 }}
            />
          ) : null}
        </section>
      </div>

      <Modal
        open={planModalOpen}
        onCancel={() => setPlanModalOpen(false)}
        title={editingPlan ? "编辑套餐" : "新建套餐"}
        okText={editingPlan ? "保存修改" : "创建套餐"}
        cancelText="取消"
        onOk={() => void handleSavePlan()}
        confirmLoading={savingPlan}
        width={640}
      >
        <div className="subscription-form-grid">
          <label className="subscription-form-field">
            <span>套餐名称</span>
            <Input value={planForm.name} onChange={(event) => setPlanForm((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label className="subscription-form-field">
            <span>套餐标识</span>
            <Input
              value={planForm.slug}
              placeholder="留空会按名称自动生成"
              onChange={(event) => setPlanForm((current) => ({ ...current, slug: event.target.value }))}
            />
          </label>
          <label className="subscription-form-field subscription-form-field-full">
            <span>说明</span>
            <Input.TextArea
              rows={3}
              value={planForm.description}
              placeholder="告诉运营这个套餐面向谁，以及什么时候适合用它。"
              onChange={(event) => setPlanForm((current) => ({ ...current, description: event.target.value }))}
            />
          </label>
          <label className="subscription-form-field">
            <span>状态</span>
            <Select
              value={planForm.status}
              onChange={(value) => setPlanForm((current) => ({ ...current, status: value }))}
              options={[
                { value: "active", label: "启用中" },
                { value: "paused", label: "已停用" }
              ]}
            />
          </label>
          <label className="subscription-form-field">
            <span>每月 AI Request</span>
            <InputNumber
              min={0}
              style={{ width: "100%" }}
              value={planForm.monthlyCompletedTurnLimit}
              placeholder="留空表示不限制"
              onChange={(value) => setPlanForm((current) => ({ ...current, monthlyCompletedTurnLimit: value ?? null }))}
            />
          </label>
          <label className="subscription-form-field">
            <span>每月服务额度</span>
            <InputNumber
              min={0}
              style={{ width: "100%" }}
              value={planForm.monthlyTokenLimit}
              placeholder="留空表示不限制"
              onChange={(value) => setPlanForm((current) => ({ ...current, monthlyTokenLimit: value ?? null }))}
            />
          </label>
        </div>
      </Modal>

      <Drawer
        open={Boolean(selectedUser)}
        onClose={() => setSelectedUser(null)}
        title={selectedUser ? `${selectedUser.displayName || selectedUser.email || "成员权益"} · 权益设置` : "成员权益设置"}
        width={isNarrowScreen ? "100%" : 560}
        destroyOnClose
      >
        {selectedUser ? (
          <div className="subscription-drawer-layout">
            <section className="subscription-detail-card">
              <div className="subscription-detail-header">
                <div>
                  <strong>{selectedUser.displayName || selectedUser.email || selectedUser.id}</strong>
                  <span>{selectedUser.email || "未绑定邮箱"}</span>
                </div>
                <Tag color={accessTagColor(selectedUser.access.status)} style={{ borderRadius: 999 }}>
                  {selectedUser.access.title}
                </Tag>
              </div>
              <div className="subscription-detail-meta">
                <span><UserRound size={14} /> {userTypeLabel(selectedUser.userType)}</span>
                <span><Building2 size={14} /> {selectedUser.organization?.name || "未归属组织"}</span>
                <span><Clock3 size={14} /> {selectedUser.source.label}</span>
              </div>
              <p>{selectedUser.access.description}</p>
            </section>

            {selectedUser.organizationGrant && !selectedUser.userGrant ? (
              <section className="subscription-detail-card subscription-detail-card-subtle">
                <div className="subscription-section-heading">当前正在沿用的组织规则</div>
                <div className="subscription-inherited-copy">
                  {selectedUser.organization?.name || "该组织"} 正在使用
                  <strong>{selectedUser.organizationGrant.planName || "自定义配置"}</strong>，
                  只要不单独为这个成员设置，就会继续沿用组织规则。
                </div>
              </section>
            ) : null}

            <section className="subscription-form-grid">
              <label className="subscription-form-field">
                <span>套用套餐</span>
                <Select
                  value={userGrantForm.planId || undefined}
                  allowClear
                  placeholder="可留空，直接填写自定义额度"
                  onChange={(value) => setUserGrantForm((current) => ({ ...current, planId: value ?? "" }))}
                  options={plans.map((plan) => ({ value: plan.id, label: `${plan.name} · ${formatCount(plan.monthlyCompletedTurnLimit)} AI Request/月` }))}
                />
              </label>
              <label className="subscription-form-field">
                <span>状态</span>
                <Select
                  value={userGrantForm.status}
                  onChange={(value) => setUserGrantForm((current) => ({ ...current, status: value }))}
                  options={[
                    { value: "active", label: "生效中" },
                    { value: "paused", label: "暂停使用" }
                  ]}
                />
              </label>
              <label className="subscription-form-field">
                <span>开始时间</span>
                <Input
                  type="datetime-local"
                  value={userGrantForm.startsAt}
                  onChange={(event) => setUserGrantForm((current) => ({ ...current, startsAt: event.target.value }))}
                />
              </label>
              <label className="subscription-form-field">
                <span>到期时间</span>
                <Input
                  type="datetime-local"
                  value={userGrantForm.expiresAt}
                  onChange={(event) => setUserGrantForm((current) => ({ ...current, expiresAt: event.target.value }))}
                />
              </label>
              <label className="subscription-form-field">
                <span>每月周期起点</span>
                <Input
                  type="datetime-local"
                  value={userGrantForm.cycleAnchorAt}
                  onChange={(event) => setUserGrantForm((current) => ({ ...current, cycleAnchorAt: event.target.value }))}
                />
              </label>
              <label className="subscription-form-field">
                <span>单独 AI Request</span>
                <InputNumber
                  min={0}
                  style={{ width: "100%" }}
                  placeholder="留空时沿用套餐"
                  value={userGrantForm.completedTurnLimitOverride}
                  onChange={(value) =>
                    setUserGrantForm((current) => ({ ...current, completedTurnLimitOverride: value ?? null }))
                  }
                />
              </label>
              <label className="subscription-form-field">
                <span>单独服务额度</span>
                <InputNumber
                  min={0}
                  style={{ width: "100%" }}
                  placeholder="留空时沿用套餐"
                  value={userGrantForm.tokenLimitOverride}
                  onChange={(value) => setUserGrantForm((current) => ({ ...current, tokenLimitOverride: value ?? null }))}
                />
              </label>
              <label className="subscription-form-field subscription-form-field-full">
                <span>备注</span>
                <Input.TextArea
                  rows={3}
                  value={userGrantForm.note}
                  placeholder="例如：试用补量、人工延期、专项支持。"
                  onChange={(event) => setUserGrantForm((current) => ({ ...current, note: event.target.value }))}
                />
              </label>
            </section>

            <GrantUsagePanel grant={selectedUser.userGrant ?? selectedUser.organizationGrant} />

            <div className="subscription-drawer-actions">
              {selectedUser.userGrant ? (
                <Button danger icon={<Trash2 size={16} />} onClick={() => void handleRemoveUserGrant()} loading={savingUserGrant}>
                  移除单独配置
                </Button>
              ) : (
                <span className="subscription-muted">未单独配置时会继续按组织或默认规则处理。</span>
              )}
              <Button type="primary" onClick={() => void handleSaveUserGrant()} loading={savingUserGrant}>
                保存成员设置
              </Button>
            </div>
          </div>
        ) : null}
      </Drawer>

      <Drawer
        open={Boolean(selectedOrganization)}
        onClose={() => setSelectedOrganization(null)}
        title={selectedOrganization ? `${selectedOrganization.name} · 组织权益` : "组织权益"}
        width={isNarrowScreen ? "100%" : 560}
        destroyOnClose
      >
        {selectedOrganization ? (
          <div className="subscription-drawer-layout">
            <section className="subscription-detail-card">
              <div className="subscription-detail-header">
                <div>
                  <strong>{selectedOrganization.name}</strong>
                  <span>{organizationTypeLabel(selectedOrganization.type)} · {selectedOrganization.memberCount} 人</span>
                </div>
                <Tag color={accessTagColor(selectedOrganization.access.status)} style={{ borderRadius: 999 }}>
                  {selectedOrganization.access.title}
                </Tag>
              </div>
              <div className="subscription-detail-meta">
                <span><Building2 size={14} /> {selectedOrganization.slug}</span>
                <span><Clock3 size={14} /> {selectedOrganization.source.label}</span>
              </div>
              <p>{selectedOrganization.access.description}</p>
            </section>

            <section className="subscription-form-grid">
              <label className="subscription-form-field">
                <span>套用套餐</span>
                <Select
                  value={organizationGrantForm.planId || undefined}
                  allowClear
                  placeholder="可留空，直接填写自定义额度"
                  onChange={(value) => setOrganizationGrantForm((current) => ({ ...current, planId: value ?? "" }))}
                  options={plans.map((plan) => ({ value: plan.id, label: `${plan.name} · ${formatCount(plan.monthlyCompletedTurnLimit)} AI Request/月` }))}
                />
              </label>
              <label className="subscription-form-field">
                <span>状态</span>
                <Select
                  value={organizationGrantForm.status}
                  onChange={(value) => setOrganizationGrantForm((current) => ({ ...current, status: value }))}
                  options={[
                    { value: "active", label: "生效中" },
                    { value: "paused", label: "暂停使用" }
                  ]}
                />
              </label>
              <label className="subscription-form-field">
                <span>开始时间</span>
                <Input
                  type="datetime-local"
                  value={organizationGrantForm.startsAt}
                  onChange={(event) =>
                    setOrganizationGrantForm((current) => ({ ...current, startsAt: event.target.value }))
                  }
                />
              </label>
              <label className="subscription-form-field">
                <span>到期时间</span>
                <Input
                  type="datetime-local"
                  value={organizationGrantForm.expiresAt}
                  onChange={(event) =>
                    setOrganizationGrantForm((current) => ({ ...current, expiresAt: event.target.value }))
                  }
                />
              </label>
              <label className="subscription-form-field">
                <span>每月周期起点</span>
                <Input
                  type="datetime-local"
                  value={organizationGrantForm.cycleAnchorAt}
                  onChange={(event) =>
                    setOrganizationGrantForm((current) => ({ ...current, cycleAnchorAt: event.target.value }))
                  }
                />
              </label>
              <label className="subscription-form-field">
                <span>组织 AI Request</span>
                <InputNumber
                  min={0}
                  style={{ width: "100%" }}
                  placeholder="留空时沿用套餐"
                  value={organizationGrantForm.completedTurnLimitOverride}
                  onChange={(value) =>
                    setOrganizationGrantForm((current) => ({ ...current, completedTurnLimitOverride: value ?? null }))
                  }
                />
              </label>
              <label className="subscription-form-field">
                <span>组织服务额度</span>
                <InputNumber
                  min={0}
                  style={{ width: "100%" }}
                  placeholder="留空时沿用套餐"
                  value={organizationGrantForm.tokenLimitOverride}
                  onChange={(value) =>
                    setOrganizationGrantForm((current) => ({ ...current, tokenLimitOverride: value ?? null }))
                  }
                />
              </label>
              <label className="subscription-form-field subscription-form-field-full">
                <span>备注</span>
                <Input.TextArea
                  rows={3}
                  value={organizationGrantForm.note}
                  placeholder="例如：项目试运行、临时扩容、续约说明。"
                  onChange={(event) => setOrganizationGrantForm((current) => ({ ...current, note: event.target.value }))}
                />
              </label>
            </section>

            <GrantUsagePanel grant={selectedOrganization.grant} tokenLabel="已消耗组织服务额度" />

            <div className="subscription-drawer-actions">
              {selectedOrganization.grant ? (
                <Button
                  danger
                  icon={<Trash2 size={16} />}
                  onClick={() => void handleRemoveOrganizationGrant()}
                  loading={savingOrganizationGrant}
                >
                  移除组织配置
                </Button>
              ) : (
                <span className="subscription-muted">未配置时会回到组织默认规则。</span>
              )}
              <Button type="primary" onClick={() => void handleSaveOrganizationGrant()} loading={savingOrganizationGrant}>
                保存组织设置
              </Button>
            </div>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}

export default SubscriptionWorkspace;
