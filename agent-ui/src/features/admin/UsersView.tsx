import { Edit, Search, Shield } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Drawer, Empty, Input, Select, Space, Switch, Table, Tabs, Tag, Tooltip } from "antd";

import { useIsNarrowScreen } from "../../lib/use-is-narrow-screen";
import { UserRoleEditor } from "../rbac/UserRoleEditor";
import {
  createAdminCustomerOrganization,
  createAdminOrganizationInvite,
  fetchAdminCustomerOrganizations,
  fetchAdminUsers,
  patchAdminCustomerOrganization,
  patchAdminUserLocalSettings
} from "./api";
import type { AdminCustomerOrganization, AdminUser } from "./types";

function userSource(user: AdminUser) {
  return user.source ?? {
    userType: "internal_employee",
    primaryOrganizationId: null,
    identities: [],
    organizations: []
  };
}

function formatLocalTime(value: string | null): string {
  if (!value) return "未同步";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatUserStatus(status: string): string {
  if (status === "active") return "正常";
  if (status === "disabled") return "已停用";
  return status;
}

function formatOrganizationStatus(status: string): string {
  if (status === "active") return "启用中";
  if (status === "disabled") return "已停用";
  return status;
}

function organizationStatusColor(status: string): "success" | "default" {
  return status === "active" ? "success" : "default";
}

function userTypeLabel(userType: string): string {
  switch (userType) {
    case "internal_employee":
      return "内部成员";
    case "external_user":
      return "外部成员";
    default:
      return userType || "未知类型";
  }
}

function providerLabel(provider: string): string {
  switch (provider) {
    case "dingtalk":
      return "钉钉";
    case "email_magic_link":
      return "邮箱免密";
    default:
      return provider || "未知身份";
  }
}

function membershipTypeLabel(membershipType: string): string {
  switch (membershipType) {
    case "employee":
      return "员工";
    case "customer_admin":
      return "客户管理员";
    case "customer_member":
      return "客户成员";
    default:
      return membershipType || "未命名成员";
  }
}

function userDisplayTitle(user: AdminUser): string {
  return user.synced.displayName || user.synced.email || user.id;
}

function userContact(user: AdminUser): string {
  const source = userSource(user);
  return (
    user.synced.email ||
    source.identities.find((identity) => identity.email)?.email ||
    user.synced.dingtalkUserId ||
    "未绑定邮箱"
  );
}

function userPrimaryRole(user: AdminUser): string {
  return user.primaryRole?.name || user.local.role;
}

function userIdentitySources(user: AdminUser): string[] {
  const source = userSource(user);
  return [...new Set(source.identities.map((identity) => providerLabel(identity.provider)).filter(Boolean))];
}

function userOrganizationSummary(user: AdminUser): string {
  const source = userSource(user);
  if (!source.organizations.length) {
    return "未加入组织";
  }
  const visible = source.organizations.slice(0, 2).map((membership) => {
    const organizationName = membership.organizationName || membership.organizationId;
    return `${organizationName} · ${membershipTypeLabel(membership.membershipType)}`;
  });
  const extra = source.organizations.length - visible.length;
  return extra > 0 ? `${visible.join(" / ")} +${extra}` : visible.join(" / ");
}

function organizationLabel(organization: AdminCustomerOrganization): string {
  return `${organization.name} (${organization.slug})`;
}

function upsertOrganization(
  organizations: AdminCustomerOrganization[],
  nextOrganization: AdminCustomerOrganization
): AdminCustomerOrganization[] {
  const nextOrganizations = organizations.some((organization) => organization.id === nextOrganization.id)
    ? organizations.map((organization) => (organization.id === nextOrganization.id ? nextOrganization : organization))
    : [...organizations, nextOrganization];
  return nextOrganizations.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function UsersView() {
  const [activeTab, setActiveTab] = useState<"users" | "orgs">("users");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [organizations, setOrganizations] = useState<AdminCustomerOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");
  const [filterText, setFilterText] = useState("");
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [role, setRole] = useState("employee");
  const [manualDisabled, setManualDisabled] = useState(false);
  const [adminNote, setAdminNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [roleEditorUserId, setRoleEditorUserId] = useState<string | null>(null);
  const [newOrganizationName, setNewOrganizationName] = useState("");
  const [newOrganizationStatus, setNewOrganizationStatus] = useState("active");
  const [creatingOrganization, setCreatingOrganization] = useState(false);
  const [inviteOrganizationId, setInviteOrganizationId] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteMembershipType, setInviteMembershipType] = useState("customer_member");
  const [sendingInvite, setSendingInvite] = useState(false);
  const [editingOrganizationId, setEditingOrganizationId] = useState<string | null>(null);
  const [editingOrganizationName, setEditingOrganizationName] = useState("");
  const [editingOrganizationStatus, setEditingOrganizationStatus] = useState("active");
  const [savingOrganization, setSavingOrganization] = useState(false);
  const isNarrowScreen = useIsNarrowScreen(980);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setErrorText("");
      try {
        const [userResponse, organizationResponse] = await Promise.all([
          fetchAdminUsers(),
          fetchAdminCustomerOrganizations()
        ]);
        if (!active) return;
        setUsers(userResponse.users);
        setOrganizations(organizationResponse.organizations);
        setInviteOrganizationId((current) => {
          if (current && organizationResponse.organizations.some((organization) => organization.id === current)) {
            return current;
          }
          return organizationResponse.organizations[0]?.id ?? "";
        });
      } catch (error) {
        if (active) setErrorText(error instanceof Error ? error.message : "加载用户治理数据失败");
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  const editingUser = useMemo(() => users.find((item) => item.id === editingUserId) ?? null, [editingUserId, users]);
  const editingOrganization = useMemo(
    () => organizations.find((item) => item.id === editingOrganizationId) ?? null,
    [editingOrganizationId, organizations]
  );

  const filteredUsers = useMemo(() => {
    const query = filterText.trim().toLowerCase();
    if (!query) return users;
    return users.filter((user) => {
      const source = userSource(user);
      const haystack = [
        user.id,
        source.userType,
        user.synced.displayName ?? "",
        user.synced.email ?? "",
        user.synced.dingtalkUserId ?? "",
        ...user.synced.departmentIds,
        ...source.identities.map((identity) => `${identity.provider} ${identity.email ?? ""}`),
        ...source.organizations.map((membership) =>
          `${membership.organizationName ?? ""} ${membership.organizationSlug ?? ""} ${membership.membershipType}`
        )
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [filterText, users]);

  const summaryItems = useMemo(() => {
    const activeCount = users.filter((user) => user.effective.status === "active").length;
    const internalCount = users.filter((user) => userSource(user).userType === "internal_employee").length;
    const externalCount = users.filter((user) => userSource(user).userType === "external_user").length;
    const multiOrgCount = users.filter((user) => userSource(user).organizations.length > 1).length;
    const manualDisabledCount = users.filter((user) => user.local.manualDisabled).length;
    const customerOrganizationCount = organizations.length;
    const pendingInviteCount = organizations.reduce((total, organization) => total + organization.pendingInviteCount, 0);

    return [
      {
        label: "总用户数",
        value: String(users.length),
        meta: filterText.trim() ? `当前筛选命中 ${filteredUsers.length} 人` : "平台内全部成员"
      },
      {
        label: "客户组织",
        value: String(customerOrganizationCount),
        meta: "由内部管理员创建和维护"
      },
      {
        label: "内部成员",
        value: String(internalCount),
        meta: "继续走钉钉组织同步链路"
      },
      {
        label: "外部成员",
        value: String(externalCount),
        meta: "通过邀请和邮箱免密进入"
      },
      {
        label: "待处理邀请",
        value: String(pendingInviteCount),
        meta: "尚未完成首次验证的外部用户"
      },
      {
        label: "多组织成员",
        value: String(multiOrgCount),
        meta: "拥有 2 个及以上组织成员关系"
      },
      {
        label: "正常可用",
        value: String(activeCount),
        meta: "当前仍可发起会话的成员"
      },
      {
        label: "手动禁用",
        value: String(manualDisabledCount),
        meta: "被管理员显式关闭访问的成员"
      }
    ];
  }, [filterText, filteredUsers.length, organizations, users]);

  function openEditor(user: AdminUser) {
    setEditingUserId(user.id);
    setRole(user.local.role);
    setManualDisabled(user.local.manualDisabled);
    setAdminNote(user.local.adminNote ?? "");
  }

  function openOrganizationEditor(organization: AdminCustomerOrganization) {
    setEditingOrganizationId(organization.id);
    setEditingOrganizationName(organization.name);
    setEditingOrganizationStatus(organization.status);
  }

  async function handleSave() {
    if (!editingUser) return;
    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await patchAdminUserLocalSettings(editingUser.id, {
        role,
        manualDisabled,
        adminNote: adminNote.trim() || null
      });
      setUsers((current) => current.map((item) => (item.id === editingUser.id ? response.user : item)));
      setEditingUserId(null);
      setSuccessText(`已更新 ${userDisplayTitle(response.user)} 的本地治理设置。`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存用户设置失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateOrganization() {
    const name = newOrganizationName.trim();
    if (!name) {
      setErrorText("请输入客户组织名称。");
      setSuccessText("");
      return;
    }
    setCreatingOrganization(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await createAdminCustomerOrganization({
        name,
        status: newOrganizationStatus
      });
      setOrganizations((current) => upsertOrganization(current, response.organization));
      setInviteOrganizationId(response.organization.id);
      setNewOrganizationName("");
      setNewOrganizationStatus("active");
      setSuccessText(`已创建客户组织 ${response.organization.name}。`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "创建客户组织失败");
    } finally {
      setCreatingOrganization(false);
    }
  }

  async function handleSendInvite() {
    const email = inviteEmail.trim();
    if (!inviteOrganizationId) {
      setErrorText("请先选择目标客户组织。");
      setSuccessText("");
      return;
    }
    if (!email) {
      setErrorText("请输入被邀请人的邮箱。");
      setSuccessText("");
      return;
    }
    setSendingInvite(true);
    setErrorText("");
    setSuccessText("");
    try {
      const invite = await createAdminOrganizationInvite({
        organizationId: inviteOrganizationId,
        email,
        membershipType: inviteMembershipType
      });
      const targetOrganization = organizations.find((organization) => organization.id === invite.organizationId);
      setOrganizations((current) =>
        current.map((organization) =>
          organization.id === invite.organizationId
            ? { ...organization, pendingInviteCount: organization.pendingInviteCount + 1 }
            : organization
        )
      );
      setInviteEmail("");
      setSuccessText(`已向 ${invite.email} 发送邀请，归属组织为 ${targetOrganization?.name ?? invite.organizationId}。`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "发送邀请失败");
    } finally {
      setSendingInvite(false);
    }
  }

  async function handleSaveOrganization() {
    if (!editingOrganization) return;
    const nextName = editingOrganizationName.trim();
    if (!nextName) {
      setErrorText("请输入组织名称。");
      setSuccessText("");
      return;
    }
    setSavingOrganization(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await patchAdminCustomerOrganization(editingOrganization.id, {
        name: nextName,
        status: editingOrganizationStatus
      });
      setOrganizations((current) => upsertOrganization(current, response.organization));
      setEditingOrganizationId(null);
      setSuccessText(`已更新客户组织 ${response.organization.name}。`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "更新客户组织失败");
    } finally {
      setSavingOrganization(false);
    }
  }

  const columns = [
    {
      title: "用户信息",
      dataIndex: "info",
      key: "info",
      width: 280,
      render: (_: unknown, record: AdminUser) => (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <strong style={{ color: "var(--admin-color-text)", fontSize: 14 }}>{userDisplayTitle(record)}</strong>
          <span style={{ color: "var(--admin-color-subtle)", fontSize: 13 }}>{userContact(record)}</span>
          <span style={{ color: "var(--admin-color-subtle)", fontSize: 12 }}>{userTypeLabel(userSource(record).userType)}</span>
        </div>
      )
    },
    {
      title: "身份源",
      dataIndex: "identity",
      key: "identity",
      width: 220,
      render: (_: unknown, record: AdminUser) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Space size={[4, 4]} wrap>
            {userIdentitySources(record).length ? (
              userIdentitySources(record).map((label) => (
                <Tag key={label} color="blue" style={{ borderRadius: 12, margin: 0 }}>
                  {label}
                </Tag>
              ))
            ) : (
              <span style={{ color: "var(--admin-color-subtle)", fontSize: 12 }}>未绑定登录源</span>
            )}
          </Space>
          {record.synced.dingtalkUserId ? (
            <span style={{ color: "var(--admin-color-subtle)", fontSize: 12 }}>钉钉 ID: {record.synced.dingtalkUserId}</span>
          ) : null}
        </div>
      )
    },
    {
      title: "组织成员关系",
      dataIndex: "organizations",
      key: "organizations",
      width: 260,
      render: (_: unknown, record: AdminUser) => (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ color: "var(--admin-color-text)", fontSize: 13 }}>{userOrganizationSummary(record)}</span>
          <span style={{ color: "var(--admin-color-subtle)", fontSize: 12 }}>
            主部门: {record.synced.primaryDepartmentId || "未设置"}
          </span>
        </div>
      )
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 160,
      render: (_: unknown, record: AdminUser) => (
        <Space size={4} wrap>
          <Tag color={record.effective.status === "active" ? "success" : "warning"} style={{ borderRadius: 12 }}>
            {formatUserStatus(record.effective.status)}
          </Tag>
          {record.local.manualDisabled ? (
            <Tag color="error" style={{ borderRadius: 12 }}>
              手动禁用
            </Tag>
          ) : null}
        </Space>
      )
    },
    {
      title: "角色",
      dataIndex: "role",
      key: "role",
      width: 200,
      render: (_: unknown, record: AdminUser) => (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 14 }}>{userPrimaryRole(record)}</span>
          <span style={{ color: "var(--admin-color-subtle)", fontSize: 12 }}>
            {record.assignedRoles.map((item) => item.slug).join(", ") || "未分配系统角色"}
          </span>
        </div>
      )
    },
    {
      title: "最后同步",
      dataIndex: "sync",
      key: "sync",
      width: 180,
      render: (_: unknown, record: AdminUser) => (
        <span style={{ color: "var(--admin-color-subtle)", fontSize: 13 }}>
          {formatLocalTime(record.effective.lastSyncedAt)}
        </span>
      )
    },
    {
      title: "操作",
      key: "actions",
      width: 120,
      fixed: "right" as const,
      render: (_: unknown, record: AdminUser) => (
        <Space size="small">
          <Tooltip title="编辑用户">
            <Button type="text" icon={<Edit size={16} />} onClick={() => openEditor(record)} />
          </Tooltip>
          <Tooltip title="分配角色">
            <Button type="text" icon={<Shield size={16} />} onClick={() => setRoleEditorUserId(record.id)} />
          </Tooltip>
        </Space>
      )
    }
  ];

  return (
    <>
    <div className="admin-page-container" style={{ display: "flex", flexDirection: "column", height: "100%", gap: 0, paddingBottom: 0 }}>
      <div style={{ flex: "none", marginBottom: 16 }}>
        <div className="admin-page-header" style={{ paddingBottom: 16 }}>
          <div>
            <h1 className="admin-page-title">用户治理</h1>
            <p className="admin-page-desc">平台所有成员的管理和外部组织邀请等维护工作。</p>
          </div>
          <Space wrap>
            <Tag color="blue" style={{ borderRadius: "var(--admin-radius-full)" }}>
              {activeTab === "users" ? `筛选命中 ${filteredUsers.length} 人` : `当前 ${organizations.length} 个客户组织`}
            </Tag>
          </Space>
        </div>
        <Tabs 
          activeKey={activeTab} 
          onChange={(k) => setActiveTab(k as "users" | "orgs")} 
          items={[
            { key: "users", label: "成员列表" },
            { key: "orgs", label: "客户组织与邀请" }
          ]}
          style={{ marginBottom: -16 }}
        />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        {errorText ? <Alert type="error" showIcon message={errorText} style={{ marginBottom: 16, flexShrink: 0 }} /> : null}
        {successText ? <Alert type="success" showIcon message={successText} style={{ marginBottom: 16, flexShrink: 0 }} /> : null}

        <div style={{ display: activeTab === "users" ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0 }}>
          <div className="admin-page-summary-grid">
            {summaryItems.map((item) => (
              <section key={item.label} className="admin-page-summary-card">
                <div className="admin-page-summary-label">{item.label}</div>
                <div className="admin-page-summary-value">{item.value}</div>
                <div className="admin-page-summary-meta">{item.meta}</div>
              </section>
            ))}
          </div>

        </div>

        <div style={{ display: activeTab === "orgs" ? "block" : "none" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isNarrowScreen ? "1fr" : "minmax(0, 1fr) minmax(0, 1fr)",
              gap: 16,
              marginBottom: 16
            }}
          >
        <section className="admin-page-summary-card" aria-label="创建客户组织">
          <div className="admin-page-summary-label">创建客户组织</div>
          <div className="admin-page-summary-meta" style={{ marginBottom: 16 }}>
            组织名称由内部管理员维护，外部用户只会被加入到这里选择的组织中。
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Input
              placeholder="例如：Indosat 项目组"
              value={newOrganizationName}
              onChange={(event) => setNewOrganizationName(event.target.value)}
            />
            <Select
              value={newOrganizationStatus}
              onChange={setNewOrganizationStatus}
              options={[
                { value: "active", label: "启用中" },
                { value: "disabled", label: "已停用" }
              ]}
            />
            <Button type="primary" onClick={() => void handleCreateOrganization()} loading={creatingOrganization}>
              创建客户组织
            </Button>
          </div>
        </section>

        <section className="admin-page-summary-card" aria-label="邀请外部用户">
          <div className="admin-page-summary-label">邀请外部用户</div>
          <div className="admin-page-summary-meta" style={{ marginBottom: 16 }}>
            选择目标客户组织后发送邀请邮件，首次登录会完成账号创建和组织加入。
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Select
              placeholder="选择目标客户组织"
              value={inviteOrganizationId || undefined}
              onChange={setInviteOrganizationId}
              options={organizations.map((organization) => ({
                value: organization.id,
                label: organizationLabel(organization)
              }))}
              disabled={!organizations.length}
            />
            <Input
              type="email"
              placeholder="customer@example.com"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              disabled={!organizations.length}
            />
            <Select
              value={inviteMembershipType}
              onChange={setInviteMembershipType}
              options={[
                { value: "customer_member", label: "客户成员" },
                { value: "customer_admin", label: "客户管理员" }
              ]}
              disabled={!organizations.length}
            />
            <Button
              type="primary"
              onClick={() => void handleSendInvite()}
              loading={sendingInvite}
              disabled={!organizations.length}
            >
              发送邀请
            </Button>
          </div>
        </section>
      </div>

      <section className="admin-page-summary-card" style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: isNarrowScreen ? "stretch" : "center",
            flexDirection: isNarrowScreen ? "column" : "row",
            gap: 12,
            marginBottom: 16
          }}
        >
          <div>
            <div className="admin-page-summary-label">客户组织维护</div>
            <div className="admin-page-summary-meta">创建、改名和停用都在这里执行，邀请时只能引用已存在的组织。</div>
          </div>
          <Tag color="cyan" style={{ borderRadius: "var(--admin-radius-full)", margin: 0 }}>
            当前 {organizations.length} 个客户组织
          </Tag>
        </div>

        {organizations.length === 0 ? (
          <Empty description="还没有客户组织，请先创建组织后再邀请外部用户。" />
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isNarrowScreen ? "1fr" : "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 12
            }}
          >
            {organizations.map((organization) => (
              <section
                key={organization.id}
                className="admin-entity-card"
                style={{
                  border: "1px solid var(--admin-color-border)",
                  borderRadius: "var(--admin-radius-card)",
                  padding: 16,
                  background: "var(--admin-color-panel)"
                }}
              >
                <div className="admin-entity-card-head" style={{ marginBottom: 12 }}>
                  <div>
                    <strong style={{ display: "block", fontSize: 15, color: "var(--admin-color-text)" }}>
                      {organization.name}
                    </strong>
                    <div className="admin-entity-card-subtle">{organization.slug}</div>
                  </div>
                  <Tag color={organizationStatusColor(organization.status)} style={{ borderRadius: 12, margin: 0 }}>
                    {formatOrganizationStatus(organization.status)}
                  </Tag>
                </div>

                <div className="admin-entity-card-grid">
                  <div>
                    <div className="admin-entity-card-subtle">有效成员</div>
                    <strong>{organization.memberCount}</strong>
                  </div>
                  <div>
                    <div className="admin-entity-card-subtle">待处理邀请</div>
                    <strong>{organization.pendingInviteCount}</strong>
                  </div>
                  <div>
                    <div className="admin-entity-card-subtle">创建时间</div>
                    <strong>{formatLocalTime(organization.createdAt)}</strong>
                  </div>
                  <div>
                    <div className="admin-entity-card-subtle">最近更新</div>
                    <strong>{formatLocalTime(organization.updatedAt)}</strong>
                  </div>
                </div>

                <div className="admin-entity-card-actions">
                  <Button block onClick={() => openOrganizationEditor(organization)}>
                    修改组织
                  </Button>
                  <Button
                    block
                    type="primary"
                    onClick={() => {
                      setInviteOrganizationId(organization.id);
                      setSuccessText(`已将邀请表单目标组织切换为 ${organization.name}。`);
                      setErrorText("");
                    }}
                  >
                    邀请到此组织
                  </Button>
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    </div>

    {/* User list table wrapper moved inside users tab above */}
    {activeTab === "users" && (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: isNarrowScreen ? 420 : 0,
          padding: 0,
          background: "transparent",
          marginTop: 16
        }}
      >
        <div
          style={{
            padding: isNarrowScreen ? "16px" : "16px 24px",
            borderBottom: "1px solid var(--admin-color-border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: isNarrowScreen ? "stretch" : "center",
            gap: 12,
            flexWrap: "wrap"
          }}
        >
          <Input
            prefix={<Search size={16} style={{ color: "var(--admin-color-subtle)" }} />}
            placeholder="搜索姓名、邮箱、组织、钉钉 ID..."
            value={filterText}
            onChange={(event) => setFilterText(event.target.value)}
            allowClear
            style={{ width: isNarrowScreen ? "100%" : 320, borderRadius: "var(--admin-radius-full)" }}
          />
          <span style={{ color: "var(--admin-color-subtle)", fontSize: 13 }}>共 {users.length} 名用户</span>
        </div>

        <div style={{ flex: 1, overflow: isNarrowScreen ? "auto" : "hidden" }}>
          {isNarrowScreen ? (
            loading ? (
              <div style={{ padding: 32, textAlign: "center", color: "var(--admin-color-subtle)" }}>加载中...</div>
            ) : filteredUsers.length === 0 ? (
              <Empty description="没有符合筛选条件的用户" style={{ padding: 32 }} />
            ) : (
              <div className="admin-entity-list">
                {filteredUsers.map((user) => (
                  <section key={user.id} className="admin-entity-card">
                    <div className="admin-entity-card-head">
                      <div>
                        <strong style={{ display: "block", fontSize: 15, color: "var(--admin-color-text)" }}>
                          {userDisplayTitle(user)}
                        </strong>
                        <div className="admin-entity-card-subtle">{userContact(user)}</div>
                      </div>
                      <Space size={[4, 4]} wrap>
                        <Tag color={user.effective.status === "active" ? "success" : "warning"} style={{ borderRadius: 12, margin: 0 }}>
                          {formatUserStatus(user.effective.status)}
                        </Tag>
                        {user.local.manualDisabled ? (
                          <Tag color="error" style={{ borderRadius: 12, margin: 0 }}>
                            手动禁用
                          </Tag>
                        ) : null}
                      </Space>
                    </div>

                    <div className="admin-entity-card-grid">
                      <div>
                        <div className="admin-entity-card-subtle">用户类型</div>
                        <strong>{userTypeLabel(userSource(user).userType)}</strong>
                      </div>
                      <div>
                        <div className="admin-entity-card-subtle">身份源</div>
                        <strong>{userIdentitySources(user).join(" / ") || "未绑定"}</strong>
                      </div>
                      <div>
                        <div className="admin-entity-card-subtle">组织成员</div>
                        <strong>{userOrganizationSummary(user)}</strong>
                      </div>
                      <div>
                        <div className="admin-entity-card-subtle">主角色</div>
                        <strong>{userPrimaryRole(user)}</strong>
                      </div>
                      <div>
                        <div className="admin-entity-card-subtle">主部门</div>
                        <strong>{user.synced.primaryDepartmentId || "未设置"}</strong>
                      </div>
                      <div>
                        <div className="admin-entity-card-subtle">最后同步</div>
                        <strong>{formatLocalTime(user.effective.lastSyncedAt)}</strong>
                      </div>
                    </div>

                    <div className="admin-entity-card-actions">
                      <Button block onClick={() => openEditor(user)} style={{ borderRadius: "var(--admin-radius-full)" }}>
                        编辑用户
                      </Button>
                      <Button
                        block
                        type="primary"
                        onClick={() => setRoleEditorUserId(user.id)}
                        style={{ borderRadius: "var(--admin-radius-full)" }}
                      >
                        分配角色
                      </Button>
                    </div>
                  </section>
                ))}
              </div>
            )
          ) : (
            <Table
              columns={columns}
              dataSource={filteredUsers}
              rowKey="id"
              pagination={false}
              loading={loading}
              scroll={{ y: "calc(100vh - 380px)", x: 1260 }}
              virtual
              size="middle"
              rowClassName={() => "admin-table-row-hover"}
            />
          )}
        </div>
      </div>
    )}
    </div>
  </div>

      <Drawer
        title="编辑用户设置"
        placement="right"
        width={isNarrowScreen ? "100%" : 400}
        onClose={() => setEditingUserId(null)}
        open={Boolean(editingUser)}
        footer={
          <Space style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button onClick={() => setEditingUserId(null)} disabled={saving}>
              取消
            </Button>
            <Button type="primary" onClick={handleSave} loading={saving}>
              保存更改
            </Button>
          </Space>
        }
      >
        {editingUser ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div>
              <div style={{ marginBottom: 12 }}>
                <strong style={{ display: "block", fontSize: 15 }}>{userDisplayTitle(editingUser)}</strong>
                <span style={{ color: "var(--admin-color-subtle)", fontSize: 13 }}>{userContact(editingUser)}</span>
                <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <Tag color="blue" style={{ borderRadius: 12, margin: 0 }}>
                    {userTypeLabel(userSource(editingUser).userType)}
                  </Tag>
                  {userIdentitySources(editingUser).map((label) => (
                    <Tag key={label} color="geekblue" style={{ borderRadius: 12, margin: 0 }}>
                      {label}
                    </Tag>
                  ))}
                </div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>基础角色</div>
              <Select
                value={role}
                onChange={setRole}
                style={{ width: "100%" }}
                options={[
                  { value: "employee", label: "普通员工 (Employee)" },
                  { value: "admin", label: "系统管理员 (Admin)" }
                ]}
              />
              <div style={{ fontSize: 13, color: "var(--admin-color-subtle)", marginTop: 4 }}>
                控制该用户的基础系统权限和管理后台入口可见性。
              </div>
            </div>

            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 500 }}>手动禁用账号</span>
                <Switch checked={manualDisabled} onChange={setManualDisabled} />
              </div>
              <div style={{ fontSize: 13, color: "var(--admin-color-subtle)" }}>
                启用后将阻止该用户发起任何新会话或访问系统核心资源。
              </div>
            </div>

            <div>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>管理备注</div>
              <Input.TextArea
                value={adminNote}
                onChange={(event) => setAdminNote(event.target.value)}
                rows={4}
                placeholder="记录禁用原因或权限调整说明..."
              />
            </div>
          </div>
        ) : null}
      </Drawer>

      <Drawer
        title="编辑客户组织"
        placement="right"
        width={isNarrowScreen ? "100%" : 400}
        onClose={() => setEditingOrganizationId(null)}
        open={Boolean(editingOrganization)}
        footer={
          <Space style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button onClick={() => setEditingOrganizationId(null)} disabled={savingOrganization}>
              取消
            </Button>
            <Button type="primary" onClick={() => void handleSaveOrganization()} loading={savingOrganization}>
              保存组织
            </Button>
          </Space>
        }
      >
        {editingOrganization ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div>
              <div style={{ marginBottom: 8, fontSize: 14, fontWeight: 500 }}>组织名称</div>
              <Input value={editingOrganizationName} onChange={(event) => setEditingOrganizationName(event.target.value)} />
              <div style={{ marginTop: 6, color: "var(--admin-color-subtle)", fontSize: 12 }}>
                Slug 固定为 {editingOrganization.slug}，邀请时将继续引用这个组织。
              </div>
            </div>

            <div>
              <div style={{ marginBottom: 8, fontSize: 14, fontWeight: 500 }}>组织状态</div>
              <Select
                value={editingOrganizationStatus}
                onChange={setEditingOrganizationStatus}
                style={{ width: "100%" }}
                options={[
                  { value: "active", label: "启用中" },
                  { value: "disabled", label: "已停用" }
                ]}
              />
            </div>

            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
              <div>
                <div className="admin-entity-card-subtle">有效成员</div>
                <strong>{editingOrganization.memberCount}</strong>
              </div>
              <div>
                <div className="admin-entity-card-subtle">待处理邀请</div>
                <strong>{editingOrganization.pendingInviteCount}</strong>
              </div>
              <div>
                <div className="admin-entity-card-subtle">创建时间</div>
                <strong>{formatLocalTime(editingOrganization.createdAt)}</strong>
              </div>
              <div>
                <div className="admin-entity-card-subtle">最近更新</div>
                <strong>{formatLocalTime(editingOrganization.updatedAt)}</strong>
              </div>
            </div>
          </div>
        ) : null}
      </Drawer>

      {roleEditorUserId ? (
        <UserRoleEditor
          userId={roleEditorUserId}
          onSaved={() => setRoleEditorUserId(null)}
          onCancel={() => setRoleEditorUserId(null)}
        />
      ) : null}
    </>
  );
}
