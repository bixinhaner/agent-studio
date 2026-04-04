import { useEffect, useMemo, useState, useRef } from "react";
import { Alert, Button, Card, Input, Space, Spin, Tag, Typography, Table, Tooltip, Drawer, Switch, Select } from "antd";
import { Search, Edit, Shield, MoreHorizontal } from "lucide-react";

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
  
  // Drawer states
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
      ].join(" ").toLowerCase();
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

  const columns = [
    {
      title: '用户信息',
      dataIndex: 'info',
      key: 'info',
      width: 280,
      render: (_: any, record: AdminUser) => (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <strong style={{ color: 'var(--admin-color-text)', fontSize: 14 }}>{userDisplayTitle(record)}</strong>
          <span style={{ color: 'var(--admin-color-subtle)', fontSize: 13 }}>{userContact(record)}</span>
        </div>
      )
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 140,
      render: (_: any, record: AdminUser) => (
        <Space size={4} wrap>
          <Tag color={record.effective.status === "active" ? "success" : "warning"} style={{ borderRadius: 12 }}>
            {record.effective.status}
          </Tag>
          {record.local.manualDisabled && <Tag color="error" style={{ borderRadius: 12 }}>手动禁用</Tag>}
        </Space>
      )
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      width: 200,
      render: (_: any, record: AdminUser) => (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 14 }}>{record.primaryRole?.name || record.local.role}</span>
          <span style={{ color: 'var(--admin-color-subtle)', fontSize: 12 }}>
            {record.assignedRoles.map(r => r.slug).join(", ") || "未分配系统角色"}
          </span>
        </div>
      )
    },
    {
      title: '主部门',
      dataIndex: 'department',
      key: 'department',
      width: 160,
      render: (_: any, record: AdminUser) => (
        <span style={{ color: 'var(--admin-color-text)' }}>
          {record.synced.primaryDepartmentId || "未设置"}
        </span>
      )
    },
    {
      title: '最后同步',
      dataIndex: 'sync',
      key: 'sync',
      width: 160,
      render: (_: any, record: AdminUser) => (
        <span style={{ color: 'var(--admin-color-subtle)', fontSize: 13 }}>
          {formatLocalTime(record.effective.lastSyncedAt)}
        </span>
      )
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      fixed: 'right' as const,
      render: (_: any, record: AdminUser) => (
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, height: '100%' }}>
      {errorText && <Alert type="error" showIcon message={errorText} />}
      
      <div className="admin-card" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)', padding: 0, overflow: 'hidden' }}>
        {/* Toolbar */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--admin-color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space>
            <Input
              prefix={<Search size={16} style={{ color: 'var(--admin-color-subtle)' }} />}
              placeholder="搜索姓名、邮箱、钉钉 ID..."
              value={filterText}
              onChange={e => setFilterText(e.target.value)}
              allowClear
              style={{ width: 320 }}
            />
          </Space>
          <Space>
            <span style={{ color: 'var(--admin-color-subtle)', fontSize: 13 }}>
              共 {users.length} 名用户
            </span>
          </Space>
        </div>

        {/* Virtual Table */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Table
            columns={columns}
            dataSource={filteredUsers}
            rowKey="id"
            pagination={false}
            loading={loading}
            scroll={{ y: 'calc(100vh - 300px)', x: 1060 }}
            virtual
            size="middle"
            rowClassName={() => 'admin-table-row-hover'}
          />
        </div>
      </div>

      {/* Editor Drawer */}
      <Drawer
        title="编辑用户设置"
        placement="right"
        width={400}
        onClose={() => setEditingUserId(null)}
        open={!!editingUser}
        footer={
          <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={() => setEditingUserId(null)} disabled={saving}>取消</Button>
            <Button type="primary" onClick={handleSave} loading={saving}>保存更改</Button>
          </Space>
        }
      >
        {editingUser && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>基础角色</div>
              <Select 
                value={role} 
                onChange={setRole} 
                style={{ width: '100%' }}
                options={[
                  { value: 'employee', label: '普通员工 (Employee)' },
                  { value: 'admin', label: '系统管理员 (Admin)' }
                ]}
              />
              <div style={{ fontSize: 13, color: 'var(--admin-color-subtle)', marginTop: 4 }}>
                控制该用户的基础系统权限和管理后台入口可见性。
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 500 }}>手动禁用账号</span>
                <Switch checked={manualDisabled} onChange={setManualDisabled} />
              </div>
              <div style={{ fontSize: 13, color: 'var(--admin-color-subtle)' }}>
                启用后将阻止该用户发起任何新会话或访问系统核心资源。
              </div>
            </div>

            <div>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>管理备注</div>
              <Input.TextArea 
                value={adminNote} 
                onChange={e => setAdminNote(e.target.value)} 
                rows={4} 
                placeholder="记录禁用原因或权限调整说明..."
              />
            </div>
          </div>
        )}
      </Drawer>

      {/* Role Editor Modal */}
      {roleEditorUserId && (
        <UserRoleEditor
          userId={roleEditorUserId}
          onSaved={() => setRoleEditorUserId(null)}
          onCancel={() => setRoleEditorUserId(null)}
        />
      )}
    </div>
  );
}
