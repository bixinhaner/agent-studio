import { useEffect, useMemo, useState } from "react";

import { updateRunProfile } from "./api";
import { CapabilityPolicyEditor } from "./CapabilityPolicyEditor";
import type {
  ApprovalPolicy,
  ReasoningEffort,
  RunProfileRecord,
  SandboxMode,
  UpdateRunProfileInput,
  WebSearchMode
} from "./types";

type RunProfileDetailViewProps = {
  runProfile: RunProfileRecord;
  onRunProfileUpdated: (runProfile: RunProfileRecord) => void;
};

type RunProfileTab = "basic" | "bindings" | "policies";

const RUN_PROFILE_TABS: Array<{ id: RunProfileTab; label: string }> = [
  { id: "basic", label: "基本信息" },
  { id: "bindings", label: "绑定关系" },
  { id: "policies", label: "授权" }
];

function toAllowedModelsText(allowedModels: string[]) {
  return allowedModels.join(", ");
}

function normalizeAllowedModels(value: string, fallback: string) {
  const models = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return models.length > 0 ? models : [fallback.trim()].filter(Boolean);
}

function buildInstructionPreview(profile: RunProfileRecord) {
  return [
    `默认模型：${profile.defaultModel}`,
    `可选模型：${profile.allowedModels.join(", ") || "-"}`,
    `推理强度：${profile.defaultReasoningEffort}`,
    `审批策略：${profile.approvalPolicy}`,
    `联网：${profile.networkAccessEnabled ? "启用" : "禁用"}`,
    `搜索模式：${profile.webSearchMode}`
  ].join("\n");
}

export function RunProfileDetailView({ runProfile, onRunProfileUpdated }: RunProfileDetailViewProps) {
  const [activeTab, setActiveTab] = useState<RunProfileTab>("basic");
  const [name, setName] = useState(runProfile.name);
  const [slug, setSlug] = useState(runProfile.slug);
  const [description, setDescription] = useState(runProfile.description || "");
  const [status, setStatus] = useState(runProfile.status);
  const [defaultModel, setDefaultModel] = useState(runProfile.defaultModel);
  const [allowedModels, setAllowedModels] = useState(toAllowedModelsText(runProfile.allowedModels));
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(runProfile.defaultReasoningEffort);
  const [sandboxMode, setSandboxMode] = useState<SandboxMode>(runProfile.sandboxMode);
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>(runProfile.approvalPolicy);
  const [networkAccessEnabled, setNetworkAccessEnabled] = useState(runProfile.networkAccessEnabled);
  const [webSearchMode, setWebSearchMode] = useState<WebSearchMode>(runProfile.webSearchMode);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");

  useEffect(() => {
    setActiveTab("basic");
    setName(runProfile.name);
    setSlug(runProfile.slug);
    setDescription(runProfile.description || "");
    setStatus(runProfile.status);
    setDefaultModel(runProfile.defaultModel);
    setAllowedModels(toAllowedModelsText(runProfile.allowedModels));
    setReasoningEffort(runProfile.defaultReasoningEffort);
    setSandboxMode(runProfile.sandboxMode);
    setApprovalPolicy(runProfile.approvalPolicy);
    setNetworkAccessEnabled(runProfile.networkAccessEnabled);
    setWebSearchMode(runProfile.webSearchMode);
    setErrorText("");
    setSuccessText("");
  }, [runProfile]);

  const directoryPreview = useMemo(() => {
    if (sandboxMode === "read-only") {
      return "当前运行策略默认使用只读目录策略，适合审查、检索和说明类会话。";
    }
    if (sandboxMode === "danger-full-access") {
      return "当前运行策略允许全访问目录策略，适合受控高权限执行场景。";
    }
    return "当前运行策略允许工作区写入，目录访问范围仍需由 agent mode 的工作区规则进一步约束。";
  }, [sandboxMode]);

  const agentsPreview = useMemo(() => {
    return "AGENTS.md 的实际加载由 agent mode 的工作区规则决定。运行策略只在这里提供预览，不直接绑定具体文件。";
  }, []);

  const instructionPreview = useMemo(
    () =>
      buildInstructionPreview({
        ...runProfile,
        name,
        slug,
        description,
        status,
        defaultModel,
        allowedModels: normalizeAllowedModels(allowedModels, defaultModel),
        defaultReasoningEffort: reasoningEffort,
        sandboxMode,
        approvalPolicy,
        networkAccessEnabled,
        webSearchMode
      }),
    [
      allowedModels,
      approvalPolicy,
      defaultModel,
      description,
      name,
      networkAccessEnabled,
      reasoningEffort,
      runProfile,
      sandboxMode,
      slug,
      status,
      webSearchMode
    ]
  );

  async function handleSave() {
    setSaving(true);
    setErrorText("");
    setSuccessText("");

    const payload: UpdateRunProfileInput = {
      name: name.trim(),
      slug: slug.trim(),
      description: description.trim(),
      status,
      defaultModel: defaultModel.trim(),
      allowedModels: normalizeAllowedModels(allowedModels, defaultModel),
      defaultReasoningEffort: reasoningEffort,
      sandboxMode,
      approvalPolicy,
      networkAccessEnabled,
      webSearchMode
    };

    try {
      const response = await updateRunProfile(runProfile.id, payload);
      onRunProfileUpdated(response.runProfile);
      setSuccessText("运行策略已保存");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存运行策略失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="resource-center-detail-stack">
      <section className="resource-center-section capability-center-summary">
        <div className="resource-center-section-header">
          <div>
            <h3>{runProfile.name}</h3>
            <p>维护运行策略元数据、模型约束和预览性的绑定信息。</p>
          </div>
          <span className={status === "active" ? "resource-center-badge" : "resource-center-badge muted"}>{status}</span>
        </div>

        <div className="capability-center-detail-tabs" role="tablist" aria-label="运行策略详情标签">
          {RUN_PROFILE_TABS.map((tab) => (
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
                <span className="field-label">运行策略名称</span>
                <input className="field-input" aria-label="运行策略名称" value={name} disabled={saving} onChange={(event) => setName(event.target.value)} />
              </label>

              <label className="field">
                <span className="field-label">运行策略 slug</span>
                <input className="field-input" aria-label="运行策略 slug" value={slug} disabled={saving} onChange={(event) => setSlug(event.target.value)} />
              </label>

              <label className="field resource-center-form-span-2">
                <span className="field-label">运行策略描述</span>
                <textarea
                  className="field-input textarea"
                  aria-label="运行策略描述"
                  value={description}
                  disabled={saving}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>

              <label className="field">
                <span className="field-label">运行策略状态</span>
                <select className="field-input" aria-label="运行策略状态" value={status} disabled={saving} onChange={(event) => setStatus(event.target.value)}>
                  <option value="active">active</option>
                  <option value="disabled">disabled</option>
                </select>
              </label>

              <label className="field">
                <span className="field-label">默认模型</span>
                <input className="field-input" aria-label="默认模型" value={defaultModel} disabled={saving} onChange={(event) => setDefaultModel(event.target.value)} />
              </label>

              <label className="field resource-center-form-span-2">
                <span className="field-label">可选模型</span>
                <input
                  className="field-input"
                  aria-label="可选模型"
                  value={allowedModels}
                  disabled={saving}
                  onChange={(event) => setAllowedModels(event.target.value)}
                />
              </label>

              <label className="field">
                <span className="field-label">推理强度</span>
                <select className="field-input" aria-label="推理强度" value={reasoningEffort} disabled={saving} onChange={(event) => setReasoningEffort(event.target.value as ReasoningEffort)}>
                  <option value="none">none</option>
                  <option value="minimal">minimal</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="xhigh">xhigh</option>
                </select>
              </label>

              <label className="field">
                <span className="field-label">沙箱模式</span>
                <select className="field-input" aria-label="沙箱模式" value={sandboxMode} disabled={saving} onChange={(event) => setSandboxMode(event.target.value as SandboxMode)}>
                  <option value="read-only">read-only</option>
                  <option value="workspace-write">workspace-write</option>
                  <option value="danger-full-access">danger-full-access</option>
                </select>
              </label>

              <label className="field">
                <span className="field-label">审批策略</span>
                <select className="field-input" aria-label="审批策略" value={approvalPolicy} disabled={saving} onChange={(event) => setApprovalPolicy(event.target.value as ApprovalPolicy)}>
                  <option value="never">never</option>
                  <option value="on-request">on-request</option>
                  <option value="on-failure">on-failure</option>
                  <option value="untrusted">untrusted</option>
                </select>
              </label>

              <label className="field">
                <span className="field-label">联网</span>
                <select
                  className="field-input"
                  aria-label="联网"
                  value={networkAccessEnabled ? "enabled" : "disabled"}
                  disabled={saving}
                  onChange={(event) => setNetworkAccessEnabled(event.target.value === "enabled")}
                >
                  <option value="disabled">disabled</option>
                  <option value="enabled">enabled</option>
                </select>
              </label>

              <label className="field">
                <span className="field-label">搜索模式</span>
                <select className="field-input" aria-label="搜索模式" value={webSearchMode} disabled={saving} onChange={(event) => setWebSearchMode(event.target.value as WebSearchMode)}>
                  <option value="disabled">disabled</option>
                  <option value="cached">cached</option>
                  <option value="live">live</option>
                </select>
              </label>
            </div>

            <div className="resource-center-actions">
              <button type="button" className="admin-action-btn" onClick={() => void handleSave()} disabled={saving}>
                {saving ? "保存中..." : "保存运行策略"}
              </button>
            </div>
          </>
        ) : null}

        {activeTab === "bindings" ? (
          <div className="capability-center-preview-grid">
            <article className="capability-center-preview-card">
              <h4>目录策略预览</h4>
              <p>{directoryPreview}</p>
            </article>
            <article className="capability-center-preview-card">
              <h4>AGENTS.md 预览</h4>
              <p>{agentsPreview}</p>
            </article>
            <article className="capability-center-preview-card capability-center-preview-card-wide">
              <h4>指令预览</h4>
              <pre className="capability-center-preview-code">{instructionPreview}</pre>
            </article>
          </div>
        ) : null}

        {activeTab === "policies" ? (
          <CapabilityPolicyEditor resourceType="run_profile" resourceId={runProfile.id} title="运行策略授权" />
        ) : null}
      </section>
    </div>
  );
}
