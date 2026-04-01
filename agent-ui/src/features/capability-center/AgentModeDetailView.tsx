import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Checkbox, Input, Segmented, Select, Tag } from "antd";

import { putAgentModeInstructionSources, putAgentModeSkillPackages, updateAgentMode } from "./api";
import { CapabilityPolicyEditor } from "./CapabilityPolicyEditor";
import { InstructionSourceEditor } from "./InstructionSourceEditor";
import type {
  AgentModeInstructionSourceInput,
  AgentModeRecord,
  RunProfileRecord,
  SkillPackageRecord,
  UpdateAgentModeInput
} from "./types";

type AgentModeDetailViewProps = {
  agentMode: AgentModeRecord;
  runProfiles: RunProfileRecord[];
  skillPackages: SkillPackageRecord[];
  onAgentModeUpdated: (agentMode: AgentModeRecord) => void;
};

type AgentModeTab = "basic" | "bindings" | "policies";

const AGENT_MODE_TABS: Array<{ id: AgentModeTab; label: string }> = [
  { id: "basic", label: "基本信息" },
  { id: "bindings", label: "绑定关系" },
  { id: "policies", label: "授权" }
];

const STATUS_OPTIONS = [
  { label: "active", value: "active" },
  { label: "disabled", value: "disabled" }
];

const VISIBILITY_OPTIONS = [
  { label: "hidden", value: "hidden" },
  { label: "visible", value: "visible" }
];

function formatLocalDateTime(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString();
}

function toSkillPackageIds(agentMode: AgentModeRecord) {
  return agentMode.skillPackages.map((item) => item.skillPackageId);
}

function toInstructionSources(agentMode: AgentModeRecord): AgentModeInstructionSourceInput[] {
  return [...agentMode.instructionSources]
    .sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
      return left.createdAt.localeCompare(right.createdAt);
    })
    .map((source, index) => ({
      sourceType: source.sourceType,
      sourceRef: source.sourceRef,
      sortOrder: index
    }));
}

export function AgentModeDetailView({
  agentMode,
  runProfiles,
  skillPackages,
  onAgentModeUpdated
}: AgentModeDetailViewProps) {
  const [activeTab, setActiveTab] = useState<AgentModeTab>("basic");
  const [name, setName] = useState(agentMode.name);
  const [slug, setSlug] = useState(agentMode.slug);
  const [description, setDescription] = useState(agentMode.description || "");
  const [status, setStatus] = useState(agentMode.status);
  const [visibleToUsers, setVisibleToUsers] = useState(agentMode.visibleToUsers);
  const [runProfileId, setRunProfileId] = useState(agentMode.runProfileId);
  const [skillPackageIds, setSkillPackageIds] = useState<string[]>(() => toSkillPackageIds(agentMode));
  const [instructionSources, setInstructionSources] = useState<AgentModeInstructionSourceInput[]>(() =>
    toInstructionSources(agentMode)
  );
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");

  useEffect(() => {
    setActiveTab("basic");
    setName(agentMode.name);
    setSlug(agentMode.slug);
    setDescription(agentMode.description || "");
    setStatus(agentMode.status);
    setVisibleToUsers(agentMode.visibleToUsers);
    setRunProfileId(agentMode.runProfileId);
    setSkillPackageIds(toSkillPackageIds(agentMode));
    setInstructionSources(toInstructionSources(agentMode));
    setErrorText("");
    setSuccessText("");
  }, [agentMode]);

  const createdAt = useMemo(() => formatLocalDateTime(agentMode.createdAt), [agentMode.createdAt]);
  const updatedAt = useMemo(() => formatLocalDateTime(agentMode.updatedAt), [agentMode.updatedAt]);

  const selectedRunProfileLabel = useMemo(
    () => runProfiles.find((item) => item.id === runProfileId)?.name ?? runProfileId,
    [runProfileId, runProfiles]
  );

  const selectedSkillPackageNames = useMemo(
    () => skillPackageIds.map((id) => skillPackages.find((item) => item.id === id)?.name ?? id).filter(Boolean),
    [skillPackageIds, skillPackages]
  );

  const instructionPreview = useMemo(
    () =>
      instructionSources
        .map(
          (source, index) =>
            `${index + 1}. ${source.sourceType === "inline_text" ? "inline" : source.sourceType} :: ${source.sourceRef}`
        )
        .join("\n"),
    [instructionSources]
  );

  function toggleSkillPackage(skillPackageId: string) {
    setSkillPackageIds((current) =>
      current.includes(skillPackageId) ? current.filter((item) => item !== skillPackageId) : [...current, skillPackageId]
    );
    setSuccessText("");
  }

  async function handleSave() {
    setSaving(true);
    setErrorText("");
    setSuccessText("");

    const payload: UpdateAgentModeInput = {
      name: name.trim(),
      slug: slug.trim(),
      description: description.trim(),
      status,
      visibleToUsers,
      runProfileId
    };

    try {
      await updateAgentMode(agentMode.id, payload);
      await putAgentModeSkillPackages(agentMode.id, skillPackageIds);
      const response = await putAgentModeInstructionSources(agentMode.id, instructionSources);
      onAgentModeUpdated(response.agentMode);
      setSuccessText("模式已保存");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存模式失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="resource-center-detail-stack">
      <Card className="resource-center-section capability-center-summary antd-admin-card" size="small">
        <div className="resource-center-section-header">
          <div>
            <h3>{agentMode.name}</h3>
            <p>维护模式元数据、绑定关系和指令源。</p>
          </div>
          <Tag color={status === "active" ? "success" : "default"}>{status}</Tag>
        </div>

        <div className="capability-center-summary-grid">
          <div>
            <span className="field-label">更新时间</span>
            <p>{updatedAt || "-"}</p>
          </div>
          <div>
            <span className="field-label">创建时间</span>
            <p>{createdAt || "-"}</p>
          </div>
          <div>
            <span className="field-label">运行策略</span>
            <p>{selectedRunProfileLabel || "-"}</p>
          </div>
        </div>

        <div className="capability-center-detail-tabs" role="tablist" aria-label="Agent Mode 详情标签">
          <Segmented
            block
            value={activeTab}
            options={AGENT_MODE_TABS.map((tab) => ({ label: tab.label, value: tab.id }))}
            onChange={(value) => setActiveTab(value as AgentModeTab)}
          />
        </div>

        {errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={errorText} /> : null}
        {successText ? <Alert type="success" showIcon className="admin-alert-inline" message={successText} /> : null}

        {activeTab === "basic" ? (
          <div className="resource-center-form-grid">
            <label className="field">
              <span className="field-label">模式名称</span>
              <Input aria-label="模式名称" value={name} disabled={saving} onChange={(event) => setName(event.target.value)} />
            </label>

            <label className="field">
              <span className="field-label">模式 slug</span>
              <Input aria-label="模式 slug" value={slug} disabled={saving} onChange={(event) => setSlug(event.target.value)} />
            </label>

            <label className="field resource-center-form-span-2">
              <span className="field-label">模式描述</span>
              <Input.TextArea
                aria-label="模式描述"
                value={description}
                disabled={saving}
                rows={4}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>

            <label className="field">
              <span className="field-label">模式状态</span>
              <Select
                aria-label="模式状态"
                value={status}
                options={STATUS_OPTIONS}
                disabled={saving}
                onChange={(value) => setStatus(value)}
              />
            </label>

            <label className="field">
              <span className="field-label">对用户可见</span>
              <Select
                aria-label="对用户可见"
                value={visibleToUsers ? "visible" : "hidden"}
                options={VISIBILITY_OPTIONS}
                disabled={saving}
                onChange={(value) => setVisibleToUsers(value === "visible")}
              />
            </label>

            <div className="resource-center-form-span-2 capability-mode-preview">
              <span className="field-label">当前绑定概览</span>
              <div className="capability-mode-preview-list">
                <p>运行策略：{selectedRunProfileLabel || "-"}</p>
                <p>技能包：{selectedSkillPackageNames.length > 0 ? selectedSkillPackageNames.join("、") : "-"}</p>
                <p>指令源：{instructionSources.length}</p>
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "bindings" ? (
          <div className="capability-mode-bindings">
            <section className="capability-mode-binding-section">
              <div className="resource-center-section-header">
                <div>
                  <h4>运行策略</h4>
                  <p>每个模式仅绑定一个运行策略。</p>
                </div>
              </div>

              <label className="field">
                <span className="field-label">运行策略</span>
                <Select
                  aria-label="运行策略"
                  value={runProfileId}
                  disabled={saving}
                  options={runProfiles.map((runProfile) => ({ label: runProfile.name, value: runProfile.id }))}
                  onChange={(value) => setRunProfileId(value)}
                />
              </label>
            </section>

            <section className="capability-mode-binding-section">
              <div className="resource-center-section-header">
                <div>
                  <h4>技能包</h4>
                  <p>按需勾选多个技能包作为模式能力组合。</p>
                </div>
              </div>

              <div className="capability-mode-skill-grid">
                {skillPackages.map((skillPackage) => (
                  <label key={skillPackage.id} className="capability-mode-skill-option">
                    <Checkbox
                      checked={skillPackageIds.includes(skillPackage.id)}
                      disabled={saving}
                      onChange={() => toggleSkillPackage(skillPackage.id)}
                    />
                    <span>{skillPackage.name}</span>
                  </label>
                ))}
              </div>
            </section>

            <section className="capability-mode-binding-section">
              <InstructionSourceEditor instructionSources={instructionSources} disabled={saving} onChange={setInstructionSources} />
            </section>

            <section className="capability-mode-binding-section">
              <div className="resource-center-section-header">
                <div>
                  <h4>绑定预览</h4>
                  <p>保存前可以先确认运行策略、技能包与指令源组合。</p>
                </div>
              </div>
              <pre className="capability-center-preview-code capability-mode-binding-preview">{instructionPreview || "当前没有指令源。"}</pre>
            </section>
          </div>
        ) : null}

        {activeTab !== "policies" ? (
          <div className="resource-center-actions">
            <Button type="primary" onClick={() => void handleSave()} disabled={saving}>
              {saving ? "保存中..." : "保存模式配置"}
            </Button>
          </div>
        ) : null}

        {activeTab === "policies" ? (
          <CapabilityPolicyEditor resourceType="agent_mode" resourceId={agentMode.id} title="模式授权" />
        ) : null}
      </Card>
    </div>
  );
}
