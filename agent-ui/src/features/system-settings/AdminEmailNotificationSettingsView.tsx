import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Drawer,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography
} from "antd";
import { BellRing, Edit3, RefreshCw, Send, ShieldCheck, Users } from "lucide-react";

import { fetchAdminUsers } from "../admin/api";
import {
  fetchAdminEmailNotificationRecords,
  type AdminEmailNotificationRecord
} from "./api";
import type {
  AdminEmailNotificationEventKey,
  SystemSettingsAdminEmailNotifications
} from "./types";

type Props = {
  value: SystemSettingsAdminEmailNotifications;
  disabled?: boolean;
  onChange(patch: Partial<SystemSettingsAdminEmailNotifications>): void;
};

const EVENT_META: Array<{ key: AdminEmailNotificationEventKey; label: string; scene: string }> = [
  { key: "access_request.submitted", label: "新申请已提交", scene: "客户首次提交访问申请" },
  { key: "access_request.resubmitted", label: "申请已补充", scene: "客户补充资料后重新提交" },
  { key: "access_request.review_requested", label: "已发起审批", scene: "管理员将申请交给审批人" },
  { key: "access_request.needs_info", label: "需要补充资料", scene: "管理员要求客户补充信息" },
  { key: "access_request.rejected", label: "申请已拒绝", scene: "申请被明确拒绝" },
  { key: "access_request.review_decision", label: "审批结果更新", scene: "审批人提交同意或拒绝" },
  { key: "access_request.provisioned", label: "权益已开通", scene: "组织、套餐和邀请已创建" },
  { key: "access_request.activated", label: "用户已激活", scene: "申请人完成首次登录" }
];

const EVENT_LABEL = new Map(EVENT_META.map((item) => [item.key, item.label]));

function localDateTime(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "未记录" : parsed.toLocaleString();
}

export function AdminEmailNotificationSettingsView({ value, disabled, onChange }: Props) {
  const [recipientOptions, setRecipientOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [records, setRecords] = useState<AdminEmailNotificationRecord[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [editingEvent, setEditingEvent] = useState<AdminEmailNotificationEventKey | null>(null);

  async function loadRecords() {
    setLoadingRecords(true);
    setLoadError("");
    try {
      const response = await fetchAdminEmailNotificationRecords({ take: 100 });
      setRecords(response.records);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "发送记录加载失败");
    } finally {
      setLoadingRecords(false);
    }
  }

  useEffect(() => {
    let active = true;
    void fetchAdminUsers()
      .then((users) => {
        if (!active) return;
        setRecipientOptions(users.users
          .filter((user) => user.effective.status === "active" && user.source.userType === "internal_employee" && Boolean(user.synced.email))
          .map((user) => ({
            value: String(user.synced.email).toLowerCase(),
            label: `${user.synced.displayName || user.synced.email} · ${user.synced.email}`
          })));
      })
      .catch((error) => {
        if (active) setLoadError(error instanceof Error ? error.message : "收件人目录加载失败");
      });
    void loadRecords();
    return () => { active = false; };
  }, []);

  const enabledCount = EVENT_META.filter((item) => value.events[item.key].enabled).length;
  const sentCount = records.filter((record) => record.status === "sent").length;
  const failedCount = records.filter((record) => record.status === "failed").length;
  const recipientSummary = value.recipientMode === "all_admins"
    ? "管理员和超级管理员"
    : value.recipientMode === "all_super_admins"
      ? "仅超级管理员"
      : `${value.recipientEmails.length} 位指定用户`;
  const currentTemplate = editingEvent ? value.events[editingEvent] : null;

  function updateEvent(key: AdminEmailNotificationEventKey, patch: Partial<SystemSettingsAdminEmailNotifications["events"][AdminEmailNotificationEventKey]>) {
    onChange({
      events: {
        ...value.events,
        [key]: { ...value.events[key], ...patch }
      }
    });
  }

  const policyColumns = useMemo(() => [
    {
      title: "通知事件",
      dataIndex: "label",
      key: "label",
      render: (_: unknown, row: typeof EVENT_META[number]) => (
        <div className="admin-notification-event-cell">
          <strong>{row.label}</strong>
          <span>{row.scene}</span>
        </div>
      )
    },
    {
      title: "邮件",
      key: "enabled",
      width: 92,
      render: (_: unknown, row: typeof EVENT_META[number]) => (
        <Switch
          size="small"
          checked={value.events[row.key].enabled}
          disabled={disabled || !value.enabled}
          onChange={(enabled) => updateEvent(row.key, { enabled })}
        />
      )
    },
    {
      title: "收件范围",
      key: "audience",
      width: 170,
      render: () => <span>{recipientSummary}</span>
    },
    {
      title: "模板",
      key: "template",
      width: 90,
      render: (_: unknown, row: typeof EVENT_META[number]) => (
        <Button type="text" size="small" icon={<Edit3 size={15} />} onClick={() => setEditingEvent(row.key)}>编辑</Button>
      )
    }
  ], [disabled, recipientSummary, value]);

  const recordColumns = [
    {
      title: "时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 180,
      render: localDateTime
    },
    {
      title: "事件",
      dataIndex: "eventType",
      key: "eventType",
      render: (eventType: AdminEmailNotificationEventKey) => EVENT_LABEL.get(eventType) ?? eventType
    },
    {
      title: "收件人",
      key: "recipients",
      render: (_: unknown, record: AdminEmailNotificationRecord) => record.payload?.recipients?.join(", ") || "未记录"
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 110,
      render: (status: AdminEmailNotificationRecord["status"]) => (
        <Tag color={status === "sent" ? "success" : status === "failed" ? "error" : "processing"}>
          {status === "sent" ? "已发送" : status === "failed" ? "失败" : "发送中"}
        </Tag>
      )
    },
    {
      title: "结果",
      key: "result",
      render: (_: unknown, record: AdminEmailNotificationRecord) => record.errorMessage || `尝试 ${record.payload?.attempts ?? 0} 次`
    }
  ];

  return (
    <div className="admin-notification-settings">
      <div className="admin-notification-summary-grid">
        <div><span>启用事件</span><strong>{enabledCount} / {EVENT_META.length}</strong><small>访问申请生命周期</small></div>
        <div><span>默认收件范围</span><strong>{recipientSummary}</strong><small>发布后统一生效</small></div>
        <div><span>最近发送</span><strong>{sentCount}</strong><small>最近 100 条记录</small></div>
        <div><span>发送失败</span><strong className={failedCount ? "danger" : ""}>{failedCount}</strong><small>可在发送记录排查</small></div>
      </div>

      {loadError ? <Alert type="warning" showIcon message={loadError} /> : null}

      <Tabs
        className="admin-notification-tabs"
        items={[
          {
            key: "policy",
            label: "策略",
            children: (
              <div className="admin-notification-policy-grid">
                <section className="admin-notification-panel admin-notification-event-panel">
                  <div className="admin-notification-panel-heading">
                    <div><BellRing size={19} /><div><h3>管理员邮件事件</h3><p>业务只上报事件，收件人与模板在这里统一控制。</p></div></div>
                    <Space><span>总开关</span><Switch checked={value.enabled} disabled={disabled} onChange={(enabled) => onChange({ enabled })} /></Space>
                  </div>
                  <Table rowKey="key" size="small" pagination={false} columns={policyColumns} dataSource={EVENT_META} />
                </section>

                <aside className="admin-notification-side-stack">
                  <section className="admin-notification-panel">
                    <div className="admin-notification-panel-heading compact">
                      <div><Users size={18} /><div><h3>默认收件范围</h3><p>同一封邮件自动去重。</p></div></div>
                    </div>
                    <label className="admin-notification-field">
                      <span>角色范围</span>
                      <Select
                        value={value.recipientMode}
                        disabled={disabled}
                        onChange={(recipientMode) => onChange({ recipientMode })}
                        options={[
                          { value: "all_admins", label: "管理员和超级管理员" },
                          { value: "all_super_admins", label: "仅超级管理员" },
                          { value: "specified_users", label: "指定用户" }
                        ]}
                      />
                    </label>
                    {value.recipientMode === "specified_users" ? (
                      <label className="admin-notification-field">
                        <span>指定用户</span>
                        <Select
                          mode="multiple"
                          showSearch
                          optionFilterProp="label"
                          value={value.recipientEmails}
                          options={recipientOptions}
                          disabled={disabled}
                          placeholder="选择姓名或邮箱"
                          onChange={(recipientEmails) => onChange({ recipientEmails })}
                        />
                      </label>
                    ) : null}
                    <div className="admin-notification-switch-row"><div><strong>同时通知申请负责人</strong><span>仅该申请已分配负责人时加入</span></div><Switch checked={value.includeOwner} disabled={disabled} onChange={(includeOwner) => onChange({ includeOwner })} /></div>
                    <div className="admin-notification-switch-row"><div><strong>同时通知内部销售联系人</strong><span>只接受内部企业邮箱</span></div><Switch checked={value.includeSalesContact} disabled={disabled} onChange={(includeSalesContact) => onChange({ includeSalesContact })} /></div>
                    <Alert type="info" showIcon message="审批人邮件独立发送" description="审批邀请仍只发给被指定的审批人，管理员通知不会改变审批关系。" />
                  </section>

                  <section className="admin-notification-panel">
                    <div className="admin-notification-panel-heading compact"><div><ShieldCheck size={18} /><div><h3>发送保护</h3><p>失败只影响通知，不改变申请状态。</p></div></div></div>
                    <div className="admin-notification-switch-row"><div><strong>记录发送结果</strong><span>用于审计和排障</span></div><Switch checked={value.recordDelivery} disabled={disabled} onChange={(recordDelivery) => onChange({ recordDelivery })} /></div>
                    <label className="admin-notification-field inline"><span>失败最大尝试次数</span><InputNumber min={1} max={3} value={value.maxAttempts} disabled={disabled} onChange={(maxAttempts) => onChange({ maxAttempts: maxAttempts ?? 1 })} /></label>
                  </section>
                </aside>
              </div>
            )
          },
          {
            key: "templates",
            label: "邮件模板",
            children: (
              <section className="admin-notification-panel">
                <div className="admin-notification-panel-heading"><div><Send size={19} /><div><h3>访问申请邮件模板</h3><p>点击事件编辑主题和正文；变量会在发送时替换。</p></div></div></div>
                <Table rowKey="key" size="small" pagination={false} columns={policyColumns.filter((column) => column.key !== "audience" && column.key !== "enabled")} dataSource={EVENT_META} />
              </section>
            )
          },
          {
            key: "records",
            label: "发送记录",
            children: (
              <section className="admin-notification-panel">
                <div className="admin-notification-panel-heading">
                  <div><Send size={19} /><div><h3>最近发送记录</h3><p>记录真实收件人、状态和失败原因。</p></div></div>
                  <Button icon={<RefreshCw size={15} />} loading={loadingRecords} onClick={() => void loadRecords()}>刷新</Button>
                </div>
                <Table rowKey="id" size="small" loading={loadingRecords} columns={recordColumns} dataSource={records} pagination={{ pageSize: 20, showSizeChanger: false }} />
              </section>
            )
          }
        ]}
      />

      <Drawer
        title={editingEvent ? `编辑模板 · ${EVENT_LABEL.get(editingEvent)}` : "编辑模板"}
        width={560}
        open={Boolean(editingEvent && currentTemplate)}
        onClose={() => setEditingEvent(null)}
      >
        {editingEvent && currentTemplate ? (
          <div className="admin-notification-template-editor">
            <label><span>邮件主题</span><Input value={currentTemplate.subject} disabled={disabled} onChange={(event) => updateEvent(editingEvent, { subject: event.target.value })} /></label>
            <label><span>邮件正文</span><Input.TextArea rows={14} value={currentTemplate.bodyText} disabled={disabled} onChange={(event) => updateEvent(editingEvent, { bodyText: event.target.value })} /></label>
            <div className="admin-notification-variable-help">
              <Typography.Text strong>可用变量</Typography.Text>
              <Typography.Paragraph code copyable>{"{{company_name}} {{applicant_email}} {{sn_number}} {{sales_contact_email}} {{po_line}} {{public_link_line}} {{review_to}} {{review_cc_line}} {{message}} {{rejection_reason}} {{reviewer_name}} {{reviewer_decision}} {{reviewer_comment}} {{current_status}} {{organization_name}} {{plan_name}}"}</Typography.Paragraph>
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
