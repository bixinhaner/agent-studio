import { Edit, Search, Shield } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Drawer, Empty, Input, Segmented, Select, Space, Switch, Table, Tabs, Tag, Tooltip } from "antd";

import { useIsNarrowScreen } from "../../lib/use-is-narrow-screen";
import { UserRoleEditor } from "../rbac/UserRoleEditor";
import {
  createAdminCustomerOrganization,
  createAdminOrganizationInvite,
  fetchAdminCustomerOrganizations,
  fetchDepartmentTree,
  fetchAdminUsers,
  patchAdminCustomerOrganization,
  patchAdminUserLocalSettings
} from "./api";
import type { AdminCustomerOrganization, AdminDepartmentNode, AdminUser } from "./types";

type UserScope = "active" | "internal" | "brandEmployee" | "external" | "dingtalkOnly" | "disabled" | "all";
type LoginFilter = "all" | "loggedIn" | "neverLoggedIn";
type StatusFilter = "all" | "active" | "disabled" | "manualDisabled";

const ALL_OWNERSHIP_FILTER = "__all__";

const USER_SCOPE_OPTIONS: Array<{ value: UserScope; label: string }> = [
  { value: "active", label: "激活用户" },
  { value: "internal", label: "内部账号" },
  { value: "brandEmployee", label: "品牌员工" },
  { value: "external", label: "外部客户" },
  { value: "dingtalkOnly", label: "仅钉钉同步" },
  { value: "disabled", label: "已停用" },
  { value: "all", label: "全部人员" }
];

function userSource(user: AdminUser) {
  return user.source ?? {
    userType: "internal_employee",
    primaryOrganizationId: null,
    identities: [],
    organizations: []
  };
}

function userEnterprise(user: AdminUser): AdminUser["enterprise"] {
  return user.enterprise ?? {
    title: null,
    employeeNo: null,
    mobileMasked: null,
    telephoneMasked: null,
    avatarUrl: null,
    workPlace: null,
    hiredAt: null,
    manager: null,
    isAdmin: null,
    isBoss: null,
    isLeader: null,
    departmentPositions: [],
    lastSyncedAt: null
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

function brandEmployeeMembership(user: AdminUser) {
  return userSource(user).organizations.find(
    (membership) => membership.membershipType === "brand_employee" && membership.status === "active"
  );
}

function userAudienceLabel(user: AdminUser): string {
  return brandEmployeeMembership(user) ? "品牌员工" : userTypeLabel(userSource(user).userType);
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
      return "Admin";
    case "customer_member":
      return "User";
    case "brand_employee":
      return "品牌员工";
    default:
      return membershipType || "未命名成员";
  }
}

function userDisplayTitle(user: AdminUser): string {
  return user.synced.displayName || user.synced.email || "未命名用户";
}

function userContact(user: AdminUser): string {
  const source = userSource(user);
  return (
    user.synced.email ||
    source.identities.find((identity) => identity.email)?.email ||
    "未绑定邮箱"
  );
}

function userPrimaryRole(user: AdminUser): string {
  if (user.primaryRole?.name) {
    return user.primaryRole.name;
  }
  if (user.local.role === "employee") {
    if (brandEmployeeMembership(user)) return "品牌员工";
    return userSource(user).userType === "external_user" ? "User" : "员工";
  }
  if (user.local.role === "admin") {
    return "管理员";
  }
  if (user.local.role === "super_admin") {
    return "超级管理员";
  }
  return user.local.role;
}

function userIdentitySources(user: AdminUser): string[] {
  const source = userSource(user);
  return [...new Set(source.identities.map((identity) => providerLabel(identity.provider)).filter(Boolean))];
}

function hasUserLoggedIn(user: AdminUser): boolean {
  return userSource(user).identities.some((identity) => Boolean(identity.lastLoginAt));
}

function loginStateLabel(user: AdminUser): string {
  return hasUserLoggedIn(user) ? "已登录" : "从未登录";
}

function isUserDisabled(user: AdminUser): boolean {
  return user.effective.status !== "active" || user.local.manualDisabled;
}

function isDingTalkSyncOnlyUser(user: AdminUser): boolean {
  return userSource(user).userType === "internal_employee" && Boolean(user.synced.dingtalkUserId) && !hasUserLoggedIn(user);
}

function matchesUserScope(user: AdminUser, scope: UserScope): boolean {
  const source = userSource(user);
  const disabled = isUserDisabled(user);
  const dingtalkOnly = isDingTalkSyncOnlyUser(user);

  switch (scope) {
    case "active":
      return !disabled && !dingtalkOnly;
    case "internal":
      return source.userType === "internal_employee" && !disabled && !dingtalkOnly;
    case "brandEmployee":
      return Boolean(brandEmployeeMembership(user)) && !disabled;
    case "external":
      return source.userType === "external_user" && !brandEmployeeMembership(user) && !disabled;
    case "dingtalkOnly":
      return !disabled && dingtalkOnly;
    case "disabled":
      return disabled;
    case "all":
      return true;
    default:
      return true;
  }
}

function matchesLoginFilter(user: AdminUser, loginFilter: LoginFilter): boolean {
  if (loginFilter === "all") return true;
  const loggedIn = hasUserLoggedIn(user);
  return loginFilter === "loggedIn" ? loggedIn : !loggedIn;
}

function matchesStatusFilter(user: AdminUser, statusFilter: StatusFilter): boolean {
  if (statusFilter === "all") return true;
  if (statusFilter === "active") return !isUserDisabled(user);
  if (statusFilter === "disabled") return isUserDisabled(user);
  return user.local.manualDisabled;
}

function matchesOwnershipFilter(user: AdminUser, ownershipFilter: string): boolean {
  if (ownershipFilter === ALL_OWNERSHIP_FILTER) return true;
  if (ownershipFilter.startsWith("department:")) {
    const departmentId = ownershipFilter.slice("department:".length);
    return user.synced.departmentIds.includes(departmentId);
  }
  if (ownershipFilter.startsWith("organization:")) {
    const organizationId = ownershipFilter.slice("organization:".length);
    return userSource(user).organizations.some((membership) => membership.organizationId === organizationId);
  }
  return true;
}

function userOrganizationSummary(user: AdminUser): string {
  const source = userSource(user);
  if (!source.organizations.length) {
    return "未加入组织";
  }
  const visible = source.organizations.slice(0, 2).map((membership) => {
    if (membership.membershipType === "brand_employee") {
      return `${membership.publicBrandName || membership.organizationName || "品牌"} · 品牌员工`;
    }
    const organizationName = membership.organizationName || (membership.organizationType === "internal" ? "内部组织" : "未命名组织");
    return `${organizationName} · ${membershipTypeLabel(membership.membershipType)}`;
  });
  const extra = source.organizations.length - visible.length;
  return extra > 0 ? `${visible.join(" / ")} +${extra}` : visible.join(" / ");
}

function organizationLabel(organization: AdminCustomerOrganization): string {
  return organization.name || "未命名组织";
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

function departmentDisplayLabel(department: AdminDepartmentNode): string {
  return department.name.trim() || "未命名部门";
}

function buildDepartmentDisplayMap(
  departments: AdminDepartmentNode[],
  map = new Map<string, string>()
): Map<string, string> {
  for (const department of departments) {
    const id = department.id.trim();
    const externalId = department.externalId.trim();
    const displayLabel = departmentDisplayLabel(department);
    if (id) {
      map.set(id, displayLabel);
    }
    if (externalId) {
      map.set(externalId, displayLabel);
    }
    if (department.children.length > 0) {
      buildDepartmentDisplayMap(department.children, map);
    }
  }
  return map;
}

function resolveDepartmentLabel(
  departmentId: string | null | undefined,
  departmentDisplayMap: Map<string, string>
): string {
  const normalizedDepartmentId = departmentId?.trim();
  if (!normalizedDepartmentId) return "未设置";
  return departmentDisplayMap.get(normalizedDepartmentId) || "未知部门";
}

function formatDepartmentList(
  departmentIds: string[],
  resolveLabel: (departmentId: string | null | undefined) => string
): string {
  const labels = [
    ...new Set(
      departmentIds
        .map((departmentId) => resolveLabel(departmentId))
        .map((label) => label.trim())
        .filter(Boolean)
    )
  ];
  return labels.length ? labels.join(" / ") : "未设置";
}

function userManagerLabel(user: AdminUser): string {
  const manager = userEnterprise(user).manager;
  return manager?.displayName || manager?.email || "未同步上级";
}

function userEnterpriseTags(user: AdminUser): string[] {
  const enterprise = userEnterprise(user);
  return [
    enterprise.isAdmin ? "钉钉管理员" : null,
    enterprise.isBoss ? "主管" : null,
    enterprise.isLeader ? "部门负责人" : null
  ].filter((item): item is string => Boolean(item));
}

function formatDepartmentPosition(
  position: AdminUser["enterprise"]["departmentPositions"][number],
  resolveLabel: (departmentId: string | null | undefined) => string
): string {
  const departmentName = resolveLabel(position.departmentId);
  const role = position.position?.trim();
  const prefix = position.isPrimary ? "主部门" : "部门";
  const leaderSuffix = position.isLeader ? " · 负责人" : "";
  return `${prefix}: ${departmentName}${role ? ` · ${role}` : ""}${leaderSuffix}`;
}

function userPrimaryDepartmentPosition(
  user: AdminUser,
  resolveLabel: (departmentId: string | null | undefined) => string
): string {
  const enterprise = userEnterprise(user);
  const primaryPosition =
    enterprise.departmentPositions.find((position) => position.isPrimary) ?? enterprise.departmentPositions[0];
  if (primaryPosition) {
    return formatDepartmentPosition(primaryPosition, resolveLabel);
  }
  return `主部门: ${resolveLabel(user.synced.primaryDepartmentId)}`;
}

function collectDepartmentFilterOptions(departments: AdminDepartmentNode[]): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [];
  const seen = new Set<string>();

  function visit(items: AdminDepartmentNode[]) {
    for (const department of items) {
      const value = department.externalId.trim() || department.id.trim();
      if (value && !seen.has(value)) {
        seen.add(value);
        options.push({
          value: `department:${value}`,
          label: `部门 · ${departmentDisplayLabel(department)}`
        });
      }
      if (department.children.length > 0) {
        visit(department.children);
      }
    }
  }

  visit(departments);
  return options;
}

function collectOrganizationFilterOptions(
  users: AdminUser[],
  organizations: AdminCustomerOrganization[]
): Array<{ value: string; label: string }> {
  const options = new Map<string, string>();

  for (const organization of organizations) {
    options.set(organization.id, `组织 · ${organizationLabel(organization)}`);
  }

  for (const user of users) {
    for (const membership of userSource(user).organizations) {
      if (!options.has(membership.organizationId)) {
        const name = membership.organizationName || (membership.organizationType === "internal" ? "内部组织" : "未命名组织");
        options.set(membership.organizationId, `组织 · ${name}`);
      }
    }
  }

  return Array.from(options.entries())
    .map(([organizationId, label]) => ({ value: `organization:${organizationId}`, label }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function UsersView() {
  const [activeTab, setActiveTab] = useState<"users" | "orgs">("users");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [organizations, setOrganizations] = useState<AdminCustomerOrganization[]>([]);
  const [departments, setDepartments] = useState<AdminDepartmentNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");
  const [filterText, setFilterText] = useState("");
  const [userScope, setUserScope] = useState<UserScope>("active");
  const [loginFilter, setLoginFilter] = useState<LoginFilter>("all");
  const [ownershipFilter, setOwnershipFilter] = useState(ALL_OWNERSHIP_FILTER);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
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
  const tableScrollY = typeof window === "undefined" ? 520 : Math.max(360, window.innerHeight - 380);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setErrorText("");
      try {
        const [userResponse, organizationResponse, departmentResponse] = await Promise.all([
          fetchAdminUsers(),
          fetchAdminCustomerOrganizations(),
          fetchDepartmentTree().catch(() => ({ departments: [] as AdminDepartmentNode[] }))
        ]);
        if (!active) return;
        setUsers(userResponse.users);
        setOrganizations(organizationResponse.organizations);
        setDepartments(departmentResponse.departments);
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
  const departmentDisplayMap = useMemo(() => buildDepartmentDisplayMap(departments), [departments]);
  const resolveDepartmentLabelFromMap = useMemo(
    () => (departmentId: string | null | undefined) => resolveDepartmentLabel(departmentId, departmentDisplayMap),
    [departmentDisplayMap]
  );
  const ownershipOptions = useMemo(
    () => [
      { value: ALL_OWNERSHIP_FILTER, label: "全部部门/组织" },
      ...collectDepartmentFilterOptions(departments),
      ...collectOrganizationFilterOptions(users, organizations)
    ],
    [departments, organizations, users]
  );
  const scopeCounts = useMemo(() => {
    return USER_SCOPE_OPTIONS.reduce(
      (counts, option) => {
        counts[option.value] = users.filter((user) => matchesUserScope(user, option.value)).length;
        return counts;
      },
      {} as Record<UserScope, number>
    );
  }, [users]);
  const scopeOptions = useMemo(
    () =>
      USER_SCOPE_OPTIONS.map((option) => ({
        value: option.value,
        label: `${option.label} ${scopeCounts[option.value] ?? 0}`
      })),
    [scopeCounts]
  );
  const scopedUsers = useMemo(() => users.filter((user) => matchesUserScope(user, userScope)), [userScope, users]);

  useEffect(() => {
    if (ownershipFilter !== ALL_OWNERSHIP_FILTER && !ownershipOptions.some((option) => option.value === ownershipFilter)) {
      setOwnershipFilter(ALL_OWNERSHIP_FILTER);
    }
  }, [ownershipFilter, ownershipOptions]);

  const filteredUsers = useMemo(() => {
    const query = filterText.trim().toLowerCase();
    return scopedUsers.filter((user) => {
      if (!matchesLoginFilter(user, loginFilter)) return false;
      if (!matchesOwnershipFilter(user, ownershipFilter)) return false;
      if (!matchesStatusFilter(user, statusFilter)) return false;
      if (!query) return true;
      const source = userSource(user);
      const enterprise = userEnterprise(user);
      const haystack = [
        source.userType,
        user.synced.displayName ?? "",
        user.synced.email ?? "",
        enterprise.title ?? "",
        enterprise.employeeNo ?? "",
        enterprise.workPlace ?? "",
        enterprise.manager?.displayName ?? "",
        enterprise.manager?.email ?? "",
        enterprise.mobileMasked ?? "",
        enterprise.telephoneMasked ?? "",
        ...enterprise.departmentPositions.map((position) => position.position ?? ""),
        ...enterprise.departmentPositions.map((position) => resolveDepartmentLabelFromMap(position.departmentId)),
        ...user.synced.departmentIds.map((departmentId) => resolveDepartmentLabelFromMap(departmentId)),
        ...source.identities.map((identity) => `${identity.provider} ${identity.email ?? ""}`),
        ...source.organizations.map((membership) =>
          `${membership.organizationName ?? ""} ${membership.publicBrandName ?? ""} ${membership.publicBrandKey ?? ""} ${membership.membershipType}`
        )
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [filterText, loginFilter, ownershipFilter, resolveDepartmentLabelFromMap, scopedUsers, statusFilter]);

  const editingEnterprise = editingUser ? userEnterprise(editingUser) : null;
  const editingDepartmentPositionLabels = editingUser
    ? userEnterprise(editingUser).departmentPositions
        .map((position) => formatDepartmentPosition(position, resolveDepartmentLabelFromMap))
        .filter(Boolean)
    : [];

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
      setSuccessText(`已向 ${invite.email} 发送邀请，归属组织为 ${targetOrganization?.name ?? "目标组织"}。`);
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
      width: 260,
      render: (_: unknown, record: AdminUser) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <strong style={{ color: "var(--admin-color-text)", fontSize: 14 }}>{userDisplayTitle(record)}</strong>
          <span style={{ color: "var(--admin-color-subtle)", fontSize: 13 }}>{userContact(record)}</span>
          <Space size={[4, 4]} wrap>
            <Tag color={brandEmployeeMembership(record) ? "cyan" : "blue"} style={{ borderRadius: 12, margin: 0 }}>
              {userAudienceLabel(record)}
            </Tag>
            {userIdentitySources(record).map((label) => (
              <Tag key={label} color="geekblue" style={{ borderRadius: 12, margin: 0 }}>
                {label}
              </Tag>
            ))}
            <Tag color={hasUserLoggedIn(record) ? "green" : "default"} style={{ borderRadius: 12, margin: 0 }}>
              {loginStateLabel(record)}
            </Tag>
          </Space>
        </div>
      )
    },
    {
      title: "企业资料",
      dataIndex: "enterprise",
      key: "enterprise",
      width: 240,
      render: (_: unknown, record: AdminUser) => {
        const enterprise = userEnterprise(record);
        const tags = userEnterpriseTags(record);
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ color: "var(--admin-color-text)", fontSize: 13 }}>
              {enterprise.title || "未同步岗位"}
            </span>
            <span style={{ color: "var(--admin-color-subtle)", fontSize: 12 }}>上级: {userManagerLabel(record)}</span>
            {enterprise.workPlace ? (
              <span style={{ color: "var(--admin-color-subtle)", fontSize: 12 }}>地点: {enterprise.workPlace}</span>
            ) : null}
            <Space size={[4, 4]} wrap>
              {tags.map((label) => (
                <Tag key={label} color="cyan" style={{ borderRadius: 12, margin: 0 }}>
                  {label}
                </Tag>
              ))}
              {enterprise.employeeNo ? (
                <Tag color="default" style={{ borderRadius: 12, margin: 0 }}>
                  工号 {enterprise.employeeNo}
                </Tag>
              ) : null}
            </Space>
          </div>
        );
      }
    },
    {
      title: "组织 / 部门",
      dataIndex: "organizations",
      key: "organizations",
      width: 280,
      render: (_: unknown, record: AdminUser) => (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ color: "var(--admin-color-text)", fontSize: 13 }}>{userOrganizationSummary(record)}</span>
          <span style={{ color: "var(--admin-color-subtle)", fontSize: 12 }}>
            {userPrimaryDepartmentPosition(record, resolveDepartmentLabelFromMap)}
          </span>
          <span style={{ color: "var(--admin-color-subtle)", fontSize: 12 }}>
            全部部门: {formatDepartmentList(record.synced.departmentIds, resolveDepartmentLabelFromMap)}
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
                { value: "customer_member", label: "User" },
                { value: "customer_admin", label: "Admin" }
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
            padding: isNarrowScreen ? "10px 12px" : "10px 16px",
            borderBottom: "1px solid var(--admin-color-border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            flexWrap: "nowrap",
            minHeight: 52
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flex: "1 1 auto",
              minWidth: 0,
              overflowX: "auto",
              overflowY: "hidden",
              paddingBottom: 2
            }}
          >
            <Segmented
              size="small"
              value={userScope}
              onChange={(value) => setUserScope(value as UserScope)}
              options={scopeOptions}
              style={{ flex: "0 0 auto" }}
            />
            <Input
              prefix={<Search size={15} style={{ color: "var(--admin-color-subtle)" }} />}
              placeholder="搜索姓名/邮箱/部门/岗位..."
              value={filterText}
              onChange={(event) => setFilterText(event.target.value)}
              allowClear
              style={{ width: isNarrowScreen ? 220 : 260, flex: `0 0 ${isNarrowScreen ? 220 : 260}px`, borderRadius: "var(--admin-radius-full)" }}
            />
            <Select
              size="middle"
              value={loginFilter}
              onChange={(value) => setLoginFilter(value as LoginFilter)}
              options={[
                { value: "all", label: "全部登录状态" },
                { value: "loggedIn", label: "已登录" },
                { value: "neverLoggedIn", label: "从未登录" }
              ]}
              style={{ width: 136, flex: "0 0 136px" }}
            />
            <Select
              size="middle"
              showSearch
              value={ownershipFilter}
              onChange={setOwnershipFilter}
              options={ownershipOptions}
              optionFilterProp="label"
              style={{ width: 190, flex: "0 0 190px" }}
            />
            <Select
              size="middle"
              value={statusFilter}
              onChange={(value) => setStatusFilter(value as StatusFilter)}
              options={[
                { value: "all", label: "全部状态" },
                { value: "active", label: "正常" },
                { value: "disabled", label: "已停用" },
                { value: "manualDisabled", label: "手动禁用" }
              ]}
              style={{ width: 112, flex: "0 0 112px" }}
            />
          </div>
          <Tooltip title={`当前范围 ${scopedUsers.length} 人，筛选命中 ${filteredUsers.length} 人`}>
            <span style={{ color: "var(--admin-color-subtle)", fontSize: 13, flex: "0 0 auto", whiteSpace: "nowrap" }}>
              {filteredUsers.length} / {scopedUsers.length}
            </span>
          </Tooltip>
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
                        <strong>{userAudienceLabel(user)}</strong>
                      </div>
                      <div>
                        <div className="admin-entity-card-subtle">岗位</div>
                        <strong>{userEnterprise(user).title || "未同步岗位"}</strong>
                      </div>
                      <div>
                        <div className="admin-entity-card-subtle">直属上级</div>
                        <strong>{userManagerLabel(user)}</strong>
                      </div>
                      <div>
                        <div className="admin-entity-card-subtle">身份源</div>
                        <strong>{`${userIdentitySources(user).join(" / ") || "未绑定登录源"} · ${loginStateLabel(user)}`}</strong>
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
                        <strong>{userPrimaryDepartmentPosition(user, resolveDepartmentLabelFromMap)}</strong>
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
              scroll={{ y: tableScrollY, x: 1250 }}
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
                    {userAudienceLabel(editingUser)}
                  </Tag>
                  {userIdentitySources(editingUser).map((label) => (
                    <Tag key={label} color="geekblue" style={{ borderRadius: 12, margin: 0 }}>
                      {label}
                    </Tag>
                  ))}
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>企业资料</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <div style={{ color: "var(--admin-color-subtle)", fontSize: 12 }}>岗位</div>
                    <strong>{editingEnterprise?.title || "未同步岗位"}</strong>
                  </div>
                  <div>
                    <div style={{ color: "var(--admin-color-subtle)", fontSize: 12 }}>直属上级</div>
                    <strong>{editingUser ? userManagerLabel(editingUser) : "未同步上级"}</strong>
                  </div>
                  <div>
                    <div style={{ color: "var(--admin-color-subtle)", fontSize: 12 }}>工号</div>
                    <strong>{editingEnterprise?.employeeNo || "未同步"}</strong>
                  </div>
                  <div>
                    <div style={{ color: "var(--admin-color-subtle)", fontSize: 12 }}>工作地点</div>
                    <strong>{editingEnterprise?.workPlace || "未同步"}</strong>
                  </div>
                  <div>
                    <div style={{ color: "var(--admin-color-subtle)", fontSize: 12 }}>联系方式</div>
                    <strong>{editingEnterprise?.mobileMasked || editingEnterprise?.telephoneMasked || "未同步"}</strong>
                  </div>
                  <div>
                    <div style={{ color: "var(--admin-color-subtle)", fontSize: 12 }}>入职时间</div>
                    <strong>{formatLocalTime(editingEnterprise?.hiredAt ?? null)}</strong>
                  </div>
                </div>
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
                  {(editingDepartmentPositionLabels.length ? editingDepartmentPositionLabels : [
                    `主部门: ${resolveDepartmentLabelFromMap(editingUser.synced.primaryDepartmentId)}`
                  ]).map((label) => (
                    <span key={label} style={{ color: "var(--admin-color-subtle)", fontSize: 12 }}>
                      {label}
                    </span>
                  ))}
                </div>
                {editingUser ? (
                  <Space size={[4, 4]} wrap style={{ marginTop: 10 }}>
                    {userEnterpriseTags(editingUser).map((label) => (
                      <Tag key={label} color="cyan" style={{ borderRadius: 12, margin: 0 }}>
                        {label}
                      </Tag>
                    ))}
                  </Space>
                ) : null}
              </div>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>基础角色</div>
              <Select
                value={role}
                onChange={setRole}
                style={{ width: "100%" }}
                options={[
                  {
                    value: "employee",
                    label: userSource(editingUser).userType === "external_user" ? "普通用户 (User)" : "普通员工 (Employee)"
                  },
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
