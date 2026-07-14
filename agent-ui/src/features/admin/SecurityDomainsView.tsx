import { Alert, Button, Card, Checkbox, Empty, Form, Input, Modal, Result, Select, Space, Table, Tag, Typography } from "antd";
import { KeyRound, LockKeyhole, Plus, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  createAdminSecurityDomain,
  changeAdminSecurityDomainPassword,
  fetchAdminSecurityDomains,
  fetchAdminSecurityDomainAccess,
  fetchAdminUsers,
  fetchDepartmentTree,
  initializeAdminSecurityDomainAccess,
  lockAdminSecurityDomains,
  unlockAdminSecurityDomains,
  updateAdminSecurityDomain
} from "./api";
import type { AdminDepartmentNode, AdminSecurityDomain, AdminSecurityDomainAccessStatus, AdminUser } from "./types";

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
  const [access, setAccess] = useState<AdminSecurityDomainAccessStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    fetchAdminSecurityDomainAccess()
      .then(setAccess)
      .catch((error) => setErrorText(error instanceof Error ? error.message : "无法检查保密域访问状态。"))
      .finally(() => setChecking(false));
  }, []);

  async function submitAccess() {
    if (!access) return;
    if (access.canInitialize && password !== confirmation) {
      setErrorText("两次输入的密码不一致。");
      return;
    }
    setSubmitting(true);
    setErrorText("");
    try {
      if (access.canInitialize) await initializeAdminSecurityDomainAccess(password);
      else await unlockAdminSecurityDomains(password);
      setAccess({ ...access, configured: true, unlocked: true, canInitialize: false });
      setPassword("");
      setConfirmation("");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "无法解锁保密域，请重试。");
    } finally {
      setSubmitting(false);
    }
  }

  if (access?.unlocked) {
    return (
      <SecurityDomainsWorkspace
        expiresInMinutes={access.expiresInMinutes}
        onLocked={() => setAccess({ ...access, unlocked: false })}
      />
    );
  }

  if (!checking && !access) {
    return (
      <div className="admin-page-container">
        <div className="admin-page-header">
          <div>
            <h1 className="admin-page-title">保密域</h1>
            <p className="admin-page-desc">输入独立密码后才能查看和修改保密域配置。</p>
          </div>
        </div>
        <Alert
          type="error"
          showIcon
          message={errorText || "无法检查保密域访问状态。"}
          action={<Button onClick={() => window.location.reload()}>重新加载</Button>}
        />
      </div>
    );
  }

  const initializing = Boolean(access?.canInitialize);
  return (
    <div className="admin-page-container">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">保密域</h1>
          <p className="admin-page-desc">输入独立密码后才能查看和修改保密域配置。</p>
        </div>
      </div>
      {access && !access.configured && !access.canInitialize ? (
        <Result status="403" title="尚未设置保密域密码" subTitle="请联系超级管理员完成首次设置。" />
      ) : (
        <Card loading={checking} style={{ maxWidth: 520 }}>
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Space size={12} align="start">
              <KeyRound size={22} aria-hidden="true" />
              <div>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  {initializing ? "首次设置保密域密码" : "解锁保密域"}
                </Typography.Title>
                <Typography.Text type="secondary">
                  {initializing
                    ? "密码长度需要为 10–128 个字符。设置后仅持有密码的管理员可以进入。"
                    : `验证后保持解锁 ${access?.expiresInMinutes ?? 30} 分钟，也可以随时主动锁定。`}
                </Typography.Text>
              </div>
            </Space>
            {errorText ? <Alert type="error" showIcon message={errorText} /> : null}
            <Form layout="vertical" onFinish={() => void submitAccess()}>
              <Form.Item label={initializing ? "设置密码" : "密码"} required>
                <Input.Password
                  autoFocus
                  autoComplete={initializing ? "new-password" : "current-password"}
                  value={password}
                  maxLength={128}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Form.Item>
              {initializing ? (
                <Form.Item label="确认密码" required>
                  <Input.Password
                    autoComplete="new-password"
                    value={confirmation}
                    maxLength={128}
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
                </Form.Item>
              ) : null}
              <Button type="primary" htmlType="submit" loading={submitting} disabled={!password}>
                {initializing ? "设置并进入" : "解锁保密域"}
              </Button>
            </Form>
          </Space>
        </Card>
      )}
    </div>
  );
}

function SecurityDomainsWorkspace(props: { expiresInMinutes: number; onLocked: () => void }) {
  const [domains, setDomains] = useState<AdminSecurityDomain[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [departments, setDepartments] = useState<AdminDepartmentNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [passwordEditorOpen, setPasswordEditorOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState("");

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
      if (error && typeof error === "object" && "code" in error && error.code === "security_domain_locked") {
        props.onLocked();
        return;
      }
      setErrorText(error instanceof Error ? error.message : "加载保密域失败，请刷新后重试。");
    } finally {
      setLoading(false);
    }
  }

  async function lockWorkspace() {
    setErrorText("");
    try {
      await lockAdminSecurityDomains();
      props.onLocked();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "锁定失败，请重试。");
    }
  }

  async function savePassword() {
    if (newPassword !== newPasswordConfirmation) {
      setErrorText("两次输入的新密码不一致。");
      return;
    }
    setSaving(true);
    setErrorText("");
    try {
      await changeAdminSecurityDomainPassword(newPassword);
      setPasswordEditorOpen(false);
      setNewPassword("");
      setNewPasswordConfirmation("");
      setSuccessText("保密域密码已更新，其他已解锁会话需要重新验证。");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "修改密码失败，请重试。");
    } finally {
      setSaving(false);
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
        <Space>
          <Button
            onClick={() => {
              setErrorText("");
              setPasswordEditorOpen(true);
            }}
          >
            修改密码
          </Button>
          <Button onClick={() => void lockWorkspace()}>锁定</Button>
          <Button type="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setEditor({ ...EMPTY_EDITOR })}>
            创建保密域
          </Button>
        </Space>
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
      <Modal
        open={passwordEditorOpen}
        title="修改保密域密码"
        okText="保存新密码"
        cancelText="取消"
        confirmLoading={saving}
        okButtonProps={{ disabled: !newPassword || !newPasswordConfirmation }}
        onOk={() => void savePassword()}
        onCancel={() => {
          if (saving) return;
          setPasswordEditorOpen(false);
          setErrorText("");
          setNewPassword("");
          setNewPasswordConfirmation("");
        }}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          新密码保存后，其他管理员的解锁状态会立即失效。当前解锁有效期为 {props.expiresInMinutes} 分钟。
        </Typography.Paragraph>
        {errorText ? <Alert type="error" showIcon message={errorText} style={{ marginBottom: 16 }} /> : null}
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label="新密码" required extra="长度需要为 10–128 个字符。">
            <Input.Password
              autoFocus
              autoComplete="new-password"
              value={newPassword}
              maxLength={128}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </Form.Item>
          <Form.Item label="确认新密码" required>
            <Input.Password
              autoComplete="new-password"
              value={newPasswordConfirmation}
              maxLength={128}
              onChange={(event) => setNewPasswordConfirmation(event.target.value)}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default SecurityDomainsView;
