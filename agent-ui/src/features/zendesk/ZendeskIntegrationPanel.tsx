import { useEffect, useMemo, useState } from "react";

import {
  DEFAULT_MODEL,
  MODEL_OPTIONS,
  normalizeReasoningEffortForModel,
  reasoningOptionsForModel,
  type ReasoningEffort
} from "../../lib/model-config";
import { fetchZendeskOverview, runZendeskTicket, saveZendeskSettings, validateZendeskConnection } from "./api";
import type {
  ZendeskApprovalPolicy,
  ZendeskAutoStatus,
  ZendeskFallbackMode,
  ZendeskOverview,
  ZendeskPublicSettings,
  ZendeskResponseMode,
  ZendeskRunRecord,
  ZendeskSandboxMode,
  ZendeskSettingsUpdate,
  ZendeskWebSearchMode
} from "./types";
import "./zendesk.css";

const DEFAULT_WORKSPACE = ".";

type DraftState = {
  enabled: boolean;
  publicBaseUrl: string;
  zendeskBaseUrl: string;
  zendeskEmail: string;
  zendeskApiTokenDraft: string;
  webhookSigningSecretDraft: string;
  responseMode: ZendeskResponseMode;
  fallbackMode: ZendeskFallbackMode;
  autoStatus: ZendeskAutoStatus;
  excludedTagsRaw: string;
  workspace: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  sandboxMode: ZendeskSandboxMode;
  approvalPolicy: ZendeskApprovalPolicy;
  networkAccessEnabled: boolean;
  webSearchMode: ZendeskWebSearchMode;
  additionalDirectoriesRaw: string;
  maxCommentHistory: number;
  systemPrompt: string;
  manualTicketId: string;
};

const SANDBOX_OPTIONS: Array<{ value: ZendeskSandboxMode; label: string }> = [
  { value: "workspace-write", label: "workspace-write" },
  { value: "read-only", label: "read-only" },
  { value: "danger-full-access", label: "danger-full-access" }
];

const APPROVAL_OPTIONS: Array<{ value: ZendeskApprovalPolicy; label: string }> = [
  { value: "never", label: "never" },
  { value: "on-request", label: "on-request" },
  { value: "on-failure", label: "on-failure" },
  { value: "untrusted", label: "untrusted" }
];

const WEB_SEARCH_OPTIONS: Array<{ value: ZendeskWebSearchMode; label: string }> = [
  { value: "disabled", label: "disabled" },
  { value: "cached", label: "cached" },
  { value: "live", label: "live" }
];

const AUTO_STATUS_OPTIONS: Array<{ value: ZendeskAutoStatus; label: string }> = [
  { value: "pending", label: "pending（推荐）" },
  { value: "open", label: "open" },
  { value: "hold", label: "hold" },
  { value: "unchanged", label: "unchanged" }
];

function formatLocalDateTime(value?: string): string {
  if (!value) return "-";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(at);
}

function parseLinesOrComma(input: string): string[] {
  return input
    .split(/\n|,/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function draftFromSettings(settings: ZendeskPublicSettings): DraftState {
  return {
    enabled: settings.enabled,
    publicBaseUrl: settings.publicBaseUrl,
    zendeskBaseUrl: settings.zendeskBaseUrl,
    zendeskEmail: settings.zendeskEmail,
    zendeskApiTokenDraft: "",
    webhookSigningSecretDraft: "",
    responseMode: settings.responseMode,
    fallbackMode: settings.fallbackMode,
    autoStatus: settings.autoStatus,
    excludedTagsRaw: settings.excludedTags.join(", "),
    workspace: settings.workspace || DEFAULT_WORKSPACE,
    model: settings.model || DEFAULT_MODEL,
    reasoningEffort: normalizeReasoningEffortForModel(settings.model || DEFAULT_MODEL, settings.reasoningEffort),
    sandboxMode: settings.sandboxMode,
    approvalPolicy: settings.approvalPolicy,
    networkAccessEnabled: settings.networkAccessEnabled,
    webSearchMode: settings.webSearchMode,
    additionalDirectoriesRaw: settings.additionalDirectories.join("\n"),
    maxCommentHistory: settings.maxCommentHistory,
    systemPrompt: settings.systemPrompt,
    manualTicketId: ""
  };
}

function buildSettingsPayload(draft: DraftState): ZendeskSettingsUpdate {
  const payload: ZendeskSettingsUpdate = {
    enabled: draft.enabled,
    public_base_url: draft.publicBaseUrl.trim(),
    zendesk_base_url: draft.zendeskBaseUrl.trim(),
    zendesk_email: draft.zendeskEmail.trim(),
    response_mode: draft.responseMode,
    fallback_mode: draft.fallbackMode,
    auto_status: draft.autoStatus,
    excluded_tags: parseLinesOrComma(draft.excludedTagsRaw),
    workspace: draft.workspace.trim() || DEFAULT_WORKSPACE,
    model: draft.model.trim() || DEFAULT_MODEL,
    reasoning_effort: normalizeReasoningEffortForModel(draft.model, draft.reasoningEffort),
    sandbox_mode: draft.sandboxMode,
    approval_policy: draft.approvalPolicy,
    network_access_enabled: draft.networkAccessEnabled,
    web_search_mode: draft.webSearchMode,
    additional_directories: parseLinesOrComma(draft.additionalDirectoriesRaw),
    max_comment_history: Math.max(1, Math.min(50, Number(draft.maxCommentHistory) || 12)),
    system_prompt: draft.systemPrompt.trim()
  };

  if (draft.zendeskApiTokenDraft.trim()) {
    payload.zendesk_api_token = draft.zendeskApiTokenDraft.trim();
  }
  if (draft.webhookSigningSecretDraft.trim()) {
    payload.webhook_signing_secret = draft.webhookSigningSecretDraft.trim();
  }
  return payload;
}

function runStatusLabel(run: ZendeskRunRecord): string {
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

export function ZendeskIntegrationPanel() {
  const [overview, setOverview] = useState<ZendeskOverview | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [runningTicket, setRunningTicket] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [statusText, setStatusText] = useState("");

  const reasoningOptions = useMemo(
    () => reasoningOptionsForModel(draft?.model || DEFAULT_MODEL),
    [draft?.model]
  );

  useEffect(() => {
    void loadOverview();
  }, []);

  async function loadOverview() {
    setLoading(true);
    setErrorText("");
    try {
      const next = await fetchZendeskOverview();
      setOverview(next);
      setDraft(draftFromSettings(next.settings));
      setStatusText("已加载 Zendesk 集成配置");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "读取 Zendesk 集成失败");
    } finally {
      setLoading(false);
    }
  }

  async function onSave() {
    if (!draft) return;
    setSaving(true);
    setErrorText("");
    try {
      const next = await saveZendeskSettings(buildSettingsPayload(draft));
      setOverview(next);
      setDraft(draftFromSettings(next.settings));
      setStatusText("Zendesk 配置已保存");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存 Zendesk 配置失败");
    } finally {
      setSaving(false);
    }
  }

  async function onValidate() {
    setValidating(true);
    setErrorText("");
    try {
      const next = await validateZendeskConnection();
      setOverview(next.overview);
      setDraft(draftFromSettings(next.overview.settings));
      setStatusText("Zendesk 凭证验证通过");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Zendesk 凭证验证失败");
    } finally {
      setValidating(false);
    }
  }

  async function onManualRun() {
    if (!draft?.manualTicketId.trim()) {
      setErrorText("请输入要测试的 ticket ID");
      return;
    }
    setRunningTicket(true);
    setErrorText("");
    try {
      const next = await runZendeskTicket(draft.manualTicketId.trim());
      setOverview(next.overview);
      setDraft((prev) => (prev ? { ...draftFromSettings(next.overview.settings), manualTicketId: prev.manualTicketId } : prev));
      setStatusText(`已执行 ticket #${draft.manualTicketId.trim()} 的手动处理`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "手动执行失败");
    } finally {
      setRunningTicket(false);
    }
  }

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setStatusText(`${label} 已复制`);
    } catch {
      setErrorText(`复制 ${label} 失败`);
    }
  }

  if (loading || !overview || !draft) {
    return (
      <section className="panel zendesk-panel">
        <div className="panel-title-row">
          <h2>Zendesk 自动答复</h2>
        </div>
        <p className="field-help">正在加载集成配置…</p>
      </section>
    );
  }

  return (
    <section className="panel zendesk-panel">
      <div className="panel-title-row">
        <h2>Zendesk 自动答复</h2>
        <span className={`zendesk-status-pill ${overview.ready ? "ready" : "warn"}`}>
          {overview.ready ? "Ready" : "Setup Needed"}
        </span>
      </div>

      <div className="zendesk-summary-grid">
        <div>
          <strong>启用状态</strong>
          <p>{draft.enabled ? "已启用 webhook 自动答复" : "未启用 webhook 自动答复"}</p>
        </div>
        <div>
          <strong>最近验证</strong>
          <p>{overview.settings.lastValidatedAt ? formatLocalDateTime(overview.settings.lastValidatedAt) : "尚未验证"}</p>
        </div>
      </div>

      {overview.missing.length > 0 ? (
        <p className="field-help">
          缺少关键项：{overview.missing.join(", ")}
        </p>
      ) : null}

      <details className="zendesk-section" open>
        <summary>连接配置</summary>
        <label className="field checkbox-field">
          <span className="field-label">启用自动答复</span>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft((prev) => (prev ? { ...prev, enabled: e.target.checked } : prev))}
          />
          <span className="field-help">开启后，Zendesk webhook 会触发自动处理。</span>
        </label>

        <label className="field">
          <span className="field-label">公开访问地址</span>
          <input
            className="field-input"
            value={draft.publicBaseUrl}
            onChange={(e) => setDraft((prev) => (prev ? { ...prev, publicBaseUrl: e.target.value } : prev))}
            placeholder="例如 https://agent.example.com"
          />
          <span className="field-help">Zendesk webhook 回调将使用这个外网地址。</span>
        </label>

        <label className="field">
          <span className="field-label">Zendesk Base URL</span>
          <input
            className="field-input"
            value={draft.zendeskBaseUrl}
            onChange={(e) => setDraft((prev) => (prev ? { ...prev, zendeskBaseUrl: e.target.value } : prev))}
            placeholder="例如 https://example.zendesk.com"
          />
        </label>

        <label className="field">
          <span className="field-label">Zendesk 邮箱</span>
          <input
            className="field-input"
            value={draft.zendeskEmail}
            onChange={(e) => setDraft((prev) => (prev ? { ...prev, zendeskEmail: e.target.value } : prev))}
            placeholder="agent@example.com"
          />
        </label>

        <label className="field">
          <span className="field-label">API Token</span>
          <input
            className="field-input"
            type="password"
            value={draft.zendeskApiTokenDraft}
            onChange={(e) => setDraft((prev) => (prev ? { ...prev, zendeskApiTokenDraft: e.target.value } : prev))}
            placeholder={overview.settings.hasZendeskApiToken ? "已保存，留空则保持不变" : "输入 Zendesk API token"}
          />
        </label>

        <label className="field">
          <span className="field-label">Webhook Signing Secret</span>
          <input
            className="field-input"
            type="password"
            value={draft.webhookSigningSecretDraft}
            onChange={(e) =>
              setDraft((prev) => (prev ? { ...prev, webhookSigningSecretDraft: e.target.value } : prev))
            }
            placeholder={
              overview.settings.hasWebhookSigningSecret ? "已保存，留空则保持不变" : "输入 Zendesk webhook signing secret"
            }
          />
          <span className="field-help">后端会校验 `X-Zendesk-Webhook-Signature` 与时间戳。</span>
        </label>
      </details>

      <details className="zendesk-section">
        <summary>Agent 行为</summary>
        <label className="field">
          <span className="field-label">回复模式</span>
          <select
            className="field-input"
            value={draft.responseMode}
            onChange={(e) => setDraft((prev) => (prev ? { ...prev, responseMode: e.target.value as ZendeskResponseMode } : prev))}
          >
            <option value="public_reply">public_reply</option>
            <option value="internal_note">internal_note</option>
          </select>
        </label>

        <label className="field">
          <span className="field-label">兜底策略</span>
          <select
            className="field-input"
            value={draft.fallbackMode}
            onChange={(e) => setDraft((prev) => (prev ? { ...prev, fallbackMode: e.target.value as ZendeskFallbackMode } : prev))}
          >
            <option value="internal_note">internal_note</option>
            <option value="skip">skip</option>
          </select>
        </label>

        <label className="field">
          <span className="field-label">回写状态</span>
          <select
            className="field-input"
            value={draft.autoStatus}
            onChange={(e) => setDraft((prev) => (prev ? { ...prev, autoStatus: e.target.value as ZendeskAutoStatus } : prev))}
          >
            {AUTO_STATUS_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">排除标签</span>
          <textarea
            className="field-input textarea"
            value={draft.excludedTagsRaw}
            onChange={(e) => setDraft((prev) => (prev ? { ...prev, excludedTagsRaw: e.target.value } : prev))}
            placeholder="例如 vip, escalated"
          />
        </label>

        <label className="field">
          <span className="field-label">工作目录</span>
          <input
            className="field-input"
            value={draft.workspace}
            onChange={(e) => setDraft((prev) => (prev ? { ...prev, workspace: e.target.value } : prev))}
          />
        </label>

        <label className="field">
          <span className="field-label">模型</span>
          <select
            className="field-input"
            value={draft.model}
            onChange={(e) =>
              setDraft((prev) =>
                prev
                  ? {
                      ...prev,
                      model: e.target.value,
                      reasoningEffort: normalizeReasoningEffortForModel(e.target.value, prev.reasoningEffort)
                    }
                  : prev
              )
            }
          >
            {MODEL_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">思考深度</span>
          <select
            className="field-input"
            value={draft.reasoningEffort}
            onChange={(e) =>
              setDraft((prev) => (prev ? { ...prev, reasoningEffort: e.target.value as ReasoningEffort } : prev))
            }
          >
            {reasoningOptions.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">沙箱模式</span>
          <select
            className="field-input"
            value={draft.sandboxMode}
            onChange={(e) => setDraft((prev) => (prev ? { ...prev, sandboxMode: e.target.value as ZendeskSandboxMode } : prev))}
          >
            {SANDBOX_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">审批策略</span>
          <select
            className="field-input"
            value={draft.approvalPolicy}
            onChange={(e) =>
              setDraft((prev) => (prev ? { ...prev, approvalPolicy: e.target.value as ZendeskApprovalPolicy } : prev))
            }
          >
            {APPROVAL_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">Web 搜索</span>
          <select
            className="field-input"
            value={draft.webSearchMode}
            onChange={(e) => setDraft((prev) => (prev ? { ...prev, webSearchMode: e.target.value as ZendeskWebSearchMode } : prev))}
          >
            {WEB_SEARCH_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field checkbox-field">
          <span className="field-label">允许网络访问</span>
          <input
            type="checkbox"
            checked={draft.networkAccessEnabled}
            onChange={(e) =>
              setDraft((prev) => (prev ? { ...prev, networkAccessEnabled: e.target.checked } : prev))
            }
          />
          <span className="field-help">控制 agent 运行环境的网络开关。</span>
        </label>

        <label className="field">
          <span className="field-label">附加目录</span>
          <textarea
            className="field-input textarea"
            value={draft.additionalDirectoriesRaw}
            onChange={(e) => setDraft((prev) => (prev ? { ...prev, additionalDirectoriesRaw: e.target.value } : prev))}
            placeholder="每行一个目录"
          />
        </label>

        <label className="field">
          <span className="field-label">最大评论回放数</span>
          <input
            className="field-input"
            type="number"
            min={1}
            max={50}
            value={draft.maxCommentHistory}
            onChange={(e) =>
              setDraft((prev) => (prev ? { ...prev, maxCommentHistory: Number(e.target.value) || 12 } : prev))
            }
          />
        </label>

        <label className="field">
          <span className="field-label">系统提示词</span>
          <textarea
            className="field-input textarea zendesk-prompt-textarea"
            value={draft.systemPrompt}
            onChange={(e) => setDraft((prev) => (prev ? { ...prev, systemPrompt: e.target.value } : prev))}
          />
        </label>
      </details>

      <details className="zendesk-section">
        <summary>Webhook Setup</summary>
        <div className="zendesk-inline-actions">
          <button type="button" className="picker-btn" onClick={() => copyText(overview.setup.webhookUrl || "", "Webhook URL")}>
            复制 Webhook URL
          </button>
          <button type="button" className="picker-btn" onClick={() => copyText(overview.setup.payloadExample, "Payload 示例")}>
            复制 Payload
          </button>
        </div>
        <label className="field">
          <span className="field-label">Webhook URL</span>
          <input className="field-input" readOnly value={overview.setup.webhookUrl} />
        </label>
        <div className="zendesk-code-block">
          <pre>{overview.setup.payloadExample}</pre>
        </div>
        <div className="zendesk-trigger-list">
          {overview.setup.triggers.map((item) => (
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
      </details>

      <details className="zendesk-section" open>
        <summary>操作与日志</summary>
        <div className="zendesk-inline-actions zendesk-manual-run-row">
          <input
            className="field-input"
            value={draft.manualTicketId}
            onChange={(e) => setDraft((prev) => (prev ? { ...prev, manualTicketId: e.target.value } : prev))}
            placeholder="输入 Zendesk ticket ID 进行手动测试"
          />
          <button type="button" className="picker-btn" onClick={onManualRun} disabled={runningTicket}>
            {runningTicket ? "执行中…" : "手动执行"}
          </button>
        </div>

        <div className="zendesk-inline-actions">
          <button type="button" className="picker-btn" onClick={loadOverview} disabled={loading}>
            刷新
          </button>
          <button type="button" className="picker-btn" onClick={onValidate} disabled={validating}>
            {validating ? "验证中…" : "验证凭证"}
          </button>
          <button type="button" className="picker-btn primary-action-btn" onClick={onSave} disabled={saving}>
            {saving ? "保存中…" : "保存配置"}
          </button>
        </div>

        <div className="status-box">
          <p>
            <strong>状态：</strong>
            {statusText || "等待操作"}
          </p>
          {errorText ? <p className="err-text">{errorText}</p> : null}
        </div>

        <div className="zendesk-run-list">
          {overview.runs.length > 0 ? (
            overview.runs.map((run) => (
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
      </details>
    </section>
  );
}
