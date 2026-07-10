import { ReloadOutlined } from "@ant-design/icons";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  Segmented,
  Select,
  Space,
  Spin,
  Steps,
  Switch,
  Tag,
  Typography
} from "antd";

import {
  createAgentMode,
  createRunProfile,
  createSkillPackage,
  fetchAgentModes,
  fetchRuntimeModelCatalog,
  fetchRunProfiles,
  fetchSkillPackages
} from "./api";
import {
  modelOptionsFromCatalog,
  normalizeReasoningEffortForModel,
  reasoningOptionsForModel,
  type RuntimeModelCatalog
} from "../../lib/model-config";
import { deepEqual, normalizeRecordForCompare } from "../../lib/object-utils";
import { useIsNarrowScreen } from "../../lib/use-is-narrow-screen";
import { openWarningConfirm } from "../../lib/warning-modal";
import { MobileFilterDrawer } from "../admin/components/MobileFilterDrawer";
import {
  buildRunProfileModelOptions,
  DEFAULT_RUN_PROFILE_MODEL,
  normalizeRunProfileAllowedModels
} from "./run-profile-model-options";
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

const AgentModeDetailViewLazy = lazy(() =>
  import("./AgentModeDetailView").then((module) => ({ default: module.AgentModeDetailView }))
);
const RunProfileDetailViewLazy = lazy(() =>
  import("./RunProfileDetailView").then((module) => ({ default: module.RunProfileDetailView }))
);
const SkillPackageDetailViewLazy = lazy(() =>
  import("./SkillPackageDetailView").then((module) => ({ default: module.SkillPackageDetailView }))
);

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
      allowedModels: string[];
      defaultReasoningEffort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
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

const CREATE_STATUS_OPTIONS = [
  { label: "active", value: "active" },
  { label: "disabled", value: "disabled" }
];

const CREATE_VISIBILITY_OPTIONS = [
  { label: "仅管理员", value: "hidden" },
  { label: "对用户可见", value: "visible" }
];

const CREATE_SANDBOX_OPTIONS = [
  { label: "read-only", value: "read-only" },
  { label: "workspace-write", value: "workspace-write" },
  { label: "danger-full-access", value: "danger-full-access" }
];

const CREATE_APPROVAL_OPTIONS = [
  { label: "never", value: "never" },
  { label: "on-request", value: "on-request" },
  { label: "on-failure", value: "on-failure" },
  { label: "untrusted", value: "untrusted" }
];

const CREATE_SEARCH_OPTIONS = [
  { label: "disabled", value: "disabled" },
  { label: "cached", value: "cached" },
  { label: "live", value: "live" }
];

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

function createStepsForKind(kind: CreatePanelState["kind"]) {
  if (kind === "agent_mode") {
    return [
      { title: "基础信息", description: "名称、slug、描述" },
      { title: "绑定策略", description: "运行策略与可见性" },
      { title: "确认创建", description: "检查配置后提交" }
    ];
  }
  if (kind === "skill_package") {
    return [
      { title: "基础信息", description: "名称、slug、描述" },
      { title: "可见性", description: "状态与用户可见范围" },
      { title: "确认创建", description: "检查配置后提交" }
    ];
  }
  return [
    { title: "基础信息", description: "名称、slug、描述" },
    { title: "运行参数", description: "模型与执行策略" },
    { title: "确认创建", description: "检查配置后提交" }
  ];
}

function createStepValidationMessage(
  panel: CreatePanelState,
  step: number,
  runProfileCount: number
): string | null {
  if (step === 0) {
    if (!panel.name.trim()) return "请填写能力名称";
    if (!panel.slug.trim()) return "请填写能力 slug";
    return null;
  }

  if (step !== 1) return null;
  if (!panel.status.trim()) return "请设置状态";
  if (panel.kind === "agent_mode") {
    if (runProfileCount === 0) return "请先创建至少一个运行策略";
    if (!panel.runProfileId.trim()) return "请绑定运行策略";
    return null;
  }
  if (panel.kind === "run_profile") {
    if (!panel.defaultModel.trim()) return "请选择默认模型";
    if (panel.allowedModels.length === 0) return "请至少选择一个可选模型";
    return null;
  }
  return null;
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
    allowedModels: [DEFAULT_RUN_PROFILE_MODEL],
    defaultReasoningEffort: "high",
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    networkAccessEnabled: true,
    webSearchMode: "live"
  };
}

function hasCreatePanelChanges(
  currentPanel: CreatePanelState | null,
  initialPanel: CreatePanelState | null,
  currentStep: number
): boolean {
  if (!currentPanel || !initialPanel) return false;
  if (currentStep > 0) return true;
  return !deepEqual(normalizeRecordForCompare(currentPanel), normalizeRecordForCompare(initialPanel));
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
            <span className="field-label">AGENTS.md 规则</span>
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
  const [modelCatalog, setModelCatalog] = useState<RuntimeModelCatalog | null>(null);
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
  const [createPanelInitial, setCreatePanelInitial] = useState<CreatePanelState | null>(null);
  const [createStep, setCreateStep] = useState(0);
  const [createSlugEdited, setCreateSlugEdited] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [createErrorText, setCreateErrorText] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const isNarrowScreen = useIsNarrowScreen(980);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setErrorText("");
      try {
        const [runProfileResponse, skillPackageResponse, agentModeResponse, nextModelCatalog] = await Promise.all([
          fetchRunProfiles(),
          fetchSkillPackages(),
          fetchAgentModes(),
          fetchRuntimeModelCatalog()
        ]);
        if (!active) return;
        setRunProfiles(runProfileResponse.runProfiles);
        setSkillPackages(skillPackageResponse.skillPackages);
        setAgentModes(agentModeResponse.agentModes);
        setModelCatalog(nextModelCatalog);
      } catch (error) {
        if (active) {
          setErrorText(error instanceof Error ? error.message : "加载智能体配置失败");
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
    const nextInitial = createInitialPanelState(tab, runProfiles);
    setCreatePanel(nextInitial);
    setCreatePanelInitial(nextInitial);
    setCreateStep(0);
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

  function resetCreatePanel() {
    setCreatePanel(null);
    setCreatePanelInitial(null);
    setCreateStep(0);
    setCreateSlugEdited(false);
    setCreateErrorText("");
    setCreateSaving(false);
  }

  async function closeCreatePanel(forceClose = false) {
    if (
      !forceClose &&
      hasCreatePanelChanges(createPanel, createPanelInitial, createStep)
    ) {
      const confirmed = await openWarningConfirm({
        title: "确认关闭创建流程",
        content: "当前存在未保存内容，关闭后将丢失本次填写。",
        description: "建议先完成创建，或确认放弃当前输入。",
        okText: "放弃并关闭",
        cancelText: "继续编辑",
        dangerLevel: "warning",
        okButtonDanger: false
      });
      if (!confirmed) return;
    }

    resetCreatePanel();
  }

  function openCreatePanel() {
    const nextInitial = createInitialPanelState(tab, runProfiles);
    setCreatePanel(nextInitial);
    setCreatePanelInitial(nextInitial);
    setCreateStep(0);
    setCreateSlugEdited(false);
    setCreateErrorText("");
    setCreateSaving(false);
  }

  function selectResource(id: string) {
    if (tab === "agent_mode") {
      setSelectedAgentModeId(id);
      setSelectedSkillPackageId(null);
      setSelectedRunProfileId(null);
      if (isNarrowScreen) setMobileDetailOpen(true);
      return;
    }
    if (tab === "skill_package") {
      setSelectedSkillPackageId(id);
      setSelectedAgentModeId(null);
      setSelectedRunProfileId(null);
      if (isNarrowScreen) setMobileDetailOpen(true);
      return;
    }
    setSelectedRunProfileId(id);
    setSelectedAgentModeId(null);
    setSelectedSkillPackageId(null);
    if (isNarrowScreen) setMobileDetailOpen(true);
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
        resetCreatePanel();
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
        resetCreatePanel();
      } else {
        const allowedModels = normalizeRunProfileAllowedModels(createPanel.allowedModels, createPanel.defaultModel);
        const payload: CreateRunProfileInput = {
          name: createPanel.name.trim(),
          slug: createPanel.slug.trim(),
          description: createPanel.description.trim(),
          status: createPanel.status,
          defaultModel: createPanel.defaultModel.trim(),
          allowedModels,
          defaultReasoningEffort: createPanel.defaultReasoningEffort,
          sandboxMode: createPanel.sandboxMode,
          approvalPolicy: createPanel.approvalPolicy,
          networkAccessEnabled: createPanel.networkAccessEnabled,
          webSearchMode: createPanel.webSearchMode
        };
        const response = await createRunProfile(payload);
        setRunProfiles((current) => [...current, response.runProfile]);
        setSelectedRunProfileId(response.runProfile.id);
        resetCreatePanel();
      }
    } catch (error) {
      setCreateErrorText(error instanceof Error ? error.message : "创建能力资源失败");
      setCreateSaving(false);
    }
  }

  const visibilityDisabled = tab === "run_profile";
  const mobileFilterCount = (search.trim() ? 1 : 0) + (statusFilter !== "all" ? 1 : 0) + (visibilityFilter !== "all" ? 1 : 0);
  const resourceLabel = resourceTitle(tab);
  const noResultsLabel = tab === "agent_mode" ? "没有可用能力资源" : `当前筛选条件下没有${resourceLabel}`;
  const visibleCount = visibleItems.length;
  const enabledCount = visibleItems.filter((item) => item.status === "active").length;
  const resourceCountLabel = tab === "agent_mode" ? "模式资源总数" : tab === "skill_package" ? "技能包总数" : "运行策略总数";
  const sidebarTitle = tab === "agent_mode" ? "模式列表" : tab === "skill_package" ? "技能包列表" : "运行策略列表";
  const selectedResourceSummary = selectedResource?.name ? `已选：${selectedResource.name}` : "未选择";
  const createPanelKind = createPanel?.kind ?? panelKindForTab(tab);
  const createSteps = useMemo(() => createStepsForKind(createPanelKind), [createPanelKind]);
  const maxCreateStep = createSteps.length - 1;
  const activeCreateStep = Math.min(createStep, maxCreateStep);
  const runProfileModelOptions = useMemo(() => {
    const modelsFromProfiles = runProfiles.flatMap((profile) => [profile.defaultModel, ...profile.allowedModels]);
    const modelsFromCreatePanel =
      createPanel?.kind === "run_profile" ? [createPanel.defaultModel, ...createPanel.allowedModels] : [];
    return buildRunProfileModelOptions(
      [...modelsFromProfiles, ...modelsFromCreatePanel],
      modelOptionsFromCatalog(modelCatalog)
    );
  }, [createPanel, modelCatalog, runProfiles]);
  const createReasoningOptions = useMemo(
    () =>
      createPanel?.kind === "run_profile"
        ? reasoningOptionsForModel(createPanel.defaultModel, modelOptionsFromCatalog(modelCatalog))
        : [],
    [createPanel, modelCatalog]
  );

  useEffect(() => {
    if (createStep <= maxCreateStep) return;
    setCreateStep(maxCreateStep);
  }, [createStep, maxCreateStep]);

  function handleRunProfileUpdated(updatedRunProfile: RunProfileRecord) {
    setRunProfiles((current) => current.map((item) => (item.id === updatedRunProfile.id ? updatedRunProfile : item)));
    setSelectedRunProfileId(updatedRunProfile.id);
  }

  function handleSkillPackageUpdated(updatedSkillPackage: SkillPackageRecord) {
    setSkillPackages((current) => current.map((item) => (item.id === updatedSkillPackage.id ? updatedSkillPackage : item)));
    setSelectedSkillPackageId(updatedSkillPackage.id);
  }

  function handleCreateNextStep() {
    if (!createPanel) return;
    const errorMessage = createStepValidationMessage(createPanel, activeCreateStep, runProfiles.length);
    if (errorMessage) {
      setCreateErrorText(errorMessage);
      return;
    }
    setCreateErrorText("");
    setCreateStep((current) => Math.min(current + 1, maxCreateStep));
  }

  function handleCreatePreviousStep() {
    setCreateErrorText("");
    setCreateStep((current) => Math.max(current - 1, 0));
  }

  useEffect(() => {
    if (!isNarrowScreen) {
      setMobileDetailOpen(false);
    }
  }, [isNarrowScreen]);

  function renderSelectedDetail() {
    if (selectedAgentMode) {
      return (
        <Suspense
          fallback={(
            <div className="admin-workspace-loading">
              <Spin size="small" />
            </div>
          )}
        >
          <AgentModeDetailViewLazy
            agentMode={selectedAgentMode}
            runProfiles={runProfiles}
            skillPackages={skillPackages}
            onAgentModeUpdated={(updatedAgentMode) =>
              setAgentModes((current) => current.map((item) => (item.id === updatedAgentMode.id ? updatedAgentMode : item)))
            }
          />
        </Suspense>
      );
    }
    if (selectedRunProfile) {
      return (
        <Suspense
          fallback={(
            <div className="admin-workspace-loading">
              <Spin size="small" />
            </div>
          )}
        >
          <RunProfileDetailViewLazy
            runProfile={selectedRunProfile}
            modelOptions={modelOptionsFromCatalog(modelCatalog)}
            onRunProfileUpdated={handleRunProfileUpdated}
          />
        </Suspense>
      );
    }
    if (selectedSkillPackage) {
      return (
        <Suspense
          fallback={(
            <div className="admin-workspace-loading">
              <Spin size="small" />
            </div>
          )}
        >
          <SkillPackageDetailViewLazy skillPackage={selectedSkillPackage} onSkillPackageUpdated={handleSkillPackageUpdated} />
        </Suspense>
      );
    }
    if (selectedResource) {
      return (
        <CapabilitySummaryCard tab={tab} resource={selectedResource as AgentModeRecord | SkillPackageRecord | RunProfileRecord} />
      );
    }
    return (
      <div className="resource-center-placeholder empty">
        <h3>{resourceLabel}</h3>
        <p>请选择左侧能力资源以继续配置。</p>
      </div>
    );
  }

  return (
    <div className="admin-page-container">
      <div className="admin-page-header">
        <div>
          <Typography.Title level={3} style={{ margin: 0, marginBottom: 8 }}>
            智能体配置
          </Typography.Title>
          <Typography.Text type="secondary">统一管理 Agent Modes、Skill Packages 和 Run Profiles。</Typography.Text>
        </div>
        <Space>
          <Tag color="blue" style={{ borderRadius: 'var(--admin-radius-full)' }}>{resourceCountLabel} {visibleCount}</Tag>
          <Tag color={enabledCount > 0 ? "success" : "default"} style={{ borderRadius: 'var(--admin-radius-full)' }}>active {enabledCount}</Tag>
          <Button icon={<ReloadOutlined />} onClick={() => setReloadNonce((current) => current + 1)} loading={loading}>
            刷新
          </Button>
          <Button type="primary" onClick={openCreatePanel} disabled={loading} style={{ borderRadius: 'var(--admin-radius-full)' }}>
            新建配置
          </Button>
        </Space>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Segmented
          value={tab}
          options={CAPABILITY_TABS.map((item) => ({ label: item.label, value: item.id }))}
          onChange={(value) => setTab(value as CapabilityCenterTab)}
          style={{ padding: 4, background: 'var(--admin-color-surface)' }}
        />
      </div>

      <div className="admin-split-layout">
        <div className="admin-split-master">
          <div style={{ padding: '16px', borderBottom: '1px solid var(--admin-color-border)' }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Input
                prefix={<span style={{ color: 'var(--admin-color-subtle)' }}>🔍</span>}
                placeholder={`搜索${resourceLabel}...`}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                allowClear
                style={{ borderRadius: 'var(--admin-radius-full)' }}
              />
              <Space>
                <Select
                  value={statusFilter}
                  options={STATUS_FILTER_OPTIONS}
                  onChange={(value) => setStatusFilter(value as CapabilityStatusFilter)}
                  size="small"
                  style={{ width: 100 }}
                />
                <Select
                  value={visibilityDisabled ? "all" : visibilityFilter}
                  disabled={visibilityDisabled}
                  options={VISIBILITY_FILTER_OPTIONS}
                  onChange={(value) => setVisibilityFilter(value as CapabilityVisibilityFilter)}
                  size="small"
                  style={{ width: 110 }}
                />
              </Space>
            </Space>
          </div>

          <div className="admin-master-list">
            {loading ? (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <Spin size="small" />
              </div>
            ) : visibleItems.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={noResultsLabel} />
            ) : (
              visibleItems.map((item: any) => {
                const isSelected = 
                  (tab === "agent_mode" && selectedAgentModeId === item.id) ||
                  (tab === "skill_package" && selectedSkillPackageId === item.id) ||
                  (tab === "run_profile" && selectedRunProfileId === item.id);
                return (
                  <div
                    key={item.id}
                    className={`admin-master-item ${isSelected ? 'active' : ''}`}
                    onClick={() => selectResource(item.id)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                      <strong style={{ fontSize: 14, fontWeight: 600 }}>{item.name}</strong>
                      <Tag color={statusTagColor(item.status)} style={{ margin: 0, borderRadius: 4 }}>
                        {item.status}
                      </Tag>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--admin-color-subtle)', marginBottom: 8 }}>
                      {item.slug}
                    </div>
                    {tab !== "run_profile" && (
                      <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                        <Tag style={{ margin: 0, border: 'none', background: 'var(--admin-color-bg)' }}>
                          {item.visibleToUsers ? "👀 可见" : "🔒 隐藏"}
                        </Tag>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="admin-split-detail">
          {!isNarrowScreen ? (
            <div style={{ height: '100%', overflow: 'auto' }}>
              {renderSelectedDetail()}
            </div>
          ) : null}
        </div>
      </div>

      {isNarrowScreen ? (
        <Drawer
          title={selectedResource ? `${resourceLabel}：${selectedResource.name}` : `${resourceLabel}详情`}
          placement="right"
          width="94%"
          open={mobileDetailOpen && Boolean(selectedResource)}
          onClose={() => setMobileDetailOpen(false)}
          destroyOnClose={false}
        >
          {renderSelectedDetail()}
        </Drawer>
      ) : null}

      <Drawer
        title={`新建${resourceLabel}`}
        width={560}
        open={Boolean(createPanel)}
        onClose={() => void closeCreatePanel()}
        destroyOnClose
        maskClosable={!createSaving}
        footer={(
          <Space>
            <Button onClick={() => void closeCreatePanel()} disabled={createSaving}>
              取消
            </Button>
            {activeCreateStep > 0 ? (
              <Button onClick={handleCreatePreviousStep} disabled={createSaving}>
                上一步
              </Button>
            ) : null}
            {activeCreateStep < maxCreateStep ? (
              <Button type="primary" onClick={handleCreateNextStep} disabled={createSaving}>
                下一步
              </Button>
            ) : (
              <Button
                type="primary"
                loading={createSaving}
                disabled={createSaving || (createPanel?.kind === "agent_mode" && runProfiles.length === 0)}
                onClick={() => void handleCreateSave()}
              >
                创建能力
              </Button>
            )}
          </Space>
        )}
      >
        {createPanel ? (
          <Space direction="vertical" size={16} className="admin-full-width">
            <Steps direction="vertical" size="small" current={activeCreateStep} items={createSteps} />

            {createErrorText ? <Alert type="error" showIcon className="admin-alert-inline" message={createErrorText} /> : null}

            {activeCreateStep === 0 ? (
              <Space direction="vertical" size={12} className="admin-full-width">
                <label className="field">
                  <span className="field-label">能力名称</span>
                  <Input
                    aria-label="能力名称"
                    maxLength={128}
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
                </label>

                <label className="field">
                  <span className="field-label">能力 slug</span>
                  <Input
                    aria-label="能力 slug"
                    maxLength={128}
                    disabled={createSaving}
                    value={createPanel.slug}
                    onChange={(event) => {
                      setCreateSlugEdited(true);
                      setCreatePanel((current) => (current ? { ...current, slug: event.target.value } : current));
                    }}
                  />
                </label>

                <label className="field">
                  <span className="field-label">能力描述</span>
                  <Input.TextArea
                    aria-label="能力描述"
                    rows={4}
                    disabled={createSaving}
                    value={createPanel.description}
                    onChange={(event) =>
                      setCreatePanel((current) => (current ? { ...current, description: event.target.value } : current))
                    }
                  />
                </label>
              </Space>
            ) : null}

            {activeCreateStep === 1 ? (
              <Space direction="vertical" size={12} className="admin-full-width">
                <label className="field">
                  <span className="field-label">状态</span>
                  <Select
                    aria-label="状态"
                    value={createPanel.status}
                    disabled={createSaving}
                    options={CREATE_STATUS_OPTIONS}
                    onChange={(value) =>
                      setCreatePanel((current) => (current ? { ...current, status: value } : current))
                    }
                  />
                </label>

                {createPanel.kind !== "run_profile" ? (
                  <label className="field">
                    <span className="field-label">对用户可见</span>
                    <Select
                      aria-label="对用户可见"
                      value={createPanel.visibleToUsers ? "visible" : "hidden"}
                      disabled={createSaving}
                      options={CREATE_VISIBILITY_OPTIONS}
                      onChange={(value) =>
                        setCreatePanel((current) =>
                          current && current.kind !== "run_profile"
                            ? { ...current, visibleToUsers: value === "visible" }
                            : current
                        )
                      }
                    />
                  </label>
                ) : null}

                {createPanel.kind === "agent_mode" ? (
                  <label className="field">
                    <span className="field-label">运行策略</span>
                    <Select
                      aria-label="运行策略"
                      placeholder="请选择运行策略"
                      disabled={createSaving || runProfiles.length === 0}
                      value={createPanel.runProfileId || undefined}
                      options={runProfiles.map((runProfile) => ({ label: runProfile.name, value: runProfile.id }))}
                      onChange={(value) =>
                        setCreatePanel((current) =>
                          current && current.kind === "agent_mode" ? { ...current, runProfileId: value } : current
                        )
                      }
                    />
                  </label>
                ) : null}

                {createPanel.kind === "run_profile" ? (
                  <>
                    <label className="field">
                      <span className="field-label">默认模型</span>
                      <Select
                        aria-label="默认模型"
                        disabled={createSaving}
                        value={createPanel.defaultModel}
                        options={runProfileModelOptions}
                        showSearch
                        optionFilterProp="label"
                        onChange={(value) =>
                          setCreatePanel((current) =>
                            current && current.kind === "run_profile"
                              ? {
                                  ...current,
                                  defaultModel: value,
                                  defaultReasoningEffort: normalizeReasoningEffortForModel(
                                    value,
                                    current.defaultReasoningEffort,
                                    modelOptionsFromCatalog(modelCatalog)
                                  ),
                                  allowedModels: current.allowedModels.includes(value)
                                    ? current.allowedModels
                                    : [...current.allowedModels, value]
                                }
                              : current
                          )
                        }
                      />
                    </label>

                    <label className="field">
                      <span className="field-label">可选模型</span>
                      <Select
                        aria-label="可选模型"
                        mode="multiple"
                        disabled={createSaving}
                        value={createPanel.allowedModels}
                        options={runProfileModelOptions}
                        showSearch
                        optionFilterProp="label"
                        placeholder="请选择可选模型"
                        onChange={(value) =>
                          setCreatePanel((current) =>
                            current && current.kind === "run_profile"
                              ? { ...current, allowedModels: value as string[] }
                              : current
                          )
                        }
                      />
                    </label>

                    <label className="field">
                      <span className="field-label">推理强度</span>
                      <Select
                        aria-label="推理强度"
                        value={createPanel.defaultReasoningEffort}
                        disabled={createSaving}
                        options={createReasoningOptions}
                        onChange={(value) =>
                          setCreatePanel((current) =>
                            current && current.kind === "run_profile"
                              ? { ...current, defaultReasoningEffort: value as CreateRunProfileInput["defaultReasoningEffort"] }
                              : current
                          )
                        }
                      />
                    </label>

                    <label className="field">
                      <span className="field-label">沙箱模式</span>
                      <Select
                        aria-label="沙箱模式"
                        value={createPanel.sandboxMode}
                        disabled={createSaving}
                        options={CREATE_SANDBOX_OPTIONS}
                        onChange={(value) =>
                          setCreatePanel((current) =>
                            current && current.kind === "run_profile"
                              ? { ...current, sandboxMode: value as CreateRunProfileInput["sandboxMode"] }
                              : current
                          )
                        }
                      />
                    </label>

                    <label className="field">
                      <span className="field-label">审批策略</span>
                      <Select
                        aria-label="审批策略"
                        value={createPanel.approvalPolicy}
                        disabled={createSaving}
                        options={CREATE_APPROVAL_OPTIONS}
                        onChange={(value) =>
                          setCreatePanel((current) =>
                            current && current.kind === "run_profile"
                              ? { ...current, approvalPolicy: value as CreateRunProfileInput["approvalPolicy"] }
                              : current
                          )
                        }
                      />
                    </label>

                    <label className="field checkbox-field resource-center-toggle-row">
                      <Switch
                        checked={createPanel.networkAccessEnabled}
                        disabled={createSaving}
                        checkedChildren="联网"
                        unCheckedChildren="离线"
                        onChange={(checked) =>
                          setCreatePanel((current) =>
                            current && current.kind === "run_profile"
                              ? { ...current, networkAccessEnabled: checked }
                              : current
                          )
                        }
                      />
                      <span className="field-label">网络访问</span>
                    </label>

                    <label className="field">
                      <span className="field-label">搜索模式</span>
                      <Select
                        aria-label="搜索模式"
                        value={createPanel.webSearchMode}
                        disabled={createSaving}
                        options={CREATE_SEARCH_OPTIONS}
                        onChange={(value) =>
                          setCreatePanel((current) =>
                            current && current.kind === "run_profile"
                              ? { ...current, webSearchMode: value as CreateRunProfileInput["webSearchMode"] }
                              : current
                          )
                        }
                      />
                    </label>
                  </>
                ) : null}
              </Space>
            ) : null}

            {activeCreateStep === 2 ? (
              <Card size="small" className="admin-workspace-help-card">
                <Space direction="vertical" size={6} className="admin-full-width">
                  <Typography.Text strong>{createPanel.name || "-"}</Typography.Text>
                  <Typography.Text type="secondary">slug: {createPanel.slug || "-"}</Typography.Text>
                  <Typography.Text type="secondary">状态: {createPanel.status || "-"}</Typography.Text>
                  {createPanel.kind !== "run_profile" ? (
                    <Typography.Text type="secondary">
                      可见性: {createPanel.visibleToUsers ? "对用户可见" : "仅管理员"}
                    </Typography.Text>
                  ) : null}
                  {createPanel.kind === "agent_mode" ? (
                    <Typography.Text type="secondary">运行策略: {createPanel.runProfileId || "-"}</Typography.Text>
                  ) : null}
                  {createPanel.kind === "run_profile" ? (
                    <>
                      <Typography.Text type="secondary">默认模型: {createPanel.defaultModel || "-"}</Typography.Text>
                      <Typography.Text type="secondary">
                        可选模型: {createPanel.allowedModels.join(", ") || "-"}
                      </Typography.Text>
                      <Typography.Text type="secondary">
                        推理/沙箱/审批: {createPanel.defaultReasoningEffort} / {createPanel.sandboxMode} / {createPanel.approvalPolicy}
                      </Typography.Text>
                    </>
                  ) : null}
                  <Typography.Paragraph type="secondary" className="resource-center-inline-muted">
                    {createPanel.description?.trim() || "未填写描述"}
                  </Typography.Paragraph>
                </Space>
              </Card>
            ) : null}

          </Space>
        ) : null}
      </Drawer>
    </div>
  );
}
