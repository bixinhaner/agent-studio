import {
  Alert,
  Button,
  Col,
  Empty,
  Input,
  InputNumber,
  List,
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
import { BrainCircuit, Eraser, FileText, RefreshCcw, Save, Search, Send, Trash2 } from "lucide-react";
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
  unknown: "未知"
};

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

function CodexMemoryMarkdownPreview(props: { text: string }) {
  return (
    <div className="conversation-audit-markdown" style={{ maxHeight: 420, overflow: "auto" }}>
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

export function CodexMemoryManagementView() {
  const [settings, setSettings] = useState<CodexMemorySettings>(DEFAULT_MEMORY_SETTINGS);
  const [publishedSettings, setPublishedSettings] = useState<CodexMemorySettings | null>(null);
  const [publishedMeta, setPublishedMeta] = useState<SystemSettingsVersionMeta | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");

  const [scopes, setScopes] = useState<CodexMemoryScope[]>([]);
  const [scopeRoot, setScopeRoot] = useState("");
  const [scopeQuery, setScopeQuery] = useState("");
  const [scopeKind, setScopeKind] = useState<CodexMemoryScopeKind | "all">("all");
  const [scopesLoading, setScopesLoading] = useState(true);
  const [scopesError, setScopesError] = useState("");
  const [selectedScopeId, setSelectedScopeId] = useState("");

  const [files, setFiles] = useState<CodexMemoryFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [fileContent, setFileContent] = useState<CodexMemoryFileContent | null>(null);
  const [fileDraft, setFileDraft] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileSaving, setFileSaving] = useState(false);

  const selectedScope = scopes.find((scope) => scope.id === selectedScopeId) ?? null;
  const isSettingsDirty = settingsChanged(settings, publishedSettings);

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
      setScopeRoot(response.root);
      setScopes(response.scopes);
      setSelectedScopeId((current) => {
        if (current && response.scopes.some((scope) => scope.id === current)) return current;
        return response.scopes[0]?.id ?? "";
      });
    } catch (error) {
      setScopesError(error instanceof Error ? error.message : "加载记忆空间失败");
    } finally {
      setScopesLoading(false);
    }
  }

  async function loadFiles(scopeId: string) {
    if (!scopeId) {
      setFiles([]);
      setSelectedFilePath("");
      setFileContent(null);
      return;
    }
    setFilesLoading(true);
    try {
      const response = await fetchCodexMemoryFiles(scopeId);
      setFiles(response.files);
      setSelectedFilePath((current) => {
        if (current && response.files.some((file) => file.path === current)) return current;
        return response.files[0]?.path ?? "";
      });
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

  const scopeStats = useMemo(() => {
    const totalBytes = scopes.reduce((sum, scope) => sum + scope.totalBytes, 0);
    const totalFiles = scopes.reduce((sum, scope) => sum + scope.fileCount, 0);
    return { totalBytes, totalFiles };
  }, [scopes]);

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
    await loadFiles(selectedScopeId);
    await loadScopes();
  }

  async function handleClearScope() {
    if (!selectedScopeId) return;
    await clearCodexMemoryScope(selectedScopeId);
    void message.success("当前记忆空间已清空");
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

  return (
    <div className="admin-page-container">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">记忆管理</h1>
          <p className="admin-page-desc">统一管理 Codex 原生 memory 的全局开关、生成策略和实际记忆文件。</p>
        </div>
        <Space>
          <Button icon={<RefreshCcw size={16} />} onClick={() => {
            void loadSettings();
            void loadScopes();
          }}>
            刷新
          </Button>
          <Button
            type="primary"
            icon={<Send size={16} />}
            loading={settingsSaving}
            onClick={() => void handleSaveSettings(true)}
          >
            保存并发布
          </Button>
        </Space>
      </div>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={9}>
          <div className="admin-card" style={{ padding: 20, height: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <BrainCircuit size={20} />
              <Typography.Title level={4} style={{ margin: 0 }}>全局记忆策略</Typography.Title>
            </div>
            {settingsError ? <Alert type="error" showIcon message={settingsError} style={{ marginBottom: 12 }} /> : null}
            {settingsLoading ? (
              <Spin />
            ) : (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <Row gutter={[12, 12]}>
                  <Col span={12}>
                    <Space direction="vertical" size={4}>
                      <Typography.Text strong>启用 Codex Memory</Typography.Text>
                      <Switch checked={settings.enabled} onChange={(enabled) => setSettings((current) => ({ ...current, enabled }))} />
                    </Space>
                  </Col>
                  <Col span={12}>
                    <Space direction="vertical" size={4}>
                      <Typography.Text strong>读取已有记忆</Typography.Text>
                      <Switch checked={settings.useMemories} onChange={(useMemories) => setSettings((current) => ({ ...current, useMemories }))} />
                    </Space>
                  </Col>
                  <Col span={12}>
                    <Space direction="vertical" size={4}>
                      <Typography.Text strong>自动生成记忆</Typography.Text>
                      <Switch checked={settings.generateMemories} onChange={(generateMemories) => setSettings((current) => ({ ...current, generateMemories }))} />
                    </Space>
                  </Col>
                  <Col span={12}>
                    <Space direction="vertical" size={4}>
                      <Typography.Text strong>外部上下文时禁用生成</Typography.Text>
                      <Switch checked={settings.disableOnExternalContext} onChange={(disableOnExternalContext) => setSettings((current) => ({ ...current, disableOnExternalContext }))} />
                    </Space>
                  </Col>
                </Row>

                <Row gutter={[12, 12]}>
                  <Col span={12}>
                    <Typography.Text strong>最低剩余额度 %</Typography.Text>
                    <InputNumber
                      min={0}
                      max={100}
                      value={settings.minRateLimitRemainingPercent}
                      onChange={(value) => setSettings((current) => ({ ...current, minRateLimitRemainingPercent: Number(value ?? 0) }))}
                      style={{ width: "100%", marginTop: 6 }}
                    />
                  </Col>
                  <Col span={12}>
                    <Typography.Text strong>rollout 空闲小时</Typography.Text>
                    <InputNumber
                      min={0}
                      max={720}
                      value={settings.minRolloutIdleHours}
                      onChange={(value) => setSettings((current) => ({ ...current, minRolloutIdleHours: Number(value ?? 0) }))}
                      style={{ width: "100%", marginTop: 6 }}
                    />
                  </Col>
                  <Col span={12}>
                    <Typography.Text strong>rollout 最大天数</Typography.Text>
                    <InputNumber
                      min={1}
                      max={3650}
                      value={settings.maxRolloutAgeDays}
                      onChange={(value) => setSettings((current) => ({ ...current, maxRolloutAgeDays: Number(value ?? 1) }))}
                      style={{ width: "100%", marginTop: 6 }}
                    />
                  </Col>
                  <Col span={12}>
                    <Typography.Text strong>未使用保留天数</Typography.Text>
                    <InputNumber
                      min={1}
                      max={3650}
                      value={settings.maxUnusedDays}
                      onChange={(value) => setSettings((current) => ({ ...current, maxUnusedDays: Number(value ?? 1) }))}
                      style={{ width: "100%", marginTop: 6 }}
                    />
                  </Col>
                </Row>

                <Alert
                  type={settings.enabled ? "success" : "warning"}
                  showIcon
                  message={settings.enabled ? "发布后所有 Codex 渠道统一启用原生 memory" : "发布后所有 Codex 渠道统一关闭原生 memory"}
                  description={`当前发布版本：${publishedMeta ? `v${publishedMeta.versionNumber}` : "尚未发布"}。Zendesk 的记忆空间按集成实例和智能体共享。`}
                />
                <Space>
                  <Button icon={<Save size={16} />} loading={settingsSaving} onClick={() => void handleSaveSettings(false)}>
                    保存草稿
                  </Button>
                  <Button type="primary" icon={<Send size={16} />} loading={settingsSaving} onClick={() => void handleSaveSettings(true)}>
                    保存并发布
                  </Button>
                  {isSettingsDirty ? <Tag color="orange">有未发布差异</Tag> : <Tag color="green">与发布态一致</Tag>}
                </Space>
              </Space>
            )}
          </div>
        </Col>

        <Col xs={24} xl={15}>
          <div className="admin-card" style={{ padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <Typography.Title level={4} style={{ margin: 0 }}>记忆空间</Typography.Title>
                <Typography.Text type="secondary">
                  {scopeRoot || "CODEX_SESSION_HOME_ROOT"} · {scopes.length} 个空间 · {scopeStats.totalFiles} 个文件 · {formatBytes(scopeStats.totalBytes)}
                </Typography.Text>
              </div>
              <Space>
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
                  placeholder="搜索 scope"
                  value={scopeQuery}
                  onChange={(event) => setScopeQuery(event.target.value)}
                  onPressEnter={() => void loadScopes()}
                  style={{ width: 220 }}
                />
                <Button icon={<RefreshCcw size={16} />} onClick={() => void loadScopes()} />
              </Space>
            </div>

            {scopesError ? <Alert type="error" showIcon message={scopesError} style={{ marginBottom: 12 }} /> : null}
            <Row gutter={[16, 16]}>
              <Col xs={24} lg={10}>
                <div style={{ border: "1px solid var(--admin-color-border)", borderRadius: 12, overflow: "hidden", minHeight: 420 }}>
                  {scopesLoading ? (
                    <div style={{ padding: 32, textAlign: "center" }}><Spin /></div>
                  ) : scopes.length ? (
                    <List
                      dataSource={scopes}
                      renderItem={(scope) => (
                        <List.Item
                          onClick={() => setSelectedScopeId(scope.id)}
                          style={{
                            cursor: "pointer",
                            padding: "14px 16px",
                            background: scope.id === selectedScopeId ? "rgba(22, 119, 255, 0.08)" : undefined
                          }}
                        >
                          <List.Item.Meta
                            title={
                              <Space size={8}>
                                <span>{scope.label}</span>
                                <Tag>{KIND_LABELS[scope.kind]}</Tag>
                              </Space>
                            }
                            description={
                              <Space direction="vertical" size={2}>
                                <Typography.Text type="secondary" ellipsis>{scope.relativeHome}</Typography.Text>
                                <Typography.Text type="secondary">
                                  {scope.fileCount} 个文件 · {formatBytes(scope.totalBytes)} · {formatLocalTime(scope.latestModifiedAt)}
                                </Typography.Text>
                              </Space>
                            }
                          />
                        </List.Item>
                      )}
                    />
                  ) : (
                    <Empty description="暂无记忆空间" style={{ padding: 48 }} />
                  )}
                </div>
              </Col>

              <Col xs={24} lg={14}>
                <div style={{ border: "1px solid var(--admin-color-border)", borderRadius: 12, padding: 16, minHeight: 420 }}>
                  {selectedScope ? (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                        <div style={{ minWidth: 0 }}>
                          <Typography.Title level={5} style={{ margin: 0 }}>{selectedScope.label}</Typography.Title>
                          <Typography.Text type="secondary" ellipsis style={{ display: "block" }}>
                            {selectedScope.memoriesPath}
                          </Typography.Text>
                        </div>
                        <Popconfirm
                          title="清空当前记忆空间？"
                          description="只会删除该 scope 的 memories 文件，不删除 Codex home。"
                          okText="清空"
                          cancelText="取消"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => void handleClearScope()}
                        >
                          <Button danger icon={<Eraser size={16} />}>清空</Button>
                        </Popconfirm>
                      </div>

                      <Table
                        size="small"
                        rowKey="path"
                        loading={filesLoading}
                        dataSource={files}
                        pagination={{ pageSize: 5, size: "small" }}
                        onRow={(file) => ({
                          onClick: () => setSelectedFilePath(file.path),
                          style: {
                            cursor: "pointer",
                            background: file.path === selectedFilePath ? "rgba(22, 119, 255, 0.08)" : undefined
                          }
                        })}
                        columns={[
                          {
                            title: "文件",
                            dataIndex: "path",
                            key: "path",
                            render: (value: string) => (
                              <Space>
                                <FileText size={14} />
                                <Typography.Text ellipsis style={{ maxWidth: 240 }}>{value}</Typography.Text>
                              </Space>
                            )
                          },
                          {
                            title: "大小",
                            dataIndex: "bytes",
                            key: "bytes",
                            width: 90,
                            render: (value: number) => formatBytes(value)
                          },
                          {
                            title: "操作",
                            key: "action",
                            width: 80,
                            render: (_: unknown, record: CodexMemoryFile) => (
                              <Popconfirm
                                title="删除这个记忆文件？"
                                okText="删除"
                                cancelText="取消"
                                okButtonProps={{ danger: true }}
                                onConfirm={(event) => {
                                  event?.stopPropagation();
                                  void handleDeleteFile(record.path);
                                }}
                              >
                                <Button
                                  size="small"
                                  danger
                                  icon={<Trash2 size={14} />}
                                  onClick={(event) => event.stopPropagation()}
                                />
                              </Popconfirm>
                            )
                          }
                        ]}
                      />

                      <div style={{ marginTop: 16 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                          <Typography.Text strong>{selectedFilePath || "未选择文件"}</Typography.Text>
                          <Button
                            size="small"
                            icon={<Save size={14} />}
                            disabled={!fileContent || fileContent.truncated}
                            loading={fileSaving}
                            onClick={() => void handleSaveFile()}
                          >
                            保存文件
                          </Button>
                        </div>
                        {fileLoading ? (
                          <Spin />
                        ) : fileContent ? (
                          fileContent.truncated ? (
                            <Alert type="warning" showIcon message="文件过大，界面不加载内容预览" />
                          ) : (
                            <Tabs
                              size="small"
                              items={[
                                {
                                  key: "preview",
                                  label: "Markdown 预览",
                                  children: <CodexMemoryMarkdownPreview text={fileDraft} />
                                },
                                {
                                  key: "source",
                                  label: "源码编辑",
                                  children: (
                                    <Input.TextArea
                                      value={fileDraft}
                                      onChange={(event) => setFileDraft(event.target.value)}
                                      autoSize={{ minRows: 8, maxRows: 18 }}
                                      style={{ fontFamily: "var(--admin-font-mono, monospace)" }}
                                    />
                                  )
                                }
                              ]}
                            />
                          )
                        ) : (
                          <Empty description="选择一个 memory 文件查看内容" />
                        )}
                      </div>
                    </>
                  ) : (
                    <Empty description="选择左侧记忆空间" style={{ padding: 64 }} />
                  )}
                </div>
              </Col>
            </Row>
          </div>
        </Col>
      </Row>
    </div>
  );
}
