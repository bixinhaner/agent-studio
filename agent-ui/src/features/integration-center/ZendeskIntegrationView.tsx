import { useEffect, useState } from "react";

import { updateIntegrationInstance, validateIntegrationInstance } from "./api";
import { IntegrationBindingsEditor } from "./IntegrationBindingsEditor";
import { IntegrationPolicyEditor } from "./IntegrationPolicyEditor";
import { IntegrationValidationHistory } from "./IntegrationValidationHistory";
import type { IntegrationDetail, ZendeskConfigDraft } from "./types";

type ZendeskTab = "basic" | "bindings" | "policies" | "history";

const TABS: Array<{ id: ZendeskTab; label: string }> = [
  { id: "basic", label: "基本信息" },
  { id: "bindings", label: "绑定关系" },
  { id: "policies", label: "授权" },
  { id: "history", label: "验证与历史" }
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
      setSuccessText("Zendesk 验证已执行");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "验证 Zendesk 集成失败");
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
            <p>管理 Zendesk 站点、Webhook、模型与运行参数。</p>
          </div>
          <span className={status === "active" ? "resource-center-badge" : "resource-center-badge muted"}>{status}</span>
        </div>

        <div className="capability-center-detail-tabs" role="tablist" aria-label="Zendesk 详情标签">
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
              <label className="field">
                <span className="field-label">启用集成</span>
                <select className="field-input" value={draft.enabled ? "true" : "false"} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.value === "true" }))}>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </label>
              <div className="field">
                <span className="field-label">密钥状态</span>
                <p className="resource-center-subtle">
                  {props.detail.secretState.hasSecrets ? "已保存 Zendesk 凭证" : "未保存 Zendesk 凭证"}
                </p>
              </div>
              <label className="field resource-center-form-span-2">
                <span className="field-label">Public Base URL</span>
                <input className="field-input" value={draft.publicBaseUrl} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, publicBaseUrl: event.target.value }))} />
              </label>
              <label className="field">
                <span className="field-label">Zendesk Base URL</span>
                <input className="field-input" value={draft.zendeskBaseUrl} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, zendeskBaseUrl: event.target.value }))} />
              </label>
              <label className="field">
                <span className="field-label">Zendesk Email</span>
                <input className="field-input" value={draft.zendeskEmail} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, zendeskEmail: event.target.value }))} />
              </label>
              <label className="field">
                <span className="field-label">Zendesk API Token</span>
                <input className="field-input" type="password" value={draft.zendeskApiTokenDraft} placeholder="留空则保持现状" disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, zendeskApiTokenDraft: event.target.value }))} />
              </label>
              <label className="field">
                <span className="field-label">Webhook Secret</span>
                <input className="field-input" type="password" value={draft.webhookSigningSecretDraft} placeholder="留空则保持现状" disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, webhookSigningSecretDraft: event.target.value }))} />
              </label>
              <label className="field">
                <span className="field-label">Response Mode</span>
                <input className="field-input" value={draft.responseMode} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, responseMode: event.target.value }))} />
              </label>
              <label className="field">
                <span className="field-label">Fallback Mode</span>
                <input className="field-input" value={draft.fallbackMode} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, fallbackMode: event.target.value }))} />
              </label>
              <label className="field">
                <span className="field-label">Auto Status</span>
                <input className="field-input" value={draft.autoStatus} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, autoStatus: event.target.value }))} />
              </label>
              <label className="field">
                <span className="field-label">Workspace</span>
                <input className="field-input" value={draft.workspace} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, workspace: event.target.value }))} />
              </label>
              <label className="field">
                <span className="field-label">Model</span>
                <input className="field-input" value={draft.model} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))} />
              </label>
              <label className="field">
                <span className="field-label">Reasoning Effort</span>
                <input className="field-input" value={draft.reasoningEffort} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, reasoningEffort: event.target.value }))} />
              </label>
              <label className="field">
                <span className="field-label">Sandbox Mode</span>
                <input className="field-input" value={draft.sandboxMode} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, sandboxMode: event.target.value }))} />
              </label>
              <label className="field">
                <span className="field-label">Approval Policy</span>
                <input className="field-input" value={draft.approvalPolicy} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, approvalPolicy: event.target.value }))} />
              </label>
              <label className="field">
                <span className="field-label">Web Search Mode</span>
                <input className="field-input" value={draft.webSearchMode} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, webSearchMode: event.target.value }))} />
              </label>
              <label className="field">
                <span className="field-label">允许联网</span>
                <select className="field-input" value={draft.networkAccessEnabled ? "true" : "false"} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, networkAccessEnabled: event.target.value === "true" }))}>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </label>
              <label className="field">
                <span className="field-label">最大评论历史</span>
                <input className="field-input" type="number" value={draft.maxCommentHistory} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, maxCommentHistory: Number(event.target.value) || 12 }))} />
              </label>
              <label className="field resource-center-form-span-2">
                <span className="field-label">排除标签</span>
                <input className="field-input" value={draft.excludedTagsRaw} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, excludedTagsRaw: event.target.value }))} />
              </label>
              <label className="field resource-center-form-span-2">
                <span className="field-label">附加目录</span>
                <input className="field-input" value={draft.additionalDirectoriesRaw} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, additionalDirectoriesRaw: event.target.value }))} />
              </label>
              <label className="field resource-center-form-span-2">
                <span className="field-label">System Prompt</span>
                <textarea className="field-input textarea integration-center-large-textarea" value={draft.systemPrompt} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, systemPrompt: event.target.value }))} />
              </label>
            </div>

            <div className="resource-center-actions">
              <button type="button" className="admin-secondary-btn" onClick={() => void handleValidate()} disabled={saving || validating}>
                {validating ? "验证中..." : "验证实例"}
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
