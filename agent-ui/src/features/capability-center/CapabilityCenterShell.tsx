import { useEffect, useMemo, useState } from "react";

import {
  createAgentMode,
  createRunProfile,
  createSkillPackage,
  fetchAgentModes,
  fetchRunProfiles,
  fetchSkillPackages
} from "./api";
import { RunProfileDetailView } from "./RunProfileDetailView";
import type {
  AgentModeRecord,
  CapabilityCenterTab,
  CapabilityStatusFilter,
  CapabilityVisibilityFilter,
  CreateAgentModeInput,
  CreateRunProfileInput,
  CreateSkillPackageInput,
  RunProfileRecord,
  SkillPackageRecord
} from "./types";

type CreatePanelState =
  | {
      kind: "agent_mode";
      name: string;
      slug: string;
      description: string;
      status: string;
      visibleToUsers: boolean;
      runProfileId: string;
    }
  | {
      kind: "skill_package";
      name: string;
      slug: string;
      description: string;
      status: string;
      visibleToUsers: boolean;
    }
  | {
      kind: "run_profile";
      name: string;
      slug: string;
      description: string;
      status: string;
      defaultModel: string;
      allowedModels: string;
      defaultReasoningEffort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
      sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
      approvalPolicy: "never" | "on-request" | "on-failure" | "untrusted";
      networkAccessEnabled: boolean;
      webSearchMode: "disabled" | "cached" | "live";
    };

const CAPABILITY_TABS: Array<{ id: CapabilityCenterTab; label: string }> = [
  { id: "agent_mode", label: "Agent Modes" },
  { id: "skill_package", label: "Skill Packages" },
  { id: "run_profile", label: "Run Profiles" }
];

const VISIBILITY_FILTER_LABELS: Record<CapabilityVisibilityFilter, string> = {
  all: "全部可见性",
  visible: "仅对用户可见",
  hidden: "仅管理员可见"
};

const DEFAULT_RUN_PROFILE_MODEL = "gpt-5.4";

function panelKindForTab(tab: CapabilityCenterTab): CreatePanelState["kind"] {
  if (tab === "agent_mode") return "agent_mode";
  if (tab === "skill_package") return "skill_package";
  return "run_profile";
}

function formatLocalDateTime(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString();
}

function matchesSearch(input: string, values: Array<string | undefined | null>) {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return true;
  return values.some((value) => (value ?? "").toLowerCase().includes(normalized));
}

function resourceTitle(tab: CapabilityCenterTab) {
  return CAPABILITY_TABS.find((item) => item.id === tab)?.label ?? "能力资源";
}

function createInitialPanelState(tab: CapabilityCenterTab, runProfiles: RunProfileRecord[]): CreatePanelState {
  if (tab === "agent_mode") {
    return {
      kind: "agent_mode",
      name: "",
      slug: "",
      description: "",
      status: "active",
      visibleToUsers: false,
      runProfileId: runProfiles[0]?.id ?? ""
    };
  }
  if (tab === "skill_package") {
    return {
      kind: "skill_package",
      name: "",
      slug: "",
      description: "",
      status: "active",
      visibleToUsers: false
    };
  }
  return {
    kind: "run_profile",
    name: "",
    slug: "",
    description: "",
    status: "active",
    defaultModel: DEFAULT_RUN_PROFILE_MODEL,
    allowedModels: DEFAULT_RUN_PROFILE_MODEL,
    defaultReasoningEffort: "high",
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    networkAccessEnabled: true,
    webSearchMode: "live"
  };
}

function toListText(items: string[]) {
  return items.length > 0 ? items.join(", ") : "-";
}

function CapabilitySummaryCard(props: {
  tab: CapabilityCenterTab;
  resource: AgentModeRecord | SkillPackageRecord | RunProfileRecord;
}) {
  const resource = props.resource;
  const createdAt = formatLocalDateTime(resource.createdAt);
  const updatedAt = formatLocalDateTime(resource.updatedAt);

  if (props.tab === "agent_mode") {
    const agentMode = resource as AgentModeRecord;

    return (
      <section className="resource-center-section capability-center-summary">
        <div className="resource-center-section-header">
          <div>
            <h3>{agentMode.name}</h3>
            <p>{agentMode.slug}</p>
          </div>
          <span className={agentMode.status === "active" ? "resource-center-badge" : "resource-center-badge muted"}>
            {agentMode.status}
          </span>
        </div>

        <div className="capability-center-summary-grid">
          <div>
            <span className="field-label">资源类型</span>
            <p>{resourceTitle(props.tab)}</p>
          </div>
          <div>
            <span className="field-label">更新时间</span>
            <p>{updatedAt || "-"}</p>
          </div>
          <div>
            <span className="field-label">创建时间</span>
            <p>{createdAt || "-"}</p>
          </div>
        </div>

        <div className="capability-center-summary-grid compact">
          <div>
            <span className="field-label">运行策略</span>
            <p>{agentMode.runProfileId}</p>
          </div>
          <div>
            <span className="field-label">技能包</span>
            <p>{agentMode.skillPackages.length}</p>
          </div>
          <div>
            <span className="field-label">工作区规则</span>
            <p>{agentMode.workspaceRules.length}</p>
          </div>
          <div>
            <span className="field-label">指令源</span>
            <p>{agentMode.instructionSources.length}</p>
          </div>
        </div>

        <p className="capability-center-detail-note">后续任务会在这里接入完整的编辑器、绑定编辑和授权编辑。</p>
      </section>
    );
  }

  if (props.tab === "skill_package") {
    const skillPackage = resource as SkillPackageRecord;

    return (
      <section className="resource-center-section capability-center-summary">
        <div className="resource-center-section-header">
          <div>
            <h3>{skillPackage.name}</h3>
            <p>{skillPackage.slug}</p>
          </div>
          <span className={skillPackage.status === "active" ? "resource-center-badge" : "resource-center-badge muted"}>
            {skillPackage.status}
          </span>
        </div>

        <div className="capability-center-summary-grid">
          <div>
            <span className="field-label">资源类型</span>
            <p>{resourceTitle(props.tab)}</p>
          </div>
          <div>
            <span className="field-label">更新时间</span>
            <p>{updatedAt || "-"}</p>
          </div>
          <div>
            <span className="field-label">创建时间</span>
            <p>{createdAt || "-"}</p>
          </div>
        </div>

        <div className="capability-center-summary-grid compact">
          <div>
            <span className="field-label">可见性</span>
            <p>{skillPackage.visibleToUsers ? "对用户可见" : "仅管理员"}</p>
          </div>
          <div>
            <span className="field-label">能力项</span>
            <p>{skillPackage.items.length}</p>
          </div>
          <div>
            <span className="field-label">运行绑定</span>
            <p>{skillPackage.items.reduce((total: number, item) => total + item.runtimeBindings.length, 0)}</p>
          </div>
        </div>

        <p className="capability-center-detail-note">后续任务会在这里接入完整的编辑器、绑定编辑和授权编辑。</p>
      </section>
    );
  }

  const runProfile = resource as RunProfileRecord;

  return (
    <section className="resource-center-section capability-center-summary">
      <div className="resource-center-section-header">
        <div>
          <h3>{runProfile.name}</h3>
          <p>{runProfile.slug}</p>
        </div>
        <span className={runProfile.status === "active" ? "resource-center-badge" : "resource-center-badge muted"}>
          {runProfile.status}
        </span>
      </div>

      <div className="capability-center-summary-grid">
        <div>
          <span className="field-label">资源类型</span>
          <p>{resourceTitle(props.tab)}</p>
        </div>
        <div>
          <span className="field-label">更新时间</span>
          <p>{updatedAt || "-"}</p>
        </div>
        <div>
          <span className="field-label">创建时间</span>
          <p>{createdAt || "-"}</p>
        </div>
      </div>

      <div className="capability-center-summary-grid compact">
        <div>
          <span className="field-label">默认模型</span>
          <p>{runProfile.defaultModel}</p>
        </div>
        <div>
          <span className="field-label">可选模型</span>
          <p>{toListText(runProfile.allowedModels)}</p>
        </div>
        <div>
          <span className="field-label">推理强度</span>
          <p>{runProfile.defaultReasoningEffort}</p>
        </div>
        <div>
          <span className="field-label">联网</span>
          <p>{runProfile.networkAccessEnabled ? "启用" : "禁用"}</p>
        </div>
      </div>

      <p className="capability-center-detail-note">后续任务会在这里接入完整的编辑器、绑定编辑和授权编辑。</p>
    </section>
  );
}

export function CapabilityCenterShell() {
  const [runProfiles, setRunProfiles] = useState<RunProfileRecord[]>([]);
  const [skillPackages, setSkillPackages] = useState<SkillPackageRecord[]>([]);
  const [agentModes, setAgentModes] = useState<AgentModeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [tab, setTab] = useState<CapabilityCenterTab>("agent_mode");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CapabilityStatusFilter>("all");
  const [visibilityFilter, setVisibilityFilter] = useState<CapabilityVisibilityFilter>("all");
  const [selectedAgentModeId, setSelectedAgentModeId] = useState<string | null>(null);
  const [selectedSkillPackageId, setSelectedSkillPackageId] = useState<string | null>(null);
  const [selectedRunProfileId, setSelectedRunProfileId] = useState<string | null>(null);
  const [createPanel, setCreatePanel] = useState<CreatePanelState | null>(null);
  const [createSaving, setCreateSaving] = useState(false);
  const [createErrorText, setCreateErrorText] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setErrorText("");
      try {
        const [runProfileResponse, skillPackageResponse, agentModeResponse] = await Promise.all([
          fetchRunProfiles(),
          fetchSkillPackages(),
          fetchAgentModes()
        ]);
        if (!active) return;
        setRunProfiles(runProfileResponse.runProfiles);
        setSkillPackages(skillPackageResponse.skillPackages);
        setAgentModes(agentModeResponse.agentModes);
      } catch (error) {
        if (active) {
          setErrorText(error instanceof Error ? error.message : "加载能力配置中心失败");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (tab === "run_profile" && visibilityFilter !== "all") {
      setVisibilityFilter("all");
    }
  }, [tab, visibilityFilter]);

  useEffect(() => {
    if (!createPanel) return;
    if (createPanel.kind === panelKindForTab(tab)) return;
    setCreatePanel(createInitialPanelState(tab, runProfiles));
    setCreateErrorText("");
    setCreateSaving(false);
  }, [createPanel, runProfiles, tab]);

  useEffect(() => {
    if (!createPanel || createPanel.kind !== "agent_mode") return;
    if (createPanel.runProfileId || runProfiles.length === 0) return;
    setCreatePanel((current) =>
      current && current.kind === "agent_mode" ? { ...current, runProfileId: runProfiles[0]?.id ?? "" } : current
    );
  }, [createPanel, runProfiles]);

  const visibleItems = useMemo(() => {
    if (tab === "agent_mode") {
      return agentModes.filter((item) => {
        if (statusFilter !== "all" && item.status !== statusFilter) return false;
        if (visibilityFilter !== "all") {
          const visible = visibilityFilter === "visible";
          if (Boolean(item.visibleToUsers) !== visible) return false;
        }
        return matchesSearch(search, [
          item.name,
          item.slug,
          item.description,
          item.runProfileId,
          item.skillPackages.map((item) => item.skillPackageId).join(" "),
          item.workspaceRules.map((item) => item.workspaceId).join(" "),
          item.instructionSources.map((item) => item.sourceRef).join(" ")
        ]);
      });
    }
    if (tab === "skill_package") {
      return skillPackages.filter((item) => {
        if (statusFilter !== "all" && item.status !== statusFilter) return false;
        if (visibilityFilter !== "all") {
          const visible = visibilityFilter === "visible";
          if (Boolean(item.visibleToUsers) !== visible) return false;
        }
        return matchesSearch(search, [
          item.name,
          item.slug,
          item.description,
          item.items.map((item) => item.capabilityKey).join(" ")
        ]);
      });
    }
    return runProfiles.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      return matchesSearch(search, [item.name, item.slug, item.description, item.defaultModel, item.allowedModels.join(" ")]);
    });
  }, [agentModes, runProfiles, search, skillPackages, statusFilter, tab, visibilityFilter]);

  const selectedResource = useMemo(() => {
    if (tab === "agent_mode") {
      return agentModes.find((item) => item.id === selectedAgentModeId) ?? null;
    }
    if (tab === "skill_package") {
      return skillPackages.find((item) => item.id === selectedSkillPackageId) ?? null;
    }
    return runProfiles.find((item) => item.id === selectedRunProfileId) ?? null;
  }, [agentModes, runProfiles, selectedAgentModeId, selectedRunProfileId, selectedSkillPackageId, skillPackages, tab]);

  const selectedRunProfile = useMemo(() => {
    return tab === "run_profile" ? runProfiles.find((item) => item.id === selectedRunProfileId) ?? null : null;
  }, [runProfiles, selectedRunProfileId, tab]);

  function closeCreatePanel() {
    setCreatePanel(null);
    setCreateErrorText("");
    setCreateSaving(false);
  }

  function openCreatePanel() {
    setCreatePanel(createInitialPanelState(tab, runProfiles));
    setCreateErrorText("");
  }

  function selectResource(id: string) {
    if (tab === "agent_mode") {
      setSelectedAgentModeId(id);
      setSelectedSkillPackageId(null);
      setSelectedRunProfileId(null);
      return;
    }
    if (tab === "skill_package") {
      setSelectedSkillPackageId(id);
      setSelectedAgentModeId(null);
      setSelectedRunProfileId(null);
      return;
    }
    setSelectedRunProfileId(id);
    setSelectedAgentModeId(null);
    setSelectedSkillPackageId(null);
  }

  async function handleCreateSave() {
    if (!createPanel) return;
    setCreateSaving(true);
    setCreateErrorText("");

    try {
      if (createPanel.kind === "agent_mode") {
        const payload: CreateAgentModeInput = {
          name: createPanel.name.trim(),
          slug: createPanel.slug.trim(),
          description: createPanel.description.trim(),
          status: createPanel.status,
          visibleToUsers: createPanel.visibleToUsers,
          runProfileId: createPanel.runProfileId.trim()
        };
        const response = await createAgentMode(payload);
        setAgentModes((current) => [...current, response.agentMode]);
        setSelectedAgentModeId(response.agentMode.id);
        setCreatePanel(null);
      } else if (createPanel.kind === "skill_package") {
        const payload: CreateSkillPackageInput = {
          name: createPanel.name.trim(),
          slug: createPanel.slug.trim(),
          description: createPanel.description.trim(),
          status: createPanel.status,
          visibleToUsers: createPanel.visibleToUsers
        };
        const response = await createSkillPackage(payload);
        setSkillPackages((current) => [...current, response.skillPackage]);
        setSelectedSkillPackageId(response.skillPackage.id);
        setCreatePanel(null);
      } else {
        const allowedModels = createPanel.allowedModels
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        const payload: CreateRunProfileInput = {
          name: createPanel.name.trim(),
          slug: createPanel.slug.trim(),
          description: createPanel.description.trim(),
          status: createPanel.status,
          defaultModel: createPanel.defaultModel.trim(),
          allowedModels: allowedModels.length > 0 ? allowedModels : [createPanel.defaultModel.trim() || DEFAULT_RUN_PROFILE_MODEL],
          defaultReasoningEffort: createPanel.defaultReasoningEffort,
          sandboxMode: createPanel.sandboxMode,
          approvalPolicy: createPanel.approvalPolicy,
          networkAccessEnabled: createPanel.networkAccessEnabled,
          webSearchMode: createPanel.webSearchMode
        };
        const response = await createRunProfile(payload);
        setRunProfiles((current) => [...current, response.runProfile]);
        setSelectedRunProfileId(response.runProfile.id);
        setCreatePanel(null);
      }
    } catch (error) {
      setCreateErrorText(error instanceof Error ? error.message : "创建能力资源失败");
      setCreateSaving(false);
    }
  }

  const visibilityDisabled = tab === "run_profile";
  const resourceLabel = resourceTitle(tab);
  const noResultsLabel = tab === "agent_mode" ? "没有可用能力资源" : `当前筛选条件下没有${resourceLabel}`;

  function handleRunProfileUpdated(updatedRunProfile: RunProfileRecord) {
    setRunProfiles((current) => current.map((item) => (item.id === updatedRunProfile.id ? updatedRunProfile : item)));
    setSelectedRunProfileId(updatedRunProfile.id);
  }

  return (
    <section className="admin-card capability-center-shell resource-center-shell">
      <div className="admin-section-header">
        <div>
          <h2>能力配置中心</h2>
          <p>统一管理 Agent Modes、Skill Packages 和 Run Profiles。</p>
        </div>
        <div className="resource-center-create-row">
          <button type="button" className="admin-action-btn" onClick={openCreatePanel} disabled={loading}>
            新建能力资源
          </button>
        </div>
      </div>

      <div className="resource-center-type-tabs" role="tablist" aria-label="能力资源类型">
        {CAPABILITY_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? "resource-center-type-tab active" : "resource-center-type-tab"}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="resource-center-toolbar capability-center-toolbar">
        <label className="field resource-center-search">
          <span className="field-label">搜索资源</span>
          <input
            className="field-input"
            aria-label="搜索资源"
            placeholder={`名称、slug、描述${tab === "agent_mode" ? "、run profile" : tab === "skill_package" ? "、能力项" : "、模型"}`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        <label className="field resource-center-filter">
          <span className="field-label">状态筛选</span>
          <select
            className="field-input"
            aria-label="状态筛选"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as CapabilityStatusFilter)}
          >
            <option value="all">全部状态</option>
            <option value="active">启用中</option>
            <option value="disabled">已禁用</option>
          </select>
        </label>

        <label className="field resource-center-filter">
          <span className="field-label">可见性筛选</span>
          <select
            className="field-input"
            aria-label="可见性筛选"
            value={visibilityDisabled ? "all" : visibilityFilter}
            disabled={visibilityDisabled}
            onChange={(event) => setVisibilityFilter(event.target.value as CapabilityVisibilityFilter)}
          >
            <option value="all">{VISIBILITY_FILTER_LABELS.all}</option>
            <option value="visible">{VISIBILITY_FILTER_LABELS.visible}</option>
            <option value="hidden">{VISIBILITY_FILTER_LABELS.hidden}</option>
          </select>
        </label>
      </div>

      {loading ? <p className="resource-center-subtle">加载能力资源中...</p> : null}
      {errorText ? <p className="err-text">{errorText}</p> : null}

      <div className="resource-center-body capability-center-body">
        <aside className="resource-center-sidebar">
          <ul className="resource-center-list capability-center-list">
            {tab === "agent_mode"
              ? (visibleItems as AgentModeRecord[]).map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={selectedAgentModeId === item.id ? "resource-center-item active" : "resource-center-item"}
                      onClick={() => selectResource(item.id)}
                    >
                      <span className="resource-center-item-title">{item.name}</span>
                      <span className="resource-center-item-meta capability-center-item-meta">
                        {item.slug}
                        {` · ${item.visibleToUsers ? "visible" : "hidden"}`}
                        {` · ${item.status}`}
                      </span>
                    </button>
                  </li>
                ))
              : tab === "skill_package"
                ? (visibleItems as SkillPackageRecord[]).map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={selectedSkillPackageId === item.id ? "resource-center-item active" : "resource-center-item"}
                        onClick={() => selectResource(item.id)}
                      >
                        <span className="resource-center-item-title">{item.name}</span>
                        <span className="resource-center-item-meta capability-center-item-meta">
                          {item.slug}
                          {` · ${item.visibleToUsers ? "visible" : "hidden"}`}
                          {` · ${item.status}`}
                        </span>
                      </button>
                    </li>
                  ))
                : (visibleItems as RunProfileRecord[]).map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={selectedRunProfileId === item.id ? "resource-center-item active" : "resource-center-item"}
                        onClick={() => selectResource(item.id)}
                      >
                        <span className="resource-center-item-title">{item.name}</span>
                        <span className="resource-center-item-meta capability-center-item-meta">
                          {item.slug}
                          {` · ${item.status}`}
                        </span>
                      </button>
                    </li>
                  ))}
          </ul>

          {visibleItems.length === 0 && !loading ? <p className="resource-center-empty">{noResultsLabel}</p> : null}
        </aside>

        <section className="resource-center-detail capability-center-detail">
          {createPanel ? (
            <section className="resource-center-section capability-center-create-panel">
              <div className="resource-center-section-header">
                <div>
                  <h3>新建能力资源</h3>
                  <p>{resourceLabel} 创建后会立即出现在左侧列表中。</p>
                </div>
              </div>

              {createErrorText ? <p className="err-text">{createErrorText}</p> : null}

              <div className="resource-center-form-grid capability-center-create-grid">
                <label className="field">
                  <span className="field-label">能力名称</span>
                  <input
                    className="field-input"
                    aria-label="能力名称"
                    disabled={createSaving}
                    value={createPanel.name}
                    onChange={(event) =>
                      setCreatePanel((current) => (current ? { ...current, name: event.target.value } : current))
                    }
                  />
                </label>
                <label className="field">
                  <span className="field-label">能力 slug</span>
                  <input
                    className="field-input"
                    aria-label="能力 slug"
                    disabled={createSaving}
                    value={createPanel.slug}
                    onChange={(event) =>
                      setCreatePanel((current) => (current ? { ...current, slug: event.target.value } : current))
                    }
                  />
                </label>

                <label className="field resource-center-form-span-2">
                  <span className="field-label">能力描述</span>
                  <textarea
                    className="field-input textarea"
                    aria-label="能力描述"
                    disabled={createSaving}
                    value={createPanel.description}
                    onChange={(event) =>
                      setCreatePanel((current) => (current ? { ...current, description: event.target.value } : current))
                    }
                  />
                </label>

                <label className="field">
                  <span className="field-label">状态</span>
                  <select
                    className="field-input"
                    aria-label="状态"
                    disabled={createSaving}
                    value={createPanel.status}
                    onChange={(event) =>
                      setCreatePanel((current) => (current ? { ...current, status: event.target.value } : current))
                    }
                  >
                    <option value="active">active</option>
                    <option value="disabled">disabled</option>
                  </select>
                </label>

                {createPanel.kind !== "run_profile" ? (
                  <label className="field">
                    <span className="field-label">对用户可见</span>
                    <select
                      className="field-input"
                      aria-label="对用户可见"
                      disabled={createSaving}
                      value={createPanel.visibleToUsers ? "visible" : "hidden"}
                      onChange={(event) =>
                        setCreatePanel((current) =>
                          current && current.kind !== "run_profile"
                            ? { ...current, visibleToUsers: event.target.value === "visible" }
                            : current
                        )
                      }
                    >
                      <option value="hidden">hidden</option>
                      <option value="visible">visible</option>
                    </select>
                  </label>
                ) : null}

                {createPanel.kind === "agent_mode" ? (
                  <label className="field resource-center-form-span-2">
                    <span className="field-label">运行策略</span>
                    <select
                      className="field-input"
                      aria-label="运行策略"
                      disabled={createSaving || runProfiles.length === 0}
                      value={createPanel.runProfileId}
                      onChange={(event) =>
                        setCreatePanel((current) =>
                          current && current.kind === "agent_mode"
                            ? { ...current, runProfileId: event.target.value }
                            : current
                        )
                      }
                    >
                      <option value="">请选择运行策略</option>
                      {runProfiles.map((runProfile) => (
                        <option key={runProfile.id} value={runProfile.id}>
                          {runProfile.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {createPanel.kind === "run_profile" ? (
                  <>
                    <label className="field">
                      <span className="field-label">默认模型</span>
                      <input
                        className="field-input"
                        aria-label="默认模型"
                        disabled={createSaving}
                        value={createPanel.defaultModel}
                        onChange={(event) =>
                          setCreatePanel((current) =>
                            current && current.kind === "run_profile"
                              ? { ...current, defaultModel: event.target.value }
                              : current
                          )
                        }
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">可选模型</span>
                      <input
                        className="field-input"
                        aria-label="可选模型"
                        disabled={createSaving}
                        value={createPanel.allowedModels}
                        onChange={(event) =>
                          setCreatePanel((current) =>
                            current && current.kind === "run_profile"
                              ? { ...current, allowedModels: event.target.value }
                              : current
                          )
                        }
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">推理强度</span>
                      <select
                        className="field-input"
                        aria-label="推理强度"
                        disabled={createSaving}
                        value={createPanel.defaultReasoningEffort}
                        onChange={(event) =>
                          setCreatePanel((current) =>
                            current && current.kind === "run_profile"
                              ? { ...current, defaultReasoningEffort: event.target.value as CreateRunProfileInput["defaultReasoningEffort"] }
                              : current
                          )
                        }
                      >
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
                      <select
                        className="field-input"
                        aria-label="沙箱模式"
                        disabled={createSaving}
                        value={createPanel.sandboxMode}
                        onChange={(event) =>
                          setCreatePanel((current) =>
                            current && current.kind === "run_profile"
                              ? { ...current, sandboxMode: event.target.value as CreateRunProfileInput["sandboxMode"] }
                              : current
                          )
                        }
                      >
                        <option value="read-only">read-only</option>
                        <option value="workspace-write">workspace-write</option>
                        <option value="danger-full-access">danger-full-access</option>
                      </select>
                    </label>
                    <label className="field">
                      <span className="field-label">审批策略</span>
                      <select
                        className="field-input"
                        aria-label="审批策略"
                        disabled={createSaving}
                        value={createPanel.approvalPolicy}
                        onChange={(event) =>
                          setCreatePanel((current) =>
                            current && current.kind === "run_profile"
                              ? { ...current, approvalPolicy: event.target.value as CreateRunProfileInput["approvalPolicy"] }
                              : current
                          )
                        }
                      >
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
                        disabled={createSaving}
                        value={createPanel.networkAccessEnabled ? "enabled" : "disabled"}
                        onChange={(event) =>
                          setCreatePanel((current) =>
                            current && current.kind === "run_profile"
                              ? { ...current, networkAccessEnabled: event.target.value === "enabled" }
                              : current
                          )
                        }
                      >
                        <option value="disabled">disabled</option>
                        <option value="enabled">enabled</option>
                      </select>
                    </label>
                    <label className="field">
                      <span className="field-label">搜索模式</span>
                      <select
                        className="field-input"
                        aria-label="搜索模式"
                        disabled={createSaving}
                        value={createPanel.webSearchMode}
                        onChange={(event) =>
                          setCreatePanel((current) =>
                            current && current.kind === "run_profile"
                              ? { ...current, webSearchMode: event.target.value as CreateRunProfileInput["webSearchMode"] }
                              : current
                          )
                        }
                      >
                        <option value="disabled">disabled</option>
                        <option value="cached">cached</option>
                        <option value="live">live</option>
                      </select>
                    </label>
                  </>
                ) : null}
              </div>

              <div className="resource-center-actions">
                <button
                  type="button"
                  className="admin-action-btn"
                  disabled={createSaving || (createPanel.kind === "agent_mode" && runProfiles.length === 0)}
                  onClick={() => void handleCreateSave()}
                >
                  {createSaving ? "创建中..." : "创建能力"}
                </button>
                <button type="button" className="admin-secondary-btn" disabled={createSaving} onClick={closeCreatePanel}>
                  取消创建
                </button>
              </div>
            </section>
          ) : selectedRunProfile ? (
            <RunProfileDetailView runProfile={selectedRunProfile} onRunProfileUpdated={handleRunProfileUpdated} />
          ) : selectedResource ? (
            <CapabilitySummaryCard tab={tab} resource={selectedResource as AgentModeRecord | SkillPackageRecord | RunProfileRecord} />
          ) : (
            <div className="resource-center-placeholder empty">
              <h3>{resourceLabel}</h3>
              <p>请选择左侧能力资源以继续配置。</p>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
