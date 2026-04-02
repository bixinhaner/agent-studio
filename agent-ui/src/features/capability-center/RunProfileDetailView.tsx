import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Input, Segmented, Select, Switch, Tag } from "antd";

import { updateRunProfile } from "./api";
import { CapabilityPolicyEditor } from "./CapabilityPolicyEditor";
import { buildRunProfileModelOptions, normalizeRunProfileAllowedModels } from "./run-profile-model-options";
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

const STATUS_OPTIONS = [
  { label: "active", value: "active" },
  { label: "disabled", value: "disabled" }
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

const SEARCH_OPTIONS = [
  { label: "disabled", value: "disabled" },
  { label: "cached", value: "cached" },
  { label: "live", value: "live" }
];

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
  const [allowedModels, setAllowedModels] = useState<string[]>(
    normalizeRunProfileAllowedModels(runProfile.allowedModels, runProfile.defaultModel)
  );
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
    setAllowedModels(normalizeRunProfileAllowedModels(runProfile.allowedModels, runProfile.defaultModel));
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

  const modelOptions = useMemo(
    () => buildRunProfileModelOptions([defaultModel, ...allowedModels]),
    [allowedModels, defaultModel]
  );

  const instructionPreview = useMemo(
    () =>
      buildInstructionPreview({
        ...runProfile,
        name,
        slug,
        description,
        status,
        defaultModel,
        allowedModels: normalizeRunProfileAllowedModels(allowedModels, defaultModel),
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
      allowedModels: normalizeRunProfileAllowedModels(allowedModels, defaultModel),
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
      <Card className="resource-center-section capability-center-summary antd-admin-card" size="small">
        <div className="resource-center-section-header">
          <div>
            <h3>{runProfile.name}</h3>
            <p>维护运行策略元数据、模型约束和预览性的绑定信息。</p>
          </div>
          <Tag color={status === "active" ? "success" : "default"}>{status}</Tag>
        </div>

        <div className="capability-center-detail-tabs" role="tablist" aria-label="运行策略详情标签">
          <Segmented
            block
            value={activeTab}
            options={RUN_PROFILE_TABS.map((tab) => ({ label: tab.label, value: tab.id }))}
            onChange={(value) => setActiveTab(value as RunProfileTab)}
          />
        </div>

        {errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={errorText} /> : null}
        {successText ? <Alert type="success" showIcon className="admin-alert-inline" message={successText} /> : null}

        {activeTab === "basic" ? (
          <>
            <div className="resource-center-form-grid">
              <label className="field">
                <span className="field-label">运行策略名称</span>
                <Input aria-label="运行策略名称" value={name} disabled={saving} onChange={(event) => setName(event.target.value)} />
              </label>

              <label className="field">
                <span className="field-label">运行策略 slug</span>
                <Input aria-label="运行策略 slug" value={slug} disabled={saving} onChange={(event) => setSlug(event.target.value)} />
              </label>

              <label className="field resource-center-form-span-2">
                <span className="field-label">运行策略描述</span>
                <Input.TextArea
                  aria-label="运行策略描述"
                  value={description}
                  disabled={saving}
                  rows={4}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>

              <label className="field">
                <span className="field-label">运行策略状态</span>
                <Select
                  aria-label="运行策略状态"
                  value={status}
                  disabled={saving}
                  options={STATUS_OPTIONS}
                  onChange={(value) => setStatus(value)}
                />
              </label>

              <label className="field">
                <span className="field-label">默认模型</span>
                <Select
                  aria-label="默认模型"
                  value={defaultModel}
                  disabled={saving}
                  options={modelOptions}
                  showSearch
                  optionFilterProp="label"
                  onChange={(value) => {
                    setDefaultModel(value);
                    setAllowedModels((current) => (current.includes(value) ? current : [...current, value]));
                  }}
                />
              </label>

              <label className="field resource-center-form-span-2">
                <span className="field-label">可选模型</span>
                <Select
                  aria-label="可选模型"
                  mode="multiple"
                  value={allowedModels}
                  disabled={saving}
                  options={modelOptions}
                  showSearch
                  optionFilterProp="label"
                  placeholder="请选择可选模型"
                  onChange={(value) => setAllowedModels(value as string[])}
                />
              </label>

              <label className="field">
                <span className="field-label">推理强度</span>
                <Select
                  aria-label="推理强度"
                  value={reasoningEffort}
                  disabled={saving}
                  options={REASONING_OPTIONS}
                  onChange={(value) => setReasoningEffort(value as ReasoningEffort)}
                />
              </label>

              <label className="field">
                <span className="field-label">沙箱模式</span>
                <Select
                  aria-label="沙箱模式"
                  value={sandboxMode}
                  disabled={saving}
                  options={SANDBOX_OPTIONS}
                  onChange={(value) => setSandboxMode(value as SandboxMode)}
                />
              </label>

              <label className="field">
                <span className="field-label">审批策略</span>
                <Select
                  aria-label="审批策略"
                  value={approvalPolicy}
                  disabled={saving}
                  options={APPROVAL_OPTIONS}
                  onChange={(value) => setApprovalPolicy(value as ApprovalPolicy)}
                />
              </label>

              <label className="field checkbox-field resource-center-toggle-row">
                <Switch
                  aria-label="联网"
                  checked={networkAccessEnabled}
                  disabled={saving}
                  checkedChildren="联网"
                  unCheckedChildren="离线"
                  onChange={(checked) => setNetworkAccessEnabled(checked)}
                />
                <span className="field-label">网络访问</span>
              </label>

              <label className="field">
                <span className="field-label">搜索模式</span>
                <Select
                  aria-label="搜索模式"
                  value={webSearchMode}
                  disabled={saving}
                  options={SEARCH_OPTIONS}
                  onChange={(value) => setWebSearchMode(value as WebSearchMode)}
                />
              </label>
            </div>

            <div className="resource-center-actions">
              <Button type="primary" onClick={() => void handleSave()} disabled={saving}>
                {saving ? "保存中..." : "保存运行策略"}
              </Button>
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
      </Card>
    </div>
  );
}
