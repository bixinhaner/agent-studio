import { useEffect, useState } from "react";
import { Button, Tag, Input, Typography, Space, Modal, Form, Dropdown, MenuProps } from "antd";
import { Plus, Search, MoreVertical, Copy, ShieldBan, Trash2 } from "lucide-react";

import { cloneRole, createRole, disableRole, fetchRoles } from "./api";
import { RoleDetailView } from "./RoleDetailView";
import type { RoleSummary } from "./types";

function formatLocalTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export function RolesView() {
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  
  // Create Modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    const response = await fetchRoles();
    setRoles(response.roles);
    if (!selectedRoleId && response.roles.length > 0) {
      setSelectedRoleId(response.roles[0]?.id || "");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleCreate(values: { slug: string; name: string; description?: string }) {
    setSubmitting(true);
    try {
      const response = await createRole({ 
        slug: values.slug, 
        name: values.name, 
        description: values.description || null 
      });
      form.resetFields();
      setIsCreateModalOpen(false);
      await load();
      setSelectedRoleId(response.role.id);
    } catch (error) {
      // Handle error visually
      console.error(error);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClone(role: RoleSummary) {
    const response = await cloneRole(role.id, {
      slug: `${role.slug}_copy`,
      name: `${role.name} 副本`,
      description: role.description ?? null
    });
    await load();
    setSelectedRoleId(response.role.id);
  }

  async function handleDisable(role: RoleSummary) {
    await disableRole(role.id);
    await load();
  }

  const filteredRoles = roles.filter(role => 
    role.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    role.slug.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getRoleMenu = (role: RoleSummary): MenuProps => ({
    items: [
      {
        key: 'clone',
        icon: <Copy size={14} />,
        label: '复制角色',
        onClick: (e) => {
          e.domEvent.stopPropagation();
          void handleClone(role);
        }
      },
      ...(!role.isSystem ? [
        {
          key: 'disable',
          icon: <ShieldBan size={14} />,
          label: role.isActive ? '禁用角色' : '启用角色',
          danger: role.isActive,
          onClick: (e: any) => {
            e.domEvent.stopPropagation();
            void handleDisable(role);
          }
        }
      ] : [])
    ]
  });

  return (
    <div className="admin-rbac-layout">
      {/* Roles List Sidebar */}
      <aside className="admin-rbac-sidebar">
        <div className="admin-rbac-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Typography.Title level={5} style={{ margin: 0, fontSize: 16 }}>系统角色</Typography.Title>
            <Button 
              type="primary" 
              icon={<Plus size={14} />} 
              size="small"
              onClick={() => setIsCreateModalOpen(true)}
            >
              新建
            </Button>
          </div>
          <Input 
            prefix={<Search size={14} style={{ color: 'var(--admin-color-subtle)' }} />}
            placeholder="搜索角色名称或标识..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            allowClear
          />
        </div>
        
        <div className="admin-rbac-list">
          {filteredRoles.map(role => (
            <div 
              key={role.id} 
              className={`admin-role-card ${selectedRoleId === role.id ? 'active' : ''}`}
              onClick={() => setSelectedRoleId(role.id)}
            >
              <div className="admin-role-card-header">
                <div className="admin-role-card-title">
                  {role.name}
                  {role.isSystem && <Tag color="blue" style={{ margin: 0, fontSize: 10, lineHeight: '16px' }}>系统</Tag>}
                </div>
                <Dropdown menu={getRoleMenu(role)} trigger={['click']} placement="bottomRight">
                  <Button 
                    type="text" 
                    size="small" 
                    icon={<MoreVertical size={14} />} 
                    onClick={e => e.stopPropagation()}
                    style={{ color: selectedRoleId === role.id ? '#fff' : 'var(--admin-color-subtle)', opacity: 0.8 }}
                  />
                </Dropdown>
              </div>
              <div className="admin-role-card-desc">
                {role.description || "无描述"}
              </div>
              <div className="admin-role-card-meta">
                <span style={{ fontFamily: 'monospace' }}>{role.slug}</span>
                <Tag color={role.isActive ? (selectedRoleId === role.id ? 'default' : 'success') : 'default'} style={{ margin: 0 }}>
                  {role.isActive ? 'Active' : 'Disabled'}
                </Tag>
              </div>
            </div>
          ))}
          {filteredRoles.length === 0 && (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--admin-color-subtle)' }}>
              未找到匹配的角色
            </div>
          )}
        </div>
      </aside>

      {/* Role Detail Area */}
      <main className="admin-rbac-main">
        {selectedRoleId ? (
          <div className="admin-rbac-detail-scroll">
            <RoleDetailView roleId={selectedRoleId} />
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--admin-color-subtle)' }}>
            请在左侧选择一个角色以查看其权限配置
          </div>
        )}
      </main>

      {/* Create Role Modal */}
      <Modal
        title="新建自定义角色"
        open={isCreateModalOpen}
        onCancel={() => setIsCreateModalOpen(false)}
        footer={null}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleCreate}
          style={{ marginTop: 24 }}
        >
          <Form.Item 
            name="name" 
            label="角色名称" 
            rules={[{ required: true, message: '请输入角色名称' }]}
          >
            <Input placeholder="如：部门管理员" />
          </Form.Item>
          <Form.Item 
            name="slug" 
            label="角色标识 (Slug)" 
            rules={[
              { required: true, message: '请输入角色标识' },
              { pattern: /^[a-z0-9_]+$/, message: '标识只能包含小写字母、数字和下划线' }
            ]}
          >
            <Input placeholder="如：dept_admin" />
          </Form.Item>
          <Form.Item 
            name="description" 
            label="描述"
          >
            <Input.TextArea placeholder="简要说明该角色的适用范围和职责" rows={3} />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setIsCreateModalOpen(false)}>取消</Button>
              <Button type="primary" htmlType="submit" loading={submitting}>创建角色</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
