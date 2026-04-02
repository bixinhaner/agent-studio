import { useEffect, useState } from "react";
import { Alert, Button, Card, Collapse, Input, InputNumber, Segmented, Select, Space, Switch, Tag } from "antd";

import { fetchIntegrationDetail, runZendeskIntegrationTicket, updateIntegrationInstance, validateIntegrationInstance } from "./api";
import { IntegrationBindingsEditor } from "./IntegrationBindingsEditor";
import { IntegrationPolicyEditor } from "./IntegrationPolicyEditor";
import { IntegrationValidationHistory } from "./IntegrationValidationHistory";
import type { IntegrationDetail, ZendeskConfigDraft } from "./types";
import type { ZendeskRunRecord } from "../zendesk/types";
import "../zendesk/zendesk.css";

type ZendeskTab = "basic" | "operations" | "bindings" | "policies" | "history";

const TABS: Array<{ id: ZendeskTab; label: string }> = [
  { id: "basic", label: "基本信息" },
  { id: "operations", label: "Webhook / 运行" },
  { id: "bindings", label: "绑定关系" },
  { id: "policies", label: "授权" },
  { id: "history", label: "验证与历史" }
];

const STATUS_OPTIONS = [
  { label: "active", value: "active" },
  { label: "disabled", value: "disabled" },
  { label: "draft", value: "draft" }
];

const RESPONSE_MODE_OPTIONS = [
  { label: "public_reply", value: "public_reply" },
  { label: "internal_note", value: "internal_note" }
];

const FALLBACK_MODE_OPTIONS = [
  { label: "internal_note", value: "internal_note" },
  { label: "public_reply", value: "public_reply" },
  { label: "disabled", value: "disabled" }
];

const AUTO_STATUS_OPTIONS = [
  { label: "pending", value: "pending" },
  { label: "open", value: "open" },
  { label: "hold", value: "hold" },
  { label: "solved", value: "solved" }
];

const REASONING_OPTIONS = [
  { label: "none", value: "none" },
  { label: "minimal", value: "minimal" },
  { label: "low", value: "low" },
  { label: "medium", value: "medium" },
  { label: "high", value: "high" },
  { label: "xhigh", value: "xhigh" }
];

const SANDBOX_OPTIONS = [
  { label: "read-only", value: "read-only" },
  { label: "workspace-write", value: "workspace-write" },
  { label: "danger-full-access", value: "danger-full-access" }
];

const APPROVAL_OPTIONS = [
  { label: "never", value: "never" },
  { label: "on-request", value: "on-request" },
  { label: "on-failure", value: "on-failure" },
  { label: "untrusted", value: "untrusted" }
];

const WEB_SEARCH_OPTIONS = [
  { label: "disabled", value: "disabled" },
  { label: "cached", value: "cached" },
  { label: "live", value: "live" }
];

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asBoolean(value: unknown) {
  return Boolean(value);
}

function asNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asListText(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean).join(", ") : "";
}

function buildDraft(detail: IntegrationDetail): ZendeskConfigDraft {
  return {
    enabled: asBoolean(detail.config.enabled),
    publicBaseUrl: asString(detail.config.publicBaseUrl),
    zendeskBaseUrl: asString(detail.config.zendeskBaseUrl),
    zendeskEmail: asString(detail.config.zendeskEmail),
    zendeskApiTokenDraft: "",
    webhookSigningSecretDraft: "",
    responseMode: asString(detail.config.responseMode) || "public_reply",
    fallbackMode: asString(detail.config.fallbackMode) || "internal_note",
    autoStatus: asString(detail.config.autoStatus) || "pending",
    excludedTagsRaw: asListText(detail.config.excludedTags),
    workspace: asString(detail.config.workspace),
    model: asString(detail.config.model),
    reasoningEffort: asString(detail.config.reasoningEffort),
    sandboxMode: asString(detail.config.sandboxMode) || "workspace-write",
    approvalPolicy: asString(detail.config.approvalPolicy) || "never",
    networkAccessEnabled: asBoolean(detail.config.networkAccessEnabled),
    webSearchMode: asString(detail.config.webSearchMode) || "live",
    additionalDirectoriesRaw: asListText(detail.config.additionalDirectories),
    maxCommentHistory: asNumber(detail.config.maxCommentHistory, 12),
    systemPrompt: asString(detail.config.systemPrompt)
  };
}

function parseList(value: string) {
  return value
    .split(/,|\n/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionsWithCurrent(options: Array<{ label: string; value: string }>, value: string) {
  if (!value) return options;
  if (options.some((item) => item.value === value)) return options;
  return [{ label: value, value }, ...options];
}

function formatLocalDateTime(value?: string) {
  if (!value) return "-";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(at);
}

function runStatusLabel(run: ZendeskRunRecord) {
  const map: Record<ZendeskRunRecord["status"], string> = {
    received: "已接收",
    skipped: "已跳过",
    processing: "处理中",
    replied: "已公开回复",
    noted: "已写内部备注",
    handoff: "待人工接管",
    failed: "执行失败"
  };
  return map[run.status];
}

export function ZendeskIntegrationView(props: {
  detail: IntegrationDetail;
  onUpdated(detail: IntegrationDetail): void;
}) {
  const [activeTab, setActiveTab] = useState<ZendeskTab>("basic");
  const [name, setName] = useState(props.detail.instance.name);
  const [description, setDescription] = useState(props.detail.instance.description || "");
  const [status, setStatus] = useState(props.detail.instance.status);
  const [draft, setDraft] = useState<ZendeskConfigDraft>(() => buildDraft(props.detail));
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [refreshingOperations, setRefreshingOperations] = useState(false);
  const [runningTicket, setRunningTicket] = useState(false);
  const [manualTicketId, setManualTicketId] = useState("");
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");

  useEffect(() => {
    setName(props.detail.instance.name);
    setDescription(props.detail.instance.description || "");
    setStatus(props.detail.instance.status);
    setDraft(buildDraft(props.detail));
  }, [props.detail]);

  useEffect(() => {
    setManualTicketId("");
    setErrorText("");
    setSuccessText("");
  }, [props.detail.instance.id]);

  async function handleSave() {
    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const detail = await updateIntegrationInstance(props.detail.instance.id, {
        name: name.trim(),
        description: description.trim() || null,
        status,
        config: {
          enabled: draft.enabled,
          publicBaseUrl: draft.publicBaseUrl.trim(),
          zendeskBaseUrl: draft.zendeskBaseUrl.trim(),
          zendeskEmail: draft.zendeskEmail.trim(),
          responseMode: draft.responseMode.trim(),
          fallbackMode: draft.fallbackMode.trim(),
          autoStatus: draft.autoStatus.trim(),
          excludedTags: parseList(draft.excludedTagsRaw),
          workspace: draft.workspace.trim(),
          model: draft.model.trim(),
          reasoningEffort: draft.reasoningEffort.trim(),
          sandboxMode: draft.sandboxMode.trim(),
          approvalPolicy: draft.approvalPolicy.trim(),
          networkAccessEnabled: draft.networkAccessEnabled,
          webSearchMode: draft.webSearchMode.trim(),
          additionalDirectories: parseList(draft.additionalDirectoriesRaw),
          maxCommentHistory: Math.max(1, Math.min(50, Number(draft.maxCommentHistory) || 12)),
          systemPrompt: draft.systemPrompt.trim()
        },
        secretState:
          draft.zendeskApiTokenDraft.trim() || draft.webhookSigningSecretDraft.trim()
            ? {
                ...(draft.zendeskApiTokenDraft.trim() ? { zendeskApiToken: draft.zendeskApiTokenDraft.trim() } : {}),
                ...(draft.webhookSigningSecretDraft.trim()
                  ? { webhookSigningSecret: draft.webhookSigningSecretDraft.trim() }
                  : {})
              }
            : undefined
      });
      props.onUpdated(detail);
      setSuccessText("Zendesk 集成已保存");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存 Zendesk 集成失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleValidate() {
    setValidating(true);
    setErrorText("");
    setSuccessText("");
    try {
      const result = await validateIntegrationInstance(props.detail.instance.id);
      props.onUpdated(result.detail);
      if (result.validation.status === "success") {
        setSuccessText("Zendesk 验证通过");
      } else {
        setErrorText(
          typeof result.validation.detail === "object" && result.validation.detail && "error" in result.validation.detail
            ? String((result.validation.detail as { error?: unknown }).error || "Zendesk 验证失败")
            : "Zendesk 验证失败"
        );
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "验证 Zendesk 集成失败");
    } finally {
      setValidating(false);
    }
  }

  async function handleRefreshOperations() {
    setRefreshingOperations(true);
    setErrorText("");
    setSuccessText("");
    try {
      props.onUpdated(await fetchIntegrationDetail(props.detail.instance.id));
      setSuccessText("Webhook 与运行记录已刷新");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "刷新 Zendesk 运维数据失败");
    } finally {
      setRefreshingOperations(false);
    }
  }

  async function handleManualRun() {
    if (!manualTicketId.trim()) {
      setErrorText("请输入要测试的 ticket ID");
      setSuccessText("");
      return;
    }
    setRunningTicket(true);
    setErrorText("");
    setSuccessText("");
    try {
      const result = await runZendeskIntegrationTicket(props.detail.instance.id, manualTicketId.trim());
      props.onUpdated(result.detail);
      setSuccessText(`已执行 ticket #${manualTicketId.trim()} 的手动处理`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "手动执行 Zendesk ticket 失败");
    } finally {
      setRunningTicket(false);
    }
  }

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setSuccessText(`${label} 已复制`);
      setErrorText("");
    } catch {
      setErrorText(`复制 ${label} 失败`);
    }
  }

  return (
    <section className="resource-center-detail-stack">
      <Card className="resource-center-section capability-center-summary antd-admin-card" size="small">
        <div className="resource-center-section-header">
          <div>
            <h3>{props.detail.instance.name}</h3>
            <p>管理 Zendesk 站点、Webhook、模型与运行参数。</p>
          </div>
          <Tag color={status === "active" ? "success" : "default"}>{status}</Tag>
        </div>

        <div className="capability-center-detail-tabs" role="tablist" aria-label="Zendesk 详情标签">
          <Segmented
            block
            value={activeTab}
            options={TABS.map((tab) => ({ label: tab.label, value: tab.id }))}
            onChange={(value) => setActiveTab(value as ZendeskTab)}
          />
        </div>

        {errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={errorText} /> : null}
        {successText ? <Alert type="success" showIcon className="admin-alert-inline" message={successText} /> : null}

        {activeTab === "basic" ? (
          <>
            <Collapse
              size="small"
              defaultActiveKey={["identity", "connection", "runtime", "advanced"]}
              items={[
                {
                  key: "identity",
                  label: "基础信息",
                  children: (
                    <div className="resource-center-form-grid">
                      <label className="field">
                        <span className="field-label">实例名称</span>
                        <Input value={name} disabled={saving} onChange={(event) => setName(event.target.value)} />
                      </label>
                      <label className="field">
                        <span className="field-label">实例 slug</span>
                        <Input value={props.detail.instance.slug} disabled />
                      </label>
                      <label className="field resource-center-form-span-2">
                        <span className="field-label">实例描述</span>
                        <Input.TextArea
                          rows={4}
                          value={description}
                          disabled={saving}
                          onChange={(event) => setDescription(event.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">状态</span>
                        <Select value={status} options={STATUS_OPTIONS} disabled={saving} onChange={(value) => setStatus(value)} />
                      </label>
                      <label className="field checkbox-field resource-center-toggle-row">
                        <Switch
                          checked={draft.enabled}
                          disabled={saving}
                          checkedChildren="启用"
                          unCheckedChildren="停用"
                          onChange={(checked) => setDraft((current) => ({ ...current, enabled: checked }))}
                        />
                        <span className="field-label">启用集成</span>
                      </label>
                      <div className="field">
                        <span className="field-label">密钥状态</span>
                        <p className="resource-center-subtle">
                          {props.detail.secretState.hasSecrets ? "已保存 Zendesk 凭证" : "未保存 Zendesk 凭证"}
                        </p>
                      </div>
                    </div>
                  )
                },
                {
                  key: "connection",
                  label: "连接与密钥",
                  children: (
                    <div className="resource-center-form-grid">
                      <label className="field resource-center-form-span-2">
                        <span className="field-label">Public Base URL</span>
                        <Input
                          value={draft.publicBaseUrl}
                          disabled={saving}
                          onChange={(event) => setDraft((current) => ({ ...current, publicBaseUrl: event.target.value }))}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Zendesk Base URL</span>
                        <Input
                          value={draft.zendeskBaseUrl}
                          disabled={saving}
                          onChange={(event) => setDraft((current) => ({ ...current, zendeskBaseUrl: event.target.value }))}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Zendesk Email</span>
                        <Input
                          value={draft.zendeskEmail}
                          disabled={saving}
                          onChange={(event) => setDraft((current) => ({ ...current, zendeskEmail: event.target.value }))}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Zendesk API Token</span>
                        <Input.Password
                          value={draft.zendeskApiTokenDraft}
                          placeholder="留空则保持现状"
                          disabled={saving}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, zendeskApiTokenDraft: event.target.value }))
                          }
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Webhook Secret</span>
                        <Input.Password
                          value={draft.webhookSigningSecretDraft}
                          placeholder="留空则保持现状"
                          disabled={saving}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, webhookSigningSecretDraft: event.target.value }))
                          }
                        />
                      </label>
                    </div>
                  )
                },
                {
                  key: "runtime",
                  label: "运行参数",
                  children: (
                    <div className="resource-center-form-grid">
                      <label className="field">
                        <span className="field-label">Response Mode</span>
                        <Select
                          value={draft.responseMode}
                          options={optionsWithCurrent(RESPONSE_MODE_OPTIONS, draft.responseMode)}
                          disabled={saving}
                          onChange={(value) => setDraft((current) => ({ ...current, responseMode: value }))}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Fallback Mode</span>
                        <Select
                          value={draft.fallbackMode}
                          options={optionsWithCurrent(FALLBACK_MODE_OPTIONS, draft.fallbackMode)}
                          disabled={saving}
                          onChange={(value) => setDraft((current) => ({ ...current, fallbackMode: value }))}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Auto Status</span>
                        <Select
                          value={draft.autoStatus}
                          options={optionsWithCurrent(AUTO_STATUS_OPTIONS, draft.autoStatus)}
                          disabled={saving}
                          onChange={(value) => setDraft((current) => ({ ...current, autoStatus: value }))}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Workspace</span>
                        <Input
                          value={draft.workspace}
                          disabled={saving}
                          onChange={(event) => setDraft((current) => ({ ...current, workspace: event.target.value }))}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Model</span>
                        <Input
                          value={draft.model}
                          disabled={saving}
                          onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Reasoning Effort</span>
                        <Select
                          value={draft.reasoningEffort}
                          options={optionsWithCurrent(REASONING_OPTIONS, draft.reasoningEffort)}
                          disabled={saving}
                          onChange={(value) => setDraft((current) => ({ ...current, reasoningEffort: value }))}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Sandbox Mode</span>
                        <Select
                          value={draft.sandboxMode}
                          options={optionsWithCurrent(SANDBOX_OPTIONS, draft.sandboxMode)}
                          disabled={saving}
                          onChange={(value) => setDraft((current) => ({ ...current, sandboxMode: value }))}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Approval Policy</span>
                        <Select
                          value={draft.approvalPolicy}
                          options={optionsWithCurrent(APPROVAL_OPTIONS, draft.approvalPolicy)}
                          disabled={saving}
                          onChange={(value) => setDraft((current) => ({ ...current, approvalPolicy: value }))}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Web Search Mode</span>
                        <Select
                          value={draft.webSearchMode}
                          options={optionsWithCurrent(WEB_SEARCH_OPTIONS, draft.webSearchMode)}
                          disabled={saving}
                          onChange={(value) => setDraft((current) => ({ ...current, webSearchMode: value }))}
                        />
                      </label>
                      <label className="field checkbox-field resource-center-toggle-row">
                        <Switch
                          checked={draft.networkAccessEnabled}
                          disabled={saving}
                          checkedChildren="联网"
                          unCheckedChildren="离线"
                          onChange={(checked) => setDraft((current) => ({ ...current, networkAccessEnabled: checked }))}
                        />
                        <span className="field-label">允许联网</span>
                      </label>
                      <label className="field">
                        <span className="field-label">最大评论历史</span>
                        <InputNumber
                          min={1}
                          max={50}
                          value={Number(draft.maxCommentHistory) || 12}
                          disabled={saving}
                          onChange={(value) =>
                            setDraft((current) => ({ ...current, maxCommentHistory: Number(value) || 12 }))
                          }
                          style={{ width: "100%" }}
                        />
                      </label>
                    </div>
                  )
                },
                {
                  key: "advanced",
                  label: "高级配置",
                  children: (
                    <div className="resource-center-form-grid">
                      <label className="field resource-center-form-span-2">
                        <span className="field-label">排除标签</span>
                        <Input.TextArea
                          rows={2}
                          value={draft.excludedTagsRaw}
                          disabled={saving}
                          onChange={(event) => setDraft((current) => ({ ...current, excludedTagsRaw: event.target.value }))}
                        />
                      </label>
                      <label className="field resource-center-form-span-2">
                        <span className="field-label">附加目录</span>
                        <Input.TextArea
                          rows={2}
                          value={draft.additionalDirectoriesRaw}
                          disabled={saving}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, additionalDirectoriesRaw: event.target.value }))
                          }
                        />
                      </label>
                      <label className="field resource-center-form-span-2">
                        <span className="field-label">System Prompt</span>
                        <Input.TextArea
                          className="integration-center-large-textarea"
                          rows={8}
                          value={draft.systemPrompt}
                          disabled={saving}
                          onChange={(event) => setDraft((current) => ({ ...current, systemPrompt: event.target.value }))}
                        />
                      </label>
                    </div>
                  )
                }
              ]}
            />

            <div className="resource-center-actions">
              <Space>
                <Button onClick={() => void handleValidate()} disabled={saving || validating}>
                  {validating ? "验证中..." : "验证实例"}
                </Button>
                <Button type="primary" onClick={() => void handleSave()} disabled={saving || validating}>
                  {saving ? "保存中..." : "保存实例"}
                </Button>
              </Space>
            </div>
          </>
        ) : null}

        {activeTab === "operations" ? (
          <>
            <div className="zendesk-summary-grid">
              <div>
                <strong>启用状态</strong>
                <p>{draft.enabled ? "已启用 webhook 自动答复" : "未启用 webhook 自动答复"}</p>
              </div>
              <div>
                <strong>最近验证</strong>
                <p>
                  {props.detail.zendesk
                    ? props.detail.config.lastValidatedAt
                      ? formatLocalDateTime(String(props.detail.config.lastValidatedAt))
                      : "尚未验证"
                    : "暂无运维数据"}
                </p>
              </div>
            </div>

            {props.detail.zendesk?.missing?.length ? (
              <Alert
                type="warning"
                showIcon
                className="admin-alert-inline"
                message={`缺少关键项：${props.detail.zendesk.missing.join(", ")}`}
              />
            ) : null}

            <div className="zendesk-section">
              <h4>Webhook Setup</h4>
              <div className="zendesk-inline-actions">
                <Button onClick={() => void copyText(props.detail.zendesk?.setup.webhookUrl || "", "Webhook URL")}>
                  复制 Webhook URL
                </Button>
                <Button onClick={() => void copyText(props.detail.zendesk?.setup.payloadExample || "", "Payload 示例")}>
                  复制 Payload
                </Button>
              </div>
              <label className="field">
                <span className="field-label">Webhook URL</span>
                <Input readOnly value={props.detail.zendesk?.setup.webhookUrl || ""} />
              </label>
              <div className="zendesk-code-block">
                <pre>{props.detail.zendesk?.setup.payloadExample || ""}</pre>
              </div>
              <div className="zendesk-trigger-list">
                {(props.detail.zendesk?.setup.triggers || []).map((item) => (
                  <div key={item.name} className="zendesk-trigger-card">
                    <strong>{item.name}</strong>
                    <p>{item.description}</p>
                    <ul>
                      {item.conditions.map((condition) => (
                        <li key={condition}>{condition}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>

            <div className="zendesk-section">
              <h4>操作与日志</h4>
              <div className="zendesk-inline-actions zendesk-manual-run-row">
                <Input
                  value={manualTicketId}
                  onChange={(event) => setManualTicketId(event.target.value)}
                  placeholder="输入 Zendesk ticket ID 进行手动测试"
                />
                <Button type="primary" onClick={() => void handleManualRun()} disabled={runningTicket}>
                  {runningTicket ? "执行中..." : "手动执行"}
                </Button>
              </div>

              <div className="zendesk-inline-actions">
                <Button onClick={() => void handleRefreshOperations()} disabled={refreshingOperations}>
                  {refreshingOperations ? "刷新中..." : "刷新"}
                </Button>
                <Button onClick={() => void handleValidate()} disabled={saving || validating || refreshingOperations}>
                  {validating ? "验证中..." : "验证凭证"}
                </Button>
                <Button type="primary" onClick={() => void handleSave()} disabled={saving || validating || refreshingOperations}>
                  {saving ? "保存中..." : "保存配置"}
                </Button>
              </div>

              <div className="zendesk-run-list">
                {props.detail.zendesk?.runs?.length ? (
                  props.detail.zendesk.runs.map((run) => (
                    <article key={run.id} className={`zendesk-run-card zendesk-run-${run.status}`}>
                      <div className="zendesk-run-head">
                        <strong>#{run.ticketId}</strong>
                        <span className={`zendesk-run-badge zendesk-run-badge-${run.status}`}>{runStatusLabel(run)}</span>
                      </div>
                      <p className="zendesk-run-title">{run.ticketSubject || "未命名工单"}</p>
                      <p>{run.detail}</p>
                      <p className="field-help">
                        {formatLocalDateTime(run.updatedAt)} · {run.source === "manual" ? "手动" : "webhook"}
                        {run.commentId ? ` · comment ${run.commentId}` : ""}
                        {run.requesterCommentId ? ` · requester ${run.requesterCommentId}` : ""}
                      </p>
                      {run.error ? <p className="err-text">{run.error}</p> : null}
                    </article>
                  ))
                ) : (
                  <p className="field-help">暂无执行记录。</p>
                )}
              </div>
            </div>
          </>
        ) : null}

        {activeTab === "bindings" ? <IntegrationBindingsEditor instanceId={props.detail.instance.id} /> : null}
        {activeTab === "policies" ? <IntegrationPolicyEditor instanceId={props.detail.instance.id} /> : null}
        {activeTab === "history" ? <IntegrationValidationHistory items={props.detail.validationHistory.items} /> : null}
      </Card>
    </section>
  );
}
