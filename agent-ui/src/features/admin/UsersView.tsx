import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Input, Space, Spin, Tag, Typography } from "antd";

import { fetchAdminUsers, patchAdminUserLocalSettings } from "./api";
import type { AdminUser } from "./types";
import { UserRoleEditor } from "../rbac/UserRoleEditor";

function formatLocalTime(value: string | null): string {
  if (!value) return "未同步";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
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

  const editingUser = useMemo(
    () => users.find((item) => item.id === editingUserId) ?? null,
    [editingUserId, users]
  );
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

  return (
    <Card className="admin-card antd-admin-card">
      <div className="admin-section-header">
        <div>
          <Typography.Title level={4} className="admin-card-heading">
            用户管理
          </Typography.Title>
          <Typography.Paragraph>只允许编辑本地治理字段，钉钉同步资料保持只读。</Typography.Paragraph>
        </div>
      </div>
      <Input
        aria-label="搜索用户"
        value={filterText}
        onChange={(event) => setFilterText(event.target.value)}
        placeholder="姓名、邮箱、钉钉 ID、部门"
        allowClear
      />
      {loading ? <Spin size="small" /> : null}
      {errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={errorText} /> : null}
      <Space direction="vertical" size={12} className="admin-full-width admin-user-list">
        {filteredUsers.map((user) => {
          const title = user.synced.displayName || user.synced.email || user.id;
          return (
            <Card key={user.id} size="small" className="admin-list-card">
              <div className="admin-list-card-header">
                <div>
                  <Typography.Title level={5} className="admin-card-subheading">
                    {title}
                  </Typography.Title>
                  <Typography.Paragraph className="admin-card-meta">
                    {user.synced.email || user.synced.dingtalkUserId || "未绑定邮箱"}
                  </Typography.Paragraph>
                </div>
                <Space wrap>
                  <Button type="primary" onClick={() => openEditor(user)}>
                    编辑 {title}
                  </Button>
                  <Button onClick={() => setRoleEditorUserId(user.id)}>角色分配</Button>
                </Space>
              </div>
              <dl className="admin-detail-grid">
                <div>
                  <dt>角色</dt>
                  <dd>
                    <Tag color="blue">{user.local.role}</Tag>
                  </dd>
                </div>
                <div>
                  <dt>状态</dt>
                  <dd>
                    <Tag color={user.effective.status === "active" ? "success" : "warning"}>{user.effective.status}</Tag>
                  </dd>
                </div>
                <div>
                  <dt>已分配角色</dt>
                  <dd>{user.assignedRoles.map((roleItem) => roleItem.slug).join(", ") || "未分配"}</dd>
                </div>
                <div>
                  <dt>主部门</dt>
                  <dd>{user.synced.primaryDepartmentId || "未设置"}</dd>
                </div>
                <div>
                  <dt>最后同步</dt>
                  <dd>{formatLocalTime(user.effective.lastSyncedAt)}</dd>
                </div>
              </dl>
            </Card>
          );
        })}
      </Space>
      {editingUser ? (
        <Card
          size="small"
          className="admin-inline-editor-card"
          title={`编辑 ${editingUser.synced.displayName || editingUser.id}`}
        >
          <section className="admin-inline-editor" aria-label="用户编辑表单">
            <label className="field">
              <span className="field-label">角色</span>
              <select aria-label="角色" className="field-input" value={role} onChange={(event) => setRole(event.target.value)}>
                <option value="employee">employee</option>
                <option value="admin">admin</option>
              </select>
            </label>
            <label className="field field-checkbox">
              <span className="field-label">手动禁用</span>
              <input
                aria-label="手动禁用"
                type="checkbox"
                checked={manualDisabled}
                onChange={(event) => setManualDisabled(event.target.checked)}
              />
            </label>
            <label className="field">
              <span className="field-label">备注</span>
              <textarea
                aria-label="备注"
                className="field-input admin-textarea"
                value={adminNote}
                onChange={(event) => setAdminNote(event.target.value)}
              />
            </label>
            <Space wrap>
              <Button type="primary" aria-label="保存" onClick={() => void handleSave()} loading={saving}>
                保存
              </Button>
              <Button aria-label="取消" onClick={() => setEditingUserId(null)} disabled={saving}>
                取消
              </Button>
            </Space>
          </section>
        </Card>
      ) : null}
      {roleEditorUserId ? (
        <UserRoleEditor
          userId={roleEditorUserId}
          onSaved={() => setRoleEditorUserId(null)}
          onCancel={() => setRoleEditorUserId(null)}
        />
      ) : null}
    </Card>
  );
}
