import { useEffect, useState } from "react";
import { Alert, Button, Card, Input, Segmented, Select, Space, Switch, Tag } from "antd";

import { updateIntegrationInstance, validateIntegrationInstance } from "./api";
import { IntegrationBindingsEditor } from "./IntegrationBindingsEditor";
import { IntegrationPolicyEditor } from "./IntegrationPolicyEditor";
import { IntegrationValidationHistory } from "./IntegrationValidationHistory";
import type { ActionConnectorConfigDraft, IntegrationDetail } from "./types";

type ActionConnectorTab = "basic" | "bindings" | "policies" | "history";

const TABS: Array<{ id: ActionConnectorTab; label: string }> = [
  { id: "basic", label: "连接配置" },
  { id: "bindings", label: "绑定" },
  { id: "policies", label: "授权" },
  { id: "history", label: "验证历史" }
];

const STATUS_OPTIONS = [
  { label: "active", value: "active" },
  { label: "draft", value: "draft" },
  { label: "disabled", value: "disabled" }
];

const DEFAULTS = {
  healthPath: "/healthz",
  actionListPath: "/api/v1/agent-actions/actions",
  actionSearchPath: "/api/v1/agent-actions/actions/search",
  actionDescribePath: "/api/v1/agent-actions/actions/describe",
  actionPreviewPath: "/api/v1/agent-actions/actions/preview",
  actionExecutePath: "/api/v1/agent-actions/actions/execute",
  delegationHeader: "Authorization"
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function buildDraft(detail: IntegrationDetail): ActionConnectorConfigDraft {
  const policy = asRecord(detail.config.policy);
  return {
    displayName: asString(detail.config.displayName) || detail.instance.name,
    baseUrl: asString(detail.config.baseUrl),
    healthPath: asString(detail.config.healthPath) || DEFAULTS.healthPath,
    actionListPath: asString(detail.config.actionListPath) || DEFAULTS.actionListPath,
    actionSearchPath: asString(detail.config.actionSearchPath) || DEFAULTS.actionSearchPath,
    actionDescribePath: asString(detail.config.actionDescribePath) || DEFAULTS.actionDescribePath,
    actionPreviewPath: asString(detail.config.actionPreviewPath) || DEFAULTS.actionPreviewPath,
    actionExecutePath: asString(detail.config.actionExecutePath) || DEFAULTS.actionExecutePath,
    delegationHeader: asString(detail.config.delegationHeader) || DEFAULTS.delegationHeader,
    allowReadActions: asBoolean(policy.allowReadActions, true),
    allowLowRiskActions: asBoolean(policy.allowLowRiskActions, false),
    allowHighRiskActions: asBoolean(policy.allowHighRiskActions, false)
  };
}

function pathInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function ActionConnectorIntegrationView(props: {
  detail: IntegrationDetail;
  onUpdated(detail: IntegrationDetail): void;
}) {
  const [activeTab, setActiveTab] = useState<ActionConnectorTab>("basic");
  const [name, setName] = useState(props.detail.instance.name);
  const [description, setDescription] = useState(props.detail.instance.description || "");
  const [status, setStatus] = useState(props.detail.instance.status);
  const [draft, setDraft] = useState<ActionConnectorConfigDraft>(() => buildDraft(props.detail));
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");

  useEffect(() => {
    setActiveTab("basic");
    setName(props.detail.instance.name);
    setDescription(props.detail.instance.description || "");
    setStatus(props.detail.instance.status);
    setDraft(buildDraft(props.detail));
    setErrorText("");
    setSuccessText("");
  }, [props.detail]);

  async function handleSave() {
    if (!name.trim()) {
      setErrorText("请填写实例名称");
      return;
    }
    if (!draft.displayName.trim()) {
      setErrorText("请填写连接器显示名称");
      return;
    }
    if (!draft.baseUrl.trim()) {
      setErrorText("请填写 Base URL");
      return;
    }

    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const detail = await updateIntegrationInstance(props.detail.instance.id, {
        name: name.trim(),
        description: description.trim() || null,
        status,
        config: {
          displayName: draft.displayName.trim(),
          baseUrl: draft.baseUrl.trim().replace(/\/+$/, ""),
          healthPath: pathInput(draft.healthPath) || DEFAULTS.healthPath,
          actionListPath: pathInput(draft.actionListPath) || DEFAULTS.actionListPath,
          actionSearchPath: pathInput(draft.actionSearchPath) || DEFAULTS.actionSearchPath,
          actionDescribePath: pathInput(draft.actionDescribePath) || DEFAULTS.actionDescribePath,
          actionPreviewPath: pathInput(draft.actionPreviewPath) || DEFAULTS.actionPreviewPath,
          actionExecutePath: pathInput(draft.actionExecutePath) || DEFAULTS.actionExecutePath,
          delegationHeader: draft.delegationHeader.trim() || DEFAULTS.delegationHeader,
          policy: {
            allowReadActions: draft.allowReadActions,
            allowLowRiskActions: draft.allowLowRiskActions,
            allowHighRiskActions: draft.allowHighRiskActions
          }
        }
      });
      props.onUpdated(detail);
      setSuccessText("Action connector 配置已保存");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存 Action connector 配置失败");
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
      setSuccessText("Action connector 连接校验完成");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "校验 Action connector 失败");
    } finally {
      setValidating(false);
    }
  }

  return (
    <section className="resource-center-detail-stack">
      <Card className="resource-center-section capability-center-summary antd-admin-card" size="small">
        <div className="resource-center-section-header">
          <div>
            <h3>{props.detail.instance.name}</h3>
            <p>连接业务系统的通用 Action API，让 agent 通过受控动作读取或操作外部系统。</p>
          </div>
          <Tag color={status === "active" ? "success" : "default"}>{status}</Tag>
        </div>

        <div className="capability-center-detail-tabs" role="tablist" aria-label="Action connector 集成详情标签">
          <Segmented
            block
            value={activeTab}
            options={TABS.map((tab) => ({ label: tab.label, value: tab.id }))}
            onChange={(value) => setActiveTab(value as ActionConnectorTab)}
          />
        </div>

        {errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={errorText} /> : null}
        {successText ? <Alert type="success" showIcon className="admin-alert-inline" message={successText} /> : null}

        {activeTab === "basic" ? (
          <Space direction="vertical" size={14} className="admin-full-width">
            <div className="resource-center-form-grid">
              <label className="field">
                <span className="field-label">实例名称</span>
                <Input value={name} disabled={saving} onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">状态</span>
                <Select value={status} options={STATUS_OPTIONS} disabled={saving} onChange={setStatus} />
              </label>
              <label className="field">
                <span className="field-label">连接器显示名称</span>
                <Input
                  value={draft.displayName}
                  disabled={saving}
                  placeholder="Operations System"
                  onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))}
                />
              </label>
              <label className="field">
                <span className="field-label">Base URL</span>
                <Input
                  value={draft.baseUrl}
                  disabled={saving}
                  placeholder="https://ops.example.com"
                  onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))}
                />
              </label>
              <label className="field">
                <span className="field-label">Health Path</span>
                <Input
                  value={draft.healthPath}
                  disabled={saving}
                  onChange={(event) => setDraft((current) => ({ ...current, healthPath: event.target.value }))}
                />
              </label>
              <label className="field">
                <span className="field-label">Delegation Header</span>
                <Input
                  value={draft.delegationHeader}
                  disabled={saving}
                  onChange={(event) => setDraft((current) => ({ ...current, delegationHeader: event.target.value }))}
                />
              </label>
            </div>

            <Card size="small" title="Action Paths" className="antd-admin-card">
              <div className="resource-center-form-grid">
                <label className="field">
                  <span className="field-label">List</span>
                  <Input value={draft.actionListPath} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, actionListPath: event.target.value }))} />
                </label>
                <label className="field">
                  <span className="field-label">Search</span>
                  <Input value={draft.actionSearchPath} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, actionSearchPath: event.target.value }))} />
                </label>
                <label className="field">
                  <span className="field-label">Describe</span>
                  <Input value={draft.actionDescribePath} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, actionDescribePath: event.target.value }))} />
                </label>
                <label className="field">
                  <span className="field-label">Preview</span>
                  <Input value={draft.actionPreviewPath} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, actionPreviewPath: event.target.value }))} />
                </label>
                <label className="field resource-center-form-span-2">
                  <span className="field-label">Execute</span>
                  <Input value={draft.actionExecutePath} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, actionExecutePath: event.target.value }))} />
                </label>
              </div>
            </Card>

            <Card size="small" title="Risk Policy" className="antd-admin-card">
              <Space direction="vertical" size={12} className="admin-full-width">
                <label className="field">
                  <span className="field-label">Read actions</span>
                  <Switch checked={draft.allowReadActions} disabled={saving} onChange={(checked) => setDraft((current) => ({ ...current, allowReadActions: checked }))} />
                </label>
                <label className="field">
                  <span className="field-label">Low-risk write actions</span>
                  <Switch checked={draft.allowLowRiskActions} disabled={saving} onChange={(checked) => setDraft((current) => ({ ...current, allowLowRiskActions: checked }))} />
                </label>
                <label className="field">
                  <span className="field-label">High-risk actions</span>
                  <Switch checked={draft.allowHighRiskActions} disabled={saving} onChange={(checked) => setDraft((current) => ({ ...current, allowHighRiskActions: checked }))} />
                </label>
              </Space>
            </Card>

            <label className="field">
              <span className="field-label">实例描述</span>
              <Input.TextArea
                rows={4}
                value={description}
                disabled={saving}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>

            <Space>
              <Button type="primary" onClick={() => void handleSave()} loading={saving}>
                保存配置
              </Button>
              <Button onClick={() => void handleValidate()} loading={validating}>
                校验连接
              </Button>
            </Space>
          </Space>
        ) : null}

        {activeTab === "bindings" ? <IntegrationBindingsEditor instanceId={props.detail.instance.id} /> : null}
        {activeTab === "policies" ? <IntegrationPolicyEditor instanceId={props.detail.instance.id} /> : null}
        {activeTab === "history" ? (
          <IntegrationValidationHistory items={props.detail.validationHistory.items} />
        ) : null}
      </Card>
    </section>
  );
}

