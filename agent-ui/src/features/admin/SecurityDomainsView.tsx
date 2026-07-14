import { Alert, Button, Checkbox, Empty, Form, Input, Modal, Select, Space, Table, Tag, Typography } from "antd";
import { LockKeyhole, Plus, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  createAdminSecurityDomain,
  fetchAdminSecurityDomains,
  fetchAdminUsers,
  fetchDepartmentTree,
  updateAdminSecurityDomain
} from "./api";
import type { AdminDepartmentNode, AdminSecurityDomain, AdminUser } from "./types";

type EditorState = {
  id?: string;
  name: string;
  status: "active" | "inactive";
  departmentIds: string[];
  userIds: string[];
  includeChildren: boolean;
};

const EMPTY_EDITOR: EditorState = {
  name: "",
  status: "active",
  departmentIds: [],
  userIds: [],
  includeChildren: true
};

function flattenDepartments(nodes: AdminDepartmentNode[], parentPath = ""): Array<{ id: string; label: string }> {
  return nodes.flatMap((node) => {
    const path = parentPath ? `${parentPath} / ${node.name}` : node.name;
    return [{ id: node.id, label: path }, ...flattenDepartments(node.children, path)];
  });
}

function userLabel(user: AdminUser): string {
  return user.synced.displayName?.trim() || user.synced.email?.trim() || user.id;
}

function editorFromDomain(domain: AdminSecurityDomain): EditorState {
  const departmentRules = domain.rules.filter((rule) => rule.subjectType === "department");
  return {
    id: domain.id,
    name: domain.name,
    status: domain.status,
    departmentIds: departmentRules.map((rule) => rule.subjectId),
    userIds: domain.rules.filter((rule) => rule.subjectType === "user").map((rule) => rule.subjectId),
    includeChildren: departmentRules.length === 0 || departmentRules.every((rule) => rule.includeChildren)
  };
}

const localDateTime = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

export function SecurityDomainsView() {
  const [domains, setDomains] = useState<AdminSecurityDomain[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [departments, setDepartments] = useState<AdminDepartmentNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);

  async function load() {
    setLoading(true);
    setErrorText("");
    try {
      const [domainResponse, userResponse, departmentResponse] = await Promise.all([
        fetchAdminSecurityDomains(),
        fetchAdminUsers(),
        fetchDepartmentTree()
      ]);
      setDomains(domainResponse.domains);
      setUsers(userResponse.users);
      setDepartments(departmentResponse.departments);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "加载保密域失败，请刷新后重试。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const departmentOptions = useMemo(
    () => flattenDepartments(departments).map((item) => ({ value: item.id, label: item.label })),
    [departments]
  );
  const userOptions = useMemo(
    () =>
      users
        .filter((user) => user.effective.status === "active")
        .map((user) => ({ value: user.id, label: userLabel(user) }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [users]
  );
  const departmentLabelById = useMemo(
    () => new Map(departmentOptions.map((option) => [option.value, option.label])),
    [departmentOptions]
  );
  const userLabelById = useMemo(() => new Map(userOptions.map((option) => [option.value, option.label])), [userOptions]);

  async function saveEditor() {
    if (!editor) return;
    const name = editor.name.trim();
    if (!name) {
      setErrorText("请输入保密域名称。");
      return;
    }
    if (editor.departmentIds.length === 0 && editor.userIds.length === 0) {
      setErrorText("请至少选择 1 个部门或用户。");
      return;
    }
    setSaving(true);
    setErrorText("");
    setSuccessText("");
    const input = {
      name,
      status: editor.status,
      rules: [
        ...editor.departmentIds.map((subjectId) => ({
          subject_type: "department" as const,
          subject_id: subjectId,
          include_children: editor.includeChildren
        })),
        ...editor.userIds.map((subjectId) => ({
          subject_type: "user" as const,
          subject_id: subjectId,
          include_children: false
        }))
      ]
    };
    try {
      if (editor.id) {
        await updateAdminSecurityDomain(editor.id, input);
        setSuccessText(`已更新保密域“${name}”。`);
      } else {
        await createAdminSecurityDomain(input);
        setSuccessText(`已创建保密域“${name}”。`);
      }
      setEditor(null);
      await load();
    } catch (error) {
      setErrorText(error instanceof Error ? `${error.message}。请调整成员规则后重试。` : "保存保密域失败，请重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-page-container">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">保密域</h1>
          <p className="admin-page-desc">按部门或用户隔离 Portal 会话、附件与工作区；每个用户最多属于 1 个有效保密域。</p>
        </div>
        <Button type="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setEditor({ ...EMPTY_EDITOR })}>
          创建保密域
        </Button>
      </div>

      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        {errorText && !editor ? (
          <Alert type="error" showIcon message={errorText} closable onClose={() => setErrorText("")} />
        ) : null}
        {successText ? <Alert type="success" showIcon message={successText} closable onClose={() => setSuccessText("")} /> : null}
        <Table<AdminSecurityDomain>
          rowKey="id"
          loading={loading}
          dataSource={domains}
          pagination={false}
          locale={{ emptyText: <Empty description="尚未创建保密域" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          columns={[
            {
              title: "保密域",
              dataIndex: "name",
              render: (name: string) => (
                <Space size={8}>
                  <LockKeyhole size={16} aria-hidden="true" />
                  <Typography.Text strong>{name}</Typography.Text>
                </Space>
              )
            },
            {
              title: "状态",
              dataIndex: "status",
              width: 100,
              render: (status: AdminSecurityDomain["status"]) => (
                <Tag color={status === "active" ? "success" : "default"}>{status === "active" ? "已启用" : "已停用"}</Tag>
              )
            },
            {
              title: "成员",
              dataIndex: "memberCount",
              width: 110,
              render: (count: number) => (
                <Space size={6}>
                  <Users size={14} aria-hidden="true" />
                  <span>{count.toLocaleString()} 人</span>
                </Space>
              )
            },
            {
              title: "规则",
              key: "rules",
              render: (_, domain) => {
                const departmentCount = domain.rules.filter((rule) => rule.subjectType === "department").length;
                const userCount = domain.rules.length - departmentCount;
                return `${departmentCount} 个部门 · ${userCount} 个用户`;
              }
            },
            {
              title: "更新时间",
              dataIndex: "updatedAt",
              width: 180,
              render: (value: string) => localDateTime.format(new Date(value))
            },
            {
              title: "操作",
              key: "actions",
              width: 100,
              render: (_, domain) => <Button onClick={() => setEditor(editorFromDomain(domain))}>编辑</Button>
            }
          ]}
        />
      </Space>

      <Modal
        open={Boolean(editor)}
        title={editor?.id ? "编辑保密域" : "创建保密域"}
        okText={editor?.id ? "保存保密域" : "创建保密域"}
        cancelText="取消"
        confirmLoading={saving}
        onOk={() => void saveEditor()}
        onCancel={() => (saving ? undefined : setEditor(null))}
        destroyOnHidden
      >
        {editor ? (
          <Form layout="vertical" requiredMark={false}>
            {errorText ? (
              <Alert
                type="error"
                showIcon
                message={errorText}
                closable
                onClose={() => setErrorText("")}
                style={{ marginBottom: 16 }}
              />
            ) : null}
            <Form.Item label="名称" required>
              <Input
                value={editor.name}
                maxLength={100}
                autoFocus
                placeholder="例如：核心业务保密域"
                onChange={(event) => setEditor((current) => (current ? { ...current, name: event.target.value } : current))}
              />
            </Form.Item>
            <Form.Item label="状态">
              <Select
                value={editor.status}
                options={[
                  { value: "active", label: "启用" },
                  { value: "inactive", label: "停用" }
                ]}
                onChange={(status) => setEditor((current) => (current ? { ...current, status } : current))}
              />
            </Form.Item>
            <Form.Item label="部门" extra="命中成员会自动进入该保密域。部门同步后，成员关系会按规则重新计算。">
              <Select
                mode="multiple"
                showSearch
                optionFilterProp="label"
                value={editor.departmentIds}
                options={departmentOptions}
                placeholder="选择部门"
                onChange={(departmentIds) => setEditor((current) => (current ? { ...current, departmentIds } : current))}
              />
            </Form.Item>
            <Form.Item>
              <Checkbox
                checked={editor.includeChildren}
                onChange={(event) =>
                  setEditor((current) => (current ? { ...current, includeChildren: event.target.checked } : current))
                }
              >
                包含所选部门的子部门
              </Checkbox>
            </Form.Item>
            <Form.Item label="指定用户" extra="可用于加入不属于所选部门的个别用户。">
              <Select
                mode="multiple"
                showSearch
                optionFilterProp="label"
                value={editor.userIds}
                options={userOptions}
                placeholder="选择用户"
                onChange={(userIds) => setEditor((current) => (current ? { ...current, userIds } : current))}
              />
            </Form.Item>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              当前选择：{editor.departmentIds.map((id) => departmentLabelById.get(id) ?? id).join("、") || "无部门"}；
              {editor.userIds.map((id) => userLabelById.get(id) ?? id).join("、") || "无指定用户"}。
            </Typography.Paragraph>
          </Form>
        ) : null}
      </Modal>
    </div>
  );
}

export default SecurityDomainsView;
