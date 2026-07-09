import { useEffect, useState } from "react";
import { Alert, Button, Card, Descriptions, Input, Segmented, Select, Space, Tag, Typography } from "antd";

import { updateIntegrationInstance, validateIntegrationInstance } from "./api";
import { DEFAULT_ACTION_CONNECTOR_RUNTIME_PROMPT } from "./actionConnectorRuntimePrompt";
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

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function buildDraft(detail: IntegrationDetail): ActionConnectorConfigDraft {
  return {
    displayName: asString(detail.config.displayName) || detail.instance.name,
    runtimePrompt: asString(detail.config.runtimePrompt) || DEFAULT_ACTION_CONNECTOR_RUNTIME_PROMPT
  };
}

function activeActionConnectorConfig(config: Record<string, unknown>): Record<string, unknown> {
  const next = { ...config };
  delete next.runtimeInstruction;
  delete next.baseUrl;
  delete next.healthPath;
  delete next.delegationHeader;
  delete next.actionListPath;
  delete next.actionSearchPath;
  delete next.actionDescribePath;
  delete next.actionPreviewPath;
  delete next.actionExecutePath;
  delete next.identityPath;
  return next;
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

    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const detail = await updateIntegrationInstance(props.detail.instance.id, {
        name: name.trim(),
        description: description.trim() || null,
        status,
        config: {
          ...activeActionConnectorConfig(props.detail.config),
          displayName: draft.displayName.trim(),
          runtimePrompt: draft.runtimePrompt.trim() || DEFAULT_ACTION_CONNECTOR_RUNTIME_PROMPT
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
      setSuccessText("Action connector 配置校验完成");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "校验 Action connector 配置失败");
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
            <p>连接外部业务系统，让 agent 通过受控工具请求读取或操作系统能力。</p>
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
            </div>

            <Card size="small" title="Connector" className="antd-admin-card">
              <Descriptions size="small" column={1}>
                <Descriptions.Item label="Connector ID">
                  <Typography.Text code copyable>{props.detail.instance.id}</Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="Slug">
                  <Typography.Text code>{props.detail.instance.slug}</Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="Agent Mode">
                  <Typography.Text code>{asString(props.detail.config.agentModeId) || "default"}</Typography.Text>
                </Descriptions.Item>
              </Descriptions>
            </Card>

            <Card size="small" title="Runtime Prompt" className="antd-admin-card">
              <Space direction="vertical" size={12} className="admin-full-width">
                <Alert
                  type="info"
                  showIcon
                  className="admin-alert-inline"
                  message="这是 Action Connector 的协议层 prompt 模板。业务规则应放在 Agent Mode 的 AGENTS.md；这里只描述工具协议、安全边界和动态上下文占位符。"
                />
                <label className="field">
                  <span className="field-label">Prompt 模板</span>
                  <Input.TextArea
                    rows={12}
                    value={draft.runtimePrompt}
                    disabled={saving}
                    spellCheck={false}
                    onChange={(event) => setDraft((current) => ({ ...current, runtimePrompt: event.target.value }))}
                  />
                </label>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                  <span className="field-help">
                    可用占位符：{"{{displayName}}"}, {"{{conversationId}}"}, {"{{runId}}"}, {"{{locale}}"}, {"{{timezone}}"}, {"{{mode}}"}, {"{{policyJson}}"}, {"{{approvedActionBlock}}"}, {"{{contextJson}}"}, {"{{cliPathJson}}"}, {"{{message}}"}
                  </span>
                  <Button
                    type="default"
                    disabled={saving}
                    onClick={() => setDraft((current) => ({ ...current, runtimePrompt: DEFAULT_ACTION_CONNECTOR_RUNTIME_PROMPT }))}
                  >
                    恢复默认
                  </Button>
                </div>
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
                校验配置
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
