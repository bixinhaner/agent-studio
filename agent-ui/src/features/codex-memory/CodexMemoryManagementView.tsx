import {
  Alert,
  Button,
  Col,
  Empty,
  Input,
  InputNumber,
  Popconfirm,
  Row,
  Segmented,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message
} from "antd";
import {
  ArrowLeft,
  BrainCircuit,
  CheckCircle2,
  Eraser,
  Eye,
  FileText,
  PencilLine,
  RefreshCcw,
  Save,
  Search,
  Send,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";

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
  clearCodexMemoryScope,
  deleteCodexMemoryFile,
  fetchCodexMemoryFileContent,
  fetchCodexMemoryFiles,
  fetchCodexMemoryScopes,
  saveCodexMemoryFileContent
} from "./api";
import type {
  CodexMemoryFile,
  CodexMemoryFileContent,
  CodexMemoryScope,
  CodexMemoryScopeKind,
  CodexMemorySettings
} from "./types";

const DEFAULT_MEMORY_SETTINGS: CodexMemorySettings = {
  enabled: true,
  useMemories: true,
  generateMemories: true,
  disableOnExternalContext: true,
  minRateLimitRemainingPercent: 25,
  minRolloutIdleHours: 6,
  maxRolloutAgeDays: 30,
  maxUnusedDays: 30
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

function settingsChanged(left: CodexMemorySettings | null, right: CodexMemorySettings | null): boolean {
  if (!left || !right) return Boolean(left || right);
  return JSON.stringify(left) !== JSON.stringify(right);
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

function CodexMemoryMarkdownPreview(props: { text: string; maxHeight?: number }) {
  return (
    <div
      className="conversation-audit-markdown"
      style={{
        maxHeight: props.maxHeight ?? 520,
        overflow: "auto",
        padding: "2px 4px"
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
        style={{ width: "100%", marginTop: 8 }}
      />
    </div>
  );
}

function RawTextPreview(props: { text: string; maxHeight?: number }) {
  return (
    <pre
      style={{
        maxHeight: props.maxHeight ?? 420,
        overflow: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        margin: 0,
        border: "1px solid var(--admin-color-border)",
        borderRadius: 10,
        padding: 12,
        background: "var(--admin-color-bg-subtle, #f8fafc)",
        fontFamily: "var(--admin-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)"
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
  const [publishedMeta, setPublishedMeta] = useState<SystemSettingsVersionMeta | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");

  const [scopes, setScopes] = useState<CodexMemoryScope[]>([]);
  const [scopeQuery, setScopeQuery] = useState("");
  const [scopeKind, setScopeKind] = useState<CodexMemoryScopeKind | "all">("all");
  const [scopesLoading, setScopesLoading] = useState(true);
  const [scopesError, setScopesError] = useState("");
  const [selectedScopeId, setSelectedScopeId] = useState("");
  const [scopeDetail, setScopeDetail] = useState<CodexMemoryScope | null>(null);

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
  const isSettingsDirty = settingsChanged(settings, publishedSettings);
  const publishedVersion = publishedMeta ? `v${publishedMeta.versionNumber}` : "未发布";

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

  async function loadSettings() {
    setSettingsLoading(true);
    setSettingsError("");
    try {
      const response = await fetchSystemSettings();
      const nextSettings = response.draft.payload.codexMemory ?? DEFAULT_MEMORY_SETTINGS;
      setSettings({ ...DEFAULT_MEMORY_SETTINGS, ...nextSettings });
      setPublishedSettings(response.published?.payload.codexMemory ? { ...DEFAULT_MEMORY_SETTINGS, ...response.published.payload.codexMemory } : null);
      setPublishedMeta(response.publishedMeta);
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "加载记忆配置失败");
    } finally {
      setSettingsLoading(false);
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
  }, []);

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
      const saved = await saveSystemSettingsDraft(payload);
      if (publishAfterSave) {
        const published = await publishSystemSettings();
        setPublishedSettings({ ...DEFAULT_MEMORY_SETTINGS, ...published.published!.payload.codexMemory });
        setPublishedMeta(published.publishedMeta);
        setSettings({ ...DEFAULT_MEMORY_SETTINGS, ...published.draft.payload.codexMemory });
        void message.success("记忆配置已保存并发布");
      } else {
        setSettings({ ...DEFAULT_MEMORY_SETTINGS, ...saved.draft.payload.codexMemory });
        setPublishedSettings(saved.published?.payload.codexMemory ? { ...DEFAULT_MEMORY_SETTINGS, ...saved.published.payload.codexMemory } : null);
        setPublishedMeta(saved.publishedMeta);
        void message.success("记忆配置草稿已保存");
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

  const scopeColumns = [
    {
      title: "记忆空间",
      key: "scope",
      width: "30%",
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
      title: "归属",
      key: "owner",
      width: "22%",
      render: (_: unknown, scope: CodexMemoryScope) => (
        <Space direction="vertical" size={2} style={{ minWidth: 0 }}>
          <Typography.Text>{ownerLabel(scope)}</Typography.Text>
          {scope.ownerEmail ? <Typography.Text type="secondary">{scope.ownerEmail}</Typography.Text> : null}
        </Space>
      )
    },
    {
      title: "智能体",
      key: "agent",
      width: "14%",
      render: (_: unknown, scope: CodexMemoryScope) => <Typography.Text ellipsis>{agentLabel(scope)}</Typography.Text>
    },
    {
      title: "内容",
      key: "content",
      width: 140,
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

  const fileColumns = [
    {
      title: "文件",
      key: "file",
      render: (_: unknown, file: CodexMemoryFile) => (
        <Space size={8} style={{ minWidth: 0 }}>
          <FileText size={15} />
          <Space direction="vertical" size={0} style={{ minWidth: 0 }}>
            <Typography.Text strong>{fileDisplayName(file)}</Typography.Text>
            <Typography.Text type="secondary">{fileExtension(file).toUpperCase()} · {formatBytes(file.bytes)}</Typography.Text>
          </Space>
        </Space>
      )
    },
    {
      title: "更新时间",
      dataIndex: "modifiedAt",
      key: "modifiedAt",
      width: 160,
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

  function renderHeader() {
    return (
      <div className="admin-page-header">
        <div>
          <Space size={10} wrap style={{ marginBottom: 8 }}>
            {view !== "overview" ? (
              <Button icon={<ArrowLeft size={16} />} onClick={() => setView(view === "file" ? "scope" : "overview")}>
                {view === "file" ? "返回空间" : "返回列表"}
              </Button>
            ) : null}
            <Tag color={publishedSettings?.enabled ? "green" : "orange"}>
              {publishedSettings?.enabled ? "Memory 已启用" : "Memory 未启用"}
            </Tag>
            <Tag>{publishedVersion}</Tag>
            {isSettingsDirty ? <Tag color="orange">有未发布草稿</Tag> : <Tag color="green">与发布态一致</Tag>}
          </Space>
          <h1 className="admin-page-title">
            {view === "file" && selectedFile ? fileDisplayName(selectedFile) : view === "scope" && selectedScope ? scopeTitle(selectedScope) : "记忆管理"}
          </h1>
          <p className="admin-page-desc">
            {view === "file" && selectedScope
              ? `${scopeTitle(selectedScope)} 的 memory 文件`
              : view === "scope" && selectedScope
                ? scopeSubtitle(selectedScope)
                : "统一管理 Codex 原生 memory 的全局策略、记忆空间和实际 memory 文件。"}
          </p>
        </div>
        <Space>
          <Button
            icon={<RefreshCcw size={16} />}
            onClick={() => {
              void loadSettings();
              void loadScopes();
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
                description="Codex 在合适时机把稳定偏好写入 memory 文件。"
                checked={settings.generateMemories}
                onChange={(generateMemories) => updateSetting("generateMemories", generateMemories)}
              />
              <SettingSwitch
                title="外部上下文时暂停生成"
                description="带知识库、工单或文件上下文时避免把临时信息沉淀为长期记忆。"
                checked={settings.disableOnExternalContext}
                onChange={(disableOnExternalContext) => updateSetting("disableOnExternalContext", disableOnExternalContext)}
              />
            </div>

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
              message={settings.enabled ? "发布后所有 Codex 渠道统一启用原生 memory" : "发布后所有 Codex 渠道统一关闭原生 memory"}
              description="Zendesk 等集成渠道按集成实例和智能体共享记忆，站内用户按用户和智能体共享记忆。"
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

  function renderOverview() {
    return (
      <Space direction="vertical" size={16} style={{ width: "100%", marginTop: 16 }}>
        <div className="codex-memory-overview-grid">
          <div className="codex-memory-grid-cell">{renderSettingsPanel()}</div>
          <div className="codex-memory-grid-cell">
            <div className="codex-memory-overview-metrics">
              <MemoryMetric label="记忆空间" value={String(scopes.length)} hint={`${scopeStats.userScopes} 用户 · ${scopeStats.integrationScopes} 集成`} />
              <MemoryMetric label="memory 文件" value={String(scopeStats.totalFiles)} hint="可查看、编辑、删除" />
              <MemoryMetric label="占用空间" value={formatBytes(scopeStats.totalBytes)} hint="仅 memory 文件" />
              <MemoryMetric
                label="发布状态"
                value={publishedSettings?.enabled ? "已启用" : "未启用"}
                hint={publishedVersion}
              />
            </div>
          </div>
        </div>

        <div className="admin-card codex-memory-spaces-card" style={{ padding: 20 }}>
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
                style={{ width: 260, maxWidth: "100%" }}
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
            scroll={{ x: 960 }}
            pagination={{ pageSize: 8, showSizeChanger: false }}
            locale={{ emptyText: <Empty description="暂无记忆空间" /> }}
            onRow={(scope) => ({
              onClick: () => openScope(scope),
              style: { cursor: "pointer" }
            })}
          />
        </div>
      </Space>
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

        <div className="codex-memory-grid-cell">
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
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

            <div className="admin-card" style={{ padding: 20, minHeight: 260 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
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
                <div style={{ padding: 32, textAlign: "center" }}>
                  <Spin />
                </div>
              ) : fileContent ? (
                fileContent.truncated ? (
                  <Alert type="warning" showIcon message="文件过大，界面不加载内容预览" />
                ) : isMarkdownFile(fileContent) ? (
                  <CodexMemoryMarkdownPreview text={fileDraft} maxHeight={360} />
                ) : (
                  <RawTextPreview text={fileDraft} maxHeight={360} />
                )
              ) : (
                <Empty description="选择一个 memory 文件查看内容" />
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
        autoSize={{ minRows: 18, maxRows: 30 }}
        disabled={fileContent?.truncated}
        style={{ fontFamily: "var(--admin-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)" }}
      />
    );
    const preview = isMarkdownFile(selectedFile) ? (
      <CodexMemoryMarkdownPreview text={fileDraft} maxHeight={620} />
    ) : (
      <RawTextPreview text={fileDraft} maxHeight={620} />
    );

    return (
      <div className="codex-memory-file-grid" style={{ marginTop: 16 }}>
        <div className="codex-memory-grid-cell">
          <div className="admin-card" style={{ padding: 16 }}>
            <Typography.Title level={5} style={{ marginTop: 0 }}>
              当前空间文件
            </Typography.Title>
            <Space className="codex-memory-scroll-list" direction="vertical" size={8} style={{ width: "100%" }}>
              {files.map((file) => (
                <Button
                  key={file.path}
                  type={file.path === selectedFilePath ? "primary" : "default"}
                  icon={<FileText size={14} />}
                  style={{ justifyContent: "flex-start", width: "100%", overflow: "hidden" }}
                  onClick={() => setSelectedFilePath(file.path)}
                >
                  <Typography.Text ellipsis style={{ color: file.path === selectedFilePath ? "inherit" : undefined }}>
                    {fileDisplayName(file)}
                  </Typography.Text>
                </Button>
              ))}
            </Space>
          </div>
        </div>
        <div className="codex-memory-grid-cell">
          <div className="admin-card" style={{ padding: 20, minHeight: 620 }}>
            {fileLoading ? (
              <div style={{ padding: 48, textAlign: "center" }}>
                <Spin />
              </div>
            ) : fileContent?.truncated ? (
              <Alert type="warning" showIcon message="文件过大，界面不加载内容，也不能直接编辑。" />
            ) : (
              <Tabs
                items={[
                  {
                    key: "edit",
                    label: "编辑",
                    children: editor
                  },
                  {
                    key: "preview",
                    label: "预览",
                    children: preview
                  },
                  {
                    key: "split",
                    label: "分屏",
                    children: (
                      <Row gutter={[12, 12]}>
                        <Col xs={24} xl={12}>
                          {editor}
                        </Col>
                        <Col xs={24} xl={12}>
                          {preview}
                        </Col>
                      </Row>
                    )
                  },
                  {
                    key: "raw",
                    label: "原文",
                    children: <RawTextPreview text={fileDraft} maxHeight={620} />
                  }
                ]}
              />
            )}
          </div>
        </div>
        <div className="codex-memory-grid-cell">
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
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
    <div className="admin-page-container">
      {renderHeader()}
      {view === "overview" ? renderOverview() : view === "scope" ? renderScopeDetail() : renderFileEditor()}
    </div>
  );
}
