import { useEffect, useState } from "react";

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
      <section className="resource-center-section capability-center-summary">
        <div className="resource-center-section-header">
          <div>
            <h3>{props.detail.instance.name}</h3>
            <p>管理模型供应方配置、默认模型和默认推理强度。</p>
          </div>
          <span className={status === "active" ? "resource-center-badge" : "resource-center-badge muted"}>{status}</span>
        </div>

        <div className="capability-center-detail-tabs" role="tablist" aria-label="OpenAI-Codex 详情标签">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? "capability-center-detail-tab active" : "capability-center-detail-tab"}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {errorText ? <p className="err-text">{errorText}</p> : null}
        {successText ? <p className="resource-center-success">{successText}</p> : null}

        {activeTab === "basic" ? (
          <>
            <div className="resource-center-form-grid">
              <label className="field">
                <span className="field-label">实例名称</span>
                <input className="field-input" value={name} disabled={saving} onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">实例 slug</span>
                <input className="field-input" value={props.detail.instance.slug} disabled />
              </label>
              <label className="field resource-center-form-span-2">
                <span className="field-label">实例描述</span>
                <textarea className="field-input textarea" value={description} disabled={saving} onChange={(event) => setDescription(event.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">状态</span>
                <select className="field-input" value={status} disabled={saving} onChange={(event) => setStatus(event.target.value)}>
                  <option value="active">active</option>
                  <option value="disabled">disabled</option>
                  <option value="draft">draft</option>
                </select>
              </label>
              <div className="field">
                <span className="field-label">密钥状态</span>
                <p className="resource-center-subtle">
                  {props.detail.secretState.hasSecrets ? "已保存 API key" : "未保存 API key"}
                </p>
              </div>

              <label className="field resource-center-form-span-2">
                <span className="field-label">Base URL</span>
                <input className="field-input" value={draft.baseUrl} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))} />
              </label>
              <label className="field">
                <span className="field-label">API Key</span>
                <input
                  className="field-input"
                  type="password"
                  value={draft.apiKeyDraft}
                  placeholder="留空则保持现状"
                  disabled={saving}
                  onChange={(event) => setDraft((current) => ({ ...current, apiKeyDraft: event.target.value }))}
                />
              </label>
              <label className="field">
                <span className="field-label">默认模型</span>
                <input className="field-input" value={draft.defaultModel} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, defaultModel: event.target.value }))} />
              </label>
              <label className="field">
                <span className="field-label">默认推理强度</span>
                <input className="field-input" value={draft.defaultReasoningEffort} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, defaultReasoningEffort: event.target.value }))} />
              </label>
            </div>

            <div className="resource-center-actions">
              <button type="button" className="admin-secondary-btn" onClick={() => void handleValidate()} disabled={saving || validating}>
                {validating ? "验证中..." : "验证连接"}
              </button>
              <button type="button" className="admin-action-btn" onClick={() => void handleSave()} disabled={saving || validating}>
                {saving ? "保存中..." : "保存实例"}
              </button>
            </div>
          </>
        ) : null}

        {activeTab === "bindings" ? <IntegrationBindingsEditor instanceId={props.detail.instance.id} /> : null}
        {activeTab === "policies" ? <IntegrationPolicyEditor instanceId={props.detail.instance.id} /> : null}
        {activeTab === "history" ? <IntegrationValidationHistory items={props.detail.validationHistory.items} /> : null}
      </section>
    </section>
  );
}
