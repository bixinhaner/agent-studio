import { useEffect, useState } from "react";
import { Alert, Button, Card, Collapse, Input, Segmented, Select, Space, Tag } from "antd";

import { updateIntegrationInstance, validateIntegrationInstance } from "./api";
import { IntegrationBindingsEditor } from "./IntegrationBindingsEditor";
import { IntegrationPolicyEditor } from "./IntegrationPolicyEditor";
import { IntegrationValidationHistory } from "./IntegrationValidationHistory";
import type { IntegrationDetail, OpenAICodexConfigDraft } from "./types";

type OpenAITab = "basic" | "bindings" | "policies" | "history";

const TABS: Array<{ id: OpenAITab; label: string }> = [
  { id: "basic", label: "基本信息" },
  { id: "bindings", label: "绑定关系" },
  { id: "policies", label: "授权" },
  { id: "history", label: "验证与历史" }
];

const STATUS_OPTIONS = [
  { label: "active", value: "active" },
  { label: "disabled", value: "disabled" },
  { label: "draft", value: "draft" }
];

const REASONING_OPTIONS = [
  { label: "none", value: "none" },
  { label: "minimal", value: "minimal" },
  { label: "low", value: "low" },
  { label: "medium", value: "medium" },
  { label: "high", value: "high" },
  { label: "xhigh", value: "xhigh" }
];

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function buildDraft(detail: IntegrationDetail): OpenAICodexConfigDraft {
  return {
    baseUrl: asString(detail.config.baseUrl),
    apiKeyDraft: "",
    defaultModel: asString(detail.config.defaultModel),
    defaultReasoningEffort: asString(detail.config.defaultReasoningEffort)
  };
}

function optionsWithCurrent(options: Array<{ label: string; value: string }>, value: string) {
  if (!value) return options;
  if (options.some((item) => item.value === value)) return options;
  return [{ label: value, value }, ...options];
}

export function OpenAICodexIntegrationView(props: {
  detail: IntegrationDetail;
  onUpdated(detail: IntegrationDetail): void;
}) {
  const [activeTab, setActiveTab] = useState<OpenAITab>("basic");
  const [name, setName] = useState(props.detail.instance.name);
  const [description, setDescription] = useState(props.detail.instance.description || "");
  const [status, setStatus] = useState(props.detail.instance.status);
  const [draft, setDraft] = useState<OpenAICodexConfigDraft>(() => buildDraft(props.detail));
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
    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const detail = await updateIntegrationInstance(props.detail.instance.id, {
        name: name.trim(),
        description: description.trim() || null,
        status,
        config: {
          baseUrl: draft.baseUrl.trim(),
          defaultModel: draft.defaultModel.trim(),
          defaultReasoningEffort: draft.defaultReasoningEffort.trim()
        },
        secretState: draft.apiKeyDraft.trim()
          ? {
              apiKey: draft.apiKeyDraft.trim()
            }
          : undefined
      });
      props.onUpdated(detail);
      setSuccessText("OpenAI/Codex 集成已保存");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存 OpenAI/Codex 集成失败");
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
      setSuccessText("OpenAI/Codex 连接验证完成");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "验证 OpenAI/Codex 连接失败");
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
            <p>管理模型供应方配置、默认模型和默认推理强度。</p>
          </div>
          <Tag color={status === "active" ? "success" : "default"}>{status}</Tag>
        </div>

        <div className="capability-center-detail-tabs" role="tablist" aria-label="OpenAI-Codex 详情标签">
          <Segmented
            block
            value={activeTab}
            options={TABS.map((tab) => ({ label: tab.label, value: tab.id }))}
            onChange={(value) => setActiveTab(value as OpenAITab)}
          />
        </div>

        {errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={errorText} /> : null}
        {successText ? <Alert type="success" showIcon className="admin-alert-inline" message={successText} /> : null}

        {activeTab === "basic" ? (
          <>
            <Collapse
              size="small"
              defaultActiveKey={["identity", "provider"]}
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
                        <Select
                          value={status}
                          options={STATUS_OPTIONS}
                          disabled={saving}
                          onChange={(value) => setStatus(value)}
                        />
                      </label>
                      <div className="field">
                        <span className="field-label">密钥状态</span>
                        <p className="resource-center-subtle">
                          {props.detail.secretState.hasSecrets ? "已保存 API key" : "未保存 API key"}
                        </p>
                      </div>
                    </div>
                  )
                },
                {
                  key: "provider",
                  label: "供应方连接与默认模型",
                  children: (
                    <div className="resource-center-form-grid">
                      <label className="field resource-center-form-span-2">
                        <span className="field-label">Base URL</span>
                        <Input
                          value={draft.baseUrl}
                          disabled={saving}
                          onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">API Key</span>
                        <Input.Password
                          value={draft.apiKeyDraft}
                          placeholder="留空则保持现状"
                          disabled={saving}
                          onChange={(event) => setDraft((current) => ({ ...current, apiKeyDraft: event.target.value }))}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">默认模型</span>
                        <Input
                          value={draft.defaultModel}
                          disabled={saving}
                          onChange={(event) => setDraft((current) => ({ ...current, defaultModel: event.target.value }))}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">默认推理强度</span>
                        <Select
                          value={draft.defaultReasoningEffort}
                          options={optionsWithCurrent(REASONING_OPTIONS, draft.defaultReasoningEffort)}
                          disabled={saving}
                          onChange={(value) =>
                            setDraft((current) => ({ ...current, defaultReasoningEffort: value }))
                          }
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
                  {validating ? "验证中..." : "验证连接"}
                </Button>
                <Button type="primary" onClick={() => void handleSave()} disabled={saving || validating}>
                  {saving ? "保存中..." : "保存实例"}
                </Button>
              </Space>
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
