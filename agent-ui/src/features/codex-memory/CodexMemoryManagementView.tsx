import {
  Alert,
  Button,
  Checkbox,
  Col,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  ArrowLeft,
  BrainCircuit,
  Building2,
  CheckCircle2,
  CirclePause,
  CirclePlay,
  CircleStop,
  Eraser,
  Eye,
  FileText,
  GitBranch,
  History,
  PencilLine,
  RefreshCcw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";

import { fetchAdminUsers } from "../admin/api";
import type { AdminUser } from "../admin/types";
import { fetchAgentModes } from "../capability-center/api";
import type { AgentModeRecord } from "../capability-center/types";
import {
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS,
  MarkdownMermaidBlock,
  MarkdownTable,
  extractMermaidCodeFromPreChildren
} from "../markdown/markdown-rendering";
import { fetchSystemSettings, publishSystemSettings, saveSystemSettingsDraft } from "../system-settings/api";
import type { SystemSettingsPayload, SystemSettingsVersionMeta } from "../system-settings/types";
import {
  cancelCodexMemoryBackfillRun,
  clearCodexMemoryScope,
  createCodexMemoryBackfillRun,
  deleteCodexMemoryFile,
  fetchCodexMemoryBackfillRuns,
  fetchCodexMemoryFileContent,
  fetchCodexMemoryFiles,
  fetchCodexMemoryLlmSecretState,
  fetchCodexMemoryRuns,
  fetchCodexMemoryScopes,
  fetchPythonRuntimeStatus,
  pauseCodexMemoryBackfillRun,
  previewCodexMemoryBackfill,
  previewEnterpriseContext,
  resumeCodexMemoryBackfillRun,
  saveCodexMemoryLlmSecret,
  saveCodexMemoryFileContent
} from "./api";
import type {
  CodexMemoryBackfillFilters,
  CodexMemoryBackfillPreview,
  CodexMemoryBackfillRun,
  CodexMemoryBackfillRunStatus,
  CodexMemoryFile,
  CodexMemoryFileContent,
  CodexMemoryLlmSecretState,
  CodexMemoryRunLog,
  CodexMemoryRunStatus,
  CodexMemoryScope,
  CodexMemoryScopeKind,
  CodexMemorySettings,
  EnterpriseContextChannel,
  EnterpriseContextFieldKey,
  EnterpriseContextPreviewResponse,
  EnterpriseContextSettings,
  PythonRuntimeCapabilityStatus,
  PythonRuntimeSettings,
  PythonRuntimeStatus
} from "./types";

const DEFAULT_MEMORY_SETTINGS: CodexMemorySettings = {
  enabled: true,
  useMemories: true,
  generateMemories: true,
  generationEngine: "agent_studio",
  llmProvider: "active_codex_provider",
  llmApiMode: "auto",
  llmModel: "",
  llmBaseUrl: "",
  llmApiKeyEnv: "CODEX_API_KEY",
  llmAzureApiVersion: "",
  disableOnExternalContext: true,
  minRateLimitRemainingPercent: 25,
  minRolloutIdleHours: 6,
  maxRolloutAgeDays: 30,
  maxUnusedDays: 30
};

const DEFAULT_ENTERPRISE_CONTEXT_SETTINGS: EnterpriseContextSettings = {
  enabled: false,
  failOpen: true,
  maxPromptChars: 1200,
  channels: {
    portal: true,
    dingtalk: true,
    crest: true,
    zendesk: false,
    openaiCompatibleApi: false
  },
  fields: {
    identity: true,
    organization: true,
    departmentPosition: true,
    employeeNo: true,
    workPlace: true,
    manager: true,
    contact: false
  },
  agentOverrides: []
};

const DEFAULT_PYTHON_RUNTIME_SETTINGS: PythonRuntimeSettings = {
  enabled: true,
  injectRuntimeHint: true,
  preferSharedPackages: true,
  sessionTmpEnabled: true,
  cleanupSessionArtifactsOlderThanDays: 14
};

const ENTERPRISE_CHANNEL_LABELS: Record<EnterpriseContextChannel, string> = {
  portal: "Portal",
  dingtalk: "钉钉",
  crest: "CREST",
  zendesk: "Zendesk",
  openai_compatible_api: "外部 API"
};

const ENTERPRISE_FIELD_LABELS: Record<EnterpriseContextFieldKey, { title: string; description: string }> = {
  identity: { title: "基础身份", description: "姓名、邮箱等用于识别当前用户。" },
  organization: { title: "组织", description: "用户所在组织名称，不包含内部组织 ID。" },
  departmentPosition: { title: "部门岗位", description: "部门、职位、负责人标记等工作背景。" },
  employeeNo: { title: "工号", description: "仅在需要企业内部识别时注入。" },
  workPlace: { title: "工作地", description: "办公地点或区域信息。" },
  manager: { title: "汇报关系", description: "直属主管姓名或邮箱。" },
  contact: { title: "联系方式", description: "手机号、电话。默认关闭，开启需确认隐私边界。" }
};

const KIND_LABELS: Record<CodexMemoryScopeKind, string> = {
  user_agent: "用户智能体",
  integration_agent: "集成智能体",
  legacy_thread: "旧会话",
  unknown: "未知来源"
};

const KIND_COLORS: Record<CodexMemoryScopeKind, string> = {
  user_agent: "blue",
  integration_agent: "purple",
  legacy_thread: "orange",
  unknown: "default"
};

const RUN_STATUS_LABELS: Record<CodexMemoryRunStatus, string> = {
  written: "已写入",
  skipped_no_durable_memory: "无长期记忆",
  skipped_missing_input: "不可检测",
  failed: "失败"
};

const MISSING_INPUT_HELP =
  "不可检测表示该历史轮次缺少回填必须的信息，例如用户问题为空、助手回答为空、助手回复未完成，或旧数据无法定位到对应记忆空间；这类轮次不会调用 LLM，也不会写入 memory。";

const RUN_STATUS_COLORS: Record<CodexMemoryRunStatus, string> = {
  written: "green",
  skipped_no_durable_memory: "default",
  skipped_missing_input: "orange",
  failed: "red"
};

const BACKFILL_CHANNEL_OPTIONS = [
  { label: "Portal", value: "portal" },
  { label: "Zendesk", value: "zendesk" },
  { label: "钉钉", value: "dingtalk" },
  { label: "CREST", value: "crest" },
  { label: "外部 API", value: "openai_compatible_api" }
];

const BACKFILL_CHANNEL_LABELS: Record<string, string> = {
  portal: "Portal",
  zendesk: "Zendesk",
  dingtalk: "钉钉",
  crest: "CREST",
  openai_compatible_api: "外部 API"
};

const BACKFILL_STATUS_LABELS: Record<CodexMemoryBackfillRunStatus, string> = {
  queued: "排队中",
  running: "运行中",
  paused: "已暂停",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消"
};

const BACKFILL_STATUS_COLORS: Record<CodexMemoryBackfillRunStatus, string> = {
  queued: "blue",
  running: "processing",
  paused: "orange",
  completed: "green",
  failed: "red",
  cancelled: "default"
};

const RUN_REASON_LABELS: Record<string, string> = {
  memory_written: "已写入记忆",
  memory_create: "新增记忆",
  memory_update: "更新记忆",
  memory_merge: "合并记忆",
  candidate_recorded: "已记录候选",
  model_declined: "模型判断无需沉淀",
  empty_memory: "模型返回空记忆",
  missing_prompt: "缺少用户输入",
  missing_answer: "缺少助手回复",
  missing_codex_home: "缺少 Codex home",
  assistant_incomplete: "助手回复未完成",
  memory_disabled: "Memory 未启用",
  generation_disabled: "自动生成未启用",
  codex_native_generation: "当前使用 Codex 原生生成",
  external_context_disabled: "外部上下文暂停生成",
  missing_llm_config: "缺少 LLM 配置",
  invalid_llm_response: "LLM 返回格式无效",
  exception: "执行异常"
};

const ENTERPRISE_PREVIEW_REASON_LABELS: Record<string, string> = {
  enterprise_context_disabled: "企业上下文注入未启用",
  channel_disabled: "当前渠道未启用",
  agent_override_disabled: "当前智能体被单独关闭",
  missing_user: "未选择用户",
  user_not_found: "用户不存在",
  resolution_failed: "企业上下文解析失败"
};

type MemoryView = "overview" | "scope" | "file";

function clonePayload(payload: SystemSettingsPayload): SystemSettingsPayload {
  return JSON.parse(JSON.stringify(payload)) as SystemSettingsPayload;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
}

function formatLocalTime(value?: string | null): string {
  if (!value) return "未记录";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "未记录";
  return parsed.toLocaleString();
}

function normalizeDatetimeInput(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

function compareTime(a?: string | null, b?: string | null): number {
  return (a ? Date.parse(a) : 0) - (b ? Date.parse(b) : 0);
}

function settingsChanged(left: CodexMemorySettings | null, right: CodexMemorySettings | null): boolean {
  if (!left || !right) return Boolean(left || right);
  return JSON.stringify(left) !== JSON.stringify(right);
}

function enterpriseSettingsChanged(
  left: EnterpriseContextSettings | null,
  right: EnterpriseContextSettings | null
): boolean {
  if (!left || !right) return Boolean(left || right);
  return JSON.stringify(left) !== JSON.stringify(right);
}

function pythonRuntimeSettingsChanged(
  left: PythonRuntimeSettings | null,
  right: PythonRuntimeSettings | null
): boolean {
  if (!left || !right) return Boolean(left || right);
  return JSON.stringify(left) !== JSON.stringify(right);
}

function enterpriseChannelKey(channel: EnterpriseContextChannel): keyof EnterpriseContextSettings["channels"] {
  return channel === "openai_compatible_api" ? "openaiCompatibleApi" : channel;
}

function scopeTitle(scope: CodexMemoryScope): string {
  return scope.displayLabel || scope.label || "未命名记忆空间";
}

function scopeSubtitle(scope: CodexMemoryScope): string {
  return scope.displaySubtitle || KIND_LABELS[scope.kind] || "记忆空间";
}

function ownerLabel(scope: CodexMemoryScope): string {
  if (scope.kind === "integration_agent") {
    return scope.integrationName || scope.integrationSlug || scope.provider || "集成共享";
  }
  if (scope.kind === "user_agent") {
    return scope.ownerName || scope.ownerEmail || "未知用户";
  }
  return scopeSubtitle(scope);
}

function agentLabel(scope: CodexMemoryScope): string {
  return scope.agentName || scope.agentSlug || "默认智能体";
}

function userLabel(user: AdminUser): string {
  return user.synced.displayName || user.synced.email || "未命名用户";
}

function userSubtitle(user: AdminUser): string {
  return [user.synced.email, user.enterprise.title, user.enterprise.workPlace].filter(Boolean).join(" · ") || "无补充信息";
}

function agentModeLabel(mode?: AgentModeRecord | null): string {
  return mode?.name || mode?.slug || "默认智能体";
}

function channelDisplayName(channel: string): string {
  return BACKFILL_CHANNEL_LABELS[channel] ?? channel;
}

function fileDisplayName(file: Pick<CodexMemoryFile, "path" | "name">): string {
  return file.name || file.path.split("/").filter(Boolean).at(-1) || file.path;
}

function fileExtension(file: Pick<CodexMemoryFile, "path" | "name">): string {
  const name = fileDisplayName(file);
  const match = /\.([^.]+)$/.exec(name);
  return match?.[1]?.toLowerCase() || "file";
}

function isMarkdownFile(file?: Pick<CodexMemoryFile, "path" | "name"> | null): boolean {
  if (!file) return false;
  return ["md", "markdown", "mdx"].includes(fileExtension(file));
}

function scopeHealth(scope: CodexMemoryScope): "empty" | "active" {
  return scope.fileCount > 0 ? "active" : "empty";
}

function backfillProgress(run: CodexMemoryBackfillRun): number {
  if (run.totalItems <= 0) return 100;
  return Math.min(100, Math.round((run.processedItems / run.totalItems) * 100));
}

function backfillRangeLabel(filters: CodexMemoryBackfillFilters): string {
  const channels = filters.channels?.length
    ? filters.channels.map(channelDisplayName).join("、")
    : "全部渠道";
  const from = filters.createdFrom ? formatLocalTime(filters.createdFrom) : "";
  const to = filters.createdTo ? formatLocalTime(filters.createdTo) : "";
  const range = from || to ? `${from || "最早"} - ${to || "现在"}` : "全部时间";
  return `${channels} · ${range}`;
}

function CodexMemoryMarkdownPreview(props: { text: string; maxHeight?: number; style?: React.CSSProperties }) {
  return (
    <div
      className="conversation-audit-markdown"
      style={{
        maxHeight: props.maxHeight,
        overflow: "auto",
        padding: "2px 4px",
        ...props.style
      }}
    >
      <ReactMarkdown
        rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
        remarkPlugins={MARKDOWN_REMARK_PLUGINS}
        components={{
          pre: ({ children, ...rest }) => {
            const mermaidCode = extractMermaidCodeFromPreChildren(children);
            if (mermaidCode) return <MarkdownMermaidBlock code={mermaidCode} />;
            return <pre {...rest}>{children}</pre>;
          },
          table: MarkdownTable as never
        }}
      >
        {props.text}
      </ReactMarkdown>
    </div>
  );
}

function MemoryMetric(props: { label: string; value: string; hint?: string }) {
  return (
    <div
      style={{
        border: "1px solid var(--admin-color-border)",
        borderRadius: 12,
        padding: 14,
        background: "var(--admin-color-surface)"
      }}
    >
      <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
        {props.label}
      </Typography.Text>
      <Typography.Text strong style={{ display: "block", marginTop: 4, fontSize: 22, lineHeight: 1.2 }}>
        {props.value}
      </Typography.Text>
      {props.hint ? (
        <Typography.Text type="secondary" style={{ display: "block", marginTop: 4, fontSize: 12 }}>
          {props.hint}
        </Typography.Text>
      ) : null}
    </div>
  );
}

function SettingSwitch(props: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 16,
        padding: "12px 0",
        borderBottom: "1px solid var(--admin-color-border-subtle, rgba(15, 23, 42, 0.08))"
      }}
    >
      <div style={{ minWidth: 0 }}>
        <Typography.Text strong>{props.title}</Typography.Text>
        <Typography.Text type="secondary" style={{ display: "block", marginTop: 4 }}>
          {props.description}
        </Typography.Text>
      </div>
      <Switch checked={props.checked} onChange={props.onChange} />
    </div>
  );
}

function SettingNumber(props: {
  title: string;
  description: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <Typography.Text strong>{props.title}</Typography.Text>
      <Typography.Text type="secondary" style={{ display: "block", marginTop: 3, minHeight: 42 }}>
        {props.description}
      </Typography.Text>
      <InputNumber
        min={props.min}
        max={props.max}
        value={props.value}
        addonAfter={props.suffix}
        onChange={(value) => props.onChange(Number(value ?? props.min))}
        style={{ width: "100%", maxWidth: 160, marginTop: 8 }}
      />
    </div>
  );
}

function RawTextPreview(props: { text: string; maxHeight?: number; style?: React.CSSProperties }) {
  return (
    <pre
      style={{
        maxHeight: props.maxHeight,
        overflow: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        margin: 0,
        border: "1px solid var(--admin-color-border)",
        borderRadius: 10,
        padding: 12,
        background: "var(--admin-color-bg-subtle, #f8fafc)",
        fontFamily: "var(--admin-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
        ...props.style
      }}
    >
      {props.text}
    </pre>
  );
}

export function CodexMemoryManagementView() {
  const [view, setView] = useState<MemoryView>("overview");

  const [settings, setSettings] = useState<CodexMemorySettings>(DEFAULT_MEMORY_SETTINGS);
  const [publishedSettings, setPublishedSettings] = useState<CodexMemorySettings | null>(null);
  const [enterpriseSettings, setEnterpriseSettings] = useState<EnterpriseContextSettings>(DEFAULT_ENTERPRISE_CONTEXT_SETTINGS);
  const [publishedEnterpriseSettings, setPublishedEnterpriseSettings] = useState<EnterpriseContextSettings | null>(null);
  const [pythonRuntimeSettings, setPythonRuntimeSettings] = useState<PythonRuntimeSettings>(DEFAULT_PYTHON_RUNTIME_SETTINGS);
  const [publishedPythonRuntimeSettings, setPublishedPythonRuntimeSettings] = useState<PythonRuntimeSettings | null>(null);
  const [pythonRuntimeStatus, setPythonRuntimeStatus] = useState<PythonRuntimeStatus | null>(null);
  const [pythonRuntimeLoading, setPythonRuntimeLoading] = useState(false);
  const [pythonRuntimeError, setPythonRuntimeError] = useState("");
  const [publishedMeta, setPublishedMeta] = useState<SystemSettingsVersionMeta | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [llmSecretState, setLlmSecretState] = useState<CodexMemoryLlmSecretState>({ hasApiKey: false });
  const [llmApiKeyDraft, setLlmApiKeyDraft] = useState("");
  const [clearLlmApiKey, setClearLlmApiKey] = useState(false);

  const [scopes, setScopes] = useState<CodexMemoryScope[]>([]);
  const [scopeQuery, setScopeQuery] = useState("");
  const [scopeKind, setScopeKind] = useState<CodexMemoryScopeKind | "all">("all");
  const [scopesLoading, setScopesLoading] = useState(true);
  const [scopesError, setScopesError] = useState("");
  const [selectedScopeId, setSelectedScopeId] = useState("");
  const [scopeDetail, setScopeDetail] = useState<CodexMemoryScope | null>(null);

  const [activeOverviewTab, setActiveOverviewTab] = useState("overview");
  const [runs, setRuns] = useState<CodexMemoryRunLog[]>([]);
  const [runsSummary, setRunsSummary] = useState<Record<CodexMemoryRunStatus, number>>({
    written: 0,
    skipped_no_durable_memory: 0,
    skipped_missing_input: 0,
    failed: 0
  });
  const [runsQuery, setRunsQuery] = useState("");
  const [runsStatus, setRunsStatus] = useState<CodexMemoryRunStatus | "all">("all");
  const [runsChannel, setRunsChannel] = useState("");
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState("");

  const [backfillChannels, setBackfillChannels] = useState<string[]>(["portal", "zendesk", "dingtalk", "crest"]);
  const [backfillCreatedFrom, setBackfillCreatedFrom] = useState("");
  const [backfillCreatedTo, setBackfillCreatedTo] = useState("");
  const [backfillLimit, setBackfillLimit] = useState<number | null>(8000);
  const [backfillDryRun, setBackfillDryRun] = useState(false);
  const [backfillPreview, setBackfillPreview] = useState<CodexMemoryBackfillPreview | null>(null);
  const [backfillPreviewLoading, setBackfillPreviewLoading] = useState(false);
  const [backfillRuns, setBackfillRuns] = useState<CodexMemoryBackfillRun[]>([]);
  const [backfillRunsLoading, setBackfillRunsLoading] = useState(true);
  const [backfillStarting, setBackfillStarting] = useState(false);
  const [backfillActionRunId, setBackfillActionRunId] = useState("");
  const [backfillError, setBackfillError] = useState("");

  const [previewUsers, setPreviewUsers] = useState<AdminUser[]>([]);
  const [previewAgentModes, setPreviewAgentModes] = useState<AgentModeRecord[]>([]);
  const [previewUserId, setPreviewUserId] = useState("");
  const [previewAgentModeId, setPreviewAgentModeId] = useState("");
  const [previewChannel, setPreviewChannel] = useState<EnterpriseContextChannel>("portal");
  const [enterprisePreview, setEnterprisePreview] = useState<EnterpriseContextPreviewResponse | null>(null);
  const [enterprisePreviewLoading, setEnterprisePreviewLoading] = useState(false);

  const [files, setFiles] = useState<CodexMemoryFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [fileContent, setFileContent] = useState<CodexMemoryFileContent | null>(null);
  const [fileDraft, setFileDraft] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileSaving, setFileSaving] = useState(false);

  const selectedScopeFromList = scopes.find((scope) => scope.id === selectedScopeId) ?? null;
  const selectedScope = scopeDetail?.id === selectedScopeId ? scopeDetail : selectedScopeFromList;
  const selectedFile = files.find((file) => file.path === selectedFilePath) ?? null;
  const isMemorySettingsDirty = settingsChanged(settings, publishedSettings);
  const isEnterpriseSettingsDirty = enterpriseSettingsChanged(enterpriseSettings, publishedEnterpriseSettings);
  const isPythonRuntimeSettingsDirty = pythonRuntimeSettingsChanged(pythonRuntimeSettings, publishedPythonRuntimeSettings);
  const isSettingsDirty = isMemorySettingsDirty || isEnterpriseSettingsDirty || isPythonRuntimeSettingsDirty;
  const publishedVersion = publishedMeta ? `v${publishedMeta.versionNumber}` : "未发布";

  const isFileDirty = useMemo(() => {
    if (!fileContent) return false;
    return fileDraft !== fileContent.content;
  }, [fileDraft, fileContent]);

  function confirmSetFilePath(path: string) {
    if (view === "file" && isFileDirty) {
      Modal.confirm({
        title: "放弃未保存的改动？",
        content: "当前文件有未保存的修改，切换到其他文件将丢失这些改动。是否继续？",
        okText: "放弃修改",
        cancelText: "取消",
        okButtonProps: { danger: true },
        onOk() {
          setSelectedFilePath(path);
        }
      });
    } else {
      setSelectedFilePath(path);
    }
  }

  function confirmSetView(nextView: MemoryView) {
    if (view === "file" && isFileDirty) {
      Modal.confirm({
        title: "放弃未保存的改动？",
        content: "当前文件有未保存的修改，返回将丢失这些改动。是否继续？",
        okText: "放弃修改",
        cancelText: "取消",
        okButtonProps: { danger: true },
        onOk() {
          setView(nextView);
        }
      });
    } else {
      setView(nextView);
    }
  }

  const scopeStats = useMemo(() => {
    const totalBytes = scopes.reduce((sum, scope) => sum + scope.totalBytes, 0);
    const totalFiles = scopes.reduce((sum, scope) => sum + scope.fileCount, 0);
    const userScopes = scopes.filter((scope) => scope.kind === "user_agent").length;
    const integrationScopes = scopes.filter((scope) => scope.kind === "integration_agent").length;
    return { totalBytes, totalFiles, userScopes, integrationScopes };
  }, [scopes]);

  function updateSetting<K extends keyof CodexMemorySettings>(key: K, value: CodexMemorySettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function updateEnterpriseSetting<K extends keyof EnterpriseContextSettings>(
    key: K,
    value: EnterpriseContextSettings[K]
  ) {
    setEnterpriseSettings((current) => ({ ...current, [key]: value }));
  }

  function updatePythonRuntimeSetting<K extends keyof PythonRuntimeSettings>(
    key: K,
    value: PythonRuntimeSettings[K]
  ) {
    setPythonRuntimeSettings((current) => ({ ...current, [key]: value }));
  }

  function updateEnterpriseChannel(channel: EnterpriseContextChannel, enabled: boolean) {
    const key = enterpriseChannelKey(channel);
    setEnterpriseSettings((current) => ({
      ...current,
      channels: {
        ...current.channels,
        [key]: enabled
      }
    }));
  }

  function updateEnterpriseField(field: EnterpriseContextFieldKey, enabled: boolean) {
    setEnterpriseSettings((current) => ({
      ...current,
      fields: {
        ...current.fields,
        [field]: enabled
      }
    }));
  }

  function updateAgentOverride(agentModeId: string, enabled: boolean | null) {
    setEnterpriseSettings((current) => {
      const withoutCurrent = current.agentOverrides.filter((item) => item.agentModeId !== agentModeId);
      if (enabled === null) {
        return { ...current, agentOverrides: withoutCurrent };
      }
      return {
        ...current,
        agentOverrides: [...withoutCurrent, { agentModeId, enabled }]
      };
    });
  }

  function runReasonLabel(reason: string): string {
    return RUN_REASON_LABELS[reason] ?? reason;
  }

  function runScopeLabel(run: CodexMemoryRunLog): string {
    return run.scope?.displayLabel || run.scope?.ownerName || run.scope?.integrationName || "未归类空间";
  }

  function runScopeSubtitle(run: CodexMemoryRunLog): string {
    return run.scope?.displaySubtitle || run.scope?.agentName || run.relativeHome || "未记录归属";
  }

  function buildBackfillFilters(): CodexMemoryBackfillFilters {
    return {
      ...(backfillChannels.length ? { channels: backfillChannels } : {}),
      ...(normalizeDatetimeInput(backfillCreatedFrom) ? { createdFrom: normalizeDatetimeInput(backfillCreatedFrom) } : {}),
      ...(normalizeDatetimeInput(backfillCreatedTo) ? { createdTo: normalizeDatetimeInput(backfillCreatedTo) } : {}),
      ...(backfillLimit ? { limit: backfillLimit } : {})
    };
  }

  async function loadSettings() {
    setSettingsLoading(true);
    setSettingsError("");
    try {
      const [response, secretState] = await Promise.all([
        fetchSystemSettings(),
        fetchCodexMemoryLlmSecretState()
      ]);
      const nextSettings = response.draft.payload.codexMemory ?? DEFAULT_MEMORY_SETTINGS;
      const nextEnterpriseSettings = response.draft.payload.enterpriseContext ?? DEFAULT_ENTERPRISE_CONTEXT_SETTINGS;
      const nextPythonRuntimeSettings = response.draft.payload.pythonRuntime ?? DEFAULT_PYTHON_RUNTIME_SETTINGS;
      setSettings({ ...DEFAULT_MEMORY_SETTINGS, ...nextSettings });
      setEnterpriseSettings({
        ...DEFAULT_ENTERPRISE_CONTEXT_SETTINGS,
        ...nextEnterpriseSettings,
        channels: { ...DEFAULT_ENTERPRISE_CONTEXT_SETTINGS.channels, ...nextEnterpriseSettings.channels },
        fields: { ...DEFAULT_ENTERPRISE_CONTEXT_SETTINGS.fields, ...nextEnterpriseSettings.fields },
        agentOverrides: nextEnterpriseSettings.agentOverrides ?? []
      });
      setPythonRuntimeSettings({ ...DEFAULT_PYTHON_RUNTIME_SETTINGS, ...nextPythonRuntimeSettings });
      setPublishedSettings(response.published?.payload.codexMemory ? { ...DEFAULT_MEMORY_SETTINGS, ...response.published.payload.codexMemory } : null);
      setPublishedEnterpriseSettings(response.published?.payload.enterpriseContext
        ? {
            ...DEFAULT_ENTERPRISE_CONTEXT_SETTINGS,
            ...response.published.payload.enterpriseContext,
            channels: {
              ...DEFAULT_ENTERPRISE_CONTEXT_SETTINGS.channels,
              ...response.published.payload.enterpriseContext.channels
            },
            fields: {
              ...DEFAULT_ENTERPRISE_CONTEXT_SETTINGS.fields,
              ...response.published.payload.enterpriseContext.fields
            },
            agentOverrides: response.published.payload.enterpriseContext.agentOverrides ?? []
        }
        : null);
      setPublishedPythonRuntimeSettings(response.published?.payload.pythonRuntime
        ? { ...DEFAULT_PYTHON_RUNTIME_SETTINGS, ...response.published.payload.pythonRuntime }
        : null);
      setPublishedMeta(response.publishedMeta);
      setLlmSecretState(secretState);
      setLlmApiKeyDraft("");
      setClearLlmApiKey(false);
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "加载记忆配置失败");
    } finally {
      setSettingsLoading(false);
    }
  }

  async function loadPythonRuntimeStatus() {
    setPythonRuntimeLoading(true);
    setPythonRuntimeError("");
    try {
      setPythonRuntimeStatus(await fetchPythonRuntimeStatus());
    } catch (error) {
      setPythonRuntimeError(error instanceof Error ? error.message : "加载 Python 运行时状态失败");
    } finally {
      setPythonRuntimeLoading(false);
    }
  }

  async function loadScopes(nextQuery = scopeQuery, nextKind = scopeKind) {
    setScopesLoading(true);
    setScopesError("");
    try {
      const response = await fetchCodexMemoryScopes({
        query: nextQuery.trim(),
        kind: nextKind,
        limit: 300
      });
      setScopes(response.scopes);
      if (selectedScopeId && !response.scopes.some((scope) => scope.id === selectedScopeId)) {
        setScopeDetail(null);
        setFiles([]);
        setSelectedFilePath("");
        setFileContent(null);
        setView("overview");
        setSelectedScopeId("");
      }
    } catch (error) {
      setScopesError(error instanceof Error ? error.message : "加载记忆空间失败");
    } finally {
      setScopesLoading(false);
    }
  }

  async function loadRuns(nextQuery = runsQuery, nextStatus = runsStatus, nextChannel = runsChannel) {
    setRunsLoading(true);
    setRunsError("");
    try {
      const response = await fetchCodexMemoryRuns({
        query: nextQuery.trim(),
        status: nextStatus,
        channel: nextChannel.trim(),
        limit: 300
      });
      setRuns(response.runs);
      setRunsSummary({
        written: response.summary.written ?? 0,
        skipped_no_durable_memory: response.summary.skipped_no_durable_memory ?? 0,
        skipped_missing_input: response.summary.skipped_missing_input ?? 0,
        failed: response.summary.failed ?? 0
      });
    } catch (error) {
      setRunsError(error instanceof Error ? error.message : "加载记忆统计日志失败");
    } finally {
      setRunsLoading(false);
    }
  }

  async function loadBackfillRuns() {
    setBackfillRunsLoading(true);
    setBackfillError("");
    try {
      const response = await fetchCodexMemoryBackfillRuns({ limit: 80 });
      setBackfillRuns(response.runs);
    } catch (error) {
      setBackfillError(error instanceof Error ? error.message : "加载历史回填任务失败");
    } finally {
      setBackfillRunsLoading(false);
    }
  }

  async function handlePreviewBackfill() {
    setBackfillPreviewLoading(true);
    setBackfillError("");
    try {
      const preview = await previewCodexMemoryBackfill(buildBackfillFilters());
      setBackfillPreview(preview);
      void message.success("已完成历史会话回填预估");
    } catch (error) {
      setBackfillPreview(null);
      setBackfillError(error instanceof Error ? error.message : "预估历史回填失败");
    } finally {
      setBackfillPreviewLoading(false);
    }
  }

  async function handleStartBackfill() {
    setBackfillStarting(true);
    setBackfillError("");
    try {
      await createCodexMemoryBackfillRun({
        filters: buildBackfillFilters(),
        dryRun: backfillDryRun,
        name: backfillDryRun ? "历史记忆回填演练" : "历史记忆回填"
      });
      void message.success(backfillDryRun ? "已创建回填演练记录" : "历史记忆回填任务已启动");
      await loadBackfillRuns();
      await loadRuns();
    } catch (error) {
      setBackfillError(error instanceof Error ? error.message : "启动历史回填失败");
    } finally {
      setBackfillStarting(false);
    }
  }

  async function handleBackfillAction(run: CodexMemoryBackfillRun, action: "pause" | "resume" | "cancel") {
    setBackfillActionRunId(run.id);
    setBackfillError("");
    try {
      if (action === "pause") {
        await pauseCodexMemoryBackfillRun(run.id);
        void message.success("回填任务已暂停");
      } else if (action === "resume") {
        await resumeCodexMemoryBackfillRun(run.id);
        void message.success("回填任务已继续");
      } else {
        await cancelCodexMemoryBackfillRun(run.id);
        void message.success("回填任务已取消");
      }
      await loadBackfillRuns();
    } catch (error) {
      setBackfillError(error instanceof Error ? error.message : "回填任务操作失败");
    } finally {
      setBackfillActionRunId("");
    }
  }

  async function loadPreviewOptions() {
    try {
      const [userResponse, agentModeResponse] = await Promise.all([
        fetchAdminUsers(),
        fetchAgentModes()
      ]);
      setPreviewUsers(userResponse.users);
      setPreviewAgentModes(agentModeResponse.agentModes);
      setPreviewUserId((current) => current || userResponse.users[0]?.id || "");
      setPreviewAgentModeId((current) => current || agentModeResponse.agentModes[0]?.id || "");
    } catch (error) {
      void message.warning(error instanceof Error ? error.message : "加载企业上下文预览选项失败");
    }
  }

  async function loadEnterprisePreview() {
    setEnterprisePreviewLoading(true);
    try {
      const response = await previewEnterpriseContext({
        channel: previewChannel,
        userId: previewUserId || undefined,
        agentModeId: previewAgentModeId || undefined,
        settings: enterpriseSettings
      });
      setEnterprisePreview(response);
    } catch (error) {
      setEnterprisePreview(null);
      void message.error(error instanceof Error ? error.message : "生成企业上下文预览失败");
    } finally {
      setEnterprisePreviewLoading(false);
    }
  }

  async function loadFiles(scopeId: string) {
    if (!scopeId) {
      setScopeDetail(null);
      setFiles([]);
      setSelectedFilePath("");
      setFileContent(null);
      return;
    }
    setFilesLoading(true);
    try {
      const response = await fetchCodexMemoryFiles(scopeId);
      setScopeDetail(response.scope);
      setFiles(response.files);
      setSelectedFilePath((current) => {
        if (current && response.files.some((file) => file.path === current)) return current;
        return response.files[0]?.path ?? "";
      });
      if (!response.files.length) {
        setFileContent(null);
        setFileDraft("");
      }
    } catch (error) {
      setFiles([]);
      setSelectedFilePath("");
      setFileContent(null);
      void message.error(error instanceof Error ? error.message : "加载记忆文件失败");
    } finally {
      setFilesLoading(false);
    }
  }

  async function loadFileContent(scopeId: string, filePath: string) {
    if (!scopeId || !filePath) {
      setFileContent(null);
      setFileDraft("");
      return;
    }
    setFileLoading(true);
    try {
      const response = await fetchCodexMemoryFileContent(scopeId, filePath);
      setFileContent(response.file);
      setFileDraft(response.file.content);
    } catch (error) {
      setFileContent(null);
      setFileDraft("");
      void message.error(error instanceof Error ? error.message : "读取记忆文件失败");
    } finally {
      setFileLoading(false);
    }
  }

  useEffect(() => {
    void loadSettings();
    void loadScopes();
    void loadRuns();
    void loadBackfillRuns();
    void loadPreviewOptions();
    void loadPythonRuntimeStatus();
  }, []);

  useEffect(() => {
    if (!backfillRuns.some((run) => run.status === "queued" || run.status === "running")) return undefined;
    const timer = window.setInterval(() => {
      void loadBackfillRuns();
      void loadRuns();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [backfillRuns]);

  useEffect(() => {
    void loadFiles(selectedScopeId);
  }, [selectedScopeId]);

  useEffect(() => {
    void loadFileContent(selectedScopeId, selectedFilePath);
  }, [selectedScopeId, selectedFilePath]);

  async function handleSaveSettings(publishAfterSave: boolean) {
    setSettingsSaving(true);
    setSettingsError("");
    try {
      const current = await fetchSystemSettings();
      const payload = clonePayload(current.draft.payload);
      payload.codexMemory = { ...settings };
      payload.enterpriseContext = { ...enterpriseSettings };
      payload.pythonRuntime = { ...pythonRuntimeSettings };
      if (clearLlmApiKey || llmApiKeyDraft.trim()) {
        const nextSecretState = await saveCodexMemoryLlmSecret({
          apiKey: llmApiKeyDraft.trim() || undefined,
          clearApiKey: clearLlmApiKey
        });
        setLlmSecretState(nextSecretState);
        setLlmApiKeyDraft("");
        setClearLlmApiKey(false);
      }
      const saved = await saveSystemSettingsDraft(payload);
      if (publishAfterSave) {
        const published = await publishSystemSettings();
        setPublishedSettings({ ...DEFAULT_MEMORY_SETTINGS, ...published.published!.payload.codexMemory });
        setPublishedEnterpriseSettings({
          ...DEFAULT_ENTERPRISE_CONTEXT_SETTINGS,
          ...published.published!.payload.enterpriseContext
        });
        setPublishedPythonRuntimeSettings({
          ...DEFAULT_PYTHON_RUNTIME_SETTINGS,
          ...(published.published!.payload.pythonRuntime ?? DEFAULT_PYTHON_RUNTIME_SETTINGS)
        });
        setPublishedMeta(published.publishedMeta);
        setSettings({ ...DEFAULT_MEMORY_SETTINGS, ...published.draft.payload.codexMemory });
        setEnterpriseSettings({ ...DEFAULT_ENTERPRISE_CONTEXT_SETTINGS, ...published.draft.payload.enterpriseContext });
        setPythonRuntimeSettings({
          ...DEFAULT_PYTHON_RUNTIME_SETTINGS,
          ...(published.draft.payload.pythonRuntime ?? DEFAULT_PYTHON_RUNTIME_SETTINGS)
        });
        void loadPythonRuntimeStatus();
        void message.success("上下文与记忆配置已保存并发布");
      } else {
        setSettings({ ...DEFAULT_MEMORY_SETTINGS, ...saved.draft.payload.codexMemory });
        setEnterpriseSettings({ ...DEFAULT_ENTERPRISE_CONTEXT_SETTINGS, ...saved.draft.payload.enterpriseContext });
        setPythonRuntimeSettings({
          ...DEFAULT_PYTHON_RUNTIME_SETTINGS,
          ...(saved.draft.payload.pythonRuntime ?? DEFAULT_PYTHON_RUNTIME_SETTINGS)
        });
        setPublishedSettings(saved.published?.payload.codexMemory ? { ...DEFAULT_MEMORY_SETTINGS, ...saved.published.payload.codexMemory } : null);
        setPublishedEnterpriseSettings(saved.published?.payload.enterpriseContext
          ? { ...DEFAULT_ENTERPRISE_CONTEXT_SETTINGS, ...saved.published.payload.enterpriseContext }
          : null);
        setPublishedPythonRuntimeSettings(saved.published?.payload.pythonRuntime
          ? { ...DEFAULT_PYTHON_RUNTIME_SETTINGS, ...saved.published.payload.pythonRuntime }
          : null);
        setPublishedMeta(saved.publishedMeta);
        void message.success("上下文与记忆配置草稿已保存");
      }
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "保存记忆配置失败");
    } finally {
      setSettingsSaving(false);
    }
  }

  async function handleDeleteFile(filePath: string) {
    if (!selectedScopeId) return;
    await deleteCodexMemoryFile(selectedScopeId, filePath);
    void message.success("记忆文件已删除");
    if (filePath === selectedFilePath) {
      setFileContent(null);
      setFileDraft("");
      if (view === "file") setView("scope");
    }
    await loadFiles(selectedScopeId);
    await loadScopes();
  }

  async function handleClearScope() {
    if (!selectedScopeId) return;
    await clearCodexMemoryScope(selectedScopeId);
    void message.success("当前记忆空间已清空");
    setSelectedFilePath("");
    setFileContent(null);
    setFileDraft("");
    setView("scope");
    await loadFiles(selectedScopeId);
    await loadScopes();
  }

  async function handleSaveFile() {
    if (!selectedScopeId || !selectedFilePath || !fileContent) return;
    setFileSaving(true);
    try {
      const response = await saveCodexMemoryFileContent(selectedScopeId, selectedFilePath, fileDraft);
      setFileContent(response.file);
      setFileDraft(response.file.content);
      await loadFiles(selectedScopeId);
      await loadScopes();
      void message.success("记忆文件已保存");
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "保存记忆文件失败");
    } finally {
      setFileSaving(false);
    }
  }

  function openScope(scope: CodexMemoryScope) {
    setSelectedScopeId(scope.id);
    setScopeDetail(scope);
    setView("scope");
  }

  function openFile(file: CodexMemoryFile) {
    setSelectedFilePath(file.path);
    setView("file");
  }

  const scopeColumns: ColumnsType<CodexMemoryScope> = [
    {
      title: "记忆空间",
      key: "scope",
      sorter: (a, b) => compareText(scopeTitle(a), scopeTitle(b)),
      render: (_: unknown, scope: CodexMemoryScope) => (
        <Space direction="vertical" size={2} style={{ minWidth: 0 }}>
          <Space size={8} wrap>
            <Typography.Text strong>{scopeTitle(scope)}</Typography.Text>
            <Tag color={KIND_COLORS[scope.kind]}>{KIND_LABELS[scope.kind]}</Tag>
            {scopeHealth(scope) === "empty" ? <Tag>暂无文件</Tag> : null}
          </Space>
          <Typography.Text type="secondary" ellipsis>
            {scopeSubtitle(scope)}
          </Typography.Text>
        </Space>
      )
    },
    {
      title: "内容",
      key: "content",
      width: 140,
      sorter: (a, b) => a.fileCount - b.fileCount || a.totalBytes - b.totalBytes,
      render: (_: unknown, scope: CodexMemoryScope) => (
        <Space direction="vertical" size={2} style={{ whiteSpace: "nowrap" }}>
          <Typography.Text>{scope.fileCount} 个文件</Typography.Text>
          <Typography.Text type="secondary">{formatBytes(scope.totalBytes)}</Typography.Text>
        </Space>
      )
    },
    {
      title: "更新时间",
      dataIndex: "latestModifiedAt",
      key: "latestModifiedAt",
      width: 170,
      defaultSortOrder: "descend",
      sorter: (a, b) => compareTime(a.latestModifiedAt, b.latestModifiedAt),
      render: (value: string | null) => formatLocalTime(value)
    },
    {
      title: "操作",
      key: "actions",
      width: 96,
      render: (_: unknown, scope: CodexMemoryScope) => (
        <Button size="small" icon={<Eye size={14} />} onClick={() => openScope(scope)}>
          查看
        </Button>
      )
    }
  ];

  const fileColumns: ColumnsType<CodexMemoryFile> = [
    {
      title: "文件",
      key: "file",
      sorter: (a, b) => compareText(fileDisplayName(a), fileDisplayName(b)),
      render: (_: unknown, file: CodexMemoryFile) => (
        <Space size={8} style={{ minWidth: 0 }}>
          <FileText size={15} />
          <Space direction="vertical" size={0} style={{ minWidth: 0 }}>
            <Typography.Text strong>{fileDisplayName(file)}</Typography.Text>
            <Typography.Text type="secondary">{fileExtension(file).toUpperCase()}</Typography.Text>
          </Space>
        </Space>
      )
    },
    {
      title: "大小",
      dataIndex: "bytes",
      key: "bytes",
      width: 110,
      sorter: (a, b) => a.bytes - b.bytes,
      render: (value: number) => formatBytes(value)
    },
    {
      title: "更新时间",
      dataIndex: "modifiedAt",
      key: "modifiedAt",
      width: 160,
      defaultSortOrder: "descend",
      sorter: (a, b) => compareTime(a.modifiedAt, b.modifiedAt),
      render: (value: string) => formatLocalTime(value)
    },
    {
      title: "操作",
      key: "actions",
      width: 140,
      render: (_: unknown, file: CodexMemoryFile) => (
        <Space>
          <Button size="small" icon={<PencilLine size={14} />} onClick={() => openFile(file)}>
            编辑
          </Button>
          <Popconfirm
            title="删除这个记忆文件？"
            description="删除后该记忆空间将不再读取这份 memory。"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={(event) => {
              event?.stopPropagation();
              void handleDeleteFile(file.path);
            }}
          >
            <Button
              size="small"
              danger
              icon={<Trash2 size={14} />}
              onClick={(event) => event.stopPropagation()}
            />
          </Popconfirm>
        </Space>
      )
    }
  ];

  const runColumns: ColumnsType<CodexMemoryRunLog> = [
    {
      title: "时间",
      dataIndex: "completedAt",
      key: "completedAt",
      width: 170,
      defaultSortOrder: "descend",
      sorter: (a, b) => compareTime(a.completedAt, b.completedAt),
      render: (value: string) => formatLocalTime(value)
    },
    {
      title: "结果",
      key: "status",
      width: 150,
      filters: (Object.keys(RUN_STATUS_LABELS) as CodexMemoryRunStatus[]).map((status) => ({
        text: RUN_STATUS_LABELS[status],
        value: status
      })),
      onFilter: (value, run) => run.status === value,
      sorter: (a, b) => compareText(RUN_STATUS_LABELS[a.status], RUN_STATUS_LABELS[b.status]),
      render: (_: unknown, run: CodexMemoryRunLog) => (
        <Space direction="vertical" size={2}>
          <Tag color={RUN_STATUS_COLORS[run.status]}>{RUN_STATUS_LABELS[run.status]}</Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {runReasonLabel(run.reason)}
          </Typography.Text>
        </Space>
      )
    },
    {
      title: "记忆空间",
      key: "scope",
      sorter: (a, b) => compareText(runScopeLabel(a), runScopeLabel(b)),
      render: (_: unknown, run: CodexMemoryRunLog) => (
        <Space direction="vertical" size={2} style={{ minWidth: 0 }}>
          <Typography.Text strong ellipsis>
            {runScopeLabel(run)}
          </Typography.Text>
          <Typography.Text type="secondary" ellipsis>
            {runScopeSubtitle(run)}
          </Typography.Text>
        </Space>
      )
    },
    {
      title: "渠道",
      dataIndex: "channel",
      key: "channel",
      width: 120,
      sorter: (a, b) => compareText(a.channel, b.channel),
      render: (value: string) => <Tag>{value}</Tag>
    },
    {
      title: "模型",
      key: "model",
      width: 170,
      sorter: (a, b) => compareText(a.llmModel || a.model || "", b.llmModel || b.model || ""),
      render: (_: unknown, run: CodexMemoryRunLog) => (
        <Space direction="vertical" size={2}>
          <Typography.Text>{run.llmModel || run.model || "未记录"}</Typography.Text>
          {run.llmProvider ? <Typography.Text type="secondary">{run.llmProvider}</Typography.Text> : null}
        </Space>
      )
    },
    {
      title: "耗时",
      dataIndex: "durationMs",
      key: "durationMs",
      width: 100,
      sorter: (a, b) => a.durationMs - b.durationMs,
      render: (value: number) => `${Math.round(value)} ms`
    },
    {
      title: "输入/输出",
      key: "chars",
      width: 120,
      sorter: (a, b) => (a.promptChars + a.answerChars) - (b.promptChars + b.answerChars),
      render: (_: unknown, run: CodexMemoryRunLog) => `${run.promptChars}/${run.answerChars}`
    },
    {
      title: "错误",
      dataIndex: "error",
      key: "error",
      width: 220,
      render: (value?: string) => value ? <Typography.Text type="danger" ellipsis>{value}</Typography.Text> : <Typography.Text type="secondary">-</Typography.Text>
    }
  ];

  const backfillColumns: ColumnsType<CodexMemoryBackfillRun> = [
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 170,
      defaultSortOrder: "descend",
      sorter: (a, b) => compareTime(a.createdAt, b.createdAt),
      render: (value: string) => formatLocalTime(value)
    },
    {
      title: "范围",
      key: "range",
      sorter: (a, b) => compareText(backfillRangeLabel(a.filters), backfillRangeLabel(b.filters)),
      render: (_: unknown, run: CodexMemoryBackfillRun) => (
        <Space direction="vertical" size={2} style={{ minWidth: 0 }}>
          <Space size={6} wrap>
            <Typography.Text strong>{run.name || (run.dryRun ? "历史回填演练" : "历史回填")}</Typography.Text>
            {run.dryRun ? <Tag>演练</Tag> : null}
          </Space>
          <Typography.Text type="secondary" ellipsis>
            {backfillRangeLabel(run.filters)}
          </Typography.Text>
        </Space>
      )
    },
    {
      title: "状态",
      key: "status",
      width: 130,
      filters: (Object.keys(BACKFILL_STATUS_LABELS) as CodexMemoryBackfillRunStatus[]).map((status) => ({
        text: BACKFILL_STATUS_LABELS[status],
        value: status
      })),
      onFilter: (value, run) => run.status === value,
      sorter: (a, b) => compareText(BACKFILL_STATUS_LABELS[a.status], BACKFILL_STATUS_LABELS[b.status]),
      render: (_: unknown, run: CodexMemoryBackfillRun) => (
        <Tag color={BACKFILL_STATUS_COLORS[run.status]}>{BACKFILL_STATUS_LABELS[run.status]}</Tag>
      )
    },
    {
      title: "进度",
      key: "progress",
      width: 180,
      sorter: (a, b) => backfillProgress(a) - backfillProgress(b),
      render: (_: unknown, run: CodexMemoryBackfillRun) => (
        <Space direction="vertical" size={4} style={{ width: "100%" }}>
          <Progress percent={backfillProgress(run)} size="small" status={run.status === "failed" ? "exception" : undefined} />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {run.processedItems} / {run.totalItems}
          </Typography.Text>
        </Space>
      )
    },
    {
      title: "结果",
      key: "result",
      width: 220,
      sorter: (a, b) => (a.writtenItems + a.failedItems) - (b.writtenItems + b.failedItems),
      render: (_: unknown, run: CodexMemoryBackfillRun) => (
        <Space size={6} wrap>
          <Tag color="green">写入 {run.writtenItems}</Tag>
          <Tag>跳过 {run.skippedNoDurableItems}</Tag>
          <Tag color="orange">不可检测 {run.skippedMissingInputItems}</Tag>
          {run.failedItems > 0 ? <Tag color="red">失败 {run.failedItems}</Tag> : null}
        </Space>
      )
    },
    {
      title: "操作",
      key: "actions",
      width: 190,
      render: (_: unknown, run: CodexMemoryBackfillRun) => (
        <Space wrap>
          {run.status === "queued" || run.status === "running" ? (
            <Button
              size="small"
              icon={<CirclePause size={14} />}
              loading={backfillActionRunId === run.id}
              onClick={() => void handleBackfillAction(run, "pause")}
            >
              暂停
            </Button>
          ) : null}
          {run.status === "paused" || run.status === "failed" ? (
            <Button
              size="small"
              icon={<CirclePlay size={14} />}
              loading={backfillActionRunId === run.id}
              onClick={() => void handleBackfillAction(run, "resume")}
            >
              继续
            </Button>
          ) : null}
          {run.status === "queued" || run.status === "running" || run.status === "paused" ? (
            <Popconfirm
              title="取消这个回填任务？"
              description="取消后未处理的历史轮次不会继续检测。"
              okText="取消任务"
              cancelText="返回"
              okButtonProps={{ danger: true }}
              onConfirm={() => void handleBackfillAction(run, "cancel")}
            >
              <Button
                size="small"
                danger
                icon={<CircleStop size={14} />}
                loading={backfillActionRunId === run.id}
              >
                取消
              </Button>
            </Popconfirm>
          ) : (
            <Typography.Text type="secondary">-</Typography.Text>
          )}
        </Space>
      )
    }
  ];

  function renderHeader() {
    return (
      <div className="admin-page-header">
        <div>
          <Space size={10} wrap style={{ marginBottom: 8 }}>
            {view !== "overview" ? (
              <Button icon={<ArrowLeft size={16} />} onClick={() => confirmSetView(view === "file" ? "scope" : "overview")}>
                {view === "file" ? "返回空间" : "返回列表"}
              </Button>
            ) : null}
            <Tag color={publishedEnterpriseSettings?.enabled ? "green" : "orange"}>
              {publishedEnterpriseSettings?.enabled ? "Enterprise Context 已启用" : "Enterprise Context 未启用"}
            </Tag>
            <Tag color={publishedSettings?.enabled ? "green" : "orange"}>
              {publishedSettings?.enabled ? "Memory 已启用" : "Memory 未启用"}
            </Tag>
            <Tag color={publishedPythonRuntimeSettings?.enabled ? "green" : "orange"}>
              {publishedPythonRuntimeSettings?.enabled ? "Python Runtime 已启用" : "Python Runtime 未启用"}
            </Tag>
            <Tag>{publishedVersion}</Tag>
            {isSettingsDirty ? <Tag color="orange">有未发布草稿</Tag> : <Tag color="green">与发布态一致</Tag>}
          </Space>
          <h1 className="admin-page-title">
            {view === "file" && selectedFile ? fileDisplayName(selectedFile) : view === "scope" && selectedScope ? scopeTitle(selectedScope) : "上下文与记忆"}
          </h1>
          <p className="admin-page-desc">
            {view === "file" && selectedScope
              ? `${scopeTitle(selectedScope)} 的 memory 文件`
              : view === "scope" && selectedScope
                ? scopeSubtitle(selectedScope)
                : "统一管理模型运行时上下文、企业资料注入和 Codex memory。"}
          </p>
        </div>
        <Space>
          {view === "file" && isFileDirty ? <Tag color="gold">● 未保存改动</Tag> : null}
          <Button
            icon={<RefreshCcw size={16} />}
            onClick={() => {
              void loadSettings();
              void loadScopes();
              void loadRuns();
              void loadBackfillRuns();
              void loadPythonRuntimeStatus();
              if (selectedScopeId) void loadFiles(selectedScopeId);
            }}
          >
            刷新
          </Button>
          {view === "file" ? (
            <Button
              type="primary"
              icon={<Save size={16} />}
              disabled={!fileContent || fileContent.truncated}
              loading={fileSaving}
              onClick={() => void handleSaveFile()}
            >
              保存文件
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<Send size={16} />}
              loading={settingsSaving}
              onClick={() => void handleSaveSettings(true)}
            >
              保存并发布
            </Button>
          )}
        </Space>
      </div>
    );
  }

  function renderSettingsPanel() {
    return (
      <div className="admin-card" style={{ padding: 20, height: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <BrainCircuit size={20} />
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              全局记忆策略
            </Typography.Title>
            <Typography.Text type="secondary">发布后对所有 Codex 渠道生效</Typography.Text>
          </div>
        </div>
        {settingsError ? <Alert type="error" showIcon message={settingsError} style={{ marginBottom: 12 }} /> : null}
        {settingsLoading ? (
          <div style={{ padding: 36, textAlign: "center" }}>
            <Spin />
          </div>
        ) : (
          <Space direction="vertical" size={18} style={{ width: "100%" }}>
            <div>
              <SettingSwitch
                title="启用 Codex Memory"
                description="关闭后不会向 Codex 注入 memory 配置。"
                checked={settings.enabled}
                onChange={(enabled) => updateSetting("enabled", enabled)}
              />
              <SettingSwitch
                title="读取已有记忆"
                description="新旧会话都会读取当前记忆空间内的 memory。"
                checked={settings.useMemories}
                onChange={(useMemories) => updateSetting("useMemories", useMemories)}
              />
              <SettingSwitch
                title="自动生成记忆"
                description="由统一生成引擎把稳定偏好写入 Codex-compatible memory 文件。"
                checked={settings.generateMemories}
                onChange={(generateMemories) => updateSetting("generateMemories", generateMemories)}
              />
              <div style={{ padding: "14px 0", borderBottom: "1px solid var(--admin-color-border-subtle, rgba(15, 23, 42, 0.08))" }}>
                <Typography.Text strong>生成方式</Typography.Text>
                <Typography.Text type="secondary" style={{ display: "block", marginTop: 4 }}>
                  Agent Studio 异步生成不依赖 Codex 原生 rollout eligibility；Codex 原生模式只保留官方后台生成。
                </Typography.Text>
                <Select
                  value={settings.generationEngine}
                  onChange={(value) => updateSetting("generationEngine", value as CodexMemorySettings["generationEngine"])}
                  options={[
                    { label: "Agent Studio 异步生成", value: "agent_studio" },
                    { label: "Codex 原生生成", value: "codex_native" }
                  ]}
                  style={{ width: "100%", marginTop: 10 }}
                />
              </div>
              <SettingSwitch
                title="外部上下文时暂停生成"
                description="带知识库、工单或文件上下文时避免把临时信息沉淀为长期记忆。"
                checked={settings.disableOnExternalContext}
                onChange={(disableOnExternalContext) => updateSetting("disableOnExternalContext", disableOnExternalContext)}
              />
            </div>

            {settings.generationEngine === "agent_studio" ? (
              <div
                style={{
                  border: "1px solid var(--admin-color-border)",
                  borderRadius: 12,
                  padding: 14,
                  background: "var(--admin-color-bg-subtle, #f8fafc)"
                }}
              >
                <Typography.Text strong>LLM API 配置</Typography.Text>
                <Typography.Text type="secondary" style={{ display: "block", marginTop: 4 }}>
                  默认复用当前 Codex Provider；如果当前是本地 ChatGPT 登录，需要配置 API key 环境变量才会生成记忆。
                </Typography.Text>
                <Row gutter={[12, 12]} style={{ marginTop: 10 }}>
                  <Col xs={24} md={12}>
                    <Typography.Text strong>Provider</Typography.Text>
                    <Select
                      value={settings.llmProvider}
                      onChange={(value) => updateSetting("llmProvider", value as CodexMemorySettings["llmProvider"])}
                      options={[
                        { label: "复用当前 Codex Provider", value: "active_codex_provider" },
                        { label: "OpenAI Responses API", value: "openai_responses" },
                        { label: "OpenAI-compatible API", value: "openai_compatible" },
                        { label: "Azure OpenAI", value: "azure_openai" }
                      ]}
                      style={{ width: "100%", marginTop: 8 }}
                    />
                  </Col>
                  <Col xs={24} md={12}>
                    <Typography.Text strong>API 模式</Typography.Text>
                    <Select
                      value={settings.llmApiMode}
                      onChange={(value) => updateSetting("llmApiMode", value as CodexMemorySettings["llmApiMode"])}
                      options={[
                        { label: "自动选择", value: "auto" },
                        { label: "Responses API", value: "responses" },
                        { label: "Chat Completions", value: "chat_completions" }
                      ]}
                      style={{ width: "100%", marginTop: 8 }}
                    />
                  </Col>
                  <Col xs={24} md={12}>
                    <Typography.Text strong>模型 / Azure 部署名</Typography.Text>
                    <Input
                      value={settings.llmModel}
                      placeholder="gpt-5.4"
                      onChange={(event) => updateSetting("llmModel", event.target.value)}
                      style={{ marginTop: 8 }}
                    />
                  </Col>
                  <Col xs={24} md={12}>
                    <Typography.Text strong>Base URL</Typography.Text>
                    <Input
                      value={settings.llmBaseUrl}
                      placeholder="留空则使用当前 Provider 或 OpenAI 默认地址"
                      onChange={(event) => updateSetting("llmBaseUrl", event.target.value)}
                      style={{ marginTop: 8 }}
                    />
                  </Col>
                  <Col xs={24} md={12}>
                    <Typography.Text strong>API key</Typography.Text>
                    <Input.Password
                      value={llmApiKeyDraft}
                      placeholder={llmSecretState.hasApiKey ? "已保存，留空则不修改" : "请输入 API key"}
                      disabled={clearLlmApiKey}
                      onChange={(event) => setLlmApiKeyDraft(event.target.value)}
                      style={{ marginTop: 8 }}
                    />
                    <Typography.Text type="secondary" style={{ display: "block", marginTop: 4, fontSize: 12 }}>
                      {llmSecretState.hasApiKey
                        ? `已保存 API key${llmSecretState.rotatedAt ? `，更新时间 ${formatLocalTime(llmSecretState.rotatedAt)}` : ""}`
                        : "尚未保存 API key"}
                    </Typography.Text>
                  </Col>
                  <Col xs={24} md={12}>
                    <Typography.Text strong>API key 环境变量</Typography.Text>
                    <Input
                      value={settings.llmApiKeyEnv}
                      placeholder="CODEX_API_KEY"
                      onChange={(event) => updateSetting("llmApiKeyEnv", event.target.value)}
                      style={{ marginTop: 8 }}
                    />
                  </Col>
                  <Col xs={24}>
                    <Checkbox
                      checked={clearLlmApiKey}
                      onChange={(event) => {
                        setClearLlmApiKey(event.target.checked);
                        if (event.target.checked) setLlmApiKeyDraft("");
                      }}
                    >
                      清空当前保存的 API key
                    </Checkbox>
                  </Col>
                  {settings.llmProvider === "azure_openai" ? (
                    <Col xs={24} md={12}>
                      <Typography.Text strong>Azure API Version</Typography.Text>
                      <Input
                        value={settings.llmAzureApiVersion}
                        placeholder="2025-04-01-preview"
                        onChange={(event) => updateSetting("llmAzureApiVersion", event.target.value)}
                        style={{ marginTop: 8 }}
                      />
                    </Col>
                  ) : null}
                </Row>
              </div>
            ) : null}

            <Row gutter={[12, 12]}>
              <Col xs={24} md={12}>
                <SettingNumber
                  title="最低剩余额度"
                  description="低于该比例时不触发后台生成，避免挤占正常请求。"
                  value={settings.minRateLimitRemainingPercent}
                  min={0}
                  max={100}
                  suffix="%"
                  onChange={(value) => updateSetting("minRateLimitRemainingPercent", value)}
                />
              </Col>
              <Col xs={24} md={12}>
                <SettingNumber
                  title="rollout 空闲时间"
                  description="会话空闲达到该小时数后才允许异步整理。"
                  value={settings.minRolloutIdleHours}
                  min={0}
                  max={720}
                  suffix="小时"
                  onChange={(value) => updateSetting("minRolloutIdleHours", value)}
                />
              </Col>
              <Col xs={24} md={12}>
                <SettingNumber
                  title="rollout 最大年龄"
                  description="超过该天数的 rollout 不再参与自动整理。"
                  value={settings.maxRolloutAgeDays}
                  min={1}
                  max={3650}
                  suffix="天"
                  onChange={(value) => updateSetting("maxRolloutAgeDays", value)}
                />
              </Col>
              <Col xs={24} md={12}>
                <SettingNumber
                  title="未使用保留时间"
                  description="长期未使用的 memory 可被 Codex 原生机制忽略。"
                  value={settings.maxUnusedDays}
                  min={1}
                  max={3650}
                  suffix="天"
                  onChange={(value) => updateSetting("maxUnusedDays", value)}
                />
              </Col>
            </Row>

            <Alert
              type={settings.enabled ? "success" : "warning"}
              showIcon
              message={settings.enabled ? "发布后所有 Codex 渠道统一启用 memory" : "发布后所有 Codex 渠道统一关闭 memory"}
              description={
                settings.generationEngine === "agent_studio"
                  ? "读取仍走 Codex 原生 memory 文件，生成由 Agent Studio 统一异步完成。Zendesk 等集成渠道按集成实例和智能体共享记忆，站内用户按用户和智能体共享记忆。"
                  : "读取和生成都交给 Codex 原生机制。Zendesk 等集成渠道按集成实例和智能体共享记忆，站内用户按用户和智能体共享记忆。"
              }
            />

            <Space wrap>
              <Button icon={<Save size={16} />} loading={settingsSaving} onClick={() => void handleSaveSettings(false)}>
                保存草稿
              </Button>
              <Button type="primary" icon={<Send size={16} />} loading={settingsSaving} onClick={() => void handleSaveSettings(true)}>
                保存并发布
              </Button>
              <Tag color={isSettingsDirty ? "orange" : "green"}>{isSettingsDirty ? "有未发布差异" : "与发布态一致"}</Tag>
            </Space>
          </Space>
        )}
      </div>
    );
  }

  function pythonCapabilityColor(status: PythonRuntimeCapabilityStatus["status"]) {
    if (status === "ready") return "green";
    if (status === "partial") return "orange";
    return "red";
  }

  function pythonCapabilityLabel(status: PythonRuntimeCapabilityStatus["status"]) {
    if (status === "ready") return "可用";
    if (status === "partial") return "部分可用";
    return "缺失";
  }

  function renderPythonRuntimePanel() {
    const capabilities = pythonRuntimeStatus?.capabilities ?? [];
    const readyCapabilityCount = capabilities.filter((capability) => capability.status === "ready").length;
    const duplicateArtifacts = pythonRuntimeStatus?.duplicateArtifacts;
    const duplicateCount =
      (duplicateArtifacts?.sessionVirtualenvCount ?? 0) +
      (duplicateArtifacts?.argosCacheCount ?? 0) +
      (duplicateArtifacts?.argosDataCount ?? 0);

    return (
      <div style={{ width: "100%", marginTop: 16 }}>
        {pythonRuntimeError ? <Alert type="error" showIcon message={pythonRuntimeError} style={{ marginBottom: 12 }} /> : null}
        <div className="codex-memory-python-grid">
          <div className="admin-card" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <FileText size={20} />
              <div>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  共享 Python Runtime
                </Typography.Title>
                <Typography.Text type="secondary">发布后所有 Codex 渠道统一复用常用 Python 包和缓存。</Typography.Text>
              </div>
            </div>

            <SettingSwitch
              title="启用共享运行时"
              description="开启后，新旧 thread 的新请求都会注入共享 Python 包路径和缓存目录。"
              checked={pythonRuntimeSettings.enabled}
              onChange={(enabled) => updatePythonRuntimeSetting("enabled", enabled)}
            />
            <SettingSwitch
              title="优先复用共享包"
              description="提示 Codex 先尝试直接 import 常用库，减少重复建 venv 和 pip install。"
              checked={pythonRuntimeSettings.preferSharedPackages}
              onChange={(preferSharedPackages) => updatePythonRuntimeSetting("preferSharedPackages", preferSharedPackages)}
            />
            <SettingSwitch
              title="注入运行提示"
              description="把共享运行时使用方式作为隐藏运行提示传给 Codex，不展示给最终用户。"
              checked={pythonRuntimeSettings.injectRuntimeHint}
              onChange={(injectRuntimeHint) => updatePythonRuntimeSetting("injectRuntimeHint", injectRuntimeHint)}
            />
            <SettingSwitch
              title="会话独立临时目录"
              description="每个 workspace 使用自己的临时目录，避免多用户并发任务互相覆盖临时文件。"
              checked={pythonRuntimeSettings.sessionTmpEnabled}
              onChange={(sessionTmpEnabled) => updatePythonRuntimeSetting("sessionTmpEnabled", sessionTmpEnabled)}
            />
            <div style={{ paddingTop: 14 }}>
              <SettingNumber
                title="会话临时产物保留"
                description="用于后续安全清理 session 内重复 venv、Argos 缓存等临时产物。"
                value={pythonRuntimeSettings.cleanupSessionArtifactsOlderThanDays}
                min={1}
                max={3650}
                suffix="天"
                onChange={(value) => updatePythonRuntimeSetting("cleanupSessionArtifactsOlderThanDays", value)}
              />
            </div>

            <Space wrap style={{ marginTop: 18 }}>
              <Button icon={<Save size={16} />} loading={settingsSaving} onClick={() => void handleSaveSettings(false)}>
                保存草稿
              </Button>
              <Button type="primary" icon={<Send size={16} />} loading={settingsSaving} onClick={() => void handleSaveSettings(true)}>
                保存并发布
              </Button>
              <Tag color={isPythonRuntimeSettingsDirty ? "orange" : "green"}>
                {isPythonRuntimeSettingsDirty ? "有未发布差异" : "与发布态一致"}
              </Tag>
            </Space>
          </div>

          <div className="admin-card" style={{ padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  运行状态
                </Typography.Title>
                <Typography.Text type="secondary">检查生产共享 runtime 是否就绪，以及是否仍有重复会话环境。</Typography.Text>
              </div>
              <Button icon={<RefreshCcw size={16} />} loading={pythonRuntimeLoading} onClick={() => void loadPythonRuntimeStatus()}>
                刷新状态
              </Button>
            </div>

            <Spin spinning={pythonRuntimeLoading}>
              <div className="codex-memory-python-status-grid">
                <MemoryMetric
                  label="Python"
                  value={pythonRuntimeStatus?.pythonVersion?.replace(/^Python\s+/i, "") || "未检测"}
                  hint={pythonRuntimeStatus?.enabled ? "共享运行时已启用" : "共享运行时未启用"}
                />
                <MemoryMetric
                  label="关键能力"
                  value={`${readyCapabilityCount}/${Math.max(capabilities.length, 1)}`}
                  hint="表格、文档、图片、翻译"
                />
                <MemoryMetric
                  label="共享包占用"
                  value={formatBytes(pythonRuntimeStatus?.runtimeBytes ?? 0)}
                  hint={pythonRuntimeStatus?.runtimeExists ? "稳定目录" : "尚未初始化"}
                />
                <MemoryMetric
                  label="重复环境"
                  value={String(duplicateCount)}
                  hint={duplicateArtifacts?.scanned === false ? "扫描未完成" : "session 内临时产物"}
                />
              </div>

              <div className="codex-memory-capability-grid">
                {capabilities.map((capability) => (
                  <div key={capability.key} className="codex-memory-capability-card">
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                      <Typography.Text strong>{capability.label}</Typography.Text>
                      <Tag color={pythonCapabilityColor(capability.status)}>{pythonCapabilityLabel(capability.status)}</Tag>
                    </div>
                    <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
                      {capability.available.length > 0
                        ? `已就绪：${capability.available.join("、")}`
                        : "暂无可用共享包"}
                    </Typography.Text>
                    {capability.missing.length > 0 ? (
                      <Typography.Text type="secondary" style={{ display: "block", marginTop: 4 }}>
                        待补齐：{capability.missing.join("、")}
                      </Typography.Text>
                    ) : null}
                  </div>
                ))}
                {capabilities.length === 0 ? <Empty description="暂无运行状态，点击刷新状态" /> : null}
              </div>

              <Alert
                type={duplicateCount > 0 ? "warning" : "success"}
                showIcon
                style={{ marginTop: 16 }}
                message={duplicateCount > 0 ? "仍发现会话级重复 Python 产物" : "未发现明显重复 Python 产物"}
                description={
                  duplicateCount > 0
                    ? `扫描到 ${duplicateArtifacts?.sessionVirtualenvCount ?? 0} 个会话虚拟环境、${duplicateArtifacts?.argosCacheCount ?? 0} 个翻译缓存、${duplicateArtifacts?.argosDataCount ?? 0} 个翻译数据目录。后续可按保留天数做安全清理。`
                    : "新任务会优先复用共享 runtime；临时目录仍按 workspace 隔离，不影响多用户并发。"
                }
              />
            </Spin>
          </div>
        </div>
      </div>
    );
  }

  function renderEnterpriseContextPanel() {
    const selectedPreviewUser = previewUsers.find((user) => user.id === previewUserId) ?? null;
    const selectedPreviewAgent = previewAgentModes.find((mode) => mode.id === previewAgentModeId) ?? null;
    const overrideByAgent = new Map(enterpriseSettings.agentOverrides.map((item) => [item.agentModeId, item.enabled]));
    const overrideColumns: ColumnsType<AgentModeRecord> = [
      {
        title: "智能体",
        key: "agent",
        sorter: (a, b) => compareText(agentModeLabel(a), agentModeLabel(b)),
        render: (_: unknown, mode: AgentModeRecord) => (
          <Space direction="vertical" size={2}>
            <Typography.Text strong>{agentModeLabel(mode)}</Typography.Text>
            <Typography.Text type="secondary">{mode.status === "active" ? "启用中" : "停用"}</Typography.Text>
          </Space>
        )
      },
      {
        title: "企业上下文",
        key: "override",
        width: 180,
        render: (_: unknown, mode: AgentModeRecord) => (
          <Select
            value={overrideByAgent.has(mode.id) ? String(overrideByAgent.get(mode.id)) : "inherit"}
            onChange={(value) => updateAgentOverride(mode.id, value === "inherit" ? null : value === "true")}
            options={[
              { label: "继承全局", value: "inherit" },
              { label: "单独启用", value: "true" },
              { label: "单独关闭", value: "false" }
            ]}
            style={{ width: "100%" }}
          />
        )
      }
    ];

    return (
      <div style={{ width: "100%", marginTop: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={10}>
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <div className="admin-card" style={{ padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                  <Building2 size={20} />
                  <div>
                    <Typography.Title level={4} style={{ margin: 0 }}>
                      企业上下文策略
                    </Typography.Title>
                    <Typography.Text type="secondary">发布后对选中 Codex 渠道生效，运行失败时默认跳过。</Typography.Text>
                  </div>
                </div>
                <SettingSwitch
                  title="启用企业上下文注入"
                  description="开启后，系统会把当前用户的企业身份、部门和岗位作为隐藏运行时上下文传给 Codex。"
                  checked={enterpriseSettings.enabled}
                  onChange={(enabled) => updateEnterpriseSetting("enabled", enabled)}
                />
                <SettingSwitch
                  title="注入失败时跳过"
                  description="企业资料缺失或解析失败时继续问答，不阻塞用户请求。"
                  checked={enterpriseSettings.failOpen}
                  onChange={(failOpen) => updateEnterpriseSetting("failOpen", failOpen)}
                />
                <div style={{ padding: "12px 0" }}>
                  <Typography.Text strong>最大注入长度</Typography.Text>
                  <Typography.Text type="secondary" style={{ display: "block", marginTop: 4 }}>
                    控制额外 prompt 体积，避免企业资料挤占上下文窗口。
                  </Typography.Text>
                  <InputNumber
                    min={300}
                    max={4000}
                    value={enterpriseSettings.maxPromptChars}
                    addonAfter="字符"
                    onChange={(value) => updateEnterpriseSetting("maxPromptChars", Number(value ?? 1200))}
                    style={{ width: 180, marginTop: 8 }}
                  />
                </div>
              </div>

              <div className="admin-card" style={{ padding: 20 }}>
                <Typography.Title level={5} style={{ marginTop: 0 }}>
                  渠道范围
                </Typography.Title>
                <Typography.Text type="secondary">Zendesk 和外部 API 默认关闭，避免共享渠道误注入个人资料。</Typography.Text>
                <div style={{ marginTop: 12 }}>
                  {(Object.keys(ENTERPRISE_CHANNEL_LABELS) as EnterpriseContextChannel[]).map((channel) => (
                    <SettingSwitch
                      key={channel}
                      title={ENTERPRISE_CHANNEL_LABELS[channel]}
                      description={
                        channel === "zendesk" || channel === "openai_compatible_api"
                          ? "仅在运行时能识别具体用户时才会注入。"
                          : "当前用户明确可识别时注入。"
                      }
                      checked={enterpriseSettings.channels[enterpriseChannelKey(channel)]}
                      onChange={(enabled) => updateEnterpriseChannel(channel, enabled)}
                    />
                  ))}
                </div>
              </div>
            </Space>
          </Col>

          <Col xs={24} xl={14}>
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <div className="admin-card" style={{ padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                  <ShieldCheck size={20} />
                  <div>
                    <Typography.Title level={4} style={{ margin: 0 }}>
                      字段范围
                    </Typography.Title>
                    <Typography.Text type="secondary">只注入用户友好的企业信息，不注入内部 ID、目录路径或原始 JSON。</Typography.Text>
                  </div>
                </div>
                <Row gutter={[12, 12]}>
                  {(Object.keys(ENTERPRISE_FIELD_LABELS) as EnterpriseContextFieldKey[]).map((field) => (
                    <Col xs={24} md={12} key={field}>
                      <div
                        style={{
                          border: "1px solid var(--admin-color-border)",
                          borderRadius: 10,
                          padding: 12,
                          minHeight: 92,
                          background: enterpriseSettings.fields[field] ? "rgba(22, 119, 255, 0.04)" : "var(--admin-color-surface)"
                        }}
                      >
                        <Checkbox
                          checked={enterpriseSettings.fields[field]}
                          onChange={(event) => updateEnterpriseField(field, event.target.checked)}
                        >
                          <Typography.Text strong>{ENTERPRISE_FIELD_LABELS[field].title}</Typography.Text>
                        </Checkbox>
                        <Typography.Text type="secondary" style={{ display: "block", marginTop: 6, paddingLeft: 24 }}>
                          {ENTERPRISE_FIELD_LABELS[field].description}
                        </Typography.Text>
                      </div>
                    </Col>
                  ))}
                </Row>
              </div>

              <div className="admin-card" style={{ padding: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 16 }}>
                  <div>
                    <Typography.Title level={4} style={{ margin: 0 }}>
                      预览最终注入内容
                    </Typography.Title>
                    <Typography.Text type="secondary">使用当前页面草稿生成预览，不需要先发布。</Typography.Text>
                  </div>
                  <Button icon={<RefreshCcw size={16} />} onClick={() => void loadEnterprisePreview()} loading={enterprisePreviewLoading}>
                    生成预览
                  </Button>
                </div>
                <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
                  <Col xs={24} md={8}>
                    <Typography.Text strong>渠道</Typography.Text>
                    <Select
                      value={previewChannel}
                      onChange={(value) => setPreviewChannel(value as EnterpriseContextChannel)}
                      options={(Object.keys(ENTERPRISE_CHANNEL_LABELS) as EnterpriseContextChannel[]).map((channel) => ({
                        label: ENTERPRISE_CHANNEL_LABELS[channel],
                        value: channel
                      }))}
                      style={{ width: "100%", marginTop: 8 }}
                    />
                  </Col>
                  <Col xs={24} md={8}>
                    <Typography.Text strong>用户</Typography.Text>
                    <Select
                      showSearch
                      value={previewUserId || undefined}
                      placeholder="选择用户"
                      onChange={(value) => setPreviewUserId(value)}
                      optionFilterProp="label"
                      options={previewUsers.map((user) => ({
                        value: user.id,
                        label: `${userLabel(user)} ${user.synced.email ?? ""}`.trim()
                      }))}
                      style={{ width: "100%", marginTop: 8 }}
                    />
                    {selectedPreviewUser ? (
                      <Typography.Text type="secondary" style={{ display: "block", marginTop: 4 }} ellipsis>
                        {userSubtitle(selectedPreviewUser)}
                      </Typography.Text>
                    ) : null}
                  </Col>
                  <Col xs={24} md={8}>
                    <Typography.Text strong>智能体</Typography.Text>
                    <Select
                      showSearch
                      value={previewAgentModeId || undefined}
                      placeholder="选择智能体"
                      onChange={(value) => setPreviewAgentModeId(value)}
                      optionFilterProp="label"
                      options={previewAgentModes.map((mode) => ({
                        value: mode.id,
                        label: agentModeLabel(mode)
                      }))}
                      style={{ width: "100%", marginTop: 8 }}
                    />
                    {selectedPreviewAgent ? (
                      <Typography.Text type="secondary" style={{ display: "block", marginTop: 4 }} ellipsis>
                        {selectedPreviewAgent.status === "active" ? "启用中" : "停用"}
                      </Typography.Text>
                    ) : null}
                  </Col>
                </Row>
                {enterprisePreview?.enabled ? (
                  <Alert
                    type="success"
                    showIcon
                    message={`会注入企业上下文${enterprisePreview.hash ? ` · ${enterprisePreview.hash}` : ""}`}
                    style={{ marginBottom: 12 }}
                  />
                ) : enterprisePreview ? (
                  <Alert
                    type="warning"
                    showIcon
                    message={ENTERPRISE_PREVIEW_REASON_LABELS[enterprisePreview.reason || ""] ?? enterprisePreview.reason ?? "不会注入"}
                    style={{ marginBottom: 12 }}
                  />
                ) : (
                  <Alert type="info" showIcon message="点击“生成预览”查看 Codex 实际收到的企业上下文。" style={{ marginBottom: 12 }} />
                )}
                <RawTextPreview
                  text={enterprisePreview?.markdown || "尚未生成预览。"}
                  maxHeight={320}
                  style={{ minHeight: 220 }}
                />
              </div>
            </Space>
          </Col>
        </Row>

        <div className="admin-card" style={{ padding: 20, marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <GitBranch size={20} />
            <div>
              <Typography.Title level={4} style={{ margin: 0 }}>
                智能体覆盖
              </Typography.Title>
              <Typography.Text type="secondary">默认继承全局策略；仅在某个智能体不适合注入企业资料时单独关闭。</Typography.Text>
            </div>
          </div>
          <Table
            rowKey="id"
            columns={overrideColumns}
            dataSource={previewAgentModes}
            pagination={{ pageSize: 6, showSizeChanger: false }}
            scroll={{ x: 560 }}
            locale={{ emptyText: <Empty description="暂无智能体" /> }}
          />
        </div>
      </div>
    );
  }

  function renderSpacesPanel() {
    return (
      <div className="admin-card codex-memory-spaces-card" style={{ padding: 20, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap" }}>
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              记忆空间
            </Typography.Title>
            <Typography.Text type="secondary">按用户、智能体和集成归属查看，不暴露底层目录。</Typography.Text>
          </div>
          <Space wrap>
            <Segmented
              value={scopeKind}
              onChange={(value) => {
                const next = value as CodexMemoryScopeKind | "all";
                setScopeKind(next);
                void loadScopes(scopeQuery, next);
              }}
              options={[
                { label: "全部", value: "all" },
                { label: "用户", value: "user_agent" },
                { label: "集成", value: "integration_agent" },
                { label: "旧会话", value: "legacy_thread" }
              ]}
            />
            <Input
              allowClear
              prefix={<Search size={14} />}
              placeholder="搜索用户、智能体或集成"
              value={scopeQuery}
              onChange={(event) => setScopeQuery(event.target.value)}
              onPressEnter={() => void loadScopes()}
              style={{ width: 280, maxWidth: "100%" }}
            />
            <Button icon={<RefreshCcw size={16} />} onClick={() => void loadScopes()} />
          </Space>
        </div>

        {scopesError ? <Alert type="error" showIcon message={scopesError} style={{ marginBottom: 12 }} /> : null}
        <Table
          rowKey="id"
          loading={scopesLoading}
          columns={scopeColumns}
          dataSource={scopes}
          scroll={{ x: 560 }}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          locale={{ emptyText: <Empty description="暂无记忆空间" /> }}
          onRow={(scope) => ({
            onClick: () => openScope(scope),
            style: { cursor: "pointer" }
          })}
        />
      </div>
    );
  }

  function renderBackfillPanel() {
    const latestRun = backfillRuns[0] ?? null;
    const runningRun = backfillRuns.find((run) => run.status === "running" || run.status === "queued") ?? null;
    const previewRows = backfillPreview?.byChannel ?? [];
    return (
      <div className="codex-memory-backfill-panel">
        <div className="codex-memory-backfill-grid">
          <div className="admin-card" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <History size={20} />
              <div>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  回填范围
                </Typography.Title>
                <Typography.Text type="secondary">
                  对历史 user/assistant 对话轮次做记忆检测，符合长期记忆标准时才写入。
                </Typography.Text>
              </div>
            </div>

            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <div>
                <Typography.Text strong>渠道</Typography.Text>
                <Checkbox.Group
                  value={backfillChannels}
                  options={BACKFILL_CHANNEL_OPTIONS}
                  onChange={(values) => setBackfillChannels(values.map(String))}
                  style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8, marginTop: 10 }}
                />
              </div>

              <Row gutter={[12, 12]}>
                <Col xs={24} md={12}>
                  <Typography.Text strong>开始时间</Typography.Text>
                  <Input
                    type="datetime-local"
                    value={backfillCreatedFrom}
                    onChange={(event) => setBackfillCreatedFrom(event.target.value)}
                    style={{ marginTop: 8 }}
                  />
                </Col>
                <Col xs={24} md={12}>
                  <Typography.Text strong>结束时间</Typography.Text>
                  <Input
                    type="datetime-local"
                    value={backfillCreatedTo}
                    onChange={(event) => setBackfillCreatedTo(event.target.value)}
                    style={{ marginTop: 8 }}
                  />
                </Col>
              </Row>

              <Row gutter={[12, 12]}>
                <Col xs={24} md={12}>
                  <Typography.Text strong>单次上限</Typography.Text>
                  <Typography.Text type="secondary" style={{ display: "block", marginTop: 4 }}>
                    控制本次最多检测多少个历史轮次。
                  </Typography.Text>
                  <InputNumber
                    min={1}
                    max={20000}
                    value={backfillLimit}
                    onChange={(value) => setBackfillLimit(value === null ? null : Number(value))}
                    style={{ width: "100%", marginTop: 8 }}
                  />
                </Col>
                <Col xs={24} md={12}>
                  <Typography.Text strong>演练模式</Typography.Text>
                  <Typography.Text type="secondary" style={{ display: "block", marginTop: 4 }}>
                    只创建演练记录，不调用 LLM、不写 memory。
                  </Typography.Text>
                  <Switch checked={backfillDryRun} onChange={setBackfillDryRun} style={{ marginTop: 10 }} />
                </Col>
              </Row>

              <Alert
                type="info"
                showIcon
                message="回填使用公共记忆引擎"
                description="不会按渠道各自写入，Portal、Zendesk、钉钉、CREST 都走同一套判断、候选和写入逻辑。"
              />

              <Alert
                type="warning"
                showIcon
                message="不可检测的轮次会自动跳过"
                description={MISSING_INPUT_HELP}
              />

              <Space wrap>
                <Button icon={<Search size={16} />} loading={backfillPreviewLoading} onClick={() => void handlePreviewBackfill()}>
                  预估影响
                </Button>
                <Button
                  type="primary"
                  icon={<CirclePlay size={16} />}
                  loading={backfillStarting}
                  onClick={() => {
                    if (!backfillDryRun && (backfillPreview?.estimatedLlmCalls ?? 0) > 0) {
                      Modal.confirm({
                        title: "启动历史记忆回填？",
                        content: `预计调用 LLM 检测 ${backfillPreview?.estimatedLlmCalls ?? 0} 个历史轮次。任务将在后台顺序执行，可暂停或取消。`,
                        okText: "启动回填",
                        cancelText: "取消",
                        onOk: () => void handleStartBackfill()
                      });
                      return;
                    }
                    void handleStartBackfill();
                  }}
                >
                  启动回填
                </Button>
              </Space>
            </Space>
          </div>

          <div className="admin-card" style={{ padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap" }}>
              <div>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  回填进度
                </Typography.Title>
                <Typography.Text type="secondary">先看预估，再看最近后台任务的真实进度。</Typography.Text>
              </div>
              <Button icon={<RefreshCcw size={16} />} loading={backfillRunsLoading} onClick={() => void loadBackfillRuns()}>
                刷新任务
              </Button>
            </div>

            {backfillError ? <Alert type="error" showIcon message={backfillError} style={{ marginBottom: 12 }} /> : null}

            <div className="codex-memory-backfill-metrics">
              <MemoryMetric label="可检测轮次" value={String(backfillPreview?.readyItems ?? 0)} hint="预计调用 LLM" />
              <MemoryMetric label="已回填过" value={String(backfillPreview?.alreadyProcessed ?? 0)} hint="不会重复处理" />
              <MemoryMetric label="不可检测" value={String(backfillPreview?.skippedMissingInput ?? 0)} hint="自动跳过" />
              <MemoryMetric label="最近写入" value={String(latestRun?.writtenItems ?? 0)} hint={latestRun ? BACKFILL_STATUS_LABELS[latestRun.status] : "暂无任务"} />
            </div>

            {runningRun ? (
              <div
                style={{
                  border: "1px solid var(--admin-color-border)",
                  borderRadius: 10,
                  padding: 14,
                  marginTop: 16,
                  background: "rgba(22, 119, 255, 0.04)"
                }}
              >
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  <Space wrap>
                    <Tag color={BACKFILL_STATUS_COLORS[runningRun.status]}>{BACKFILL_STATUS_LABELS[runningRun.status]}</Tag>
                    <Typography.Text strong>{runningRun.name || "历史回填"}</Typography.Text>
                    <Typography.Text type="secondary">{backfillRangeLabel(runningRun.filters)}</Typography.Text>
                  </Space>
                  <Progress percent={backfillProgress(runningRun)} status="active" />
                  <Typography.Text type="secondary">
                    已处理 {runningRun.processedItems} / {runningRun.totalItems}，写入 {runningRun.writtenItems}，失败 {runningRun.failedItems}
                  </Typography.Text>
                </Space>
              </div>
            ) : (
              <Alert type="success" showIcon message="当前没有运行中的回填任务" style={{ marginTop: 16 }} />
            )}

            <div style={{ marginTop: 16 }}>
              <Typography.Title level={5} style={{ marginTop: 0 }}>
                渠道预估
              </Typography.Title>
              {previewRows.length > 0 ? (
                <div className="codex-memory-backfill-channel-list">
                  {previewRows.map((row) => (
                    <div key={row.channel} className="codex-memory-backfill-channel-row">
                      <div>
                        <Typography.Text strong>{channelDisplayName(row.channel)}</Typography.Text>
                        <Typography.Text type="secondary" style={{ display: "block" }}>
                          共 {row.totalPairs} 轮
                        </Typography.Text>
                      </div>
                      <Space size={6} wrap>
                        <Tag color="blue">可检测 {row.readyItems}</Tag>
                        <Tag>已回填 {row.alreadyProcessed}</Tag>
                        <Tag color="orange">不可检测 {row.skippedMissingInput}</Tag>
                      </Space>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty description="先点击“预估影响”" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </div>
          </div>
        </div>

        <div className="admin-card codex-memory-spaces-card" style={{ padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap" }}>
            <div>
              <Typography.Title level={4} style={{ margin: 0 }}>
                回填任务
              </Typography.Title>
              <Typography.Text type="secondary">
                任务按历史轮次顺序在后台执行，页面或浏览器关闭后也会继续；回来刷新即可查看进度，结果也会进入统计日志。
              </Typography.Text>
            </div>
            <Button icon={<RefreshCcw size={16} />} loading={backfillRunsLoading} onClick={() => void loadBackfillRuns()}>
              刷新
            </Button>
          </div>
          <Table
            rowKey="id"
            loading={backfillRunsLoading}
            columns={backfillColumns}
            dataSource={backfillRuns}
            scroll={{ x: 980 }}
            pagination={{ pageSize: 8, showSizeChanger: false }}
            locale={{ emptyText: <Empty description="暂无历史回填任务" /> }}
          />
        </div>
      </div>
    );
  }

  function renderRunLogsPanel() {
    return (
      <div className="admin-card codex-memory-run-log-card" style={{ padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap" }}>
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              统计日志
            </Typography.Title>
            <Typography.Text type="secondary">每轮 Codex 回复完成后的 memory 任务结果，用于判断为什么写入或跳过。</Typography.Text>
          </div>
          <Space wrap>
            <Select
              value={runsStatus}
              onChange={(value) => {
                const next = value as CodexMemoryRunStatus | "all";
                setRunsStatus(next);
                void loadRuns(runsQuery, next, runsChannel);
              }}
              options={[
                { label: "全部结果", value: "all" },
                ...Object.entries(RUN_STATUS_LABELS).map(([value, label]) => ({ value, label }))
              ]}
              style={{ width: 170 }}
            />
            <Input
              allowClear
              placeholder="渠道，如 portal / zendesk"
              value={runsChannel}
              onChange={(event) => setRunsChannel(event.target.value)}
              onPressEnter={() => void loadRuns()}
              style={{ width: 190, maxWidth: "100%" }}
            />
            <Input
              allowClear
              prefix={<Search size={14} />}
              placeholder="搜索用户、智能体、原因或线程"
              value={runsQuery}
              onChange={(event) => setRunsQuery(event.target.value)}
              onPressEnter={() => void loadRuns()}
              style={{ width: 300, maxWidth: "100%" }}
            />
            <Button icon={<RefreshCcw size={16} />} onClick={() => void loadRuns()} />
          </Space>
        </div>

        <div className="codex-memory-overview-metrics" style={{ marginBottom: 16 }}>
          <MemoryMetric label="已写入" value={String(runsSummary.written)} hint="written" />
          <MemoryMetric label="无长期记忆" value={String(runsSummary.skipped_no_durable_memory)} hint="skipped_no_durable_memory" />
          <MemoryMetric label="不可检测" value={String(runsSummary.skipped_missing_input)} hint="skipped_missing_input" />
          <MemoryMetric label="失败" value={String(runsSummary.failed)} hint="failed" />
        </div>

        {runsError ? <Alert type="error" showIcon message={runsError} style={{ marginBottom: 12 }} /> : null}
        <Table
          rowKey="id"
          loading={runsLoading}
          columns={runColumns}
          dataSource={runs}
          scroll={{ x: 1180 }}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          locale={{ emptyText: <Empty description="暂无 memory 任务日志" /> }}
        />
        <Alert type="info" showIcon message="不可检测说明" description={MISSING_INPUT_HELP} style={{ marginTop: 12 }} />
      </div>
    );
  }

  function renderOverview() {
    const enabledChannels = (Object.keys(ENTERPRISE_CHANNEL_LABELS) as EnterpriseContextChannel[])
      .filter((channel) => enterpriseSettings.channels[enterpriseChannelKey(channel)])
      .map((channel) => ENTERPRISE_CHANNEL_LABELS[channel]);

    const overviewPanel = (
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={8}>
          <div className="admin-card" style={{ padding: 20, height: "100%" }}>
            <Space direction="vertical" size={14} style={{ width: "100%" }}>
              <Space>
                <Building2 size={20} />
                <Typography.Title level={4} style={{ margin: 0 }}>
                  企业上下文
                </Typography.Title>
                <Tag color={enterpriseSettings.enabled ? "green" : "orange"}>
                  {enterpriseSettings.enabled ? "草稿启用" : "草稿关闭"}
                </Tag>
              </Space>
              <Typography.Text type="secondary">
                为 Codex 注入当前用户的企业身份、部门岗位和汇报关系；默认不注入手机号、电话。
              </Typography.Text>
              <Space wrap>
                {enabledChannels.map((channel) => <Tag key={channel}>{channel}</Tag>)}
                {enabledChannels.length === 0 ? <Tag>未选择渠道</Tag> : null}
              </Space>
              <Alert
                type={enterpriseSettings.enabled ? "success" : "info"}
                showIcon
                message={enterpriseSettings.enabled ? "发布后选中渠道会注入企业上下文" : "当前草稿关闭企业上下文注入"}
                description="真正运行时只读取发布态；预览可以使用当前草稿提前确认注入文本。"
              />
            </Space>
          </div>
        </Col>
        <Col xs={24} xl={8}>
          <div className="admin-card" style={{ padding: 20, height: "100%" }}>
            <Space direction="vertical" size={14} style={{ width: "100%" }}>
              <Space>
                <BrainCircuit size={20} />
                <Typography.Title level={4} style={{ margin: 0 }}>
                  长期记忆
                </Typography.Title>
                <Tag color={settings.enabled ? "green" : "orange"}>
                  {settings.enabled ? "草稿启用" : "草稿关闭"}
                </Tag>
              </Space>
              <Typography.Text type="secondary">
                Codex-compatible memory 继续用于稳定偏好和长期流程；不会自动沉淀企业目录里的动态岗位资料。
              </Typography.Text>
              <Space wrap>
                <Tag>{settings.generationEngine === "agent_studio" ? "Agent Studio 生成" : "Codex 原生生成"}</Tag>
                <Tag>{settings.useMemories ? "读取已有记忆" : "不读取记忆"}</Tag>
                <Tag>{settings.generateMemories ? "允许生成" : "不生成"}</Tag>
              </Space>
              <Alert
                type={settings.enabled ? "success" : "info"}
                showIcon
                message={settings.enabled ? "发布后 Codex 渠道会读取 memory" : "当前草稿关闭 memory"}
                description="企业上下文和长期记忆是两个独立能力，配置入口合并但运行结构分离。"
              />
            </Space>
          </div>
        </Col>
        <Col xs={24} xl={8}>
          <div className="admin-card" style={{ padding: 20, height: "100%" }}>
            <Space direction="vertical" size={14} style={{ width: "100%" }}>
              <Space>
                <FileText size={20} />
                <Typography.Title level={4} style={{ margin: 0 }}>
                  Python 运行时
                </Typography.Title>
                <Tag color={pythonRuntimeSettings.enabled ? "green" : "orange"}>
                  {pythonRuntimeSettings.enabled ? "草稿启用" : "草稿关闭"}
                </Tag>
              </Space>
              <Typography.Text type="secondary">
                统一复用表格、文档、图片和翻译相关 Python 包，减少重复下载、重复建环境和磁盘膨胀。
              </Typography.Text>
              <Space wrap>
                <Tag>{pythonRuntimeSettings.preferSharedPackages ? "优先共享包" : "不强制共享包"}</Tag>
                <Tag>{pythonRuntimeSettings.sessionTmpEnabled ? "临时目录隔离" : "默认临时目录"}</Tag>
                <Tag>{pythonRuntimeStatus?.runtimeExists ? "共享目录已初始化" : "等待初始化"}</Tag>
              </Space>
              <Alert
                type={pythonRuntimeSettings.enabled ? "success" : "info"}
                showIcon
                message={pythonRuntimeSettings.enabled ? "发布后 Codex 会注入共享 Python Runtime" : "当前草稿关闭共享 Python Runtime"}
                description="这个能力只改变运行环境和内部提示，不改变用户对话入口和业务流程。"
              />
            </Space>
          </div>
        </Col>
      </Row>
    );

    return (
      <div style={{ width: "100%", marginTop: 16 }}>
        <div className="codex-memory-overview-metrics" style={{ marginBottom: 16 }}>
          <MemoryMetric
            label="企业上下文"
            value={publishedEnterpriseSettings?.enabled ? "已启用" : "未启用"}
            hint={`${enabledChannels.length} 个渠道草稿启用`}
          />
          <MemoryMetric label="记忆空间" value={String(scopes.length)} hint={`${scopeStats.userScopes} 用户 · ${scopeStats.integrationScopes} 集成`} />
          <MemoryMetric label="memory 文件" value={String(scopeStats.totalFiles)} hint="可查看、编辑、删除" />
          <MemoryMetric
            label="Python Runtime"
            value={publishedPythonRuntimeSettings?.enabled ? "已启用" : "未启用"}
            hint={pythonRuntimeStatus?.runtimeExists ? formatBytes(pythonRuntimeStatus.runtimeBytes) : "未初始化"}
          />
          <MemoryMetric
            label="发布状态"
            value={isSettingsDirty ? "有草稿" : "一致"}
            hint={publishedVersion}
          />
        </div>

        <Tabs
          className="codex-memory-main-tabs"
          activeKey={activeOverviewTab}
          onChange={setActiveOverviewTab}
          items={[
            { key: "overview", label: "概览", children: overviewPanel },
            { key: "enterprise", label: "企业上下文", children: renderEnterpriseContextPanel() },
            { key: "memory", label: "长期记忆", children: renderSettingsPanel() },
            { key: "python", label: "Python 运行时", children: renderPythonRuntimePanel() },
            { key: "spaces", label: "记忆空间", children: renderSpacesPanel() },
            { key: "backfill", label: "历史回填", children: renderBackfillPanel() },
            { key: "runs", label: "统计日志", children: renderRunLogsPanel() }
          ]}
        />
      </div>
    );
  }

  function renderScopeDetail() {
    if (!selectedScope) {
      return (
        <div className="admin-card" style={{ padding: 48, marginTop: 16 }}>
          <Empty description="请选择一个记忆空间" />
        </div>
      );
    }

    return (
      <div className="codex-memory-scope-grid" style={{ marginTop: 16 }}>
        <div className="codex-memory-grid-cell">
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <div className="admin-card" style={{ padding: 20 }}>
              <Space direction="vertical" size={14} style={{ width: "100%" }}>
                <Space size={8} wrap>
                  <Tag color={KIND_COLORS[selectedScope.kind]}>{KIND_LABELS[selectedScope.kind]}</Tag>
                  {scopeHealth(selectedScope) === "active" ? <Tag color="green">有记忆</Tag> : <Tag>暂无文件</Tag>}
                </Space>
                <div>
                  <Typography.Text type="secondary">归属</Typography.Text>
                  <Typography.Title level={5} style={{ margin: "4px 0 0" }}>
                    {ownerLabel(selectedScope)}
                  </Typography.Title>
                  {selectedScope.ownerEmail ? <Typography.Text type="secondary">{selectedScope.ownerEmail}</Typography.Text> : null}
                </div>
                <div>
                  <Typography.Text type="secondary">智能体</Typography.Text>
                  <Typography.Title level={5} style={{ margin: "4px 0 0" }}>
                    {agentLabel(selectedScope)}
                  </Typography.Title>
                </div>
                <Row gutter={[10, 10]}>
                  <Col span={12}>
                    <MemoryMetric label="文件" value={String(selectedScope.fileCount)} />
                  </Col>
                  <Col span={12}>
                    <MemoryMetric label="大小" value={formatBytes(selectedScope.totalBytes)} />
                  </Col>
                </Row>
                <div>
                  <Typography.Text type="secondary">最近更新</Typography.Text>
                  <Typography.Text style={{ display: "block", marginTop: 4 }}>
                    {formatLocalTime(selectedScope.latestModifiedAt)}
                  </Typography.Text>
                </div>
              </Space>
            </div>

            <div className="admin-card" style={{ padding: 20 }}>
              <Typography.Title level={5} style={{ marginTop: 0 }}>
                继承策略
              </Typography.Title>
              <Space direction="vertical" size={10}>
                <Space>
                  <CheckCircle2 size={16} color={settings.enabled ? "#16a34a" : "#f59e0b"} />
                  <Typography.Text>{settings.enabled ? "全局 Memory 已启用" : "全局 Memory 未启用"}</Typography.Text>
                </Space>
                <Space>
                  <CheckCircle2 size={16} color={settings.useMemories ? "#16a34a" : "#f59e0b"} />
                  <Typography.Text>{settings.useMemories ? "读取已有记忆" : "不读取已有记忆"}</Typography.Text>
                </Space>
                <Space>
                  <CheckCircle2 size={16} color={settings.generateMemories ? "#16a34a" : "#f59e0b"} />
                  <Typography.Text>{settings.generateMemories ? "允许自动生成" : "不自动生成"}</Typography.Text>
                </Space>
              </Space>
            </div>

            <div className="admin-card" style={{ padding: 20 }}>
              <Typography.Title level={5} style={{ marginTop: 0 }}>
                危险操作
              </Typography.Title>
              <Typography.Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
                清空只影响当前记忆空间，不会删除用户、智能体或会话记录。
              </Typography.Text>
              <Popconfirm
                title="清空当前记忆空间？"
                description="该操作会删除这个空间下的所有 memory 文件。"
                okText="清空"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={() => void handleClearScope()}
              >
                <Button danger icon={<Eraser size={16} />} block>
                  清空记忆
                </Button>
              </Popconfirm>
            </div>
          </Space>
        </div>

        <div className="codex-memory-grid-cell" style={{ height: "100%" }}>
          <Space direction="vertical" size={16} style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
            <div className="admin-card" style={{ padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
                <div>
                  <Typography.Title level={4} style={{ margin: 0 }}>
                    memory 文件
                  </Typography.Title>
                  <Typography.Text type="secondary">点击文件可预览，进入编辑页可修改 Markdown 内容。</Typography.Text>
                </div>
                <Button icon={<RefreshCcw size={16} />} onClick={() => void loadFiles(selectedScope.id)}>
                  刷新文件
                </Button>
              </div>
              <Table
                rowKey="path"
                loading={filesLoading}
                dataSource={files}
                columns={fileColumns}
                pagination={{ pageSize: 6, showSizeChanger: false }}
                locale={{ emptyText: <Empty description="这个空间暂无 memory 文件" /> }}
                onRow={(file) => ({
                  onClick: () => setSelectedFilePath(file.path),
                  style: {
                    cursor: "pointer",
                    background: file.path === selectedFilePath ? "rgba(22, 119, 255, 0.06)" : undefined
                  }
                })}
              />
            </div>

            <div className="admin-card" style={{ padding: 20, flex: 1, display: "flex", flexDirection: "column", minHeight: 320 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  marginBottom: 12,
                  opacity: fileLoading ? 0.45 : 1,
                  pointerEvents: fileLoading ? "none" : undefined,
                  transition: "opacity 0.2s ease"
                }}
              >
                <div>
                  <Typography.Title level={5} style={{ margin: 0 }}>
                    {selectedFile ? fileDisplayName(selectedFile) : "文件预览"}
                  </Typography.Title>
                  {selectedFile ? (
                    <Typography.Text type="secondary">
                      {fileExtension(selectedFile).toUpperCase()} · {formatBytes(selectedFile.bytes)} · {formatLocalTime(selectedFile.modifiedAt)}
                    </Typography.Text>
                  ) : null}
                </div>
                {selectedFile ? (
                  <Button icon={<PencilLine size={16} />} onClick={() => openFile(selectedFile)}>
                    编辑文件
                  </Button>
                ) : null}
              </div>
              {fileLoading ? (
                <div style={{ padding: 32, textAlign: "center", flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Spin />
                </div>
              ) : fileContent ? (
                <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                  {fileContent.truncated ? (
                    <Alert type="warning" showIcon message="文件过大，界面不加载内容预览" />
                  ) : isMarkdownFile(fileContent) ? (
                    <CodexMemoryMarkdownPreview text={fileDraft} style={{ flex: 1 }} />
                  ) : (
                    <RawTextPreview text={fileDraft} style={{ flex: 1 }} />
                  )}
                </div>
              ) : (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Empty description="选择一个 memory 文件查看内容" />
                </div>
              )}
            </div>
          </Space>
        </div>
      </div>
    );
  }

  function renderFileEditor() {
    if (!selectedScope || !selectedFile) {
      return (
        <div className="admin-card" style={{ padding: 48, marginTop: 16 }}>
          <Empty description="请选择一个 memory 文件" />
        </div>
      );
    }

    const editor = (
      <Input.TextArea
        value={fileDraft}
        onChange={(event) => setFileDraft(event.target.value)}
        disabled={fileContent?.truncated}
        className="codex-memory-editor-textarea"
        style={{ fontFamily: "var(--admin-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)" }}
      />
    );
    const preview = isMarkdownFile(selectedFile) ? (
      <CodexMemoryMarkdownPreview text={fileDraft} style={{ height: "100%" }} />
    ) : (
      <RawTextPreview text={fileDraft} style={{ height: "100%" }} />
    );
    const rawText = <RawTextPreview text={fileDraft} style={{ height: "100%" }} />;

    const isMD = isMarkdownFile(selectedFile);
    const tabItems = [
      {
        key: "edit",
        label: "编辑",
        children: <div className="codex-memory-editor-container">{editor}</div>
      },
      ...(isMD ? [
        {
          key: "preview",
          label: "预览",
          children: <div className="codex-memory-preview-container">{preview}</div>
        },
        {
          key: "split",
          label: "分屏",
          children: (
            <div className="codex-memory-editor-container">
              <Row gutter={[16, 16]} style={{ height: "100%", margin: 0 }}>
                <Col xs={24} xl={12} style={{ height: "100%", padding: 0 }}>
                  {editor}
                </Col>
                <Col xs={24} xl={12} style={{ height: "100%", padding: "0 0 0 16px" }}>
                  <div className="codex-memory-preview-container" style={{ height: "100%" }}>
                    {preview}
                  </div>
                </Col>
              </Row>
            </div>
          )
        }
      ] : []),
      {
        key: "raw",
        label: "原文",
        children: <div className="codex-memory-preview-container">{rawText}</div>
      }
    ];

    return (
      <div className="codex-memory-file-grid" style={{ marginTop: 16 }}>
        <div className="codex-memory-grid-cell" style={{ height: "100%" }}>
          <div className="admin-card" style={{ padding: 16, height: "100%", display: "flex", flexDirection: "column" }}>
            <Typography.Title level={5} style={{ marginTop: 0 }}>
              当前空间文件
            </Typography.Title>
            <Space className="codex-memory-scroll-list" direction="vertical" size={8} style={{ width: "100%", flex: 1, overflow: "auto" }}>
              {files.map((file) => (
                <Button
                  key={file.path}
                  type={file.path === selectedFilePath ? "primary" : "default"}
                  icon={<FileText size={14} />}
                  style={{ justifyContent: "flex-start", width: "100%", overflow: "hidden" }}
                  onClick={() => confirmSetFilePath(file.path)}
                >
                  <Typography.Text ellipsis style={{ color: file.path === selectedFilePath ? "inherit" : undefined }}>
                    {fileDisplayName(file)}
                  </Typography.Text>
                </Button>
              ))}
            </Space>
          </div>
        </div>
        <div className="codex-memory-grid-cell" style={{ height: "100%" }}>
          <div className="admin-card" style={{ padding: 20, height: "100%", display: "flex", flexDirection: "column" }}>
            {fileLoading ? (
              <div style={{ padding: 48, textAlign: "center", flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Spin />
              </div>
            ) : fileContent?.truncated ? (
              <Alert type="warning" showIcon message="文件过大，界面不加载内容，也不能直接编辑。" />
            ) : (
              <Tabs items={tabItems} className="codex-memory-tabs-stretch" />
            )}
          </div>
        </div>
        <div className="codex-memory-grid-cell" style={{ height: "100%" }}>
          <Space
            direction="vertical"
            size={16}
            style={{
              width: "100%",
              height: "100%",
              opacity: fileLoading ? 0.45 : 1,
              pointerEvents: fileLoading ? "none" : undefined,
              transition: "opacity 0.2s ease",
              display: "flex",
              flexDirection: "column"
            }}
          >
            <div className="admin-card" style={{ padding: 20 }}>
              <Typography.Title level={5} style={{ marginTop: 0 }}>
                文件信息
              </Typography.Title>
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                <div>
                  <Typography.Text type="secondary">文件名</Typography.Text>
                  <Typography.Text strong style={{ display: "block", marginTop: 4, wordBreak: "break-word" }}>
                    {fileDisplayName(selectedFile)}
                  </Typography.Text>
                </div>
                <div>
                  <Typography.Text type="secondary">类型</Typography.Text>
                  <Typography.Text style={{ display: "block", marginTop: 4 }}>
                    {fileExtension(selectedFile).toUpperCase()}
                  </Typography.Text>
                </div>
                <div>
                  <Typography.Text type="secondary">大小</Typography.Text>
                  <Typography.Text style={{ display: "block", marginTop: 4 }}>
                    {formatBytes(selectedFile.bytes)}
                  </Typography.Text>
                </div>
                <div>
                  <Typography.Text type="secondary">更新时间</Typography.Text>
                  <Typography.Text style={{ display: "block", marginTop: 4 }}>
                    {formatLocalTime(selectedFile.modifiedAt)}
                  </Typography.Text>
                </div>
              </Space>
            </div>

            <div className="admin-card" style={{ padding: 20 }}>
              <Typography.Title level={5} style={{ marginTop: 0 }}>
                操作
              </Typography.Title>
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                <Button
                  type="primary"
                  icon={<Save size={16} />}
                  block
                  disabled={!fileContent || fileContent.truncated}
                  loading={fileSaving}
                  onClick={() => void handleSaveFile()}
                >
                  保存文件
                </Button>
                <Popconfirm
                  title="删除这个记忆文件？"
                  description="删除后该记忆空间将不再读取这份 memory。"
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => void handleDeleteFile(selectedFile.path)}
                >
                  <Button danger icon={<Trash2 size={16} />} block>
                    删除文件
                  </Button>
                </Popconfirm>
              </Space>
            </div>
          </Space>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page-container codex-memory-page">
      {renderHeader()}
      {view === "overview" ? renderOverview() : view === "scope" ? renderScopeDetail() : renderFileEditor()}
    </div>
  );
}
