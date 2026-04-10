import { Edit, Search, Shield } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Drawer, Empty, Input, Select, Space, Switch, Table, Tag, Tooltip } from "antd";

import { useIsNarrowScreen } from "../../lib/use-is-narrow-screen";
import { UserRoleEditor } from "../rbac/UserRoleEditor";
import { fetchAdminUsers, patchAdminUserLocalSettings } from "./api";
import type { AdminUser } from "./types";

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

function userDisplayTitle(user: AdminUser): string {
  return user.synced.displayName || user.synced.email || user.id;
}

function userContact(user: AdminUser): string {
  return user.synced.email || user.synced.dingtalkUserId || "未绑定邮箱";
}

function userPrimaryRole(user: AdminUser): string {
  return user.primaryRole?.name || user.local.role;
}

export function UsersView() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [filterText, setFilterText] = useState("");
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [role, setRole] = useState("employee");
  const [manualDisabled, setManualDisabled] = useState(false);
  const [adminNote, setAdminNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [roleEditorUserId, setRoleEditorUserId] = useState<string | null>(null);
  const isNarrowScreen = useIsNarrowScreen(980);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setErrorText("");
      try {
        const response = await fetchAdminUsers();
        if (active) {
          setUsers(response.users);
        }
      } catch (error) {
        if (active) setErrorText(error instanceof Error ? error.message : "加载用户失败");
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

  const filteredUsers = useMemo(() => {
    const query = filterText.trim().toLowerCase();
    if (!query) return users;
    return users.filter((user) => {
      const haystack = [
        user.id,
        user.synced.displayName ?? "",
        user.synced.email ?? "",
        user.synced.dingtalkUserId ?? "",
        ...user.synced.departmentIds
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [filterText, users]);

  const summaryItems = useMemo(() => {
    const activeCount = users.filter((user) => user.effective.status === "active").length;
    const manualDisabledCount = users.filter((user) => user.local.manualDisabled).length;
    const assignedRoleCount = users.filter((user) => user.assignedRoles.length > 0).length;

    return [
      {
        label: "总用户数",
        value: String(users.length),
        meta: filterText.trim() ? `当前筛选命中 ${filteredUsers.length} 人` : "当前租户内全部成员"
      },
      {
        label: "正常可用",
        value: String(activeCount),
        meta: "包含可以发起会话的成员"
      },
      {
        label: "手动禁用",
        value: String(manualDisabledCount),
        meta: "被管理员显式关闭访问的成员"
      },
      {
        label: "已绑定系统角色",
        value: String(assignedRoleCount),
        meta: "已配置 RBAC 角色分配"
      }
    ];
  }, [filterText, filteredUsers.length, users]);

  function openEditor(user: AdminUser) {
    setEditingUserId(user.id);
    setRole(user.local.role);
    setManualDisabled(user.local.manualDisabled);
    setAdminNote(user.local.adminNote ?? "");
  }

  async function handleSave() {
    if (!editingUser) return;
    setSaving(true);
    setErrorText("");
    try {
      const response = await patchAdminUserLocalSettings(editingUser.id, {
        role,
        manualDisabled,
        adminNote: adminNote.trim() || null
      });
      setUsers((current) => current.map((item) => (item.id === editingUser.id ? response.user : item)));
      setEditingUserId(null);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存用户设置失败");
    } finally {
      setSaving(false);
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
      title: "主部门",
      dataIndex: "department",
      key: "department",
      width: 160,
      render: (_: unknown, record: AdminUser) => (
        <span style={{ color: "var(--admin-color-text)" }}>{record.synced.primaryDepartmentId || "未设置"}</span>
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
    <div className="admin-page-container">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">用户治理</h1>
          <p className="admin-page-desc">管理用户状态、身份资料与本地治理字段。</p>
        </div>
        <Space wrap>
          <Tag color="blue" style={{ borderRadius: "var(--admin-radius-full)" }}>
            筛选结果 {filteredUsers.length} 人
          </Tag>
        </Space>
      </div>

      <div className="admin-page-summary-grid">
        {summaryItems.map((item) => (
          <section key={item.label} className="admin-page-summary-card">
            <div className="admin-page-summary-label">{item.label}</div>
            <div className="admin-page-summary-value">{item.value}</div>
            <div className="admin-page-summary-meta">{item.meta}</div>
          </section>
        ))}
      </div>

      {errorText ? <Alert type="error" showIcon message={errorText} /> : null}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: isNarrowScreen ? 420 : 0,
          padding: 0,
          background: "transparent",
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
            placeholder="搜索姓名、邮箱、钉钉 ID..."
            value={filterText}
            onChange={(event) => setFilterText(event.target.value)}
            allowClear
            style={{ width: isNarrowScreen ? "100%" : 320, borderRadius: "var(--admin-radius-full)" }}
          />
          <span style={{ color: "var(--admin-color-subtle)", fontSize: 13 }}>
            共 {users.length} 名用户
          </span>
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
                        <div className="admin-entity-card-subtle">主角色</div>
                        <strong>{userPrimaryRole(user)}</strong>
                      </div>
                      <div>
                        <div className="admin-entity-card-subtle">系统角色</div>
                        <strong>{user.assignedRoles.map((item) => item.slug).join(", ") || "未分配"}</strong>
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
              scroll={{ y: "calc(100vh - 320px)", x: 1060 }}
              virtual
              size="middle"
              rowClassName={() => "admin-table-row-hover"}
            />
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

      {roleEditorUserId ? (
        <UserRoleEditor
          userId={roleEditorUserId}
          onSaved={() => setRoleEditorUserId(null)}
          onCancel={() => setRoleEditorUserId(null)}
        />
      ) : null}
    </div>
  );
}
