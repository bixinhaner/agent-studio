import { Copy, MoreVertical, Plus, Search, ShieldBan } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Drawer,
  Dropdown,
  Empty,
  Form,
  Input,
  type MenuProps,
  message,
  Modal,
  Space,
  Tag,
  Typography
} from "antd";

import { useIsNarrowScreen } from "../../lib/use-is-narrow-screen";
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
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const isNarrowScreen = useIsNarrowScreen(980);

  async function load() {
    setLoading(true);
    setErrorText("");
    try {
      const response = await fetchRoles();
      setRoles(response.roles);
      setSelectedRoleId((current) => {
        if (current && response.roles.some((role) => role.id === current)) {
          return current;
        }
        return response.roles[0]?.id || "";
      });
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "加载角色列表失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!isNarrowScreen) {
      setMobileDetailOpen(false);
    }
  }, [isNarrowScreen]);

  const filteredRoles = useMemo(
    () =>
      roles.filter(
        (role) =>
          role.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          role.slug.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    [roles, searchQuery]
  );

  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? null;

  const summaryItems = useMemo(() => {
    const activeCount = roles.filter((role) => role.isActive).length;
    const systemCount = roles.filter((role) => role.isSystem).length;
    const customCount = roles.filter((role) => !role.isSystem).length;

    return [
      {
        label: "角色总数",
        value: String(roles.length),
        meta: searchQuery.trim() ? `当前筛选命中 ${filteredRoles.length} 个角色` : "平台内全部角色模板"
      },
      {
        label: "启用中",
        value: String(activeCount),
        meta: "目前参与权限生效的角色"
      },
      {
        label: "系统角色",
        value: String(systemCount),
        meta: "由平台预置维护的角色"
      },
      {
        label: "自定义角色",
        value: String(customCount),
        meta: "可按组织治理需要自行扩展"
      }
    ];
  }, [filteredRoles.length, roles, searchQuery]);

  async function handleCreate(values: { slug: string; name: string; description?: string }) {
    setSubmitting(true);
    setErrorText("");
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
      void message.success("角色已创建");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "创建角色失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClone(role: RoleSummary) {
    setErrorText("");
    try {
      const response = await cloneRole(role.id, {
        slug: `${role.slug}_copy`,
        name: `${role.name} 副本`,
        description: role.description ?? null
      });
      await load();
      setSelectedRoleId(response.role.id);
      void message.success(`已复制角色：${role.name}`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "复制角色失败");
    }
  }

  async function handleDisable(role: RoleSummary) {
    setErrorText("");
    try {
      await disableRole(role.id);
      await load();
      void message.success(role.isActive ? "角色已禁用" : "角色状态已更新");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "更新角色状态失败");
    }
  }

  function handleSelectRole(roleId: string) {
    setSelectedRoleId(roleId);
    if (isNarrowScreen) {
      setMobileDetailOpen(true);
    }
  }

  const getRoleMenu = (role: RoleSummary): MenuProps => ({
    items: [
      {
        key: "clone",
        icon: <Copy size={14} />,
        label: "复制角色",
        onClick: (event) => {
          event.domEvent.stopPropagation();
          void handleClone(role);
        }
      },
      ...(!role.isSystem
        ? [
            {
              key: "disable",
              icon: <ShieldBan size={14} />,
              label: role.isActive ? "禁用角色" : "启用角色",
              danger: role.isActive,
              onClick: (event: Parameters<NonNullable<MenuProps["onClick"]>>[0]) => {
                event.domEvent.stopPropagation();
                void handleDisable(role);
              }
            }
          ]
        : [])
    ]
  });

  return (
    <div className="admin-page-container">
      <div className="admin-page-header">
        <div>
          <Typography.Title level={3} style={{ margin: 0, marginBottom: 8 }}>
            角色权限
          </Typography.Title>
          <Typography.Text type="secondary">维护角色模板和权限矩阵，保障授权可追溯。</Typography.Text>
        </div>
        <Space wrap>
          <Tag color="blue" style={{ borderRadius: "var(--admin-radius-full)" }}>
            当前筛选 {filteredRoles.length} 个角色
          </Tag>
          <Button
            type="primary"
            icon={<Plus size={14} />}
            onClick={() => setIsCreateModalOpen(true)}
            style={{ borderRadius: "var(--admin-radius-full)" }}
          >
            新建角色
          </Button>
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

      <div className="admin-split-layout" style={{ marginTop: 4 }}>
        <div className="admin-split-master">
          <div style={{ padding: "16px", borderBottom: "1px solid var(--admin-color-border)" }}>
            <Input
              prefix={<Search size={14} style={{ color: "var(--admin-color-subtle)" }} />}
              placeholder="搜索角色名称或标识..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              allowClear
              style={{ borderRadius: "var(--admin-radius-full)" }}
            />
          </div>

          <div className="admin-master-list">
            {loading ? (
              <div style={{ textAlign: "center", padding: 40, color: "var(--admin-color-subtle)" }}>加载角色中...</div>
            ) : filteredRoles.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "var(--admin-color-subtle)" }}>
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未找到匹配的角色" />
              </div>
            ) : (
              filteredRoles.map((role) => (
                <div
                  key={role.id}
                  className={`admin-master-item ${selectedRoleId === role.id ? "active" : ""}`}
                  onClick={() => handleSelectRole(role.id)}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <strong style={{ fontSize: 14, fontWeight: 600 }}>{role.name}</strong>
                      {role.isSystem ? <Tag color="blue" style={{ margin: 0, borderRadius: 4 }}>系统</Tag> : null}
                    </div>
                    <Dropdown menu={getRoleMenu(role)} trigger={["click"]} placement="bottomRight">
                      <Button
                        type="text"
                        size="small"
                        icon={<MoreVertical size={14} />}
                        onClick={(event) => event.stopPropagation()}
                        style={{
                          color: selectedRoleId === role.id ? "var(--admin-color-accent)" : "var(--admin-color-subtle)"
                        }}
                      />
                    </Dropdown>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--admin-color-subtle)",
                      marginBottom: 8,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis"
                    }}
                  >
                    {role.description || "无描述"}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, fontSize: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: "monospace", color: "var(--admin-color-subtle)" }}>{role.slug}</div>
                      <div style={{ color: "var(--admin-color-subtle)", marginTop: 4 }}>
                        更新于 {formatLocalTime(role.updatedAt)}
                      </div>
                    </div>
                    <Tag color={role.isActive ? "success" : "default"} style={{ margin: 0, border: "none", background: "var(--admin-color-bg)" }}>
                      {role.isActive ? "Active" : "Disabled"}
                    </Tag>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="admin-split-detail">
          {!isNarrowScreen ? (
            selectedRoleId ? (
              <div style={{ height: "100%", overflow: "auto" }}>
                <RoleDetailView roleId={selectedRoleId} />
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  color: "var(--admin-color-subtle)"
                }}
              >
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请在左侧选择一个角色以查看其权限配置" />
              </div>
            )
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "var(--admin-color-subtle)",
                padding: 32
              }}
            >
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="在左侧点选角色后查看详情" />
            </div>
          )}
        </div>
      </div>

      <Drawer
        title={selectedRole ? `角色详情：${selectedRole.name}` : "角色详情"}
        placement="right"
        width={isNarrowScreen ? "100%" : 720}
        open={isNarrowScreen && mobileDetailOpen && Boolean(selectedRoleId)}
        onClose={() => setMobileDetailOpen(false)}
        destroyOnClose={false}
      >
        {selectedRoleId ? (
          <RoleDetailView roleId={selectedRoleId} />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请先选择一个角色" />
        )}
      </Drawer>

      <Modal title="新建自定义角色" open={isCreateModalOpen} onCancel={() => setIsCreateModalOpen(false)} footer={null} destroyOnClose>
        <Form form={form} layout="vertical" onFinish={handleCreate} style={{ marginTop: 24 }}>
          <Form.Item name="name" label="角色名称" rules={[{ required: true, message: "请输入角色名称" }]}>
            <Input placeholder="如：部门管理员" />
          </Form.Item>
          <Form.Item
            name="slug"
            label="角色标识 (Slug)"
            rules={[
              { required: true, message: "请输入角色标识" },
              { pattern: /^[a-z0-9_]+$/, message: "标识只能包含小写字母、数字和下划线" }
            ]}
          >
            <Input placeholder="如：dept_admin" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea placeholder="简要说明该角色的适用范围和职责" rows={3} />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
            <Space>
              <Button onClick={() => setIsCreateModalOpen(false)}>取消</Button>
              <Button type="primary" htmlType="submit" loading={submitting}>
                创建角色
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
