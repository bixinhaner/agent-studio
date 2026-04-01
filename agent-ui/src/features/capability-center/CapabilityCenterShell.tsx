import { ReloadOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Empty, Input, Segmented, Select, Space, Spin, Tag, Typography } from "antd";

import {
  createAgentMode,
  createRunProfile,
  createSkillPackage,
  fetchAgentModes,
  fetchRunProfiles,
  fetchSkillPackages
} from "./api";
import { AgentModeDetailView } from "./AgentModeDetailView";
import { RunProfileDetailView } from "./RunProfileDetailView";
import { SkillPackageDetailView } from "./SkillPackageDetailView";
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

const STATUS_FILTER_OPTIONS: Array<{ label: string; value: CapabilityStatusFilter }> = [
  { label: "全部状态", value: "all" },
  { label: "启用中", value: "active" },
  { label: "已禁用", value: "disabled" }
];

const VISIBILITY_FILTER_OPTIONS: Array<{ label: string; value: CapabilityVisibilityFilter }> = [
  { label: VISIBILITY_FILTER_LABELS.all, value: "all" },
  { label: VISIBILITY_FILTER_LABELS.visible, value: "visible" },
  { label: VISIBILITY_FILTER_LABELS.hidden, value: "hidden" }
];

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

function defaultSlugBase(kind: CreatePanelState["kind"]) {
  if (kind === "agent_mode") return "agent-mode";
  if (kind === "skill_package") return "skill-package";
  return "run-profile";
}

function slugifyValue(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function suggestUniqueSlug(base: string, existingSlugs: string[]) {
  const normalizedBase = slugifyValue(base);
  const seed = normalizedBase || "resource";
  const taken = new Set(existingSlugs.map((item) => item.trim().toLowerCase()).filter(Boolean));
  if (!taken.has(seed)) return seed;
  let index = 2;
  let candidate = `${seed}-${index}`;
  while (taken.has(candidate)) {
    index += 1;
    candidate = `${seed}-${index}`;
  }
  return candidate;
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

function statusTagColor(status: string): string {
  if (status === "active") return "success";
  if (status === "draft") return "warning";
  if (status === "error") return "error";
  return "default";
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
          <Tag color={agentMode.status === "active" ? "success" : "default"}>{agentMode.status}</Tag>
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
            <span className="field-label">指令源</span>
            <p>{agentMode.instructionSources.length}</p>
          </div>
        </div>

        <p className="capability-center-detail-note">当前摘要展示基础信息，详细配置请在下方详情编辑区维护。</p>
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
          <Tag color={skillPackage.status === "active" ? "success" : "default"}>{skillPackage.status}</Tag>
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

        <p className="capability-center-detail-note">当前摘要展示基础信息，详细配置请在下方详情编辑区维护。</p>
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
        <Tag color={runProfile.status === "active" ? "success" : "default"}>{runProfile.status}</Tag>
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

      <p className="capability-center-detail-note">当前摘要展示基础信息，详细配置请在下方详情编辑区维护。</p>
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
  const [createSlugEdited, setCreateSlugEdited] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [createErrorText, setCreateErrorText] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);

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
  }, [reloadNonce]);

  useEffect(() => {
    if (tab === "run_profile" && visibilityFilter !== "all") {
      setVisibilityFilter("all");
    }
  }, [tab, visibilityFilter]);

  useEffect(() => {
    if (!createPanel) return;
    if (createPanel.kind === panelKindForTab(tab)) return;
    setCreatePanel(createInitialPanelState(tab, runProfiles));
    setCreateSlugEdited(false);
    setCreateErrorText("");
    setCreateSaving(false);
  }, [createPanel, runProfiles, tab]);

  const existingSlugsForCreate = useMemo(() => {
    if (tab === "agent_mode") {
      return agentModes.map((item) => item.slug);
    }
    if (tab === "skill_package") {
      return skillPackages.map((item) => item.slug);
    }
    return runProfiles.map((item) => item.slug);
  }, [agentModes, runProfiles, skillPackages, tab]);

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

  const selectedSkillPackage = useMemo(() => {
    return tab === "skill_package" ? skillPackages.find((item) => item.id === selectedSkillPackageId) ?? null : null;
  }, [selectedSkillPackageId, skillPackages, tab]);

  const selectedAgentMode = useMemo(() => {
    return tab === "agent_mode" ? agentModes.find((item) => item.id === selectedAgentModeId) ?? null : null;
  }, [agentModes, selectedAgentModeId, tab]);

  function closeCreatePanel() {
    setCreatePanel(null);
    setCreateSlugEdited(false);
    setCreateErrorText("");
    setCreateSaving(false);
  }

  function openCreatePanel() {
    setCreatePanel(createInitialPanelState(tab, runProfiles));
    setCreateSlugEdited(false);
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
  const visibleCount = visibleItems.length;
  const enabledCount = visibleItems.filter((item) => item.status === "active").length;
  const resourceCountLabel = tab === "agent_mode" ? "模式资源总数" : tab === "skill_package" ? "技能包总数" : "运行策略总数";
  const sidebarTitle = tab === "agent_mode" ? "模式列表" : tab === "skill_package" ? "技能包列表" : "运行策略列表";
  const selectedResourceSummary = selectedResource?.name ? `已选：${selectedResource.name}` : "未选择";

  function handleRunProfileUpdated(updatedRunProfile: RunProfileRecord) {
    setRunProfiles((current) => current.map((item) => (item.id === updatedRunProfile.id ? updatedRunProfile : item)));
    setSelectedRunProfileId(updatedRunProfile.id);
  }

  function handleSkillPackageUpdated(updatedSkillPackage: SkillPackageRecord) {
    setSkillPackages((current) => current.map((item) => (item.id === updatedSkillPackage.id ? updatedSkillPackage : item)));
    setSelectedSkillPackageId(updatedSkillPackage.id);
  }

  return (
    <Card className="admin-card capability-center-shell resource-center-shell antd-admin-card admin-workspace-shell">
      <div className="admin-section-header admin-workspace-header">
        <div>
          <Typography.Title level={4} className="admin-card-heading">
            能力配置中心
          </Typography.Title>
          <Typography.Paragraph>统一管理 Agent Modes、Skill Packages 和 Run Profiles。</Typography.Paragraph>
        </div>
        <Space wrap>
          <Tag color="blue">{resourceCountLabel} {visibleCount}</Tag>
          <Tag color={enabledCount > 0 ? "success" : "default"}>active {enabledCount}</Tag>
          <Button icon={<ReloadOutlined />} onClick={() => setReloadNonce((current) => current + 1)} loading={loading}>
            刷新列表
          </Button>
          <Button type="primary" onClick={openCreatePanel} disabled={loading}>
            新建能力资源
          </Button>
        </Space>
      </div>

      <div className="resource-center-type-tabs admin-workspace-segmented" role="tablist" aria-label="能力资源类型">
        <Segmented
          block
          value={tab}
          options={CAPABILITY_TABS.map((item) => ({ label: item.label, value: item.id }))}
          onChange={(value) => setTab(value as CapabilityCenterTab)}
        />
      </div>

      <div className="resource-center-toolbar capability-center-toolbar admin-workspace-toolbar">
        <label className="field resource-center-search">
          <span className="field-label">搜索资源</span>
          <Input
            aria-label="搜索资源"
            placeholder={`名称、slug、描述${tab === "agent_mode" ? "、run profile" : tab === "skill_package" ? "、能力项" : "、模型"}`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            allowClear
          />
        </label>

        <label className="field resource-center-filter admin-workspace-filter">
          <span className="field-label">状态筛选</span>
          <Select
            aria-label="状态筛选"
            value={statusFilter}
            options={STATUS_FILTER_OPTIONS}
            onChange={(value) => setStatusFilter(value as CapabilityStatusFilter)}
          />
        </label>

        <label className="field resource-center-filter admin-workspace-filter">
          <span className="field-label">可见性筛选</span>
          <Select
            aria-label="可见性筛选"
            value={visibilityDisabled ? "all" : visibilityFilter}
            disabled={visibilityDisabled}
            options={VISIBILITY_FILTER_OPTIONS}
            onChange={(value) => setVisibilityFilter(value as CapabilityVisibilityFilter)}
          />
        </label>
      </div>

      <div className="resource-center-stats-row capability-center-stats-row" aria-label="能力统计">
        <article className="resource-center-stat-card">
          <span className="resource-center-stat-label">{resourceCountLabel}</span>
          <strong className="resource-center-stat-value">{visibleCount}</strong>
        </article>
        <article className="resource-center-stat-card">
          <span className="resource-center-stat-label">启用中</span>
          <strong className="resource-center-stat-value">{enabledCount}</strong>
        </article>
        <article className="resource-center-stat-card">
          <span className="resource-center-stat-label">选中资源</span>
          <strong className="resource-center-stat-value">{selectedResourceSummary}</strong>
        </article>
      </div>

      {loading ? (
        <div className="admin-workspace-loading">
          <Spin size="small" />
        </div>
      ) : null}
      {errorText ? <Alert className="admin-alert-inline" type="error" showIcon message={errorText} /> : null}
      <div className="resource-center-body capability-center-body">
        <aside className="resource-center-sidebar">
          <div className="resource-center-sidebar-header">
            <span>{sidebarTitle}</span>
            <Tag color="blue">{visibleCount}</Tag>
          </div>

          <div className="resource-center-list-wrap">
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
                            <span>{item.slug}</span>
                            <Tag>{item.visibleToUsers ? "visible" : "hidden"}</Tag>
                            <Tag color={statusTagColor(item.status)}>{item.status}</Tag>
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
                            <span>{item.slug}</span>
                            <Tag>{item.visibleToUsers ? "visible" : "hidden"}</Tag>
                            <Tag color={statusTagColor(item.status)}>{item.status}</Tag>
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
                            <span>{item.slug}</span>
                            <Tag color={statusTagColor(item.status)}>{item.status}</Tag>
                          </span>
                        </button>
                      </li>
                    ))}
            </ul>
          </div>

          {visibleItems.length === 0 && !loading ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} className="resource-center-empty-block" description={noResultsLabel} />
          ) : null}
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

              {createErrorText ? <Alert className="admin-alert-inline" type="error" showIcon message={createErrorText} /> : null}

              <div className="resource-center-form-grid capability-center-create-grid">
                <div className="resource-center-form-span-2 admin-form-inline-section-head">
                  <h4>基础信息</h4>
                  <p>名称用于展示，slug 用于稳定识别，状态用于控制是否可用。</p>
                </div>
                <label className="field">
                  <span className="field-label">能力名称</span>
                  <input
                    className="field-input"
                    aria-label="能力名称"
                    disabled={createSaving}
                    value={createPanel.name}
                    onChange={(event) =>
                      setCreatePanel((current) => {
                        if (!current) return current;
                        const nextName = event.target.value;
                        if (createSlugEdited) {
                          return { ...current, name: nextName };
                        }
                        const nextSlug = suggestUniqueSlug(
                          slugifyValue(nextName) || defaultSlugBase(current.kind),
                          existingSlugsForCreate
                        );
                        return { ...current, name: nextName, slug: nextSlug };
                      })
                    }
                  />
                  <small className="field-help">建议使用业务语义明确的名称，便于运营同学检索。</small>
                </label>
                <label className="field">
                  <span className="field-label">能力 slug</span>
                  <input
                    className="field-input"
                    aria-label="能力 slug"
                    disabled={createSaving}
                    value={createPanel.slug}
                    onChange={(event) => {
                      setCreateSlugEdited(true);
                      setCreatePanel((current) => (current ? { ...current, slug: event.target.value } : current));
                    }}
                  />
                  <small className="field-help">建议使用小写英文和连字符，创建后尽量不要频繁变更。</small>
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
                  <small className="field-help">可填写目标用户、适用场景和注意事项。</small>
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
                  <small className="field-help">`active` 可被选择，`disabled` 仅保留配置记录。</small>
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
                    <small className="field-help">`visible` 会出现在用户端，`hidden` 仅管理员可见。</small>
                  </label>
                ) : null}

                {createPanel.kind === "agent_mode" ? (
                  <>
                    <div className="resource-center-form-span-2 admin-form-inline-section-head">
                      <h4>Agent 模式配置</h4>
                      <p>为该 Agent 模式绑定运行策略，决定模型和执行权限。</p>
                    </div>
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
                      <small className="field-help">未绑定运行策略时，Agent 模式无法保存。</small>
                    </label>
                  </>
                ) : null}

                {createPanel.kind === "run_profile" ? (
                  <>
                    <div className="resource-center-form-span-2 admin-form-inline-section-head">
                      <h4>运行策略配置</h4>
                      <p>统一配置模型、推理强度和执行安全策略。</p>
                    </div>
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
                      <small className="field-help">新会话默认使用该模型，可与下方可选模型配合控制范围。</small>
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
                      <small className="field-help">多个模型用英文逗号分隔，例如 `gpt-5.4,gpt-5.4-mini`。</small>
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
                      <small className="field-help">值越高通常质量更好，但耗时和成本也更高。</small>
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
                      <small className="field-help">建议默认 `workspace-write`，仅在必要时启用更高权限。</small>
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
                      <small className="field-help">控制执行敏感命令时是否需要人工确认。</small>
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
                      <small className="field-help">关闭后模型无法访问外部网络，仅可用本地上下文。</small>
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
                      <small className="field-help">`live` 获取实时信息，`cached` 适合稳定场景。</small>
                    </label>
                  </>
                ) : null}
              </div>

              <div className="resource-center-actions">
                <Button
                  type="primary"
                  aria-label="创建能力"
                  disabled={createSaving || (createPanel.kind === "agent_mode" && runProfiles.length === 0)}
                  onClick={() => void handleCreateSave()}
                >
                  {createSaving ? "创建中..." : "创建能力"}
                </Button>
                <Button aria-label="取消创建" disabled={createSaving} onClick={closeCreatePanel}>
                  取消创建
                </Button>
              </div>
            </section>
          ) : selectedAgentMode ? (
            <AgentModeDetailView
              agentMode={selectedAgentMode}
              runProfiles={runProfiles}
              skillPackages={skillPackages}
              onAgentModeUpdated={(updatedAgentMode) =>
                setAgentModes((current) => current.map((item) => (item.id === updatedAgentMode.id ? updatedAgentMode : item)))
              }
            />
          ) : selectedRunProfile ? (
            <RunProfileDetailView runProfile={selectedRunProfile} onRunProfileUpdated={handleRunProfileUpdated} />
          ) : selectedSkillPackage ? (
            <SkillPackageDetailView
              skillPackage={selectedSkillPackage}
              onSkillPackageUpdated={handleSkillPackageUpdated}
            />
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
    </Card>
  );
}
