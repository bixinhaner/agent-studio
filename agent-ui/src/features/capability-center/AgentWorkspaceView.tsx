import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDot,
  Database,
  Eye,
  FileCode2,
  FileText,
  FlaskConical,
  Gauge,
  Globe2,
  GripVertical,
  Layers3,
  LockKeyhole,
  MoreHorizontal,
  PackageOpen,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  Users,
  X,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Drawer, Input, Modal, Select, Switch, Tag, Tooltip, message } from "antd";

import { CapabilityPolicyEditor } from "./CapabilityPolicyEditor";
import { AgentSkillsPanel } from "./AgentSkillsPanel";
import { InstructionSourceEditor } from "./InstructionSourceEditor";
import { updateConfiguredAgentMode, validateAgentModeConfiguration } from "./api";
import { parseWorkspaceAgentsMdSourceRef, stringifyWorkspaceAgentsMdSourceRef } from "./workspace-agents-md-source-ref";
import type {
  AgentModeInstructionSourceInput,
  AgentModeRecord,
  AgentConfigurationCheck,
  ApprovalPolicy,
  ReasoningEffort,
  RunProfileRecord,
  SandboxMode,
  SkillPackageRecord,
  WebSearchMode
} from "./types";

type TabId = "overview" | "instructions" | "skills" | "runtime" | "access" | "validate";
type InstructionSection = { title: string; body: string; rules: string[] };

type Props = {
  agent: AgentModeRecord;
  runProfiles: RunProfileRecord[];
  skillPackages: SkillPackageRecord[];
  onBack: () => void;
  onSaved: () => Promise<void>;
};

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "概览" },
  { id: "instructions", label: "角色与指令" },
  { id: "skills", label: "知识与技能" },
  { id: "runtime", label: "运行与安全" },
  { id: "access", label: "访问权限" },
  { id: "validate", label: "配置校验" }
];

const PRESETS = [
  { id: "balanced", label: "平衡", description: "推荐日常工作场景，兼顾体验与成本", effort: "medium" as ReasoningEffort, sandbox: "workspace-write" as SandboxMode, approval: "on-request" as ApprovalPolicy, network: true, search: "live" as WebSearchMode },
  { id: "quality", label: "高质量", description: "优先提升准确性，响应时间更长", effort: "high" as ReasoningEffort, sandbox: "workspace-write" as SandboxMode, approval: "on-request" as ApprovalPolicy, network: true, search: "live" as WebSearchMode },
  { id: "economy", label: "低成本", description: "优先降低资源消耗，适合简单任务", effort: "low" as ReasoningEffort, sandbox: "read-only" as SandboxMode, approval: "never" as ApprovalPolicy, network: false, search: "cached" as WebSearchMode },
  { id: "restricted", label: "受限环境", description: "最小权限，适用于高安全要求", effort: "medium" as ReasoningEffort, sandbox: "read-only" as SandboxMode, approval: "on-request" as ApprovalPolicy, network: false, search: "disabled" as WebSearchMode }
];

function formatLocalDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function agentInstructionInputs(agent: AgentModeRecord): AgentModeInstructionSourceInput[] {
  return agent.instructionSources.map((source) => ({ sourceType: source.sourceType, sourceRef: source.sourceRef, sortOrder: source.sortOrder }));
}

function inlineInstructionContent(sources: AgentModeInstructionSourceInput[]) {
  const parsed = parseWorkspaceAgentsMdSourceRef(sources[0]?.sourceRef ?? "");
  return parsed.mode === "inline" ? parsed.content : "";
}

function parseInstructionSections(content: string): InstructionSection[] {
  const normalized = content.trim();
  if (!normalized) return [];
  const sections: InstructionSection[] = [];
  const matches = [...normalized.matchAll(/^#{1,3}\s+(.+)$/gm)];
  if (matches.length === 0) {
    const rules = normalized.split(/\n+/).map((item) => item.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
    return [{ title: "身份与目标", body: rules[0] ?? "", rules: rules.slice(1) }];
  }
  matches.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? normalized.length;
    const body = normalized.slice(start, end).trim();
    const rules = body.split(/\n+/).map((item) => item.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
    sections.push({ title: match[1].trim(), body: rules[0] ?? "", rules: rules.slice(1) });
  });
  return sections;
}

export function AgentWorkspaceView({ agent, runProfiles, skillPackages, onBack, onSaved }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description ?? "");
  const [status, setStatus] = useState(agent.status);
  const [visibleToUsers, setVisibleToUsers] = useState(agent.visibleToUsers);
  const [runProfileId, setRunProfileId] = useState(agent.runProfileId);
  const [skillPackageIds, setSkillPackageIds] = useState(agent.skillPackages.map((item) => item.skillPackageId));
  const [instructionSources, setInstructionSources] = useState<AgentModeInstructionSourceInput[]>(agentInstructionInputs(agent));
  const [runDraft, setRunDraft] = useState<RunProfileRecord | null>(runProfiles.find((item) => item.id === agent.runProfileId) ?? null);
  const [instructionMode, setInstructionMode] = useState<"structured" | "source">(() =>
    parseWorkspaceAgentsMdSourceRef(agent.instructionSources[0]?.sourceRef ?? "").mode === "inline" ? "structured" : "source"
  );
  const [instructionEditOpen, setInstructionEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationChecks, setValidationChecks] = useState<AgentConfigurationCheck[] | null>(null);
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    setName(agent.name);
    setDescription(agent.description ?? "");
    setStatus(agent.status);
    setVisibleToUsers(agent.visibleToUsers);
    setRunProfileId(agent.runProfileId);
    setSkillPackageIds(agent.skillPackages.map((item) => item.skillPackageId));
    setInstructionSources(agentInstructionInputs(agent));
  }, [agent]);

  useEffect(() => setRunDraft(runProfiles.find((item) => item.id === runProfileId) ?? null), [runProfileId, runProfiles]);

  const enabledPackages = useMemo(() => skillPackages.filter((item) => skillPackageIds.includes(item.id)), [skillPackageIds, skillPackages]);
  const instructionContent = inlineInstructionContent(instructionSources);
  const instructionSourceDraft = parseWorkspaceAgentsMdSourceRef(instructionSources[0]?.sourceRef ?? "");
  const instructionConfigured = Boolean(instructionSources[0]?.sourceRef.trim());
  const instructionSections = useMemo(() => parseInstructionSections(instructionContent), [instructionContent]);
  const originalSkillIds = useMemo(() => agent.skillPackages.map((item) => item.skillPackageId).sort(), [agent]);
  const dirty = name !== agent.name || description !== (agent.description ?? "") || status !== agent.status || visibleToUsers !== agent.visibleToUsers || runProfileId !== agent.runProfileId || JSON.stringify([...skillPackageIds].sort()) !== JSON.stringify(originalSkillIds) || JSON.stringify(instructionSources) !== JSON.stringify(agentInstructionInputs(agent));

  function setInstructionContent(content: string) {
    setInstructionSources([{ sourceType: "workspace_agents_md", sourceRef: stringifyWorkspaceAgentsMdSourceRef({ mode: "inline", content, templateId: "", path: "" }), sortOrder: 0 }]);
  }

  async function save() {
    if (!name.trim() || !runProfileId) return;
    setSaving(true);
    try {
      await updateConfiguredAgentMode(agent.id, {
        agentMode: { name: name.trim(), description: description.trim(), status, visibleToUsers, runProfileId },
        skillPackageIds,
        instructionSources
      });
      await onSaved();
      messageApi.success("当前配置已保存");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "保存配置失败");
    } finally {
      setSaving(false);
    }
  }

  const activePreset = PRESETS.find((preset) => runDraft && preset.effort === runDraft.defaultReasoningEffort && preset.sandbox === runDraft.sandboxMode && preset.approval === runDraft.approvalPolicy && preset.network === runDraft.networkAccessEnabled && preset.search === runDraft.webSearchMode)?.id;

  async function validateConfiguration() {
    setValidating(true);
    try {
      const result = await validateAgentModeConfiguration({
        agentMode: { name: name.trim(), slug: agent.slug, description: description.trim(), status, visibleToUsers, runProfileId },
        skillPackageIds,
        instructionSources
      });
      setValidationChecks(result.checks);
      if (result.valid) messageApi.success("后端配置校验通过");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "配置校验失败");
    } finally {
      setValidating(false);
    }
  }

  return (
    <div className="agent-workspace agent-reference-studio">
      {contextHolder}
      <div className="reference-breadcrumb"><button onClick={onBack}><ArrowLeft size={15} /> 智能体配置</button><span>/</span><span>{agent.name}</span></div>
      <header className="reference-entity-header">
        <div className="reference-title-block"><div><h2>{name}</h2><Button type="text" aria-label="编辑名称" icon={<Pencil size={16} />} onClick={() => setActiveTab("overview")} /><span className="reference-status-cluster"><Tag color={status === "active" ? "success" : "default"}>{status === "active" ? "启用中" : "已停用"}</Tag><Tag color={visibleToUsers ? "processing" : "default"}>{visibleToUsers ? "用户可见" : "仅管理员"}</Tag>{dirty ? <Tag color="warning">未保存更改</Tag> : null}</span></div><p>{description || "尚未填写智能体用途"}</p></div>
        <div className="reference-header-meta"><span>最近修改：{formatLocalDateTime(agent.updatedAt)}</span><Button onClick={onBack}>返回工作台</Button><Button type="primary" icon={<Save size={16} />} disabled={!dirty} loading={saving} onClick={() => void save()}>保存配置</Button></div>
      </header>
      <nav className="reference-tabs" aria-label="智能体配置页面">{TABS.map((tab) => <button key={tab.id} className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}</nav>

      <main className="reference-page-body">
        {activeTab === "overview" ? <div className="reference-two-column overview-layout">
          <div className="reference-stack">
            <section className="reference-section"><div className="reference-section-title"><div><h3>基本信息</h3><p>维护用户识别这个智能体时看到的名称与用途。</p></div></div><div className="reference-form-grid"><label><span>名称</span><Input value={name} onChange={(event) => setName(event.target.value)} /></label><label><span>智能体 ID</span><Input value={agent.slug} disabled /></label><label className="span-2"><span>用途描述</span><Input.TextArea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} /></label><label><span>运行策略</span><Select value={runProfileId} onChange={setRunProfileId} options={runProfiles.filter((item) => item.status === "active" || item.id === runProfileId).map((item) => ({ label: `${item.name} · ${item.defaultModel}`, value: item.id }))} /></label><label><span>运行状态</span><Select value={status} onChange={setStatus} options={[{ label: "启用中", value: "active" }, { label: "已停用", value: "disabled" }]} /></label><label className="reference-switch-row"><span>对用户可见</span><Switch checked={visibleToUsers} onChange={setVisibleToUsers} /></label></div></section>
            <section className="reference-section"><div className="reference-section-title"><div><h3>能力装配</h3><p>当前生效的指令、技能包和运行边界。</p></div></div><div className="overview-assembly-list"><button onClick={() => setActiveTab("instructions")}><FileText /><span><strong>角色与指令</strong><small>{instructionSections.length} 个规则分组</small></span><ChevronRight /></button><button onClick={() => setActiveTab("skills")}><PackageOpen /><span><strong>知识与技能</strong><small>{enabledPackages.length} 个技能包 · {enabledPackages.reduce((sum, item) => sum + item.items.length, 0)} 项能力</small></span><ChevronRight /></button><button onClick={() => setActiveTab("runtime")}><ShieldCheck /><span><strong>运行与安全</strong><small>{runDraft ? `${runDraft.defaultModel} · ${runDraft.sandboxMode}` : "未绑定"}</small></span><ChevronRight /></button><button onClick={() => setActiveTab("access")}><Users /><span><strong>访问权限</strong><small>{visibleToUsers ? "用户可发现，支持继续细化授权" : "仅管理员可见"}</small></span><ChevronRight /></button></div></section>
          </div>
          <aside className="reference-preview-panel"><div className="reference-section-title"><div><h3>生效预览</h3><p>保存后新会话将使用以下配置。</p></div><Button type="text" icon={<RefreshCw size={15} />} /></div><div className="preview-agent-card"><span className="agent-avatar">{name.slice(0,1).toUpperCase()}</span><div><strong>{name}</strong><small>{description || agent.slug}</small></div></div><dl className="reference-summary-list"><div><dt>运行策略</dt><dd>{runDraft?.name ?? "未绑定"}</dd></div><div><dt>默认模型</dt><dd>{runDraft?.defaultModel ?? "—"}</dd></div><div><dt>角色规则</dt><dd>{instructionSections.length} 组</dd></div><div><dt>技能包</dt><dd>{enabledPackages.length} 个</dd></div><div><dt>可见范围</dt><dd>{visibleToUsers ? "用户可见" : "仅管理员"}</dd></div></dl><Button block icon={<FlaskConical size={16} />} onClick={() => setActiveTab("validate")}>运行配置检查</Button></aside>
        </div> : null}

        {activeTab === "instructions" ? <div className="reference-two-column instruction-layout">
          <div className="reference-stack">
            <div className="reference-toolbar"><div className="reference-segment"><button className={instructionMode === "structured" ? "active" : ""} onClick={() => setInstructionMode("structured")}><Layers3 size={15} />结构化编辑</button><button className={instructionMode === "source" ? "active" : ""} onClick={() => setInstructionMode("source")}><FileCode2 size={15} />源码模式</button></div><Button icon={<Pencil size={15} />} onClick={() => setInstructionEditOpen(true)}>编辑完整指令</Button></div>
            {instructionSourceDraft.mode === "inline" && instructionContent.trim() ? <Alert className="instruction-order-note" type="warning" showIcon message={`${instructionSections.length} 个规则分组将按文档顺序合并生效`} /> : null}
            {!instructionConfigured ? <Alert type="warning" showIcon message="尚未配置角色指令" action={<Button onClick={() => setInstructionEditOpen(true)}>开始配置</Button>} /> : null}
            {instructionMode === "structured" ? <>{instructionSourceDraft.mode !== "inline" ? <Alert type="info" showIcon message={`当前使用${instructionSourceDraft.mode === "template" ? "模板引用" : "路径引用"}`} description="引用内容由运行时解析，请切换到源码模式查看或更换来源。" /> : instructionSections.map((section, sectionIndex) => <section className="reference-rule-group" key={`${section.title}-${sectionIndex}`}><header><div><span className="rule-group-icon">{sectionIndex === 0 ? <Bot /> : sectionIndex === 1 ? <ShieldCheck /> : <FileText />}</span><h3>{section.title}</h3></div><div><Tag color="success">生效</Tag><Button size="small" icon={<Pencil size={13} />} onClick={() => setInstructionEditOpen(true)}>编辑原文</Button></div></header>{[section.body, ...section.rules].filter(Boolean).map((rule, ruleIndex) => <div className="reference-rule-row" key={`${rule}-${ruleIndex}`}><span>{rule}</span><Tag>按原文顺序</Tag></div>)}</section>)}</> : <section className="reference-section source-editor-wrap"><InstructionSourceEditor instructionSources={instructionSources} onChange={setInstructionSources} /></section>}
          </div>
          <aside className="reference-preview-panel instruction-preview"><div className="reference-section-title"><div><h3>生效预览</h3><p>基于当前编辑内容生成。</p></div><Tooltip title="预览会随编辑实时更新"><CircleAlert size={16} /></Tooltip></div><div className="preview-runtime"><strong>运行配置</strong><small>{runDraft?.name ?? "未绑定"}</small><div><span>模式</span><b>{agent.slug}</b><span>状态</span><Tag color={status === "active" ? "success" : "default"}>{status}</Tag><span>可见性</span><b>{visibleToUsers ? "visible" : "hidden"}</b></div></div><div className="preview-capability-list"><div><PackageOpen /><span><strong>技能包</strong><small>{enabledPackages.map((item) => item.name).join("、") || "无"}</small></span><b>{enabledPackages.length} 个</b></div><div><Settings2 /><span><strong>技能</strong><small>当前生效能力总数</small></span><b>{enabledPackages.reduce((sum, item) => sum + item.items.length, 0)} 个</b></div><div><Users /><span><strong>访问权限</strong><small>{visibleToUsers ? "用户可见" : "仅管理员"}</small></span></div></div></aside>
        </div> : null}

        {activeTab === "skills" ? <AgentSkillsPanel skillPackages={skillPackages} selectedIds={skillPackageIds} agentVisibleToUsers={visibleToUsers} onChange={setSkillPackageIds} /> : null}

        {activeTab === "runtime" ? <>
          <Alert type="info" showIcon message="运行策略是共享配置资产" description="此处仅预览当前策略。需要调整模型或安全边界时，请返回工作台进入“配置资产”；如只想影响当前智能体，请先复制运行策略再重新绑定。" />
          {runDraft?.sandboxMode === "danger-full-access" && runDraft.approvalPolicy === "never" ? <Alert className="reference-warning" type="warning" showIcon message="当前配置超出推荐值：生产环境不建议使用无审批的完全访问" /> : null}
          {runDraft?.networkAccessEnabled && !(runDraft.sandboxMode === "danger-full-access" && runDraft.approvalPolicy === "never") ? <Alert className="reference-warning" type="warning" showIcon message="联网访问已启用；外部请求仍受沙箱与审批策略共同约束" /> : null}
          <section className="reference-section runtime-presets"><div className="reference-section-title"><div><h3>当前运行预设</h3><p>预设参数由共享运行策略统一维护。</p></div></div><div className="preset-grid">{PRESETS.map((preset) => <button key={preset.id} disabled className={activePreset === preset.id ? "active" : ""}><span className="preset-radio">{activePreset === preset.id ? <CircleDot /> : null}</span><span><strong>{preset.label}</strong><small>{preset.description}</small></span></button>)}</div><div className="preset-facts"><span><Gauge />推理强度 {runDraft?.defaultReasoningEffort ?? "—"}</span><span><Globe2 />{runDraft?.networkAccessEnabled ? "可联网" : "禁止联网"}</span><span><LockKeyhole />{runDraft?.sandboxMode ?? "—"}</span></div></section>
          <div className="runtime-split"><section className="reference-section"><div className="reference-section-title"><div><h3>模型与推理</h3><p>决定回答质量、速度与成本。</p></div></div><div className="reference-setting-list"><label><span><Bot /><b>默认模型</b><small>决定回答质量与覆盖能力</small></span><Input value={runDraft?.defaultModel ?? ""} disabled /></label><label><span><Layers3 /><b>允许降级模型</b><small>主模型不可用时自动切换</small></span><Select mode="tags" value={runDraft?.allowedModels ?? []} disabled /></label><label><span><Sparkles /><b>推理强度</b><small>影响准确性与响应时间</small></span><Select value={runDraft?.defaultReasoningEffort} disabled options={["none","minimal","low","medium","high","xhigh"].map((value) => ({ label: value, value }))} /></label></div><div className="runtime-effect-table"><div><span>设置</span><span>响应时间</span><span>效果质量</span><span>成本</span></div><div><b>低</b><span>约 5–10 秒</span><span>★★☆☆☆</span><span>低</span></div><div className={runDraft?.defaultReasoningEffort === "medium" ? "current" : ""}><b>中</b><span>约 8–20 秒</span><span>★★★☆☆</span><span>中</span></div><div><b>高</b><span>约 20–40 秒</span><span>★★★★☆</span><span>高</span></div></div></section>
          <section className="reference-section"><div className="reference-section-title"><div><h3>执行边界</h3><p>控制智能体可执行的操作范围。</p></div></div><div className="reference-setting-list"><label><span><ShieldCheck /><b>沙箱模式</b><small>限制可写入的数据范围</small></span><Select value={runDraft?.sandboxMode} disabled options={["read-only","workspace-write","danger-full-access"].map((value) => ({ label: value, value }))} /></label><label><span><UserRound /><b>审批策略</b><small>高风险操作的人工确认要求</small></span><Select value={runDraft?.approvalPolicy} disabled options={["never","on-request","on-failure","untrusted"].map((value) => ({ label: value, value }))} /></label><label><span><Globe2 /><b>联网访问</b><small>是否允许访问互联网获取信息</small></span><Switch checked={runDraft?.networkAccessEnabled} disabled /></label><label><span><Search /><b>网页搜索模式</b><small>控制检索范围与时效性</small></span><Select value={runDraft?.webSearchMode} disabled options={[{ label: "disabled", value: "disabled" }, { label: "cached", value: "cached" }, { label: "live", value: "live" }]} /></label></div></section></div>
          <section className="reference-section platform-limits"><div className="reference-section-title"><div><h3>平台硬限制</h3><p>继承自平台与组织策略，当前页面不可修改。</p></div></div><div><span><LockKeyhole /><b>数据保留策略</b><small>由组织策略继承</small></span><span><LockKeyhole /><b>最大输出长度</b><small>由模型能力继承</small></span><span><LockKeyhole /><b>单次请求超时</b><small>由运行时继承</small></span><span><LockKeyhole /><b>并发会话上限</b><small>由订阅配置继承</small></span><span><LockKeyhole /><b>工具调用白名单</b><small>已受限</small></span></div></section>
          <section className="reference-section config-preview"><div className="reference-section-title"><div><h3>配置预览</h3><p>保存后传递给运行时的核心参数。</p></div></div><pre>{JSON.stringify(runDraft ? { model: runDraft.defaultModel, fallback: runDraft.allowedModels, reasoning: runDraft.defaultReasoningEffort, sandbox: runDraft.sandboxMode, approval: runDraft.approvalPolicy, network: runDraft.networkAccessEnabled, web_search: runDraft.webSearchMode } : {}, null, 2)}</pre></section>
        </> : null}

        {activeTab === "access" ? <div className="reference-two-column access-layout"><div className="reference-stack"><div className="access-page-summary"><div><h3>访问与渠道</h3><p>确定谁能使用这个智能体，以及从哪些入口访问。</p></div><span><Users />{visibleToUsers ? "用户可发现" : "仅管理员可见"}</span></div><div className="access-impact-line"><strong>{visibleToUsers ? "组织成员可发现" : "普通用户不可发现"}</strong><i />拒绝规则优先<i />渠道在集成中心单独配置</div><Alert className="access-rule-notice" type="info" showIcon message="拒绝规则优先于允许规则；发生冲突时，系统按更安全的结果判定。" /><section className="reference-section access-policy-section"><div className="access-default-header"><div><span className="access-section-icon"><Users /></span><span><strong>默认访问范围</strong><small>控制没有命中例外规则的用户是否能发现并使用该智能体。</small></span></div><label><span>{visibleToUsers ? "对组织用户开放" : "仅管理员可见"}</span><Switch checked={visibleToUsers} onChange={setVisibleToUsers} /></label></div><CapabilityPolicyEditor resourceType="agent_mode" resourceId={agent.id} title="访问规则" /></section><section className="reference-section access-channel-section"><div className="reference-section-title"><div><h3>渠道生效范围</h3><p>此页只维护智能体权限；外部渠道的启停与身份映射由集成中心维护。</p></div></div><div className="access-channel-table"><div className="access-channel-head"><span>渠道</span><span>当前状态</span><span>身份来源</span><span>配置位置</span></div><div><span><Globe2 /><b>Web 工作台</b></span><Tag color={visibleToUsers ? "success" : "default"}>{visibleToUsers ? "可发现" : "已隐藏"}</Tag><small>当前登录组织成员</small><Tag>当前页面</Tag></div><div><span><Settings2 /><b>外部集成</b></span><Tag>按集成配置</Tag><small>集成实例身份映射</small><Tag>集成中心</Tag></div></div></section></div><aside className="reference-preview-panel permission-simulator"><div className="reference-section-title"><div><h3>真实判定顺序</h3><p>运行时按以下后端规则逐层收敛访问范围。</p></div><ShieldCheck size={16} /></div><div className="decision-chain"><div><span>1</span><p><strong>组织边界</strong><small>资源必须属于当前组织或平台公共配置</small></p><Tag color="success">强制</Tag></div><i /><div><span>2</span><p><strong>可见范围</strong><small>{visibleToUsers ? "允许组织用户继续判定" : "普通用户在此处被拒绝"}</small></p><Tag color={visibleToUsers ? "success" : "default"}>{visibleToUsers ? "开放" : "隐藏"}</Tag></div><i /><div><span>3</span><p><strong>显式访问规则</strong><small>角色、部门和用户规则由后端计算，拒绝优先</small></p><Tag>后端判定</Tag></div><i /><div><span>4</span><p><strong>渠道身份</strong><small>外部渠道先映射组织身份，再进入同一判定链</small></p><Tag>集成中心</Tag></div></div><Alert type="info" showIcon message="此处不提供虚拟身份模拟" description="没有真实用户和渠道上下文时，前端推算会产生错误结论；请保存规则后使用对应账号或集成测试。" /></aside></div> : null}

        {activeTab === "validate" ? <div className="test-workspace"><aside className="test-case-list"><header><h3>校验范围</h3></header>{[<><strong>基础信息</strong><small>名称与智能体标识</small></>, <><strong>运行策略</strong><small>状态、组织与模型配置</small></>, <><strong>技能包</strong><small>状态、可见范围与组织边界</small></>, <><strong>角色指令</strong><small>workspace_agents_md 来源</small></>].map((content, index) => <div className="active" key={index}><span>{content}</span><CircleDot size={15} /></div>)}</aside><section className="test-main"><div className="test-user-prompt"><ShieldCheck /><div><strong>后端配置校验</strong><p>按真实运行时前置条件检查当前草稿，不生成或伪造模型回答。</p></div></div><div className="test-result-card"><div className="test-result-header"><Bot /><strong>校验结果</strong>{validationChecks ? <Tag color={validationChecks.every((item) => item.pass) ? "success" : "warning"}>{validationChecks.filter((item) => item.pass).length}/{validationChecks.length} 通过</Tag> : <Tag>等待执行</Tag>}</div>{validationChecks ? <div className="test-result-body"><p>{validationChecks.every((item) => item.pass) ? "当前配置满足后端保存与用户运行时的前置条件。" : "当前配置存在不会进入用户运行时的资源，请处理后再保存。"}</p>{validationChecks.map((item) => <div key={item.key} className={item.pass ? "pass" : "warning"}>{item.pass ? <CheckCircle2 /> : <AlertTriangle />}<span><strong>{item.label}</strong><small>{item.detail}</small></span></div>)}</div> : <div className="test-placeholder"><FlaskConical /><strong>尚未执行校验</strong><p>点击下方按钮后，请求后端核对当前配置草稿引用的真实资源。</p></div>}</div><div className="test-composer"><Alert type="info" showIcon message={dirty ? "将校验尚未保存的当前草稿" : "将校验当前已保存配置"} /><Button type="primary" loading={validating} icon={<Play size={16} />} onClick={() => void validateConfiguration()}>执行后端校验</Button></div></section><aside className="test-check-panel"><header><h3>当前运行配置</h3><Tag>{validationChecks ? `${validationChecks.filter((item) => item.pass).length}/${validationChecks.length}` : "待校验"}</Tag></header><section><dl><div><dt>模型</dt><dd>{runDraft?.defaultModel ?? "—"}</dd></div><div><dt>沙箱</dt><dd>{runDraft?.sandboxMode ?? "—"}</dd></div><div><dt>审批</dt><dd>{runDraft?.approvalPolicy ?? "—"}</dd></div><div><dt>技能包</dt><dd>{enabledPackages.length}</dd></div><div><dt>指令来源</dt><dd>{instructionSourceDraft.mode}</dd></div></dl></section><Alert type="warning" showIcon message="不包含模型回答测试" description="模型效果测试需要真实会话、用户权限和运行时上下文，应在工作台或渠道验收中执行。" /></aside></div> : null}
      </main>

      <footer className="reference-save-bar"><span>{dirty ? <><CircleAlert size={17} />当前配置有未保存更改</> : <><CheckCircle2 size={17} />当前配置已保存</>}</span><div>{activeTab !== "validate" ? <Button icon={<FlaskConical size={16} />} onClick={() => setActiveTab("validate")}>校验配置</Button> : null}<Button type="primary" icon={<Save size={16} />} disabled={!dirty} loading={saving} onClick={() => void save()}>保存当前配置</Button></div></footer>

      <Modal title="编辑完整角色指令" width={820} open={instructionEditOpen} onCancel={() => setInstructionEditOpen(false)} onOk={() => setInstructionEditOpen(false)} okText="完成" cancelText="取消"><p className="modal-help">使用 Markdown 标题划分规则分组；保存智能体配置后写入 AGENTS.md。</p><Input.TextArea rows={20} value={instructionContent} onChange={(event) => setInstructionContent(event.target.value)} placeholder="# 身份与目标\n你是……\n\n# 回答原则\n- 优先给出明确结论" /></Modal>
    </div>
  );
}
