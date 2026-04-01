import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Checkbox, Input, Segmented, Space, Spin } from "antd";

import { fetchIntegrationDetail, updateIntegrationInstance, validateIntegrationInstance } from "./api";
import { IntegrationBindingsEditor } from "./IntegrationBindingsEditor";
import { IntegrationPolicyEditor } from "./IntegrationPolicyEditor";
import { IntegrationValidationHistory } from "./IntegrationValidationHistory";
import type { DingTalkConfigInput, IntegrationDetail, IntegrationListItem, IntegrationSectionTab } from "./types";

const TABS: Array<{ id: IntegrationSectionTab; label: string }> = [
  { id: "basic", label: "基本信息" },
  { id: "config", label: "配置" },
  { id: "history", label: "验证与历史" },
  { id: "bindings", label: "绑定关系" },
  { id: "policies", label: "授权" }
];

const STATUS_OPTIONS = [
  { label: "draft", value: "draft" },
  { label: "active", value: "active" },
  { label: "disabled", value: "disabled" },
  { label: "error", value: "error" }
];

function formatLocalDateTime(value?: string) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function readConfig(detail: IntegrationDetail): DingTalkConfigInput {
  return {
    clientId: typeof detail.config.clientId === "string" ? detail.config.clientId : "",
    redirectUri: typeof detail.config.redirectUri === "string" ? detail.config.redirectUri : "",
    scope: typeof detail.config.scope === "string" ? detail.config.scope : "",
    apiBaseUrl: typeof detail.config.apiBaseUrl === "string" ? detail.config.apiBaseUrl : "",
    alertAgentId: typeof detail.config.alertAgentId === "string" ? detail.config.alertAgentId : "",
    alertUserIds: Array.isArray(detail.config.alertUserIds)
      ? detail.config.alertUserIds.filter((item): item is string => typeof item === "string")
      : []
  };
}

export function DingTalkIntegrationView(props: {
  instanceId: string;
  onInstanceUpdated?(instance: IntegrationListItem): void;
}) {
  const [detail, setDetail] = useState<IntegrationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");
  const [activeTab, setActiveTab] = useState<IntegrationSectionTab>("basic");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("draft");
  const [configDraft, setConfigDraft] = useState<DingTalkConfigInput>({});
  const [clientSecretDraft, setClientSecretDraft] = useState("");
  const [clearSecretState, setClearSecretState] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setErrorText("");
      try {
        const next = await fetchIntegrationDetail(props.instanceId);
        if (!active) return;
        setDetail(next);
        setName(next.instance.name);
        setDescription(next.instance.description || "");
        setStatus(next.instance.status);
        setConfigDraft(readConfig(next));
        setClientSecretDraft("");
        setClearSecretState(false);
      } catch (error) {
        if (active) setErrorText(error instanceof Error ? error.message : "加载 DingTalk 集成失败");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [props.instanceId]);

  const alertUserIdsText = useMemo(() => (configDraft.alertUserIds || []).join("\n"), [configDraft.alertUserIds]);

  async function handleSave() {
    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const next = await updateIntegrationInstance(props.instanceId, {
        name: name.trim(),
        description: description.trim() || null,
        status,
        config: {
          clientId: configDraft.clientId?.trim() || "",
          redirectUri: configDraft.redirectUri?.trim() || "",
          scope: configDraft.scope?.trim() || "",
          apiBaseUrl: configDraft.apiBaseUrl?.trim() || "",
          alertAgentId: configDraft.alertAgentId?.trim() || "",
          alertUserIds: alertUserIdsText
            .split(/\n|,/g)
            .map((item) => item.trim())
            .filter(Boolean)
        },
        secretState: clearSecretState ? null : clientSecretDraft.trim() ? { clientSecret: clientSecretDraft.trim() } : undefined
      });
      setDetail(next);
      setClientSecretDraft("");
      setClearSecretState(false);
      props.onInstanceUpdated?.(next.instance);
      setSuccessText("DingTalk 集成已保存");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存 DingTalk 集成失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleValidate() {
    setValidating(true);
    setErrorText("");
    setSuccessText("");
    try {
      const next = await validateIntegrationInstance(props.instanceId);
      setDetail(next.detail);
      props.onInstanceUpdated?.(next.detail.instance);
      setSuccessText("DingTalk 凭证验证已完成");
      setActiveTab("history");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "DingTalk 验证失败");
    } finally {
      setValidating(false);
    }
  }

  if (loading || !detail) {
    return (
      <section className="resource-center-section">
        <div className="admin-workspace-loading">
          <Spin size="small" />
        </div>
      </section>
    );
  }

  return (
    <section className="resource-center-section integration-detail-shell antd-admin-card">
      <div className="resource-center-section-header">
        <div>
          <h3>DingTalk</h3>
          <p>登录、组织同步和通知配置统一在这里维护。</p>
        </div>
        <Space>
          <Button disabled={validating} onClick={() => void handleValidate()}>
            {validating ? "验证中..." : "验证连接"}
          </Button>
          <Button type="primary" disabled={saving} onClick={() => void handleSave()}>
            {saving ? "保存中..." : "保存集成"}
          </Button>
        </Space>
      </div>

      {errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={errorText} /> : null}
      {successText ? <Alert type="success" showIcon className="admin-alert-inline" message={successText} /> : null}

      <div className="resource-center-type-tabs" role="tablist" aria-label="DingTalk 详情页签">
        <Segmented
          block
          value={activeTab}
          options={TABS.map((tab) => ({ label: tab.label, value: tab.id }))}
          onChange={(value) => setActiveTab(value as IntegrationSectionTab)}
        />
      </div>

      {activeTab === "basic" ? (
        <div className="integration-form-grid">
          <label className="field">
            <span className="field-label">实例名称</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">状态</span>
            <Segmented value={status} options={STATUS_OPTIONS} onChange={(value) => setStatus(String(value))} />
          </label>
          <label className="field integration-field-span-2">
            <span className="field-label">说明</span>
            <Input.TextArea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <Card size="small" className="resource-center-summary-grid compact integration-summary-card integration-field-span-2 antd-admin-card">
            <div><span className="field-label">slug</span><p>{detail.instance.slug}</p></div>
            <div><span className="field-label">创建时间</span><p>{formatLocalDateTime(detail.instance.createdAt)}</p></div>
            <div><span className="field-label">更新时间</span><p>{formatLocalDateTime(detail.instance.updatedAt)}</p></div>
            <div><span className="field-label">密钥状态</span><p>{detail.secretState.hasSecrets ? "已保存密钥" : "未保存密钥"}</p></div>
          </Card>
        </div>
      ) : null}

      {activeTab === "config" ? (
        <div className="integration-form-grid">
          <label className="field">
            <span className="field-label">Client ID</span>
            <Input value={configDraft.clientId || ""} onChange={(event) => setConfigDraft((current) => ({ ...current, clientId: event.target.value }))} />
          </label>
          <label className="field">
            <span className="field-label">Redirect URI</span>
            <Input value={configDraft.redirectUri || ""} onChange={(event) => setConfigDraft((current) => ({ ...current, redirectUri: event.target.value }))} />
          </label>
          <label className="field">
            <span className="field-label">Scope</span>
            <Input value={configDraft.scope || ""} onChange={(event) => setConfigDraft((current) => ({ ...current, scope: event.target.value }))} />
          </label>
          <label className="field">
            <span className="field-label">API Base URL</span>
            <Input value={configDraft.apiBaseUrl || ""} onChange={(event) => setConfigDraft((current) => ({ ...current, apiBaseUrl: event.target.value }))} />
          </label>
          <label className="field">
            <span className="field-label">通知 Agent ID</span>
            <Input value={configDraft.alertAgentId || ""} onChange={(event) => setConfigDraft((current) => ({ ...current, alertAgentId: event.target.value }))} />
          </label>
          <label className="field">
            <span className="field-label">Client Secret</span>
            <Input.Password value={clientSecretDraft} placeholder={detail.secretState.hasSecrets ? "已保存密钥" : ""} onChange={(event) => { setClientSecretDraft(event.target.value); setClearSecretState(false); }} />
          </label>
          <label className="field integration-field-span-2">
            <span className="field-label">通知用户 IDs</span>
            <Input.TextArea rows={4} value={alertUserIdsText} onChange={(event) => setConfigDraft((current) => ({ ...current, alertUserIds: event.target.value.split(/\n|,/g).map((item) => item.trim()).filter(Boolean) }))} />
          </label>
          <label className="field integration-checkbox-row integration-field-span-2">
            <Checkbox checked={clearSecretState} onChange={(event) => setClearSecretState(event.target.checked)}>
              清空当前保存的 Client Secret
            </Checkbox>
          </label>
        </div>
      ) : null}

      {activeTab === "history" ? <IntegrationValidationHistory items={detail.validationHistory.items} /> : null}
      {activeTab === "bindings" ? <IntegrationBindingsEditor instanceId={props.instanceId} /> : null}
      {activeTab === "policies" ? <IntegrationPolicyEditor instanceId={props.instanceId} /> : null}
    </section>
  );
}
