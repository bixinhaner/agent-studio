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

function userDisplayTitle(user: AdminUser): string {
  return user.synced.displayName || user.synced.email || user.id;
}

function userContact(user: AdminUser): string {
  return user.synced.email || user.synced.dingtalkUserId || "未绑定邮箱";
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
          <Typography.Paragraph>本地治理字段可编辑，钉钉同步资料保持只读。</Typography.Paragraph>
        </div>
        <Space wrap>
          <Tag color="blue">总数 {users.length}</Tag>
          <Tag>命中 {filteredUsers.length}</Tag>
        </Space>
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
      <div className="admin-density-list admin-user-density-list">
        {filteredUsers.map((user) => {
          const title = userDisplayTitle(user);
          return (
            <article key={user.id} className={editingUserId === user.id ? "admin-density-row active" : "admin-density-row"}>
              <div className="admin-density-primary">
                <strong>{title}</strong>
                <span>{userContact(user)}</span>
              </div>

              <div className="admin-density-cell">
                <span className="admin-density-label">状态</span>
                <span className="admin-density-value admin-density-tags">
                  <Tag color={user.effective.status === "active" ? "success" : "warning"}>{user.effective.status}</Tag>
                  {user.local.manualDisabled ? <Tag color="error">手动禁用</Tag> : null}
                </span>
              </div>

              <div className="admin-density-cell">
                <span className="admin-density-label">角色</span>
                <span className="admin-density-value">
                  {user.primaryRole?.name || user.local.role}
                  <small>{user.assignedRoles.map((roleItem) => roleItem.slug).join(", ") || "未分配角色"}</small>
                </span>
              </div>

              <div className="admin-density-cell">
                <span className="admin-density-label">主部门</span>
                <span className="admin-density-value">{user.synced.primaryDepartmentId || "未设置"}</span>
              </div>

              <div className="admin-density-cell">
                <span className="admin-density-label">最后同步</span>
                <span className="admin-density-value">{formatLocalTime(user.effective.lastSyncedAt)}</span>
              </div>

              <div className="admin-density-actions">
                <Button size="small" type="primary" onClick={() => openEditor(user)}>
                  编辑
                </Button>
                <Button size="small" onClick={() => setRoleEditorUserId(user.id)}>
                  角色分配
                </Button>
              </div>
            </article>
          );
        })}
      </div>
      {!loading && filteredUsers.length === 0 ? <div className="admin-density-empty">没有匹配到用户。</div> : null}
      {editingUser ? (
        <Card
          size="small"
          className="admin-inline-editor-card"
          title={`编辑 ${editingUser.synced.displayName || editingUser.id}`}
        >
          <section className="admin-inline-editor" aria-label="用户编辑表单">
            <div className="admin-form-section">
              <div className="admin-form-section-header">
                <h4>本地治理字段</h4>
                <p>仅影响本地策略，不会覆盖钉钉同步信息。</p>
              </div>
              <label className="field">
                <span className="field-label">角色</span>
                <select aria-label="角色" className="field-input" value={role} onChange={(event) => setRole(event.target.value)}>
                  <option value="employee">employee</option>
                  <option value="admin">admin</option>
                </select>
                <small className="field-help">控制管理入口和运营能力范围。</small>
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
              <small className="field-help">启用后将阻止该用户继续发起新会话。</small>
              <label className="field">
                <span className="field-label">备注</span>
                <textarea
                  aria-label="备注"
                  className="field-input admin-textarea"
                  value={adminNote}
                  onChange={(event) => setAdminNote(event.target.value)}
                />
                <small className="field-help">建议写明调整原因，便于后续审计。</small>
              </label>
            </div>
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
