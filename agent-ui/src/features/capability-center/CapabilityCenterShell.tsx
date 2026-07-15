import {
  Archive,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CircleDot,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Gauge,
  LockKeyhole,
  MoreHorizontal,
  PackageOpen,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal
} from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Alert, Button, Drawer, Dropdown, Empty, Input, Modal, Select, Spin, Steps, Switch, Tag, message } from "antd";

import {
  copyAgentMode,
  createConfiguredAgentMode,
  createRunProfile,
  createSkillPackage,
  fetchAgentModes,
  fetchRunProfiles,
  fetchRuntimeModelCatalog,
  fetchSkillPackages,
  fetchWorkspaceAgentsTemplates,
} from "./api";
import { defaultWorkspaceAgentsMdSourceRef } from "./workspace-agents-md-source-ref";
import { modelOptionsFromCatalog, type ModelOption } from "../../lib/model-config";
import type { AgentModeRecord, RunProfileRecord, SkillPackageRecord, WorkspaceAgentsTemplateRecord } from "./types";
import "./agent-workspace.css";

const AgentWorkspaceView = lazy(() =>
  import("./AgentWorkspaceView").then((module) => ({ default: module.AgentWorkspaceView }))
);
const RunProfileDetailView = lazy(() =>
  import("./RunProfileDetailView").then((module) => ({ default: module.RunProfileDetailView }))
);
const SkillPackageDetailView = lazy(() =>
  import("./SkillPackageDetailView").then((module) => ({ default: module.SkillPackageDetailView }))
);

type CreateDraft = {
  templateId: string;
  name: string;
  slug: string;
  description: string;
  status: string;
  visibleToUsers: boolean;
  runProfileId: string;
  skillPackageIds: string[];
  instructionContent: string;
};

const EMPTY_DRAFT: CreateDraft = {
  templateId: "blank",
  name: "",
  slug: "",
  description: "",
  status: "active",
  visibleToUsers: true,
  runProfileId: "",
  skillPackageIds: [],
  instructionContent: ""
};

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function formatLocalDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function initials(name: string) {
  const normalized = name.trim();
  return normalized ? normalized.slice(0, 1).toUpperCase() : "A";
}

function codexSkillCount(skillPackage: SkillPackageRecord) {
  return skillPackage.items.reduce((total, item) => total + item.runtimeBindings.filter((binding) => binding.runtimeType === "codex" && binding.bindingType === "codex_skill").length, 0);
}

export function CapabilityCenterShell() {
  const [agents, setAgents] = useState<AgentModeRecord[]>([]);
  const [runProfiles, setRunProfiles] = useState<RunProfileRecord[]>([]);
  const [skillPackages, setSkillPackages] = useState<SkillPackageRecord[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [instructionTemplates, setInstructionTemplates] = useState<WorkspaceAgentsTemplateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [visibility, setVisibility] = useState("all");
  const [runProfileFilter, setRunProfileFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState(0);
  const [createDraft, setCreateDraft] = useState<CreateDraft>(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);
  const [assetOpen, setAssetOpen] = useState(false);
  const [assetType, setAssetType] = useState<"run" | "skill">("run");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [assetCreateOpen, setAssetCreateOpen] = useState(false);
  const [assetCreating, setAssetCreating] = useState(false);
  const [assetDraft, setAssetDraft] = useState({ name: "", slug: "", description: "" });
  const [messageApi, contextHolder] = message.useMessage();

  async function load() {
    setLoading(true);
    setErrorText("");
    try {
      const [agentResponse, runResponse, skillResponse, catalog, templateResponse] = await Promise.all([
        fetchAgentModes(),
        fetchRunProfiles(),
        fetchSkillPackages(),
        fetchRuntimeModelCatalog().catch(() => null),
        fetchWorkspaceAgentsTemplates().catch(() => ({ templates: [] }))
      ]);
      setAgents(agentResponse.agentModes);
      setRunProfiles(runResponse.runProfiles);
      setSkillPackages(skillResponse.skillPackages);
      setModelOptions(modelOptionsFromCatalog(catalog));
      setInstructionTemplates(templateResponse.templates);
      setCreateDraft((current) => ({
        ...current,
        runProfileId: current.runProfileId || runResponse.runProfiles.find((item) => item.status === "active")?.id || runResponse.runProfiles[0]?.id || ""
      }));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "加载智能体配置失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const selectedAgent = agents.find((item) => item.id === selectedAgentId) ?? null;
  const runProfileMap = useMemo(() => new Map(runProfiles.map((item) => [item.id, item])), [runProfiles]);
  const filteredAgents = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return agents.filter((agent) => {
      if (normalized && ![agent.name, agent.slug, agent.description].some((value) => (value ?? "").toLowerCase().includes(normalized))) return false;
      if (status !== "all" && agent.status !== status) return false;
      if (visibility === "visible" && !agent.visibleToUsers) return false;
      if (visibility === "hidden" && agent.visibleToUsers) return false;
      if (runProfileFilter !== "all" && agent.runProfileId !== runProfileFilter) return false;
      return true;
    });
  }, [agents, query, runProfileFilter, status, visibility]);
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(filteredAgents.length / pageSize));
  const pageAgents = filteredAgents.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => setPage(1), [query, status, visibility, runProfileFilter]);

  useEffect(() => {
    if (!createOpen) return;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".create-agent-reference-drawer .ant-drawer-body")?.scrollTo({ top: 0 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [createOpen, createStep]);

  function openCreate() {
    setCreateStep(0);
    setCreateDraft({
      ...EMPTY_DRAFT,
      runProfileId: runProfiles.find((item) => item.status === "active")?.id || runProfiles[0]?.id || ""
    });
    setCreateOpen(true);
  }

  async function handleCreate() {
    if (!createDraft.name.trim() || !createDraft.slug.trim() || !createDraft.runProfileId) return;
    setCreating(true);
    try {
      const created = await createConfiguredAgentMode({
        agentMode: {
          name: createDraft.name.trim(),
          slug: createDraft.slug.trim(),
          description: createDraft.description.trim(),
          status: createDraft.status,
          visibleToUsers: createDraft.visibleToUsers,
          runProfileId: createDraft.runProfileId
        },
        skillPackageIds: createDraft.skillPackageIds,
        instructionSources: [{
          sourceType: "workspace_agents_md",
          sourceRef: createDraft.instructionContent.trim()
            ? JSON.stringify({ version: 1, kind: "inline", content: createDraft.instructionContent.trim() })
            : defaultWorkspaceAgentsMdSourceRef(),
          sortOrder: 0
        }]
      });
      await load();
      setCreateOpen(false);
      setSelectedAgentId(created.agentMode.id);
      messageApi.success("智能体已创建");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "创建智能体失败");
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy(agent: AgentModeRecord) {
    try {
      const copy = await copyAgentMode(agent.id, {
        name: `${agent.name} 副本`,
        slug: `${agent.slug}-copy-${Date.now().toString().slice(-4)}`
      });
      await load();
      setSelectedAgentId(copy.agentMode.id);
      messageApi.success("已复制智能体");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "复制失败");
    }
  }

  function openAssetCreate() {
    setAssetDraft({ name: "", slug: "", description: "" });
    setAssetCreateOpen(true);
  }

  async function handleAssetCreate() {
    if (!assetDraft.name.trim() || !assetDraft.slug.trim()) return;
    setAssetCreating(true);
    try {
      if (assetType === "run") {
        const defaultModel = modelOptions[0]?.value || "gpt-5.2";
        const created = await createRunProfile({
          name: assetDraft.name.trim(),
          slug: assetDraft.slug.trim(),
          description: assetDraft.description.trim(),
          status: "active",
          defaultModel,
          allowedModels: [defaultModel],
          defaultReasoningEffort: "medium",
          sandboxMode: "workspace-write",
          approvalPolicy: "on-request",
          networkAccessEnabled: false,
          webSearchMode: "disabled"
        });
        setRunProfiles((items) => [...items, created.runProfile]);
        setSelectedAssetId(created.runProfile.id);
      } else {
        const created = await createSkillPackage({
          name: assetDraft.name.trim(),
          slug: assetDraft.slug.trim(),
          description: assetDraft.description.trim(),
          status: "active",
          visibleToUsers: false
        });
        setSkillPackages((items) => [...items, created.skillPackage]);
        setSelectedAssetId(created.skillPackage.id);
      }
      setAssetCreateOpen(false);
      messageApi.success(assetType === "run" ? "运行策略已创建" : "技能包已创建");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "创建配置资产失败");
    } finally {
      setAssetCreating(false);
    }
  }

  if (selectedAgent) {
    return (
      <Suspense fallback={<div className="agent-loading"><Spin /></div>}>
        {contextHolder}
        <AgentWorkspaceView
          agent={selectedAgent}
          runProfiles={runProfiles}
          skillPackages={skillPackages}
          onBack={() => setSelectedAgentId(null)}
          onSaved={async () => {
            await load();
          }}
        />
      </Suspense>
    );
  }

  const selectedRunProfile = runProfiles.find((item) => item.id === selectedAssetId) ?? runProfiles[0];
  const selectedSkillPackage = skillPackages.find((item) => item.id === selectedAssetId) ?? skillPackages[0];
  const selectedCreateRunProfile = runProfileMap.get(createDraft.runProfileId);
  const createSkillPackages = skillPackages.filter((item) => createDraft.skillPackageIds.includes(item.id));
  const createTemplateLabel = createDraft.templateId === "blank"
    ? "从空白开始"
    : instructionTemplates.find((item) => item.id === createDraft.templateId)?.label || "自定义模板";

  return (
    <div className="agent-workspace agent-overview-page">
      {contextHolder}
      <header className="agent-page-header">
        <div>
          <p className="agent-eyebrow">ADMIN CONSOLE</p>
          <h2>智能体工作室</h2>
          <p>构建、配置并验证可复用的智能体</p>
        </div>
        <div className="agent-header-actions">
          <Button icon={<Archive size={16} />} onClick={() => setAssetOpen(true)}>配置资产</Button>
          <Button type="primary" icon={<Plus size={16} />} onClick={openCreate}>新建智能体</Button>
        </div>
      </header>

      {errorText ? <Alert type="error" showIcon message={errorText} action={<Button onClick={() => void load()}>重试</Button>} /> : null}

      <section className="agent-list-card" aria-label="智能体列表">
        <div className="agent-filter-bar">
          <Input
            allowClear
            prefix={<Search size={16} />}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索智能体名称或 ID"
            aria-label="搜索智能体"
          />
          <Select aria-label="状态筛选" value={status} onChange={setStatus} options={[
            { label: "全部状态", value: "all" }, { label: "启用中", value: "active" }, { label: "已停用", value: "disabled" }
          ]} />
          <Select aria-label="可见范围筛选" value={visibility} onChange={setVisibility} options={[
            { label: "全部可见范围", value: "all" }, { label: "用户可见", value: "visible" }, { label: "仅管理员", value: "hidden" }
          ]} />
          <Select aria-label="运行策略筛选" value={runProfileFilter} onChange={setRunProfileFilter} options={[
            { label: "全部运行策略", value: "all" }, ...runProfiles.map((item) => ({ label: item.name, value: item.id }))
          ]} />
          <Button className="agent-refresh-button" aria-label="刷新列表" icon={<RefreshCw size={16} />} onClick={() => void load()} loading={loading} />
        </div>

        <div className="agent-table-wrap">
          <table className="agent-table">
            <thead><tr><th>智能体</th><th>运行策略</th><th>状态</th><th>可见范围</th><th>知识与技能</th><th>最近修改</th><th aria-label="操作" /></tr></thead>
            <tbody>
              {pageAgents.map((agent) => {
                const profile = runProfileMap.get(agent.runProfileId);
                return (
                  <tr key={agent.id} onClick={() => setSelectedAgentId(agent.id)}>
                    <td><div className="agent-identity"><span className="agent-avatar">{initials(agent.name)}</span><span><strong>{agent.name}</strong><small>{agent.slug}</small></span></div></td>
                    <td><strong>{profile?.name ?? "未绑定"}</strong><small>{profile?.defaultModel ?? "—"}</small></td>
                    <td><Tag color={agent.status === "active" ? "success" : "default"}>{agent.status === "active" ? "启用中" : "已停用"}</Tag></td>
                    <td>{agent.visibleToUsers ? "用户可见" : "仅管理员"}</td>
                    <td>{agent.skillPackages.length} 个技能包</td>
                    <td>{formatLocalDateTime(agent.updatedAt)}</td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <Dropdown trigger={["click"]} menu={{ items: [
                        { key: "open", label: "打开配置", icon: <Settings2 size={15} />, onClick: () => setSelectedAgentId(agent.id) },
                        { key: "copy", label: "复制智能体", icon: <Copy size={15} />, onClick: () => void handleCopy(agent) }
                      ] }}><Button type="text" aria-label={`${agent.name} 更多操作`} icon={<MoreHorizontal size={18} />} /></Dropdown>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && pageAgents.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有符合条件的智能体" /> : null}
          {loading ? <div className="agent-loading"><Spin /></div> : null}
        </div>
        <footer className="agent-pagination">
          <span>共 {filteredAgents.length} 个智能体</span>
          <div><Button aria-label="上一页" icon={<ChevronLeft size={16} />} disabled={page <= 1} onClick={() => setPage((value) => value - 1)} /><strong>{page}</strong><span>/ {pageCount}</span><Button aria-label="下一页" icon={<ChevronRight size={16} />} disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)} /></div>
        </footer>
      </section>

      <Drawer
        className="create-agent-reference-drawer"
        title="新建智能体"
        width={1060}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        destroyOnClose
        footer={<div className="create-drawer-footer"><span>第 {createStep + 1} / 4 步 · {createStep === 0 ? "选择配置起点" : createStep === 1 ? "定义智能体用途" : createStep === 2 ? "装配运行能力" : "检查创建结果"}</span><div><Button onClick={() => setCreateOpen(false)}>取消</Button>{createStep > 0 ? <Button onClick={() => setCreateStep((value) => value - 1)}>上一步</Button> : null}{createStep < 3 ? <Button type="primary" disabled={(createStep === 1 && (!createDraft.name.trim() || !createDraft.slug.trim())) || (createStep === 2 && selectedCreateRunProfile?.status !== "active")} onClick={() => setCreateStep((value) => value + 1)}>{createStep === 0 ? "下一步：定义用途" : createStep === 1 ? "下一步：配置能力" : "下一步：检查配置"}</Button> : <Button type="primary" loading={creating} onClick={() => void handleCreate()}>创建智能体</Button>}</div></div>}
      >
        <div className="create-progress"><Steps size="small" current={createStep} items={[{ title: "选择起点" }, { title: "定义用途" }, { title: "配置能力" }, { title: "验证并创建" }]} /></div>

        {createStep === 0 ? <div className="create-step-shell">
          <div className="create-step-intro"><span className="create-step-kicker">01 · SELECT START</span><h3>选择最接近的配置起点</h3><p>起点只负责预填角色规则，不会限制后续可选择的运行策略和技能包。</p></div>
          <div className="create-start-grid">
            <button className={createDraft.templateId === "blank" ? "selected" : ""} aria-pressed={createDraft.templateId === "blank"} onClick={() => setCreateDraft((draft) => ({ ...draft, templateId: "blank", instructionContent: "" }))}><span className="create-template-icon"><Plus size={20} /></span><span><strong>从空白开始</strong><small>只创建必要字段，适合需要完全自定义的智能体。</small><em>不预填角色规则</em></span>{createDraft.templateId === "blank" ? <span className="create-selected-mark"><Check size={14} /></span> : null}</button>
            {instructionTemplates.map((template) => <button key={template.id} className={createDraft.templateId === template.id ? "selected" : ""} aria-pressed={createDraft.templateId === template.id} onClick={() => setCreateDraft((draft) => ({ ...draft, templateId: template.id, instructionContent: template.content }))}><span className="create-template-icon"><FileText size={20} /></span><span><strong>{template.label}</strong><small>从现有角色规则开始，创建前可继续调整。</small><em>已包含初始指令</em></span>{createDraft.templateId === template.id ? <span className="create-selected-mark"><Check size={14} /></span> : null}</button>)}
          </div>
          <div className="create-start-note"><ShieldCheck size={17} /><span><strong>创建不会立即对用户产生影响</strong><small>所有配置会在最后一步统一提交，关闭抽屉不会创建任何资源。</small></span></div>
        </div> : null}

        {createStep === 1 ? <div className="create-reference-layout">
          <div className="create-form-workspace">
            <div className="create-origin-banner"><span className="create-template-icon"><FileText size={18} /></span><span><small>当前配置起点</small><strong>{createTemplateLabel}</strong></span><Button type="link" onClick={() => setCreateStep(0)}>更换起点</Button></div>
            <div className="create-question"><span className="create-step-kicker">02 · DEFINE PURPOSE</span><h3>这个智能体要帮助用户完成什么？</h3><p>名称用于识别，任务描述决定团队成员是否知道什么时候该使用它。</p></div>
            <div className="create-field-grid">
              <label><span>智能体名称</span><Input maxLength={50} showCount value={createDraft.name} placeholder="例如：交付方案助手" onChange={(event) => setCreateDraft((draft) => ({ ...draft, name: event.target.value, slug: draft.slug || slugify(event.target.value) }))} /></label>
              <label><span>智能体 ID</span><Input value={createDraft.slug} placeholder="delivery-solution-agent" onChange={(event) => setCreateDraft((draft) => ({ ...draft, slug: slugify(event.target.value) }))} /></label>
              <label className="span-2"><span>主要任务</span><Input.TextArea maxLength={200} showCount rows={3} value={createDraft.description} placeholder="说明服务对象、要解决的问题，以及期望产出的结果" onChange={(event) => setCreateDraft((draft) => ({ ...draft, description: event.target.value }))} /></label>
            </div>
            <details className="create-advanced"><summary><span><FileText size={16} /><b>角色目标与回答原则</b><small>可选，模板内容已在这里预填</small></span><ChevronRight size={16} /></summary><label><span>角色指令</span><Input.TextArea rows={7} value={createDraft.instructionContent} placeholder="# 身份与目标\n说明智能体的角色、服务对象和回答边界" onChange={(event) => setCreateDraft((draft) => ({ ...draft, instructionContent: event.target.value }))} /></label></details>
            <section className="create-auto-prepare"><div className="create-section-heading"><span><strong>系统将在下一步准备</strong><small>全部来自当前组织的真实配置资源</small></span></div><div><span><Gauge /></span><p><strong>运行策略</strong><small>模型、推理强度和执行边界</small></p><em>下一步选择</em></div><div><span><PackageOpen /></span><p><strong>技能包</strong><small>为智能体装配完成任务所需的 Skill</small></p><em>下一步选择</em></div><div><span>{createDraft.visibleToUsers ? <Eye /> : <EyeOff />}</span><p><strong>可见范围</strong><small>决定普通用户能否发现该智能体</small></p><Switch checked={createDraft.visibleToUsers} onChange={(checked) => setCreateDraft((draft) => ({ ...draft, visibleToUsers: checked, skillPackageIds: checked ? draft.skillPackageIds.filter((id) => skillPackages.find((item) => item.id === id)?.visibleToUsers) : draft.skillPackageIds }))} /></div></section>
          </div>
          <aside className="create-result-panel"><h4>创建后你将得到</h4><div className="create-result-agent"><span className="agent-avatar">{initials(createDraft.name)}</span><span><strong>{createDraft.name || "未命名智能体"}</strong><small>{createDraft.description || "等待填写主要任务"}</small></span></div><div className="create-result-item"><span><Gauge /></span><p><strong>运行策略</strong><small>下一步从组织配置中选择</small></p></div><div className="create-result-item"><span><PackageOpen /></span><p><strong>技能包与技能</strong><small>按实际工作目标装配</small></p></div><dl><div><dt>配置起点</dt><dd>{createTemplateLabel}</dd></div><div><dt>可见范围</dt><dd>{createDraft.visibleToUsers ? "用户可见" : "仅管理员"}</dd></div></dl><div className="create-time-note"><Clock3 /><span><small>预计完成时间</small><strong>约 2–4 分钟</strong></span></div></aside>
        </div> : null}

        {createStep === 2 ? <div className="create-reference-layout">
          <div className="create-form-workspace">
            <div className="create-question"><span className="create-step-kicker">03 · ASSEMBLE</span><h3>装配智能体的运行能力</h3><p>这里只选择真实后端资源；详细参数可以在创建后的配置页继续调整。</p></div>
            <section className="create-resource-section"><div className="create-section-heading"><span><strong>运行策略</strong><small>必选 · 只可绑定当前可用的运行策略</small></span><Tag color={selectedCreateRunProfile?.status === "active" ? "success" : "warning"}>{selectedCreateRunProfile?.status === "active" ? "已选择" : "待选择"}</Tag></div><div className="create-runtime-options">{runProfiles.filter((item) => item.status === "active").map((item) => <button key={item.id} className={createDraft.runProfileId === item.id ? "selected" : ""} aria-pressed={createDraft.runProfileId === item.id} onClick={() => setCreateDraft((draft) => ({ ...draft, runProfileId: item.id }))}><span className="create-resource-radio">{createDraft.runProfileId === item.id ? <Check size={12} /> : null}</span><span><strong>{item.name}</strong><small>{item.defaultModel} · {item.defaultReasoningEffort}</small></span><em><LockKeyhole size={13} />{item.sandboxMode}</em></button>)}</div></section>
            <section className="create-resource-section"><div className="create-section-heading"><span><strong>技能包</strong><small>可选 · 仅显示会进入当前用户运行时的技能包</small></span><Tag>{createDraft.skillPackageIds.length} 个已选</Tag></div><div className="create-package-options">{skillPackages.filter((item) => item.status === "active" && (!createDraft.visibleToUsers || item.visibleToUsers)).map((item) => { const selected = createDraft.skillPackageIds.includes(item.id); return <button key={item.id} className={selected ? "selected" : ""} aria-pressed={selected} onClick={() => setCreateDraft((draft) => ({ ...draft, skillPackageIds: selected ? draft.skillPackageIds.filter((id) => id !== item.id) : [...draft.skillPackageIds, item.id] }))}><span className="create-package-check">{selected ? <Check size={12} /> : null}</span><span><strong>{item.name}</strong><small>{item.description || item.slug}</small></span><em>{codexSkillCount(item)} 个技能</em></button>; })}</div></section>
          </div>
          <aside className="create-result-panel create-live-summary"><h4>当前装配结果</h4><div className="create-result-agent"><span className="agent-avatar">{initials(createDraft.name)}</span><span><strong>{createDraft.name}</strong><small>{createDraft.slug}</small></span></div><dl><div><dt>运行策略</dt><dd>{selectedCreateRunProfile?.name ?? "待选择"}</dd></div><div><dt>默认模型</dt><dd>{selectedCreateRunProfile?.defaultModel ?? "—"}</dd></div><div><dt>安全边界</dt><dd>{selectedCreateRunProfile?.sandboxMode ?? "—"}</dd></div><div><dt>技能包</dt><dd>{createSkillPackages.length} 个</dd></div><div><dt>技能</dt><dd>{createSkillPackages.reduce((sum, item) => sum + codexSkillCount(item), 0)} 个</dd></div></dl><Alert type="info" showIcon message="创建后仍可调整" description="运行策略、技能包和访问范围都可以在智能体配置页继续修改。" /></aside>
        </div> : null}

        {createStep === 3 ? <div className="create-final-layout">
          <section className="create-review-panel"><div className="create-question"><span className="create-step-kicker">04 · REVIEW</span><h3>检查配置，然后创建智能体</h3><p>创建会写入智能体、技能包绑定和角色指令；完成后直接进入配置页。</p></div><div className="create-review-list"><div><span className="pass"><Check /></span><p><strong>身份信息完整</strong><small>{createDraft.name} · {createDraft.slug}</small></p><Tag color="success">通过</Tag></div><div><span className="pass"><Check /></span><p><strong>运行策略已选择</strong><small>{selectedCreateRunProfile?.name} · {selectedCreateRunProfile?.defaultModel}</small></p><Tag color="success">通过</Tag></div><div><span className={createSkillPackages.length ? "pass" : "optional"}>{createSkillPackages.length ? <Check /> : <PackageOpen />}</span><p><strong>技能包</strong><small>{createSkillPackages.length ? `${createSkillPackages.map((item) => item.name).join("、")} · 共 ${createSkillPackages.reduce((sum, item) => sum + codexSkillCount(item), 0)} 个技能` : "未选择，可在创建后继续添加"}</small></p><Tag>{createSkillPackages.length ? `${createSkillPackages.length} 个` : "可选"}</Tag></div><div><span className={createDraft.instructionContent.trim() ? "pass" : "optional"}>{createDraft.instructionContent.trim() ? <Check /> : <FileText />}</span><p><strong>角色规则</strong><small>{createDraft.instructionContent.trim() ? `已从“${createTemplateLabel}”准备` : "未配置，可在创建后补充"}</small></p><Tag>{createDraft.instructionContent.trim() ? "已配置" : "可选"}</Tag></div></div><Alert type="success" showIcon message="创建条件已满足" description="提交期间请保持页面打开；如果创建失败，已填写内容会保留，便于直接重试。" /></section>
          <aside className="create-result-panel create-final-result"><h4>即将创建</h4><div className="create-result-agent"><span className="agent-avatar large">{initials(createDraft.name)}</span><span><strong>{createDraft.name}</strong><small>{createDraft.description || "未填写用途描述"}</small></span></div><dl><div><dt>智能体 ID</dt><dd>{createDraft.slug}</dd></div><div><dt>运行策略</dt><dd>{selectedCreateRunProfile?.name}</dd></div><div><dt>技能包 / 技能</dt><dd>{createSkillPackages.length} / {createSkillPackages.reduce((sum, item) => sum + codexSkillCount(item), 0)}</dd></div><div><dt>创建后状态</dt><dd>{createDraft.status === "active" ? "启用中" : "已停用"}</dd></div><div><dt>可见范围</dt><dd>{createDraft.visibleToUsers ? "用户可见" : "仅管理员"}</dd></div></dl><div className="create-time-note ready"><Check /><span><small>下一步</small><strong>创建后进入配置页</strong></span></div></aside>
        </div> : null}
      </Drawer>

      <Drawer title="配置资产" width={980} open={assetOpen} onClose={() => setAssetOpen(false)}>
        <div className="agent-asset-shell">
          <aside>
            <div className="agent-asset-tabs"><Button type={assetType === "run" ? "primary" : "text"} icon={<SlidersHorizontal size={16} />} onClick={() => { setAssetType("run"); setSelectedAssetId(""); }}>运行策略</Button><Button type={assetType === "skill" ? "primary" : "text"} icon={<PackageOpen size={16} />} onClick={() => { setAssetType("skill"); setSelectedAssetId(""); }}>技能包</Button></div>
            <Button className="agent-asset-create-button" block icon={<Plus size={15} />} onClick={openAssetCreate}>新建{assetType === "run" ? "运行策略" : "技能包"}</Button>
            {(assetType === "run" ? runProfiles : skillPackages).map((item) => <button key={item.id} className={(selectedAssetId || (assetType === "run" ? selectedRunProfile?.id : selectedSkillPackage?.id)) === item.id ? "active" : ""} onClick={() => setSelectedAssetId(item.id)}><span>{assetType === "run" ? <CircleDot size={16} /> : <Bot size={16} />}{item.name}</span><small>{item.slug}</small></button>)}
          </aside>
          <main><Suspense fallback={<Spin />}>{assetType === "run" && selectedRunProfile ? <RunProfileDetailView runProfile={selectedRunProfile} modelOptions={modelOptions} onRunProfileUpdated={(updated) => setRunProfiles((items) => items.map((item) => item.id === updated.id ? updated : item))} /> : null}{assetType === "skill" && selectedSkillPackage ? <SkillPackageDetailView skillPackage={selectedSkillPackage} onSkillPackageUpdated={(updated) => setSkillPackages((items) => items.map((item) => item.id === updated.id ? updated : item))} /> : null}</Suspense></main>
        </div>
      </Drawer>
      <Modal
        title={`新建${assetType === "run" ? "运行策略" : "技能包"}`}
        open={assetCreateOpen}
        onCancel={() => setAssetCreateOpen(false)}
        onOk={() => void handleAssetCreate()}
        okText="创建"
        cancelText="取消"
        confirmLoading={assetCreating}
        okButtonProps={{ disabled: !assetDraft.name.trim() || !assetDraft.slug.trim() }}
      >
        <div className="agent-form-stack">
          <label><span>名称</span><Input value={assetDraft.name} onChange={(event) => setAssetDraft((draft) => ({ ...draft, name: event.target.value, slug: draft.slug || slugify(event.target.value) }))} /></label>
          <label><span>标识</span><Input value={assetDraft.slug} onChange={(event) => setAssetDraft((draft) => ({ ...draft, slug: slugify(event.target.value) }))} /></label>
          <label><span>描述</span><Input.TextArea rows={3} value={assetDraft.description} onChange={(event) => setAssetDraft((draft) => ({ ...draft, description: event.target.value }))} /></label>
          <Alert type="info" showIcon message={assetType === "run" ? "将使用安全默认值创建，随后可在右侧调整模型和权限。" : "默认仅管理员可见，创建后可继续添加 Codex Skills。"} />
        </div>
      </Modal>
    </div>
  );
}
