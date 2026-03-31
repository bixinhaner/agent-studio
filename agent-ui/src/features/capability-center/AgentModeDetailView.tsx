import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Tag } from "antd";

import { putAgentModeInstructionSources, putAgentModeSkillPackages, putAgentModeWorkspaces, updateAgentMode } from "./api";
import { CapabilityPolicyEditor } from "./CapabilityPolicyEditor";
import { InstructionSourceEditor } from "./InstructionSourceEditor";
import type {
  AgentModeInstructionSourceInput,
  AgentModeRecord,
  AgentModeWorkspaceRuleInput,
  RunProfileRecord,
  SkillPackageRecord,
  UpdateAgentModeInput
} from "./types";
import type { WorkspaceRecord } from "../resources-center/types";

type AgentModeDetailViewProps = {
  agentMode: AgentModeRecord;
  runProfiles: RunProfileRecord[];
  skillPackages: SkillPackageRecord[];
  workspaces: WorkspaceRecord[];
  onAgentModeUpdated: (agentMode: AgentModeRecord) => void;
};

type AgentModeTab = "basic" | "bindings" | "policies";

const AGENT_MODE_TABS: Array<{ id: AgentModeTab; label: string }> = [
  { id: "basic", label: "基本信息" },
  { id: "bindings", label: "绑定关系" },
  { id: "policies", label: "授权" }
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

function toWorkspaceRules(agentMode: AgentModeRecord): AgentModeWorkspaceRuleInput[] {
  const source = agentMode.workspaceRules.length > 0 ? agentMode.workspaceRules : agentMode.workspaces ?? [];
  return source.map((rule) => ({
    workspaceId: rule.workspaceId,
    isDefault: rule.isDefault,
    allowDirectorySelection: rule.allowDirectorySelection,
    directoryScope: rule.directoryScope,
    loadWorkspaceAgentsMd: rule.loadWorkspaceAgentsMd
  }));
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

function workspaceLabel(workspace: WorkspaceRecord) {
  return `${workspace.name} (${workspace.slug})`;
}

function normalizeWorkspaceRules(
  workspaceRules: AgentModeWorkspaceRuleInput[],
  preferredDefaultWorkspaceId?: string
): AgentModeWorkspaceRuleInput[] {
  if (workspaceRules.length === 0) {
    return [];
  }

  const selectedDefaultWorkspaceId =
    (preferredDefaultWorkspaceId &&
      workspaceRules.some((rule) => rule.workspaceId === preferredDefaultWorkspaceId) &&
      preferredDefaultWorkspaceId) ||
    workspaceRules.find((rule) => rule.isDefault)?.workspaceId ||
    workspaceRules[0]?.workspaceId;

  return workspaceRules.map((rule) => ({
    ...rule,
    isDefault: rule.workspaceId === selectedDefaultWorkspaceId
  }));
}

export function AgentModeDetailView({
  agentMode,
  runProfiles,
  skillPackages,
  workspaces,
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
  const [workspaceRules, setWorkspaceRules] = useState<AgentModeWorkspaceRuleInput[]>(() => toWorkspaceRules(agentMode));
  const [workspaceSelection, setWorkspaceSelection] = useState("");
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
    setWorkspaceRules(toWorkspaceRules(agentMode));
    setInstructionSources(toInstructionSources(agentMode));
    setErrorText("");
    setSuccessText("");
  }, [agentMode]);

  useEffect(() => {
    const selectedWorkspaceIds = new Set(workspaceRules.map((rule) => rule.workspaceId));
    const nextSelection = workspaces.find((workspace) => !selectedWorkspaceIds.has(workspace.id))?.id ?? "";
    if (!workspaceSelection && nextSelection) {
      setWorkspaceSelection(nextSelection);
      return;
    }
    if (workspaceSelection && (selectedWorkspaceIds.has(workspaceSelection) || !workspaces.some((workspace) => workspace.id === workspaceSelection))) {
      setWorkspaceSelection(nextSelection);
    }
  }, [workspaceRules, workspaceSelection, workspaces]);

  const createdAt = useMemo(() => formatLocalDateTime(agentMode.createdAt), [agentMode.createdAt]);
  const updatedAt = useMemo(() => formatLocalDateTime(agentMode.updatedAt), [agentMode.updatedAt]);

  const selectedWorkspaceIds = useMemo(() => new Set(workspaceRules.map((rule) => rule.workspaceId)), [workspaceRules]);
  const availableWorkspaces = useMemo(
    () => workspaces.filter((workspace) => !selectedWorkspaceIds.has(workspace.id)),
    [selectedWorkspaceIds, workspaces]
  );

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

  function updateWorkspaceRule(index: number, patch: Partial<AgentModeWorkspaceRuleInput>) {
    setWorkspaceRules((current) => {
      const next = current.map((rule, ruleIndex) => (ruleIndex === index ? { ...rule, ...patch } : rule));
      const preferredDefaultWorkspaceId = patch.isDefault ? next[index]?.workspaceId : undefined;
      return normalizeWorkspaceRules(next, preferredDefaultWorkspaceId);
    });
    setSuccessText("");
  }

  function addWorkspaceRule() {
    if (!workspaceSelection) return;
    if (workspaceRules.some((rule) => rule.workspaceId === workspaceSelection)) return;
    setWorkspaceRules((current) =>
      normalizeWorkspaceRules([
        ...current,
        {
          workspaceId: workspaceSelection,
          isDefault: current.length === 0,
          allowDirectorySelection: false,
          directoryScope: "workspace_only",
          loadWorkspaceAgentsMd: false
        }
      ])
    );
    setSuccessText("");
  }

  function removeWorkspaceRule(index: number) {
    setWorkspaceRules((current) => normalizeWorkspaceRules(current.filter((_, ruleIndex) => ruleIndex !== index)));
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
      await putAgentModeWorkspaces(agentMode.id, normalizeWorkspaceRules(workspaceRules));
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
            <p>维护模式元数据、绑定关系、工作区规则和指令源。</p>
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
          {AGENT_MODE_TABS.map((tab) => (
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

        {errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={errorText} /> : null}
        {successText ? <Alert type="success" showIcon className="admin-alert-inline" message={successText} /> : null}

        {activeTab === "basic" ? (
          <div className="resource-center-form-grid">
            <label className="field">
              <span className="field-label">模式名称</span>
              <input className="field-input" aria-label="模式名称" value={name} disabled={saving} onChange={(event) => setName(event.target.value)} />
            </label>

            <label className="field">
              <span className="field-label">模式 slug</span>
              <input className="field-input" aria-label="模式 slug" value={slug} disabled={saving} onChange={(event) => setSlug(event.target.value)} />
            </label>

            <label className="field resource-center-form-span-2">
              <span className="field-label">模式描述</span>
              <textarea
                className="field-input textarea"
                aria-label="模式描述"
                value={description}
                disabled={saving}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>

            <label className="field">
              <span className="field-label">模式状态</span>
              <select className="field-input" aria-label="模式状态" value={status} disabled={saving} onChange={(event) => setStatus(event.target.value)}>
                <option value="active">active</option>
                <option value="disabled">disabled</option>
              </select>
            </label>

            <label className="field">
              <span className="field-label">对用户可见</span>
              <select
                className="field-input"
                aria-label="对用户可见"
                value={visibleToUsers ? "visible" : "hidden"}
                disabled={saving}
                onChange={(event) => setVisibleToUsers(event.target.value === "visible")}
              >
                <option value="hidden">hidden</option>
                <option value="visible">visible</option>
              </select>
            </label>

            <div className="resource-center-form-span-2 capability-mode-preview">
              <span className="field-label">当前绑定概览</span>
              <div className="capability-mode-preview-list">
                <p>运行策略：{selectedRunProfileLabel || "-"}</p>
                <p>技能包：{selectedSkillPackageNames.length > 0 ? selectedSkillPackageNames.join("、") : "-"}</p>
                <p>工作区规则：{workspaceRules.length}</p>
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
                <select className="field-input" aria-label="运行策略" value={runProfileId} disabled={saving} onChange={(event) => setRunProfileId(event.target.value)}>
                  {runProfiles.map((runProfile) => (
                    <option key={runProfile.id} value={runProfile.id}>
                      {runProfile.name}
                    </option>
                  ))}
                </select>
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
                    <input
                      type="checkbox"
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
              <div className="resource-center-section-header">
                <div>
                  <h4>工作区规则</h4>
                  <p>维护允许的工作区、目录范围和 AGENTS.md 加载策略。</p>
                </div>
                <Button type="default" disabled={saving || availableWorkspaces.length === 0} onClick={addWorkspaceRule}>
                  添加工作区
                </Button>
              </div>

              <div className="capability-mode-add-row">
                <label className="field">
                  <span className="field-label">工作区选择</span>
                  <select
                    className="field-input"
                    aria-label="工作区选择"
                    value={workspaceSelection}
                    disabled={saving || availableWorkspaces.length === 0}
                    onChange={(event) => setWorkspaceSelection(event.target.value)}
                  >
                    <option value="">{availableWorkspaces.length === 0 ? "没有可选工作区" : "请选择工作区"}</option>
                    {availableWorkspaces.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>
                        {workspaceLabel(workspace)}
                      </option>
                    ))}
                  </select>
                </label>
                <Button type="default" disabled={saving || availableWorkspaces.length === 0 || !workspaceSelection} onClick={addWorkspaceRule}>
                  添加选中工作区
                </Button>
              </div>

              <div className="capability-mode-workspace-list">
                {workspaceRules.map((rule, index) => {
                  const workspace = workspaces.find((item) => item.id === rule.workspaceId);
                  return (
                    <article key={`${rule.workspaceId}-${index}`} className="capability-mode-workspace-card">
                      <div className="capability-mode-workspace-header">
                        <div>
                          <h5>{workspace ? workspaceLabel(workspace) : rule.workspaceId}</h5>
                          <p>{`工作区规则 ${index + 1}`}</p>
                        </div>
                        <Button type="default" disabled={saving} onClick={() => removeWorkspaceRule(index)}>
                          {`删除工作区规则 ${index + 1}`}
                        </Button>
                      </div>

                      <div className="resource-center-form-grid capability-mode-workspace-grid">
                        <label className="field">
                          <span className="field-label">{`默认工作区 ${index + 1}`}</span>
                          <select
                            className="field-input"
                            aria-label={`默认工作区 ${index + 1}`}
                            value={rule.isDefault ? "true" : "false"}
                            disabled={saving}
                            onChange={(event) => updateWorkspaceRule(index, { isDefault: event.target.value === "true" })}
                          >
                            <option value="false">false</option>
                            <option value="true">true</option>
                          </select>
                        </label>

                        <label className="field">
                          <span className="field-label">{`允许选择目录 ${index + 1}`}</span>
                          <select
                            className="field-input"
                            aria-label={`允许选择目录 ${index + 1}`}
                            value={rule.allowDirectorySelection ? "true" : "false"}
                            disabled={saving}
                            onChange={(event) => updateWorkspaceRule(index, { allowDirectorySelection: event.target.value === "true" })}
                          >
                            <option value="false">false</option>
                            <option value="true">true</option>
                          </select>
                        </label>

                        <label className="field">
                          <span className="field-label">{`目录范围 ${index + 1}`}</span>
                          <select
                            className="field-input"
                            aria-label={`目录范围 ${index + 1}`}
                            value={rule.directoryScope}
                            disabled={saving}
                            onChange={(event) =>
                              updateWorkspaceRule(index, {
                                directoryScope: event.target.value as AgentModeWorkspaceRuleInput["directoryScope"]
                              })
                            }
                          >
                            <option value="workspace_only">workspace_only</option>
                            <option value="descendants_only">descendants_only</option>
                            <option value="authorized_workspace_and_knowledge_set">authorized_workspace_and_knowledge_set</option>
                          </select>
                        </label>

                        <label className="field">
                          <span className="field-label">{`加载 AGENTS.md ${index + 1}`}</span>
                          <select
                            className="field-input"
                            aria-label={`加载 AGENTS.md ${index + 1}`}
                            value={rule.loadWorkspaceAgentsMd ? "true" : "false"}
                            disabled={saving}
                            onChange={(event) => updateWorkspaceRule(index, { loadWorkspaceAgentsMd: event.target.value === "true" })}
                          >
                            <option value="false">false</option>
                            <option value="true">true</option>
                          </select>
                        </label>
                      </div>
                    </article>
                  );
                })}
              </div>

              {workspaceRules.length === 0 ? <p className="resource-center-empty">当前还没有工作区规则。</p> : null}
            </section>

            <section className="capability-mode-binding-section">
              <InstructionSourceEditor instructionSources={instructionSources} workspaces={workspaces} disabled={saving} onChange={setInstructionSources} />
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
