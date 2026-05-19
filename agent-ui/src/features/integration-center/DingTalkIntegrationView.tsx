import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Checkbox, Empty, Input, Segmented, Select, Space, Spin, Switch, Tag } from "antd";
import { Bot, MessageCircle, RefreshCcw } from "lucide-react";

import { fetchAgentModes } from "../capability-center/api";
import type { AgentModeRecord } from "../capability-center/types";
import { fetchKnowledgeSets } from "../resources-center/api";
import type { KnowledgeSetRecord } from "../resources-center/types";
import {
  fetchDingTalkBotConversations,
  fetchDingTalkBotStatus,
  fetchIntegrationDetail,
  restartDingTalkBot,
  updateIntegrationInstance,
  validateIntegrationInstance
} from "./api";
import { IntegrationBindingsEditor } from "./IntegrationBindingsEditor";
import { IntegrationPolicyEditor } from "./IntegrationPolicyEditor";
import { IntegrationValidationHistory } from "./IntegrationValidationHistory";
import type {
  DingTalkBotConfigInput,
  DingTalkBotConversationRecord,
  DingTalkBotStatusRecord,
  DingTalkConfigInput,
  IntegrationDetail,
  IntegrationListItem,
  IntegrationSectionTab
} from "./types";

const TABS: Array<{ id: IntegrationSectionTab; label: string }> = [
  { id: "basic", label: "基本信息" },
  { id: "config", label: "配置" },
  { id: "bot", label: "机器人对话" },
  { id: "history", label: "验证与历史" },
  { id: "bindings", label: "绑定关系" },
  { id: "policies", label: "授权" }
];

const STATUS_OPTIONS = [
  { label: "draft", value: "draft" },
  { label: "active", value: "active" },
  { label: "disabled", value: "disabled" },
  { label: "error", value: "error" }
];

const DEFAULT_BOT_CONFIG: Required<DingTalkBotConfigInput> = {
  enabled: false,
  receiveMode: "stream",
  agentModeId: "",
  knowledgeSetIds: [],
  singleChatEnabled: true,
  groupChatEnabled: true,
  groupReplyMode: "mention_only",
  autoSyncUsers: true,
  resetCommands: ["新对话", "重置", "reset", "/reset"],
  unauthorizedMessage: "当前钉钉账号还没有关联到 Agent Studio 用户，请联系管理员同步组织通讯录。",
  busyMessage: "上一条消息还在处理中，请稍后再发。",
  resetConfirmationMessage: "已开启新对话。",
  unsupportedMessage: "暂时只支持文本消息。",
  errorMessage: "这条消息处理失败，请稍后重试。"
};

function formatLocalDateTime(value?: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const item of value) {
    const normalized = typeof item === "string" ? item.trim() : "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    items.push(normalized);
  }
  return items;
}

function readBotConfig(value: unknown): Required<DingTalkBotConfigInput> {
  const robot = asRecord(asRecord(value).robot);
  const resetCommands = asStringArray(robot.resetCommands);
  return {
    enabled: asBoolean(robot.enabled, DEFAULT_BOT_CONFIG.enabled),
    receiveMode: "stream",
    agentModeId: asString(robot.agentModeId),
    knowledgeSetIds: asStringArray(robot.knowledgeSetIds),
    singleChatEnabled: asBoolean(robot.singleChatEnabled, DEFAULT_BOT_CONFIG.singleChatEnabled),
    groupChatEnabled: asBoolean(robot.groupChatEnabled, DEFAULT_BOT_CONFIG.groupChatEnabled),
    groupReplyMode: "mention_only",
    autoSyncUsers: asBoolean(robot.autoSyncUsers, DEFAULT_BOT_CONFIG.autoSyncUsers),
    resetCommands: resetCommands.length > 0 ? resetCommands : DEFAULT_BOT_CONFIG.resetCommands,
    unauthorizedMessage: asString(robot.unauthorizedMessage) || DEFAULT_BOT_CONFIG.unauthorizedMessage,
    busyMessage: asString(robot.busyMessage) || DEFAULT_BOT_CONFIG.busyMessage,
    resetConfirmationMessage: asString(robot.resetConfirmationMessage) || DEFAULT_BOT_CONFIG.resetConfirmationMessage,
    unsupportedMessage: asString(robot.unsupportedMessage) || DEFAULT_BOT_CONFIG.unsupportedMessage,
    errorMessage: asString(robot.errorMessage) || DEFAULT_BOT_CONFIG.errorMessage
  };
}

function readConfig(detail: IntegrationDetail): DingTalkConfigInput {
  return {
    clientId: typeof detail.config.clientId === "string" ? detail.config.clientId : "",
    redirectUri: typeof detail.config.redirectUri === "string" ? detail.config.redirectUri : "",
    scope: typeof detail.config.scope === "string" ? detail.config.scope : "",
    apiBaseUrl: typeof detail.config.apiBaseUrl === "string" ? detail.config.apiBaseUrl : "",
    alertAgentId: typeof detail.config.alertAgentId === "string" ? detail.config.alertAgentId : "",
    alertUserIds: asStringArray(detail.config.alertUserIds),
    robot: readBotConfig(detail.config)
  };
}

function optionsWithCurrent(options: Array<{ label: string; value: string }>, value: string) {
  if (!value) return options;
  if (options.some((item) => item.value === value)) return options;
  return [{ label: value, value }, ...options];
}

function buildBotConfig(draft: Required<DingTalkBotConfigInput>): DingTalkBotConfigInput {
  return {
    enabled: draft.enabled,
    receiveMode: "stream",
    agentModeId: draft.agentModeId.trim(),
    knowledgeSetIds: asStringArray(draft.knowledgeSetIds),
    singleChatEnabled: draft.singleChatEnabled,
    groupChatEnabled: draft.groupChatEnabled,
    groupReplyMode: "mention_only",
    autoSyncUsers: draft.autoSyncUsers,
    resetCommands: asStringArray(draft.resetCommands),
    unauthorizedMessage: draft.unauthorizedMessage.trim(),
    busyMessage: draft.busyMessage.trim(),
    resetConfirmationMessage: draft.resetConfirmationMessage.trim(),
    unsupportedMessage: draft.unsupportedMessage.trim(),
    errorMessage: draft.errorMessage.trim()
  };
}

function botConnectionTag(status: DingTalkBotStatusRecord | undefined, enabled: boolean) {
  if (!enabled) return <Tag>未启用</Tag>;
  if (!status) return <Tag color="warning">等待后台刷新</Tag>;
  if (!status.configured) return <Tag color="warning">配置不完整</Tag>;
  if (status.connected && status.registered) return <Tag color="success">已连接</Tag>;
  return <Tag color="error">未连接</Tag>;
}

function conversationTypeLabel(value: string) {
  return value === "group" ? "群聊" : "单聊";
}

export function DingTalkIntegrationView(props: {
  instanceId: string;
  onInstanceUpdated?(instance: IntegrationListItem): void;
}) {
  const [detail, setDetail] = useState<IntegrationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [restartingBot, setRestartingBot] = useState(false);
  const [botRuntimeLoading, setBotRuntimeLoading] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");
  const [botRuntimeErrorText, setBotRuntimeErrorText] = useState("");
  const [optionsErrorText, setOptionsErrorText] = useState("");
  const [activeTab, setActiveTab] = useState<IntegrationSectionTab>("basic");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("draft");
  const [configDraft, setConfigDraft] = useState<DingTalkConfigInput>({});
  const [robotDraft, setRobotDraft] = useState<Required<DingTalkBotConfigInput>>(DEFAULT_BOT_CONFIG);
  const [clientSecretDraft, setClientSecretDraft] = useState("");
  const [clearSecretState, setClearSecretState] = useState(false);
  const [agentModes, setAgentModes] = useState<AgentModeRecord[]>([]);
  const [knowledgeSets, setKnowledgeSets] = useState<KnowledgeSetRecord[]>([]);
  const [botStatuses, setBotStatuses] = useState<DingTalkBotStatusRecord[]>([]);
  const [botConversations, setBotConversations] = useState<DingTalkBotConversationRecord[]>([]);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setErrorText("");
      setBotRuntimeErrorText("");
      try {
        const [next, statusResponse, conversationResponse] = await Promise.all([
          fetchIntegrationDetail(props.instanceId),
          fetchDingTalkBotStatus(props.instanceId).catch((error) => {
            if (active) setBotRuntimeErrorText(error instanceof Error ? error.message : "加载机器人运行状态失败");
            return { statuses: [] };
          }),
          fetchDingTalkBotConversations(props.instanceId, { take: 20 }).catch((error) => {
            if (active) setBotRuntimeErrorText(error instanceof Error ? error.message : "加载机器人会话失败");
            return { items: [] };
          })
        ]);
        if (!active) return;
        setDetail(next);
        setName(next.instance.name);
        setDescription(next.instance.description || "");
        setStatus(next.instance.status);
        setConfigDraft(readConfig(next));
        setRobotDraft(readBotConfig(next.config));
        setClientSecretDraft("");
        setClearSecretState(false);
        setBotStatuses(statusResponse.statuses);
        setBotConversations(conversationResponse.items);
      } catch (error) {
        if (active) setErrorText(error instanceof Error ? error.message : "加载 DingTalk 集成失败");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [props.instanceId]);

  useEffect(() => {
    let active = true;
    async function loadOptions() {
      setOptionsLoading(true);
      setOptionsErrorText("");
      try {
        const [modeResponse, knowledgeSetResponse] = await Promise.all([fetchAgentModes(), fetchKnowledgeSets()]);
        if (!active) return;
        setAgentModes(modeResponse.agentModes.filter((item) => item.status === "active"));
        setKnowledgeSets(
          knowledgeSetResponse.knowledgeSets.filter((item) => item.status === "active" && item.sourceType === "managed_upload")
        );
      } catch (error) {
        if (active) setOptionsErrorText(error instanceof Error ? error.message : "加载 Agent Mode/资料集列表失败");
      } finally {
        if (active) setOptionsLoading(false);
      }
    }

    void loadOptions();
    return () => {
      active = false;
    };
  }, []);

  const alertUserIdsText = useMemo(() => (configDraft.alertUserIds || []).join("\n"), [configDraft.alertUserIds]);
  const resetCommandsText = useMemo(() => robotDraft.resetCommands.join("\n"), [robotDraft.resetCommands]);
  const botStatus = botStatuses.find((item) => item.instanceId === props.instanceId) || botStatuses[0];
  const agentModeOptions = useMemo(
    () => agentModes.map((item) => ({ label: `${item.name} (${item.slug})`, value: item.id })),
    [agentModes]
  );
  const knowledgeSetOptions = useMemo(
    () => knowledgeSets.map((item) => ({ label: `${item.name} (${item.slug})`, value: item.id })),
    [knowledgeSets]
  );

  async function refreshBotRuntime() {
    setBotRuntimeLoading(true);
    setBotRuntimeErrorText("");
    try {
      const [statusResponse, conversationResponse] = await Promise.all([
        fetchDingTalkBotStatus(props.instanceId),
        fetchDingTalkBotConversations(props.instanceId, { take: 20 })
      ]);
      setBotStatuses(statusResponse.statuses);
      setBotConversations(conversationResponse.items);
    } catch (error) {
      setBotRuntimeErrorText(error instanceof Error ? error.message : "刷新机器人运行状态失败");
    } finally {
      setBotRuntimeLoading(false);
    }
  }

  async function handleSave() {
    if (!name.trim()) {
      setErrorText("请填写实例名称");
      return;
    }
    if (robotDraft.enabled && !robotDraft.agentModeId.trim()) {
      setErrorText("启用机器人对话前需要绑定 Agent Mode");
      setActiveTab("bot");
      return;
    }

    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const next = await updateIntegrationInstance(props.instanceId, {
        name: name.trim(),
        description: description.trim() || null,
        status,
        config: {
          clientId: configDraft.clientId?.trim() || "",
          redirectUri: configDraft.redirectUri?.trim() || "",
          scope: configDraft.scope?.trim() || "",
          apiBaseUrl: configDraft.apiBaseUrl?.trim() || "",
          alertAgentId: configDraft.alertAgentId?.trim() || "",
          alertUserIds: alertUserIdsText
            .split(/\n|,/g)
            .map((item) => item.trim())
            .filter(Boolean),
          robot: buildBotConfig(robotDraft)
        },
        secretState: clearSecretState ? null : clientSecretDraft.trim() ? { clientSecret: clientSecretDraft.trim() } : undefined
      });
      setDetail(next);
      setConfigDraft(readConfig(next));
      setRobotDraft(readBotConfig(next.config));
      setClientSecretDraft("");
      setClearSecretState(false);
      props.onInstanceUpdated?.(next.instance);
      setSuccessText("DingTalk 集成已保存");
      void refreshBotRuntime();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存 DingTalk 集成失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleValidate() {
    setValidating(true);
    setErrorText("");
    setSuccessText("");
    try {
      const next = await validateIntegrationInstance(props.instanceId);
      setDetail(next.detail);
      props.onInstanceUpdated?.(next.detail.instance);
      setSuccessText("DingTalk 凭证验证已完成");
      setActiveTab("history");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "DingTalk 验证失败");
    } finally {
      setValidating(false);
    }
  }

  async function handleRestartBot() {
    setRestartingBot(true);
    setBotRuntimeErrorText("");
    setSuccessText("");
    try {
      const response = await restartDingTalkBot(props.instanceId);
      setBotStatuses(response.statuses);
      setSuccessText("DingTalk 机器人 Stream 连接已重启");
      void refreshBotRuntime();
    } catch (error) {
      setBotRuntimeErrorText(error instanceof Error ? error.message : "重启机器人 Stream 连接失败");
    } finally {
      setRestartingBot(false);
    }
  }

  if (loading || !detail) {
    return (
      <section className="resource-center-section">
        <div className="admin-workspace-loading">
          <Spin size="small" />
        </div>
      </section>
    );
  }

  const botConfigured = Boolean(configDraft.clientId?.trim() && detail.secretState.hasSecrets && robotDraft.agentModeId.trim());

  return (
    <section className="resource-center-section integration-detail-shell antd-admin-card">
      <div className="resource-center-section-header">
        <div>
          <h3>DingTalk</h3>
          <p>登录、组织同步、通知和机器人对话配置统一在这里维护。</p>
        </div>
        <Space>
          <Button disabled={validating} onClick={() => void handleValidate()}>
            {validating ? "验证中..." : "验证连接"}
          </Button>
          <Button type="primary" disabled={saving} onClick={() => void handleSave()}>
            {saving ? "保存中..." : "保存集成"}
          </Button>
        </Space>
      </div>

      {errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={errorText} /> : null}
      {successText ? <Alert type="success" showIcon className="admin-alert-inline" message={successText} /> : null}
      {optionsErrorText ? <Alert type="warning" showIcon className="admin-alert-inline" message={optionsErrorText} /> : null}

      <div className="resource-center-type-tabs" role="tablist" aria-label="DingTalk 详情页签">
        <Segmented
          block
          value={activeTab}
          options={TABS.map((tab) => ({ label: tab.label, value: tab.id }))}
          onChange={(value) => setActiveTab(value as IntegrationSectionTab)}
        />
      </div>

      {activeTab === "basic" ? (
        <div className="integration-form-grid">
          <label className="field">
            <span className="field-label">实例名称</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">状态</span>
            <Segmented value={status} options={STATUS_OPTIONS} onChange={(value) => setStatus(String(value))} />
          </label>
          <label className="field integration-field-span-2">
            <span className="field-label">说明</span>
            <Input.TextArea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <Card size="small" className="resource-center-summary-grid compact integration-summary-card integration-field-span-2 antd-admin-card">
            <div><span className="field-label">slug</span><p>{detail.instance.slug}</p></div>
            <div><span className="field-label">创建时间</span><p>{formatLocalDateTime(detail.instance.createdAt)}</p></div>
            <div><span className="field-label">更新时间</span><p>{formatLocalDateTime(detail.instance.updatedAt)}</p></div>
            <div><span className="field-label">密钥状态</span><p>{detail.secretState.hasSecrets ? "已保存密钥" : "未保存密钥"}</p></div>
          </Card>
        </div>
      ) : null}

      {activeTab === "config" ? (
        <div className="integration-form-grid">
          <label className="field">
            <span className="field-label">Client ID</span>
            <Input value={configDraft.clientId || ""} onChange={(event) => setConfigDraft((current) => ({ ...current, clientId: event.target.value }))} />
          </label>
          <label className="field">
            <span className="field-label">Redirect URI</span>
            <Input value={configDraft.redirectUri || ""} onChange={(event) => setConfigDraft((current) => ({ ...current, redirectUri: event.target.value }))} />
          </label>
          <label className="field">
            <span className="field-label">Scope</span>
            <Input value={configDraft.scope || ""} onChange={(event) => setConfigDraft((current) => ({ ...current, scope: event.target.value }))} />
          </label>
          <label className="field">
            <span className="field-label">API Base URL</span>
            <Input value={configDraft.apiBaseUrl || ""} onChange={(event) => setConfigDraft((current) => ({ ...current, apiBaseUrl: event.target.value }))} />
          </label>
          <label className="field">
            <span className="field-label">通知 Agent ID</span>
            <Input value={configDraft.alertAgentId || ""} onChange={(event) => setConfigDraft((current) => ({ ...current, alertAgentId: event.target.value }))} />
          </label>
          <label className="field">
            <span className="field-label">Client Secret</span>
            <Input.Password value={clientSecretDraft} placeholder={detail.secretState.hasSecrets ? "已保存密钥" : ""} onChange={(event) => { setClientSecretDraft(event.target.value); setClearSecretState(false); }} />
          </label>
          <label className="field integration-field-span-2">
            <span className="field-label">通知用户 IDs</span>
            <Input.TextArea rows={4} value={alertUserIdsText} onChange={(event) => setConfigDraft((current) => ({ ...current, alertUserIds: event.target.value.split(/\n|,/g).map((item) => item.trim()).filter(Boolean) }))} />
          </label>
          <label className="field integration-checkbox-row integration-field-span-2">
            <Checkbox checked={clearSecretState} onChange={(event) => setClearSecretState(event.target.checked)}>
              清空当前保存的 Client Secret
            </Checkbox>
          </label>
        </div>
      ) : null}

      {activeTab === "bot" ? (
        <div className="integration-form-grid">
          <Card size="small" className="integration-field-span-2 antd-admin-card">
            <div className="resource-center-section-header">
              <div>
                <h3 style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <Bot size={18} />
                  机器人 Stream
                </h3>
                <p>钉钉开发者后台只需要保持机器人消息接收模式为 Stream，Agent Mode、资料集和回复策略都在这里配置。</p>
              </div>
              <Space>
                {botConnectionTag(botStatus, robotDraft.enabled)}
                <Button
                  icon={<RefreshCcw size={14} />}
                  disabled={botRuntimeLoading || restartingBot}
                  onClick={() => void refreshBotRuntime()}
                >
                  刷新
                </Button>
                <Button
                  icon={<RefreshCcw size={14} />}
                  disabled={botRuntimeLoading || restartingBot}
                  onClick={() => void handleRestartBot()}
                >
                  {restartingBot ? "重启中..." : "重启连接"}
                </Button>
              </Space>
            </div>
            {botRuntimeErrorText ? <Alert type="warning" showIcon className="admin-alert-inline" message={botRuntimeErrorText} /> : null}
            {status !== "active" && robotDraft.enabled ? (
              <Alert
                type="warning"
                showIcon
                className="admin-alert-inline"
                message="实例状态不是 active，后台不会启动 Stream 机器人连接。"
              />
            ) : null}
            <div className="capability-center-summary-grid compact" style={{ marginTop: 16 }}>
              <div><span className="field-label">配置完整</span><p>{botConfigured ? "是" : "否"}</p></div>
              <div><span className="field-label">连接状态</span><p>{botStatus?.connected ? "connected" : "disconnected"}</p></div>
              <div><span className="field-label">订阅状态</span><p>{botStatus?.registered ? "registered" : "unregistered"}</p></div>
              <div><span className="field-label">已处理 / 忽略</span><p>{botStatus ? `${botStatus.processedCount} / ${botStatus.ignoredCount}` : "0 / 0"}</p></div>
              <div><span className="field-label">启动时间</span><p>{formatLocalDateTime(botStatus?.startedAt)}</p></div>
              <div><span className="field-label">最近消息</span><p>{formatLocalDateTime(botStatus?.lastEventAt)}</p></div>
              <div><span className="field-label">最近回复</span><p>{formatLocalDateTime(botStatus?.lastReplyAt)}</p></div>
              <div><span className="field-label">最近错误</span><p>{botStatus?.lastError || "-"}</p></div>
            </div>
          </Card>

          <label className="field integration-field-span-2">
            <span className="field-label">启用机器人对话</span>
            <Switch
              checked={robotDraft.enabled}
              checkedChildren="启用"
              unCheckedChildren="停用"
              onChange={(checked) => setRobotDraft((current) => ({ ...current, enabled: checked }))}
            />
          </label>
          <label className="field">
            <span className="field-label">绑定 Agent Mode</span>
            <Select
              showSearch
              value={robotDraft.agentModeId || undefined}
              options={optionsWithCurrent(agentModeOptions, robotDraft.agentModeId)}
              loading={optionsLoading}
              optionFilterProp="label"
              onChange={(value) => setRobotDraft((current) => ({ ...current, agentModeId: value }))}
            />
          </label>
          <label className="field">
            <span className="field-label">绑定资料集</span>
            <Select
              mode="multiple"
              showSearch
              value={robotDraft.knowledgeSetIds}
              options={knowledgeSetOptions}
              loading={optionsLoading}
              optionFilterProp="label"
              onChange={(value) => setRobotDraft((current) => ({ ...current, knowledgeSetIds: value }))}
            />
          </label>
          <div className="field integration-field-span-2">
            <span className="field-label">会话范围</span>
            <Space wrap>
              <Checkbox
                checked={robotDraft.singleChatEnabled}
                onChange={(event) => setRobotDraft((current) => ({ ...current, singleChatEnabled: event.target.checked }))}
              >
                支持单聊
              </Checkbox>
              <Checkbox
                checked={robotDraft.groupChatEnabled}
                onChange={(event) => setRobotDraft((current) => ({ ...current, groupChatEnabled: event.target.checked }))}
              >
                支持群聊 @
              </Checkbox>
              <Checkbox
                checked={robotDraft.autoSyncUsers}
                onChange={(event) => setRobotDraft((current) => ({ ...current, autoSyncUsers: event.target.checked }))}
              >
                未关联用户自动同步
              </Checkbox>
            </Space>
          </div>
          <label className="field integration-field-span-2">
            <span className="field-label">新对话指令</span>
            <Input.TextArea
              rows={3}
              value={resetCommandsText}
              onChange={(event) =>
                setRobotDraft((current) => ({
                  ...current,
                  resetCommands: event.target.value.split(/\n|,/g).map((item) => item.trim()).filter(Boolean)
                }))
              }
            />
          </label>
          <label className="field">
            <span className="field-label">未授权提示</span>
            <Input.TextArea rows={3} value={robotDraft.unauthorizedMessage} onChange={(event) => setRobotDraft((current) => ({ ...current, unauthorizedMessage: event.target.value }))} />
          </label>
          <label className="field">
            <span className="field-label">忙碌提示</span>
            <Input.TextArea rows={3} value={robotDraft.busyMessage} onChange={(event) => setRobotDraft((current) => ({ ...current, busyMessage: event.target.value }))} />
          </label>
          <label className="field">
            <span className="field-label">重置确认</span>
            <Input.TextArea rows={3} value={robotDraft.resetConfirmationMessage} onChange={(event) => setRobotDraft((current) => ({ ...current, resetConfirmationMessage: event.target.value }))} />
          </label>
          <label className="field">
            <span className="field-label">异常提示</span>
            <Input.TextArea rows={3} value={robotDraft.errorMessage} onChange={(event) => setRobotDraft((current) => ({ ...current, errorMessage: event.target.value }))} />
          </label>

          <Card size="small" className="integration-field-span-2 antd-admin-card">
            <div className="resource-center-section-header">
              <div>
                <h3 style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <MessageCircle size={18} />
                  最近机器人会话
                </h3>
                <p>单聊按用户会话映射，群聊按群会话映射；同一机器人和 Agent Mode 会复用同一个系统 Thread。</p>
              </div>
            </div>
            <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
              {botConversations.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无机器人会话" />
              ) : (
                botConversations.map((item) => (
                  <a
                    key={item.id}
                    className="resource-center-item"
                    href={`#admin/conversations?conversation=${encodeURIComponent(item.threadId)}`}
                  >
                    <div className="resource-center-item-title-row">
                      <span className="resource-center-item-title">
                        {conversationTypeLabel(item.conversationType)} · {item.externalUserName || item.externalUserId || item.externalConversationId}
                      </span>
                      <Tag>{formatLocalDateTime(item.lastMessageAt || item.updatedAt)}</Tag>
                    </div>
                    <div className="resource-center-item-meta">
                      <span>机器人：{item.botName || detail.instance.name}</span>
                      <span>Agent Mode：{item.agentModeId || "-"}</span>
                      <span>Thread：{item.threadId.slice(0, 10)}</span>
                    </div>
                  </a>
                ))
              )}
            </div>
          </Card>
        </div>
      ) : null}

      {activeTab === "history" ? <IntegrationValidationHistory items={detail.validationHistory.items} /> : null}
      {activeTab === "bindings" ? <IntegrationBindingsEditor instanceId={props.instanceId} /> : null}
      {activeTab === "policies" ? <IntegrationPolicyEditor instanceId={props.instanceId} /> : null}
    </section>
  );
}
