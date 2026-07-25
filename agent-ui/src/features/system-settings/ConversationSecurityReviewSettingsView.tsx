import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Spin,
  Switch,
  Tag
} from "antd";
import { FlaskConical, ShieldAlert } from "lucide-react";

import { fetchAdminUsers } from "../admin/api";
import { fetchAgentModes } from "../capability-center/api";
import { fetchKnowledgeSets } from "../resources-center/api";
import { testConversationSecurityReview } from "./api";
import type {
  SystemSettingsConversationSecurityReview,
  SystemSettingsFieldErrors
} from "./types";
import { getFieldError } from "./validation";

type Props = {
  value: SystemSettingsConversationSecurityReview;
  publishedValue?: SystemSettingsConversationSecurityReview;
  fieldErrors: SystemSettingsFieldErrors;
  disabled?: boolean;
  onChange(patch: Partial<SystemSettingsConversationSecurityReview>): void;
};

type SelectOption = {
  value: string;
  label: string;
  searchText: string;
};

const REASONING_OPTIONS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].map((value) => ({
  value,
  label: value
}));

function optionFilter(input: string, option?: SelectOption) {
  return option?.searchText.toLowerCase().includes(input.trim().toLowerCase()) ?? false;
}

function scoreTone(score: number, settings: SystemSettingsConversationSecurityReview) {
  if (score >= settings.thresholds.critical) return "critical";
  if (score >= settings.thresholds.notify) return "high";
  if (score >= settings.thresholds.record) return "suspicious";
  return "normal";
}

function engineLabel(settings: SystemSettingsConversationSecurityReview) {
  if (settings.engine === "codex_runtime") return "Codex Runtime";
  if (settings.llmProvider === "active_codex_provider") return "活动 Codex Provider";
  if (settings.llmProvider === "openai_responses") return "OpenAI Responses";
  if (settings.llmProvider === "azure_openai") return "Azure OpenAI";
  return "OpenAI-compatible";
}

export function ConversationSecurityReviewSettingsView({
  value,
  publishedValue,
  fieldErrors,
  disabled,
  onChange
}: Props) {
  const [agentOptions, setAgentOptions] = useState<SelectOption[]>([]);
  const [knowledgeOptions, setKnowledgeOptions] = useState<SelectOption[]>([]);
  const [recipientOptions, setRecipientOptions] = useState<SelectOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [testOpen, setTestOpen] = useState(false);
  const [testQuestion, setTestQuestion] = useState("");
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState("");
  const [testResult, setTestResult] = useState<Awaited<ReturnType<typeof testConversationSecurityReview>> | null>(null);

  useEffect(() => {
    let active = true;
    async function loadOptions() {
      setOptionsLoading(true);
      setOptionsError("");
      try {
        const [agents, knowledgeSets, users] = await Promise.all([
          fetchAgentModes(),
          fetchKnowledgeSets(),
          fetchAdminUsers()
        ]);
        if (!active) return;
        setAgentOptions(
          agents.agentModes
            .filter((item) => item.status === "active")
            .map((item) => ({
              value: item.id,
              label: `${item.name} · ${item.slug}`,
              searchText: `${item.name} ${item.slug}`
            }))
        );
        setKnowledgeOptions(
          knowledgeSets.knowledgeSets
            .filter((item) => item.status === "active")
            .map((item) => ({
              value: item.id,
              label: `${item.name} · ${item.slug}`,
              searchText: `${item.name} ${item.slug}`
            }))
        );
        setRecipientOptions(
          users.users
            .filter((item) => item.effective.status === "active" && Boolean(item.synced.dingtalkUserId))
            .map((item) => {
              const displayName = item.synced.displayName || item.synced.email || item.id;
              const role = item.primaryRole?.name || item.local.role;
              return {
                value: item.id,
                label: `${displayName} · ${role}`,
                searchText: `${displayName} ${item.synced.email || ""} ${role}`
              };
            })
        );
      } catch (error) {
        if (active) setOptionsError(error instanceof Error ? error.message : "加载配置选项失败");
      } finally {
        if (active) setOptionsLoading(false);
      }
    }
    void loadOptions();
    return () => {
      active = false;
    };
  }, []);

  const effective = publishedValue ?? value;
  const audienceLabel = useMemo(() => {
    const labels = [
      effective.audiences.externalUsers ? "外部" : "",
      effective.audiences.internalUsers ? "内部" : ""
    ].filter(Boolean);
    return labels.length ? labels.join(" + ") : "未启用";
  }, [effective.audiences.externalUsers, effective.audiences.internalUsers]);

  function updateContext(patch: Partial<SystemSettingsConversationSecurityReview["context"]>) {
    onChange({ context: { ...value.context, ...patch } });
  }

  function updateThresholds(patch: Partial<SystemSettingsConversationSecurityReview["thresholds"]>) {
    onChange({ thresholds: { ...value.thresholds, ...patch } });
  }

  function updateRepeatedRisk(patch: Partial<SystemSettingsConversationSecurityReview["repeatedRisk"]>) {
    onChange({ repeatedRisk: { ...value.repeatedRisk, ...patch } });
  }

  function updateNotification(patch: Partial<SystemSettingsConversationSecurityReview["notification"]>) {
    onChange({ notification: { ...value.notification, ...patch } });
  }

  async function runTest() {
    const question = testQuestion.trim();
    if (!question) {
      setTestError("请输入要测试的问题");
      return;
    }
    setTesting(true);
    setTestError("");
    setTestResult(null);
    try {
      setTestResult(await testConversationSecurityReview({ question, settings: value }));
    } catch (error) {
      setTestError(error instanceof Error ? error.message : "测试审核失败");
    } finally {
      setTesting(false);
    }
  }

  const promptError = getFieldError(fieldErrors, "conversationSecurityReview.prompt");
  const modelError = getFieldError(fieldErrors, "conversationSecurityReview.llmModel");
  const thresholdError = getFieldError(fieldErrors, "conversationSecurityReview.thresholds.notify");
  const recipientError = getFieldError(fieldErrors, "conversationSecurityReview.notification.recipientUserIds");

  return (
    <>
      <section className="conversation-security-review-heading">
        <div>
          <div className="conversation-security-review-title-line">
            <h3>对话安全审查</h3>
            {value.observationMode ? <Tag color="gold">观察模式</Tag> : <Tag color="blue">告警生效</Tag>}
          </div>
          <p>异步分析问题链、身份与企业上下文，在风险升级时通知管理员。</p>
        </div>
        <label className="conversation-security-review-master">
          <span>启用对话安全审查</span>
          <Switch
            checked={value.enabled}
            disabled={disabled}
            onChange={(enabled) => onChange({ enabled })}
          />
        </label>
      </section>

      <Alert
        type="info"
        showIcon
        className="conversation-security-review-info"
        message="审核在回答链路之外运行"
        description="不会向客户智能体追加提示词，也不会延长正常回答。Codex Runtime 使用独立只读会话；LLM 模式只发送配置允许的审核上下文。"
      />

      {optionsError ? (
        <Alert type="warning" showIcon message="部分配置选项未加载" description={optionsError} />
      ) : null}

      <div className="conversation-security-review-layout">
        <div className="conversation-security-review-main">
          <section className="conversation-security-review-card">
            <div className="conversation-security-review-card-heading">
              <span className="conversation-security-review-step">1</span>
              <div>
                <h4>审查范围</h4>
                <p>内部、外部用户可独立启用；空的智能体或资料集范围表示全部。</p>
              </div>
            </div>

            <div className="conversation-security-review-audience-grid">
              <label className="conversation-security-review-audience">
                <Switch
                  checked={value.audiences.externalUsers}
                  disabled={disabled}
                  onChange={(externalUsers) =>
                    onChange({ audiences: { ...value.audiences, externalUsers } })
                  }
                />
                <span>
                  <strong>外部用户</strong>
                  <small>客户企业账号和外部成员</small>
                </span>
              </label>
              <label className="conversation-security-review-audience">
                <Switch
                  checked={value.audiences.internalUsers}
                  disabled={disabled}
                  onChange={(internalUsers) =>
                    onChange({ audiences: { ...value.audiences, internalUsers } })
                  }
                />
                <span>
                  <strong>内部用户</strong>
                  <small>内部员工、管理员和超级管理员</small>
                </span>
              </label>
            </div>

            <div className="conversation-security-review-form-grid">
              <label className="field">
                <span className="field-label">渠道</span>
                <Checkbox
                  checked={value.channels.portal}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange({ channels: { ...value.channels, portal: event.target.checked } })
                  }
                >
                  Web Portal
                </Checkbox>
                <span className="field-help">当前版本只接入 Web 对话，后续渠道可沿用同一审核任务。</span>
              </label>
              <label className="field">
                <span className="field-label">智能体范围</span>
                <Select
                  mode="multiple"
                  allowClear
                  showSearch
                  loading={optionsLoading}
                  disabled={disabled}
                  placeholder="全部智能体"
                  value={value.agentModeIds}
                  options={agentOptions}
                  filterOption={optionFilter}
                  onChange={(agentModeIds) => onChange({ agentModeIds })}
                />
              </label>
              <label className="field conversation-security-review-span-2">
                <span className="field-label">资料集范围</span>
                <Select
                  mode="multiple"
                  allowClear
                  showSearch
                  loading={optionsLoading}
                  disabled={disabled}
                  placeholder="全部资料集"
                  value={value.knowledgeSetIds}
                  options={knowledgeOptions}
                  filterOption={optionFilter}
                  onChange={(knowledgeSetIds) => onChange({ knowledgeSetIds })}
                />
              </label>
            </div>
          </section>

          <section className="conversation-security-review-card">
            <div className="conversation-security-review-card-heading">
              <span className="conversation-security-review-step">2</span>
              <div>
                <h4>审核引擎</h4>
                <p>Codex 复用现有登录或 Provider；LLM 模式适合独立模型与成本控制。</p>
              </div>
              <Button
                icon={<FlaskConical size={15} aria-hidden="true" />}
                disabled={disabled}
                onClick={() => {
                  setTestError("");
                  setTestResult(null);
                  setTestOpen(true);
                }}
              >
                测试审核
              </Button>
            </div>

            <Radio.Group
              className="conversation-security-review-engine"
              value={value.engine}
              disabled={disabled}
              onChange={(event) => onChange({ engine: event.target.value })}
            >
              <Radio.Button value="codex_runtime">Codex Runtime</Radio.Button>
              <Radio.Button value="llm">可配置 LLM</Radio.Button>
            </Radio.Group>

            <div className="conversation-security-review-form-grid">
              {value.engine === "llm" ? (
                <label className="field">
                  <span className="field-label">LLM Provider</span>
                  <Select
                    value={value.llmProvider}
                    disabled={disabled}
                    options={[
                      { value: "active_codex_provider", label: "活动 Codex Provider" },
                      { value: "openai_responses", label: "OpenAI Responses" },
                      { value: "openai_compatible", label: "OpenAI-compatible" },
                      { value: "azure_openai", label: "Azure OpenAI" }
                    ]}
                    onChange={(llmProvider) => onChange({ llmProvider })}
                  />
                </label>
              ) : (
                <div className="field">
                  <span className="field-label">运行来源</span>
                  <div className="conversation-security-review-static-field">活动 Codex Provider</div>
                  <span className="field-help">创建无知识库、无附加目录的独立只读审核会话。</span>
                </div>
              )}
              <label className="field">
                <span className="field-label">模型</span>
                <Input
                  value={value.llmModel}
                  disabled={disabled}
                  spellCheck={false}
                  placeholder={value.engine === "codex_runtime" ? "留空使用活动 Provider 默认模型" : "输入模型或部署名"}
                  aria-invalid={Boolean(modelError)}
                  onChange={(event) => onChange({ llmModel: event.target.value })}
                />
                {modelError ? <span className="field-error">{modelError}</span> : null}
              </label>
              <label className="field">
                <span className="field-label">推理强度</span>
                <Select
                  value={value.reasoningEffort}
                  disabled={disabled}
                  options={REASONING_OPTIONS}
                  onChange={(reasoningEffort) => onChange({ reasoningEffort })}
                />
              </label>
              {value.engine === "llm" ? (
                <label className="field">
                  <span className="field-label">API 模式</span>
                  <Select
                    value={value.llmApiMode}
                    disabled={disabled}
                    options={[
                      { value: "auto", label: "自动" },
                      { value: "responses", label: "Responses" },
                      { value: "chat_completions", label: "Chat Completions" }
                    ]}
                    onChange={(llmApiMode) => onChange({ llmApiMode })}
                  />
                </label>
              ) : null}
              {value.engine === "llm" && value.llmProvider !== "active_codex_provider" ? (
                <>
                  <label className="field conversation-security-review-span-2">
                    <span className="field-label">Base URL</span>
                    <Input
                      value={value.llmBaseUrl}
                      disabled={disabled}
                      spellCheck={false}
                      placeholder="https://api.openai.com/v1"
                      onChange={(event) => onChange({ llmBaseUrl: event.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">API Key 环境变量</span>
                    <Input
                      value={value.llmApiKeyEnv}
                      disabled={disabled}
                      spellCheck={false}
                      onChange={(event) => onChange({ llmApiKeyEnv: event.target.value })}
                    />
                  </label>
                  {value.llmProvider === "azure_openai" ? (
                    <label className="field">
                      <span className="field-label">Azure API Version</span>
                      <Input
                        value={value.llmAzureApiVersion}
                        disabled={disabled}
                        spellCheck={false}
                        onChange={(event) => onChange({ llmAzureApiVersion: event.target.value })}
                      />
                    </label>
                  ) : null}
                </>
              ) : null}
            </div>
          </section>

          <section className="conversation-security-review-card">
            <div className="conversation-security-review-card-heading">
              <span className="conversation-security-review-step">3</span>
              <div>
                <h4>提示词与上下文</h4>
                <p>审核提示词独立于客户智能体，不改变客户回答行为。</p>
              </div>
            </div>

            <label className="field">
              <span className="field-label">安全审核提示词</span>
              <Input.TextArea
                value={value.prompt}
                disabled={disabled}
                rows={8}
                aria-invalid={Boolean(promptError)}
                onChange={(event) => onChange({ prompt: event.target.value })}
              />
              <span className="field-help">系统会在其后追加固定 JSON 输出约束和经过裁剪的上下文。</span>
              {promptError ? <span className="field-error">{promptError}</span> : null}
            </label>

            <div className="conversation-security-review-context-grid">
              <label className="field">
                <span className="field-label">当前会话</span>
                <InputNumber
                  min={1}
                  max={20}
                  value={value.context.currentThreadTurns}
                  disabled={disabled}
                  suffix="轮"
                  onChange={(next) => updateContext({ currentThreadTurns: next ?? 8 })}
                />
              </label>
              <label className="field">
                <span className="field-label">跨会话窗口</span>
                <InputNumber
                  min={0}
                  max={720}
                  value={value.context.crossThreadHours}
                  disabled={disabled}
                  suffix="小时"
                  onChange={(next) => updateContext({ crossThreadHours: next ?? 24 })}
                />
              </label>
              <label className="field">
                <span className="field-label">历史风险条数</span>
                <InputNumber
                  min={0}
                  max={50}
                  value={value.context.maxCrossThreadReviews}
                  disabled={disabled}
                  suffix="条"
                  onChange={(next) => updateContext({ maxCrossThreadReviews: next ?? 12 })}
                />
              </label>
            </div>

            <div className="conversation-security-review-checkboxes" role="group" aria-label="包含的审核上下文">
              <Checkbox
                checked={value.context.includeUserIdentity}
                disabled={disabled}
                onChange={(event) => updateContext({ includeUserIdentity: event.target.checked })}
              >
                用户身份
              </Checkbox>
              <Checkbox
                checked={value.context.includeEnterpriseContext}
                disabled={disabled}
                onChange={(event) => updateContext({ includeEnterpriseContext: event.target.checked })}
              >
                企业信息
              </Checkbox>
              <Checkbox
                checked={value.context.includeAgentAndKnowledgeScope}
                disabled={disabled}
                onChange={(event) => updateContext({ includeAgentAndKnowledgeScope: event.target.checked })}
              >
                智能体 / 资料集
              </Checkbox>
              <Checkbox
                checked={value.context.includeAssistantResponse}
                disabled={disabled}
                onChange={(event) => updateContext({ includeAssistantResponse: event.target.checked })}
              >
                助手回答结果
              </Checkbox>
            </div>
          </section>

          <section className="conversation-security-review-card">
            <div className="conversation-security-review-card-heading">
              <span className="conversation-security-review-step">4</span>
              <div>
                <h4>风险与通知</h4>
                <p>先记录，再按阈值通知；观察模式下不发送钉钉。</p>
              </div>
            </div>

            <div className="conversation-security-review-thresholds">
              <label>
                <span className="conversation-security-review-dot normal" aria-hidden="true" />
                记录
                <InputNumber
                  min={0}
                  max={100}
                  value={value.thresholds.record}
                  disabled={disabled}
                  onChange={(next) => updateThresholds({ record: next ?? 40 })}
                />
              </label>
              <label>
                <span className="conversation-security-review-dot suspicious" aria-hidden="true" />
                通知
                <InputNumber
                  min={0}
                  max={100}
                  value={value.thresholds.notify}
                  disabled={disabled}
                  status={thresholdError ? "error" : undefined}
                  onChange={(next) => updateThresholds({ notify: next ?? 70 })}
                />
              </label>
              <label>
                <span className="conversation-security-review-dot critical" aria-hidden="true" />
                严重
                <InputNumber
                  min={0}
                  max={100}
                  value={value.thresholds.critical}
                  disabled={disabled}
                  onChange={(next) => updateThresholds({ critical: next ?? 90 })}
                />
              </label>
            </div>
            {thresholdError ? <p className="field-error">{thresholdError}</p> : null}

            <div className="conversation-security-review-notification-grid">
              <label className="field">
                <span className="field-label">通知冷却期</span>
                <InputNumber
                  min={0}
                  max={10080}
                  value={value.notification.cooldownMinutes}
                  disabled={disabled}
                  suffix="分钟"
                  onChange={(next) => updateNotification({ cooldownMinutes: next ?? 45 })}
                />
              </label>
              <label className="field conversation-security-review-inline-switch">
                <span>
                  <span className="field-label">钉钉通知</span>
                  <span className="field-help">投递结果写入通知记录。</span>
                </span>
                <Switch
                  checked={value.notification.dingtalkEnabled}
                  disabled={disabled}
                  onChange={(dingtalkEnabled) => updateNotification({ dingtalkEnabled })}
                />
              </label>
              <label className="field conversation-security-review-inline-switch">
                <span>
                  <span className="field-label">观察模式</span>
                  <span className="field-help">只记录风险，不发送外部通知。</span>
                </span>
                <Switch
                  checked={value.observationMode}
                  disabled={disabled}
                  onChange={(observationMode) => onChange({ observationMode })}
                />
              </label>
            </div>

            <div className="field">
              <span className="field-label">接收范围</span>
              <Radio.Group
                value={value.notification.recipientMode}
                disabled={disabled}
                onChange={(event) => updateNotification({ recipientMode: event.target.value })}
              >
                <Radio value="all_super_admins">所有超级管理员</Radio>
                <Radio value="specified_users">指定用户</Radio>
              </Radio.Group>
            </div>
            {value.notification.recipientMode === "specified_users" ? (
              <label className="field">
                <span className="field-label">接收用户</span>
                <Select
                  mode="multiple"
                  showSearch
                  loading={optionsLoading}
                  disabled={disabled}
                  value={value.notification.recipientUserIds}
                  options={recipientOptions}
                  filterOption={optionFilter}
                  status={recipientError ? "error" : undefined}
                  placeholder="选择已绑定钉钉的内部用户"
                  onChange={(recipientUserIds) => updateNotification({ recipientUserIds })}
                />
                {recipientError ? <span className="field-error">{recipientError}</span> : null}
              </label>
            ) : null}

            <div className="conversation-security-review-repeat-rule">
              <Checkbox
                checked={value.repeatedRisk.enabled}
                disabled={disabled}
                onChange={(event) => updateRepeatedRisk({ enabled: event.target.checked })}
              >
                连续风险升级
              </Checkbox>
              <span>在</span>
              <InputNumber
                min={1}
                max={720}
                value={value.repeatedRisk.windowHours}
                disabled={disabled || !value.repeatedRisk.enabled}
                suffix="小时"
                onChange={(next) => updateRepeatedRisk({ windowHours: next ?? 24 })}
              />
              <span>内出现</span>
              <InputNumber
                min={2}
                max={20}
                value={value.repeatedRisk.count}
                disabled={disabled || !value.repeatedRisk.enabled}
                suffix="次"
                onChange={(next) => updateRepeatedRisk({ count: next ?? 2 })}
              />
              <span>不低于</span>
              <InputNumber
                min={0}
                max={100}
                value={value.repeatedRisk.minimumScore}
                disabled={disabled || !value.repeatedRisk.enabled}
                onChange={(next) => updateRepeatedRisk({ minimumScore: next ?? 55 })}
              />
              <span>分时通知</span>
            </div>
          </section>
        </div>

        <aside className="conversation-security-review-summary" aria-label="当前生效策略">
          <div className="conversation-security-review-summary-heading">
            <ShieldAlert size={18} aria-hidden="true" />
            <h4>当前生效策略</h4>
          </div>
          <dl>
            <div>
              <dt>状态</dt>
              <dd>{effective.enabled ? (effective.observationMode ? "观察模式" : "已启用") : "已关闭"}</dd>
            </div>
            <div>
              <dt>审查对象</dt>
              <dd>{audienceLabel}</dd>
            </div>
            <div>
              <dt>审查范围</dt>
              <dd>Web Portal</dd>
            </div>
            <div>
              <dt>引擎</dt>
              <dd>{engineLabel(effective)}</dd>
            </div>
            <div>
              <dt>模型</dt>
              <dd className="conversation-security-review-mono">{effective.llmModel || "Provider 默认"}</dd>
            </div>
            <div>
              <dt>上下文</dt>
              <dd>{effective.context.currentThreadTurns} 轮 / {effective.context.crossThreadHours} 小时</dd>
            </div>
            <div>
              <dt>通知</dt>
              <dd>{effective.notification.recipientMode === "all_super_admins" ? "超级管理员" : `${effective.notification.recipientUserIds.length} 个指定用户`}</dd>
            </div>
          </dl>

          <div className="conversation-security-review-ladder">
            <h5>风险等级与处理</h5>
            {[
              { range: `0–${effective.thresholds.record - 1}`, label: "正常", tone: "normal", detail: "不生成告警" },
              { range: `${effective.thresholds.record}–${effective.thresholds.notify - 1}`, label: "可疑", tone: "suspicious", detail: "记录到告警中心" },
              { range: `${effective.thresholds.notify}–${effective.thresholds.critical - 1}`, label: "高风险", tone: "high", detail: "通知管理员" },
              { range: `${effective.thresholds.critical}–100`, label: "严重", tone: "critical", detail: "立即通知" }
            ].map((item) => (
              <div className={`conversation-security-review-ladder-row ${item.tone}`} key={item.tone}>
                <span className="conversation-security-review-ladder-marker" aria-hidden="true" />
                <span className="conversation-security-review-mono">{item.range}</span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </div>
            ))}
          </div>
        </aside>
      </div>

      <Modal
        title="测试安全审核"
        open={testOpen}
        width={720}
        okText="运行测试审核"
        cancelText="关闭"
        confirmLoading={testing}
        okButtonProps={{ disabled: !testQuestion.trim() }}
        onOk={() => void runTest()}
        onCancel={() => setTestOpen(false)}
      >
        <p className="field-help">使用当前草稿中的引擎、模型和提示词。测试会计入 security_review 用量，但不会创建告警或发送钉钉。</p>
        <label className="field">
          <span className="field-label">模拟用户问题</span>
          <Input.TextArea
            rows={5}
            value={testQuestion}
            disabled={testing}
            placeholder="输入一条正常或可疑问题，验证评分与原因"
            onChange={(event) => setTestQuestion(event.target.value)}
          />
        </label>
        {testing ? <Spin size="small" /> : null}
        {testError ? <Alert type="error" showIcon message="测试失败" description={testError} /> : null}
        {testResult ? (
          <div className="conversation-security-review-test-result">
            <div>
              <Tag color={testResult.decision.score >= value.thresholds.critical ? "red" : testResult.decision.score >= value.thresholds.notify ? "orange" : "blue"}>
                {testResult.decision.score} / 100
              </Tag>
              <strong>{scoreTone(testResult.decision.score, value)}</strong>
              <span className="conversation-security-review-mono">{testResult.provider} · {testResult.model}</span>
            </div>
            <p>{testResult.decision.reason}</p>
            {testResult.decision.categories.length ? (
              <div>{testResult.decision.categories.map((category) => <Tag key={category}>{category}</Tag>)}</div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
