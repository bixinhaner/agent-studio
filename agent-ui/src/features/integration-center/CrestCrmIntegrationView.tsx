import { useEffect, useState } from "react";
import { Alert, Button, Card, Input, Segmented, Select, Space, Tag } from "antd";

import { updateIntegrationInstance, validateIntegrationInstance } from "./api";
import { IntegrationBindingsEditor } from "./IntegrationBindingsEditor";
import { IntegrationPolicyEditor } from "./IntegrationPolicyEditor";
import { IntegrationValidationHistory } from "./IntegrationValidationHistory";
import type { CrestCrmConfigDraft, IntegrationDetail } from "./types";

type CrestTab = "basic" | "bindings" | "policies" | "history";

const TABS: Array<{ id: CrestTab; label: string }> = [
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

const DEFAULT_MCP_RPC_PATH = "/v1/agent-studio/mcp/rpc";
const DEFAULT_ACTION_CATALOG_PATH = "/v1/agent-actions/catalog";

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function buildDraft(detail: IntegrationDetail): CrestCrmConfigDraft {
  return {
    baseUrl: asString(detail.config.baseUrl) || "https://crest.baicells.com",
    mcpRpcPath: asString(detail.config.mcpRpcPath) || DEFAULT_MCP_RPC_PATH,
    actionCatalogPath: asString(detail.config.actionCatalogPath) || DEFAULT_ACTION_CATALOG_PATH,
    clientIdDraft: asString(detail.config.clientId),
    clientSecretDraft: ""
  };
}

export function CrestCrmIntegrationView(props: {
  detail: IntegrationDetail;
  onUpdated(detail: IntegrationDetail): void;
}) {
  const [activeTab, setActiveTab] = useState<CrestTab>("basic");
  const [name, setName] = useState(props.detail.instance.name);
  const [description, setDescription] = useState(props.detail.instance.description || "");
  const [status, setStatus] = useState(props.detail.instance.status);
  const [draft, setDraft] = useState<CrestCrmConfigDraft>(() => buildDraft(props.detail));
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
    if (!draft.baseUrl.trim()) {
      setErrorText("请填写 Crest Base URL");
      return;
    }
    if (!draft.clientIdDraft.trim()) {
      setErrorText("请填写 Client ID");
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
          baseUrl: draft.baseUrl.trim().replace(/\/+$/, ""),
          mcpRpcPath: draft.mcpRpcPath.trim() || DEFAULT_MCP_RPC_PATH,
          actionCatalogPath: draft.actionCatalogPath.trim() || DEFAULT_ACTION_CATALOG_PATH,
          clientId: draft.clientIdDraft.trim()
        },
        secretState: draft.clientSecretDraft.trim()
          ? {
              clientSecret: draft.clientSecretDraft.trim()
            }
          : undefined
      });
      props.onUpdated(detail);
      setSuccessText("Crest CRM 集成配置已保存");
      setDraft((current) => ({ ...current, clientSecretDraft: "" }));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存 Crest CRM 集成失败");
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
      setSuccessText("Crest CRM 连接校验完成");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "校验 Crest CRM 集成失败");
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
            <p>连接 Crest CRM 的 SSO、MCP 工具和 Action Catalog，让 Studio agent 以 Crest 用户身份调用 CRM。</p>
          </div>
          <Tag color={status === "active" ? "success" : "default"}>{status}</Tag>
        </div>

        <div className="capability-center-detail-tabs" role="tablist" aria-label="Crest CRM 集成详情标签">
          <Segmented
            block
            value={activeTab}
            options={TABS.map((tab) => ({ label: tab.label, value: tab.id }))}
            onChange={(value) => setActiveTab(value as CrestTab)}
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
                <span className="field-label">Crest Base URL</span>
                <Input
                  value={draft.baseUrl}
                  disabled={saving}
                  placeholder="https://crest.baicells.com"
                  onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))}
                />
              </label>
              <label className="field">
                <span className="field-label">Client ID</span>
                <Input
                  value={draft.clientIdDraft}
                  disabled={saving}
                  onChange={(event) => setDraft((current) => ({ ...current, clientIdDraft: event.target.value }))}
                />
              </label>
              <label className="field">
                <span className="field-label">MCP RPC Path</span>
                <Input
                  value={draft.mcpRpcPath}
                  disabled={saving}
                  onChange={(event) => setDraft((current) => ({ ...current, mcpRpcPath: event.target.value }))}
                />
              </label>
              <label className="field">
                <span className="field-label">Action Catalog Path</span>
                <Input
                  value={draft.actionCatalogPath}
                  disabled={saving}
                  onChange={(event) => setDraft((current) => ({ ...current, actionCatalogPath: event.target.value }))}
                />
              </label>
            </div>

            <label className="field">
              <span className="field-label">Client Secret</span>
              <Input.Password
                value={draft.clientSecretDraft}
                disabled={saving}
                placeholder={props.detail.secretState.hasSecrets ? "已保存，留空则不修改" : "请输入 Client Secret"}
                onChange={(event) => setDraft((current) => ({ ...current, clientSecretDraft: event.target.value }))}
              />
            </label>

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
        {activeTab === "history" ? <IntegrationValidationHistory items={props.detail.validationHistory.items} /> : null}
      </Card>
    </section>
  );
}
