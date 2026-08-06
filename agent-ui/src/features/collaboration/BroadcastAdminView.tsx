import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Empty,
  Input,
  Modal,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Steps,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message
} from "antd";
import {
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ClipboardCheck,
  Eye,
  FileText,
  Inbox,
  Mail,
  MessageCircle,
  MousePointerClick,
  Radio,
  RefreshCcw,
  Save,
  Send,
  ShieldCheck,
  Users
} from "lucide-react";

import { useIsNarrowScreen } from "../../lib/use-is-narrow-screen";
import { fetchAdminCustomerOrganizations, fetchAdminUsers, fetchDepartmentTree } from "../admin/api";
import type { AdminCustomerOrganization, AdminDepartmentNode, AdminUser } from "../admin/types";
import { BrandMark } from "../branding/BrandMark";
import { useBranding } from "../branding/BrandingProvider";
import {
  createBroadcastDraft,
  fetchAdminBroadcasts,
  fetchBroadcastDeliveries,
  previewBroadcastAudience,
  publishBroadcast,
  sendBroadcastTestEmail,
  updateBroadcastDraft
} from "./api";
import type {
  BroadcastAudienceConfig,
  BroadcastAudiencePreview,
  BroadcastDeliveryRecord,
  BroadcastRecord,
  BroadcastStatus
} from "./types";
import { TrainingCatalogSettings } from "./TrainingCatalogSettings";

type CampaignDraft = {
  title: string;
  bodyMarkdown: string;
  channelEmailEnabled: boolean;
  channelInAppEnabled: boolean;
  dingtalkDeliveryEnabled: boolean;
  content: {
    subject: string;
    bodyMarkdown: string;
    ctaLabel: string;
    ctaUrl: string;
    language: "zh" | "en";
  };
  audience: BroadcastAudienceConfig;
};

type WorkspaceMode = "overview" | "editor";
type OperationsOutreachTab = "broadcasts" | "training";

function readOperationsOutreachTab(): OperationsOutreachTab {
  if (typeof window === "undefined") return "broadcasts";
  const query = window.location.hash.split("?")[1] ?? "";
  return new URLSearchParams(query).get("tab") === "training" ? "training" : "broadcasts";
}

const DEFAULT_AUDIENCE: BroadcastAudienceConfig = {
  include: [{ type: "organization_type", value: "external" }],
  exclude: [{ type: "disabled_users" }, { type: "missing_email" }, { type: "email_opt_out" }]
};

function formatLocalDateTime(value?: string): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function buildEmptyDraft(): CampaignDraft {
  return {
    title: "外部客户激活邮件",
    bodyMarkdown: "Bailey 为您准备了继续使用工作台的建议。",
    channelEmailEnabled: true,
    channelInAppEnabled: false,
    dingtalkDeliveryEnabled: false,
    content: {
      subject: "Bailey 为您准备了本周的使用建议",
      bodyMarkdown:
        "{{user_name}}，\n\nBailey 为您准备了几个可以立即使用的场景。继续探索工作台中的智能体能力，可以更快完成资料检索、问题分析和方案整理。\n\n如需继续使用，请点击下方按钮进入工作台。",
      ctaLabel: "查看工作台",
      ctaUrl: "/",
      language: "zh"
    },
    audience: DEFAULT_AUDIENCE
  };
}

function draftFromBroadcast(broadcast: BroadcastRecord): CampaignDraft {
  return {
    title: broadcast.title,
    bodyMarkdown: broadcast.bodyMarkdown,
    channelEmailEnabled: broadcast.channels?.email ?? broadcast.channelEmailEnabled ?? false,
    channelInAppEnabled: broadcast.channels?.inApp ?? broadcast.channelInAppEnabled ?? true,
    dingtalkDeliveryEnabled: broadcast.channels?.dingtalk ?? broadcast.dingtalkDeliveryEnabled ?? false,
    content: {
      subject: broadcast.content?.subject || broadcast.title,
      bodyMarkdown: broadcast.content?.bodyMarkdown || broadcast.bodyMarkdown,
      ctaLabel: broadcast.content?.ctaLabel || "查看工作台",
      ctaUrl: broadcast.content?.ctaUrl || "/",
      language: broadcast.content?.language || "zh"
    },
    audience: broadcast.audience || DEFAULT_AUDIENCE
  };
}

function buildBroadcastInput(draft: CampaignDraft) {
  return {
    title: draft.title,
    bodyMarkdown: draft.bodyMarkdown,
    channelEmailEnabled: draft.channelEmailEnabled,
    channelInAppEnabled: draft.channelInAppEnabled,
    dingtalkDeliveryEnabled: draft.dingtalkDeliveryEnabled,
    content: draft.content,
    audience: draft.audience,
    targets: []
  };
}

function statusLabel(status: BroadcastStatus): string {
  if (status === "published") return "已发送";
  if (status === "archived") return "已归档";
  return "草稿";
}

function testStatusLabel(status: BroadcastRecord["testState"]["status"]): string {
  switch (status) {
    case "passed":
      return "已测试";
    case "failed":
      return "测试失败";
    case "stale":
      return "需重测";
    default:
      return "未测试";
  }
}

function testStatusColor(status: BroadcastRecord["testState"]["status"]): string {
  switch (status) {
    case "passed":
      return "success";
    case "failed":
      return "error";
    case "stale":
      return "warning";
    default:
      return "default";
  }
}

function userDisplayName(user: AdminUser): string {
  return user.synced.displayName || user.synced.email || user.id;
}

function userEmail(user: AdminUser): string {
  return user.synced.email || user.source.identities.find((identity) => identity.email)?.email || "";
}

function flattenDepartments(nodes: AdminDepartmentNode[]): AdminDepartmentNode[] {
  return nodes.flatMap((node) => [node, ...flattenDepartments(node.children || [])]);
}

function replacePreviewVariables(value: string, branding: ReturnType<typeof useBranding>["branding"]): string {
  return value
    .split("{{user_name}}").join("adriana")
    .split("{{organization_name}}").join("La Tienda")
    .split("{{platform_name}}").join(branding.platformName)
    .split("{{assistant_name}}").join(branding.assistantName);
}

function channelTags(broadcast: BroadcastRecord) {
  const tags = [];
  if (broadcast.channels?.email || broadcast.channelEmailEnabled) tags.push(<Tag key="email" icon={<Mail size={12} />}>邮件</Tag>);
  if (broadcast.channels?.inApp || broadcast.channelInAppEnabled) tags.push(<Tag key="inapp" icon={<Inbox size={12} />}>站内信</Tag>);
  if (broadcast.channels?.dingtalk || broadcast.dingtalkDeliveryEnabled) tags.push(<Tag key="dingtalk" icon={<MessageCircle size={12} />}>钉钉</Tag>);
  return tags.length ? tags : <Tag>站内信</Tag>;
}

function ruleText(rule: BroadcastAudienceConfig["include"][number], references: {
  organizations: AdminCustomerOrganization[];
  departments: AdminDepartmentNode[];
  users: AdminUser[];
}) {
  if (rule.type === "organization_type") return rule.value === "internal" ? "全部内部用户" : "全部外部客户";
  if (rule.type === "organization") return `组织：${references.organizations.find((item) => item.id === rule.id)?.name || rule.id}`;
  if (rule.type === "department") return `部门：${references.departments.find((item) => item.id === rule.id)?.name || rule.id}${rule.includeChildren ? "（含子部门）" : ""}`;
  if (rule.type === "user") return `用户：${references.users.find((item) => item.id === rule.id)?.synced.displayName || rule.id}`;
  if (rule.type === "role") return `角色：${rule.id}`;
  if (rule.type === "missing_email") return "无邮箱用户";
  if (rule.type === "email_opt_out") return "已退订用户";
  if (rule.type === "disabled_users") return "禁用用户";
  return "全部用户";
}

function EmailPreview(props: { draft: CampaignDraft }) {
  const { branding } = useBranding();
  const subject = replacePreviewVariables(props.draft.content.subject, branding);
  const body = replacePreviewVariables(props.draft.content.bodyMarkdown, branding);
  const ctaLabel = replacePreviewVariables(props.draft.content.ctaLabel || "查看工作台", branding);
  const logoUrl = branding.logoUrl || branding.iconUrl;

  return (
    <div className="engagement-email-preview">
      <div className="engagement-email-preview-top">
        <BrandMark className="engagement-email-brand" imageClassName="engagement-email-brand-img" name={branding.platformName} logoUrl={logoUrl} />
        <div>
          <strong>{branding.platformName}</strong>
          <span>{branding.assistantName}</span>
        </div>
        <Tag color="success">与正式发送一致</Tag>
      </div>
      <h2>{subject}</h2>
      <p className="engagement-email-preheader">{branding.assistantName} 为您准备了继续使用工作台的建议。</p>
      <div className="engagement-email-body">
        {body.split(/\n{2,}/g).filter(Boolean).map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      <button type="button" className="engagement-email-cta">{ctaLabel}</button>
      <div className="engagement-email-footer">
        您收到这封邮件，是因为您的组织正在使用 {branding.platformName}。您可以在工作台中管理邮件偏好。
      </div>
    </div>
  );
}

function AudienceBuilder(props: {
  draft: CampaignDraft;
  onChange(next: CampaignDraft): void;
  organizations: AdminCustomerOrganization[];
  departments: AdminDepartmentNode[];
  users: AdminUser[];
  preview: BroadcastAudiencePreview | null;
  onPreview(): void;
  previewing: boolean;
}) {
  const addInclude = (rule: BroadcastAudienceConfig["include"][number]) => {
    props.onChange({
      ...props.draft,
      audience: { ...props.draft.audience, include: [...props.draft.audience.include, rule] }
    });
  };
  const removeInclude = (index: number) => {
    props.onChange({
      ...props.draft,
      audience: {
        ...props.draft.audience,
        include: props.draft.audience.include.filter((_, currentIndex) => currentIndex !== index)
      }
    });
  };
  const removeExclude = (index: number) => {
    props.onChange({
      ...props.draft,
      audience: {
        ...props.draft.audience,
        exclude: props.draft.audience.exclude.filter((_, currentIndex) => currentIndex !== index)
      }
    });
  };

  return (
    <Row gutter={[20, 20]}>
      <Col xs={24} xl={14}>
        <div className="engagement-panel">
          <div className="engagement-panel-head">
            <div>
              <h3>发送范围</h3>
              <p>最终收件人 = 包含规则命中 - 排除规则命中 - 不可发送用户</p>
            </div>
            <Button icon={<RefreshCcw size={15} />} onClick={props.onPreview} loading={props.previewing}>
              重新计算
            </Button>
          </div>

          <div className="engagement-rule-section">
            <div className="engagement-rule-title">包含这些用户</div>
            <Space wrap>
              <Button onClick={() => addInclude({ type: "organization_type", value: "internal" })}>全部内部用户</Button>
              <Button onClick={() => addInclude({ type: "organization_type", value: "external" })}>全部外部客户</Button>
            </Space>
            <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
              <Col xs={24} md={8}>
                <Select
                  placeholder="指定组织"
                  style={{ width: "100%" }}
                  showSearch
                  options={props.organizations.map((org) => ({ value: org.id, label: org.name }))}
                  onChange={(id) => addInclude({ type: "organization", id })}
                />
              </Col>
              <Col xs={24} md={8}>
                <Select
                  placeholder="指定部门"
                  style={{ width: "100%" }}
                  showSearch
                  options={props.departments.map((department) => ({ value: department.id, label: department.name }))}
                  onChange={(id) => addInclude({ type: "department", id, includeChildren: true })}
                />
              </Col>
              <Col xs={24} md={8}>
                <Select
                  placeholder="指定用户"
                  style={{ width: "100%" }}
                  showSearch
                  options={props.users.map((user) => ({ value: user.id, label: `${userDisplayName(user)} ${userEmail(user)}` }))}
                  onChange={(id) => addInclude({ type: "user", id })}
                />
              </Col>
            </Row>
            <div className="engagement-rule-chip-row">
              {props.draft.audience.include.map((rule, index) => (
                <Tag key={`${rule.type}:${rule.id}:${rule.value}:${index}`} closable onClose={() => removeInclude(index)}>
                  {ruleText(rule, props)}
                </Tag>
              ))}
            </div>
          </div>

          <div className="engagement-rule-section">
            <div className="engagement-rule-title">排除这些用户</div>
            <div className="engagement-rule-chip-row">
              {props.draft.audience.exclude.map((rule, index) => (
                <Tag color="warning" key={`${rule.type}:${index}`} closable onClose={() => removeExclude(index)}>
                  {ruleText(rule, props)}
                </Tag>
              ))}
            </div>
          </div>
        </div>
      </Col>
      <Col xs={24} xl={10}>
        <div className="engagement-panel">
          <div className="engagement-panel-head">
            <div>
              <h3>受众预览</h3>
              <p>保存草稿后可计算真实收件范围。</p>
            </div>
          </div>
          {props.preview ? (
            <>
              <div className="engagement-audience-meter">
                <strong>{props.preview.snapshot.recipientCount}</strong>
                <span>预计触达</span>
                <Progress percent={props.preview.snapshot.recipientCount ? Math.round((props.preview.snapshot.emailReachableCount / props.preview.snapshot.recipientCount) * 100) : 0} size="small" />
              </div>
              <div className="engagement-mini-grid">
                <div><span>外部客户</span><strong>{props.preview.snapshot.externalCount}</strong></div>
                <div><span>内部员工</span><strong>{props.preview.snapshot.internalCount}</strong></div>
                <div><span>已排除</span><strong>{props.preview.snapshot.excludedCount}</strong></div>
              </div>
              <Divider style={{ margin: "14px 0" }} />
              <div className="engagement-recipient-list">
                {props.preview.snapshot.sampleRecipients.map((recipient) => (
                  <div key={recipient.userId}>
                    <strong>{recipient.displayName || recipient.email || recipient.userId}</strong>
                    <span>{recipient.email || "无邮箱"} · {recipient.organizationName || "-"}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未计算发送范围" />
          )}
        </div>
      </Col>
    </Row>
  );
}

export function BroadcastAdminView() {
  const [broadcasts, setBroadcasts] = useState<BroadcastRecord[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [organizations, setOrganizations] = useState<AdminCustomerOrganization[]>([]);
  const [departments, setDepartments] = useState<AdminDepartmentNode[]>([]);
  const [deliveries, setDeliveries] = useState<BroadcastDeliveryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("overview");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CampaignDraft>(buildEmptyDraft);
  const [step, setStep] = useState(0);
  const [audiencePreview, setAudiencePreview] = useState<BroadcastAudiencePreview | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [simulatedUserId, setSimulatedUserId] = useState<string | undefined>();
  const [publishConfirmed, setPublishConfirmed] = useState(false);
  const [activeTab, setActiveTab] = useState<OperationsOutreachTab>(readOperationsOutreachTab);
  const isNarrowScreen = useIsNarrowScreen(1080);

  useEffect(() => {
    const syncTab = () => setActiveTab(readOperationsOutreachTab());
    window.addEventListener("hashchange", syncTab);
    return () => window.removeEventListener("hashchange", syncTab);
  }, []);

  function changeTab(nextTab: OperationsOutreachTab) {
    setActiveTab(nextTab);
    const nextHash = nextTab === "training" ? "#admin/broadcasts?tab=training" : "#admin/broadcasts";
    window.history.replaceState(null, "", nextHash);
  }

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const [broadcastRows, userRows, organizationRows, departmentTree] = await Promise.all([
          fetchAdminBroadcasts(),
          fetchAdminUsers(),
          fetchAdminCustomerOrganizations(),
          fetchDepartmentTree()
        ]);
        if (!active) return;
        setBroadcasts(broadcastRows);
        setUsers(userRows.users);
        setOrganizations(organizationRows.organizations);
        setDepartments(flattenDepartments(departmentTree.departments));
        setSelectedId(broadcastRows[0]?.id ?? null);
      } catch (error) {
        message.error(error instanceof Error ? error.message : "加载运营触达数据失败");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  const orderedBroadcasts = useMemo(
    () => [...broadcasts].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [broadcasts]
  );
  const selectedBroadcast = orderedBroadcasts.find((item) => item.id === selectedId) ?? orderedBroadcasts[0] ?? null;
  const currentBroadcast = editingId ? orderedBroadcasts.find((item) => item.id === editingId) ?? null : null;

  useEffect(() => {
    if (!selectedBroadcast) return;
    void fetchBroadcastDeliveries(selectedBroadcast.id)
      .then(setDeliveries)
      .catch(() => setDeliveries([]));
  }, [selectedBroadcast?.id]);

  const summaryItems = [
    { label: "触达活动", value: String(broadcasts.length), icon: <Radio size={16} /> },
    { label: "可发布", value: String(broadcasts.filter((item) => item.status === "draft" && item.testState?.status === "passed").length), icon: <ShieldCheck size={16} /> },
    { label: "已发送", value: String(broadcasts.filter((item) => item.status === "published").length), icon: <Send size={16} /> },
    { label: "失败记录", value: String(deliveries.filter((item) => item.status === "failed").length), icon: <BarChart3 size={16} /> }
  ];

  function upsertBroadcast(next: BroadcastRecord) {
    setBroadcasts((current) => current.some((item) => item.id === next.id)
      ? current.map((item) => item.id === next.id ? next : item)
      : [next, ...current]);
    setSelectedId(next.id);
  }

  function startNew() {
    setDraft(buildEmptyDraft());
    setEditingId(null);
    setAudiencePreview(null);
    setStep(0);
    setWorkspaceMode("editor");
    setPublishConfirmed(false);
  }

  function startEdit(broadcast: BroadcastRecord) {
    setDraft(draftFromBroadcast(broadcast));
    setEditingId(broadcast.id);
    setAudiencePreview(null);
    setStep(0);
    setWorkspaceMode("editor");
    setPublishConfirmed(false);
  }

  async function saveDraft(): Promise<BroadcastRecord> {
    setSaving(true);
    try {
      const input = buildBroadcastInput(draft);
      const next = editingId ? await updateBroadcastDraft(editingId, input) : await createBroadcastDraft(input);
      setEditingId(next.id);
      upsertBroadcast(next);
      message.success("草稿已保存");
      return next;
    } finally {
      setSaving(false);
    }
  }

  async function handlePreviewAudience() {
    setPreviewing(true);
    try {
      const saved = await saveDraft();
      const preview = await previewBroadcastAudience(saved.id);
      setAudiencePreview(preview);
      const refreshed = await fetchAdminBroadcasts();
      setBroadcasts(refreshed);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "计算发送范围失败");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleSendTest() {
    setTesting(true);
    try {
      const saved = await saveDraft();
      const result = await sendBroadcastTestEmail({ broadcastId: saved.id, testEmail, simulatedUserId });
      upsertBroadcast(result.broadcast);
      Modal.success({
        title: result.mode === "debug" ? "测试邮件已记录为调试发送" : "测试邮件已发送",
        content: `实际发送给 ${testEmail}，变量按模拟用户渲染，邮件正文不包含测试字样。`
      });
    } catch (error) {
      message.error(error instanceof Error ? error.message : "测试邮件发送失败");
    } finally {
      setTesting(false);
    }
  }

  async function handlePublish() {
    if (!editingId) return;
    setPublishing(true);
    try {
      const next = await publishBroadcast(editingId);
      upsertBroadcast(next);
      setWorkspaceMode("overview");
      message.success("触达已正式发送");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "正式发送失败");
    } finally {
      setPublishing(false);
    }
  }

  const canPublish = Boolean(
    editingId &&
    currentBroadcast &&
    (!draft.channelEmailEnabled || currentBroadcast.testState?.status === "passed") &&
    publishConfirmed
  );

  if (loading) {
    return <div style={{ padding: 64, textAlign: "center" }}><Spin size="large" /></div>;
  }

  if (workspaceMode === "editor") {
    return (
      <div className="admin-page-container engagement-workspace">
        <div className="admin-page-header">
          <div>
            <Button type="text" icon={<ChevronLeft size={16} />} onClick={() => setWorkspaceMode("overview")}>返回总览</Button>
            <Typography.Title level={3} style={{ margin: "8px 0 6px" }}>{editingId ? "编辑触达" : "新建触达"}</Typography.Title>
            <Typography.Text type="secondary">内容、受众、测试和发布确认在同一条链路内完成。</Typography.Text>
          </div>
          <Space wrap>
            <Button icon={<Save size={15} />} onClick={() => void saveDraft()} loading={saving}>保存草稿</Button>
            <Button type="primary" onClick={() => setStep(Math.min(4, step + 1))}>下一步</Button>
          </Space>
        </div>

        <Card className="antd-admin-card engagement-step-card" bordered={false}>
          <Steps
            current={step}
            items={[
              { title: "基本信息" },
              { title: "内容设计" },
              { title: "发送范围" },
              { title: "测试发送" },
              { title: "发布确认" }
            ]}
          />
        </Card>

        {step === 0 || step === 1 ? (
          <Row gutter={[20, 20]}>
            <Col xs={24} xl={13}>
              <div className="engagement-panel">
                <div className="engagement-panel-head">
                  <div>
                    <h3>{step === 0 ? "基本信息" : "内容设计"}</h3>
                    <p>邮件预览使用 portal 品牌；正式测试与发布由后端统一渲染。</p>
                  </div>
                </div>
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  <div>
                    <label className="engagement-field-label">触达名称</label>
                    <Input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
                  </div>
                  <div>
                    <label className="engagement-field-label">发送渠道</label>
                    <div className="engagement-channel-grid">
                      <label><Switch checked={draft.channelEmailEnabled} onChange={(checked) => setDraft((current) => ({ ...current, channelEmailEnabled: checked }))} /> <Mail size={15} /> 邮件</label>
                      <label><Switch checked={draft.channelInAppEnabled} onChange={(checked) => setDraft((current) => ({ ...current, channelInAppEnabled: checked }))} /> <Inbox size={15} /> 站内信</label>
                      <label><Switch checked={draft.dingtalkDeliveryEnabled} onChange={(checked) => setDraft((current) => ({ ...current, dingtalkDeliveryEnabled: checked }))} /> <MessageCircle size={15} /> 钉钉</label>
                    </div>
                  </div>
                  <div>
                    <label className="engagement-field-label">模板语言</label>
                    <Segmented
                      value={draft.content.language}
                      options={[{ label: "中文", value: "zh" }, { label: "English", value: "en" }]}
                      onChange={(value) => setDraft((current) => ({ ...current, content: { ...current.content, language: value as "zh" | "en" } }))}
                    />
                  </div>
                  <div>
                    <label className="engagement-field-label">邮件标题</label>
                    <Input value={draft.content.subject} onChange={(event) => setDraft((current) => ({ ...current, content: { ...current.content, subject: event.target.value } }))} />
                  </div>
                  <div>
                    <label className="engagement-field-label">正文内容</label>
                    <Input.TextArea rows={9} value={draft.content.bodyMarkdown} onChange={(event) => setDraft((current) => ({ ...current, bodyMarkdown: event.target.value, content: { ...current.content, bodyMarkdown: event.target.value } }))} />
                  </div>
                  <Row gutter={12}>
                    <Col xs={24} md={10}>
                      <label className="engagement-field-label">按钮文案</label>
                      <Input value={draft.content.ctaLabel} onChange={(event) => setDraft((current) => ({ ...current, content: { ...current.content, ctaLabel: event.target.value } }))} />
                    </Col>
                    <Col xs={24} md={14}>
                      <label className="engagement-field-label">按钮链接</label>
                      <Input value={draft.content.ctaUrl} onChange={(event) => setDraft((current) => ({ ...current, content: { ...current.content, ctaUrl: event.target.value } }))} />
                    </Col>
                  </Row>
                </Space>
              </div>
            </Col>
            <Col xs={24} xl={11}>
              <EmailPreview draft={draft} />
            </Col>
          </Row>
        ) : null}

        {step === 2 ? (
          <AudienceBuilder
            draft={draft}
            onChange={setDraft}
            organizations={organizations}
            departments={departments}
            users={users}
            preview={audiencePreview}
            previewing={previewing}
            onPreview={() => void handlePreviewAudience()}
          />
        ) : null}

        {step === 3 ? (
          <Row gutter={[20, 20]}>
            <Col xs={24} xl={12}>
              <div className="engagement-panel">
                <div className="engagement-panel-head">
                  <div>
                    <h3>测试发送</h3>
                    <p>测试邮件与正式发送完全一致，只替换实际投递邮箱。</p>
                  </div>
                  {currentBroadcast ? <Tag color={testStatusColor(currentBroadcast.testState.status)}>{testStatusLabel(currentBroadcast.testState.status)}</Tag> : null}
                </div>
                <Alert type="info" showIcon message="正式发送前至少成功测试 1 次；邮件正文不会出现任何测试字样。" style={{ marginBottom: 16 }} />
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  <div>
                    <label className="engagement-field-label">测试邮箱</label>
                    <Input value={testEmail} placeholder="like@baicells.com" onChange={(event) => setTestEmail(event.target.value)} />
                  </div>
                  <div>
                    <label className="engagement-field-label">模拟收件人</label>
                    <Select
                      style={{ width: "100%" }}
                      placeholder="从发送范围随机选择"
                      allowClear
                      value={simulatedUserId}
                      onChange={setSimulatedUserId}
                      options={(audiencePreview?.snapshot.sampleRecipients || []).map((recipient) => ({
                        value: recipient.userId,
                        label: `${recipient.displayName || recipient.email || recipient.userId} · ${recipient.organizationName || "-"}`
                      }))}
                    />
                  </div>
                  <Button type="primary" icon={<Send size={15} />} loading={testing} disabled={!testEmail} onClick={() => void handleSendTest()}>
                    发送测试邮件
                  </Button>
                </Space>
              </div>
            </Col>
            <Col xs={24} xl={12}>
              <EmailPreview draft={draft} />
            </Col>
          </Row>
        ) : null}

        {step === 4 ? (
          <Row gutter={[20, 20]}>
            <Col xs={24} xl={13}>
              <div className="engagement-panel">
                <div className="engagement-panel-head">
                  <div>
                    <h3>发布确认</h3>
                    <p>确认内容、渠道、测试状态和最终发送范围后才能正式发送。</p>
                  </div>
                  <Tag color={currentBroadcast?.testState.status === "passed" ? "success" : "warning"}>
                    {currentBroadcast ? testStatusLabel(currentBroadcast.testState.status) : "未保存"}
                  </Tag>
                </div>
                <div className="engagement-confirm-grid">
                  <div><span>发送渠道</span><strong>{[draft.channelEmailEnabled && "邮件", draft.channelInAppEnabled && "站内信", draft.dingtalkDeliveryEnabled && "钉钉"].filter(Boolean).join(" / ")}</strong></div>
                  <div><span>最终收件人</span><strong>{audiencePreview?.snapshot.recipientCount ?? currentBroadcast?.audienceSnapshot?.recipientCount ?? "-"}</strong></div>
                  <div><span>外部客户</span><strong>{audiencePreview?.snapshot.externalCount ?? currentBroadcast?.audienceSnapshot?.externalCount ?? "-"}</strong></div>
                  <div><span>已排除</span><strong>{audiencePreview?.snapshot.excludedCount ?? currentBroadcast?.audienceSnapshot?.excludedCount ?? "-"}</strong></div>
                </div>
                <Checkbox checked={publishConfirmed} onChange={(event) => setPublishConfirmed(event.target.checked)} style={{ marginTop: 18 }}>
                  我确认发送范围和内容无误
                </Checkbox>
                <div className="engagement-sticky-actions">
                  <Button onClick={() => setStep(2)}>返回修改</Button>
                  <Tooltip title={!canPublish ? "邮件渠道需要通过当前内容的测试发送，并勾选确认" : undefined}>
                    <Button type="primary" danger={false} disabled={!canPublish} loading={publishing} icon={<Send size={15} />} onClick={() => void handlePublish()}>
                      正式发送
                    </Button>
                  </Tooltip>
                </div>
              </div>
            </Col>
            <Col xs={24} xl={11}>
              <EmailPreview draft={draft} />
            </Col>
          </Row>
        ) : null}
      </div>
    );
  }

  return (
    <div className="admin-page-container engagement-workspace">
      <div className="admin-page-header">
        <div>
          <Typography.Title level={3} style={{ margin: 0, marginBottom: 8 }}>
            运营触达
          </Typography.Title>
          <Typography.Text type="secondary">用邮件、站内信和钉钉把合适内容发送给合适用户，并完整追踪测试与送达结果。</Typography.Text>
        </div>
        {activeTab === "broadcasts" ? (
          <Button type="primary" icon={<MousePointerClick size={16} />} onClick={startNew}>
            新建触达
          </Button>
        ) : null}
      </div>

      <Tabs
        className="engagement-page-tabs"
        activeKey={activeTab}
        items={[
          { key: "broadcasts", label: "触达活动" },
          { key: "training", label: "培训案例" }
        ]}
        onChange={(key) => changeTab(key as OperationsOutreachTab)}
      />

      {activeTab === "training" ? <TrainingCatalogSettings users={users} /> : (
        <>

      <div className="admin-page-summary-grid">
        {summaryItems.map((item) => (
          <section key={item.label} className="admin-page-summary-card">
            <div className="admin-page-summary-label">{item.icon}{item.label}</div>
            <div className="admin-page-summary-value">{item.value}</div>
            <div className="admin-page-summary-meta">本地时区展示</div>
          </section>
        ))}
      </div>

      <div className={`engagement-overview-grid${isNarrowScreen ? " narrow" : ""}`}>
        <div className="engagement-campaign-list">
          <div className="engagement-list-head">
            <Input.Search placeholder="搜索触达活动" allowClear />
            <Segmented options={["全部", "草稿", "已发送"]} />
          </div>
          {orderedBroadcasts.length ? orderedBroadcasts.map((broadcast) => (
            <button
              key={broadcast.id}
              type="button"
              className={`engagement-campaign-row${selectedBroadcast?.id === broadcast.id ? " active" : ""}`}
              onClick={() => setSelectedId(broadcast.id)}
            >
              <div className="engagement-campaign-row-main">
                <div>
                  <strong>{broadcast.title}</strong>
                  <span>{broadcast.content?.subject || broadcast.bodyMarkdown}</span>
                </div>
                <Tag color={broadcast.status === "published" ? "success" : "warning"}>{statusLabel(broadcast.status)}</Tag>
              </div>
              <div className="engagement-campaign-row-meta">
                <Space size={4} wrap>{channelTags(broadcast)}</Space>
                <span>{broadcast.audienceSnapshot?.recipientCount ?? 0} 人</span>
                <span>{formatLocalDateTime(broadcast.updatedAt)}</span>
              </div>
            </button>
          )) : (
            <Empty description="还没有触达活动" style={{ padding: 40 }} />
          )}
        </div>

        <div className="engagement-detail-panel">
          {selectedBroadcast ? (
            <>
              <div className="engagement-detail-head">
                <div>
                  <Badge status={selectedBroadcast.status === "published" ? "success" : "processing"} text={statusLabel(selectedBroadcast.status)} />
                  <h2>{selectedBroadcast.title}</h2>
                  <p>{selectedBroadcast.content?.subject || selectedBroadcast.bodyMarkdown}</p>
                </div>
                {selectedBroadcast.status === "draft" ? (
                  <Button icon={<FileText size={15} />} onClick={() => startEdit(selectedBroadcast)}>编辑</Button>
                ) : null}
              </div>
              <div className="engagement-detail-metrics">
                <div><Users size={16} /><span>预计触达</span><strong>{selectedBroadcast.audienceSnapshot?.recipientCount ?? 0}</strong></div>
                <div><Mail size={16} /><span>邮件成功</span><strong>{selectedBroadcast.deliverySummary?.emailSent ?? 0}</strong></div>
                <div><Inbox size={16} /><span>站内信</span><strong>{selectedBroadcast.deliverySummary?.inAppSent ?? 0}</strong></div>
                <div><CheckCircle2 size={16} /><span>测试状态</span><strong>{testStatusLabel(selectedBroadcast.testState.status)}</strong></div>
              </div>
              <Divider />
              <div className="engagement-delivery-head">
                <h3>发送结果</h3>
                <Button size="small" icon={<Eye size={14} />} onClick={() => void fetchBroadcastDeliveries(selectedBroadcast.id).then(setDeliveries)}>刷新</Button>
              </div>
              <div className="engagement-delivery-list">
                {deliveries.length ? deliveries.slice(0, 10).map((delivery) => (
                  <div key={delivery.id}>
                    <Tag color={delivery.status === "sent" ? "success" : delivery.status === "failed" ? "error" : "processing"}>
                      {delivery.status}
                    </Tag>
                    <span>{delivery.eventType}</span>
                    <small>{formatLocalDateTime(delivery.createdAt)}</small>
                  </div>
                )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无发送记录" />}
              </div>
            </>
          ) : (
            <Empty description="选择一个触达活动查看详情" />
          )}
        </div>
      </div>
        </>
      )}
    </div>
  );
}

export default BroadcastAdminView;
