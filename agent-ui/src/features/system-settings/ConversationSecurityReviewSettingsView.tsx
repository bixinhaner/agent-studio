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
import { BellRing, FlaskConical, Info, ShieldAlert } from "lucide-react";

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
  if (score >= settings.thresholds.critical) return "严重";
  if (score >= settings.thresholds.notify) return "高风险";
  if (score >= settings.thresholds.record) return "可疑";
  return "正常";
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
      {optionsError ? (
        <Alert
          type="warning"
          showIcon
          className="conversation-security-review-options-error"
          message="部分配置选项未加载"
          description={optionsError}
        />
      ) : null}

      <div className="conversation-security-review-layout">
        <div className="conversation-security-review-main">
          <section className="conversation-security-review-card">
            <div className="conversation-security-review-card-heading">
              <h4><span>1.</span> 审查范围</h4>
              <p>内外部用户独立启用；智能体或资料集留空表示全部。</p>
            </div>

            <div className="conversation-security-review-audience-grid">
              <label className={`conversation-security-review-audience ${value.audiences.externalUsers ? "enabled" : ""}`}>
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
              <label className={`conversation-security-review-audience ${value.audiences.internalUsers ? "enabled" : ""}`}>
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

            <div className="conversation-security-review-scope-grid">
              <label className="conversation-security-review-compact-field">
                <span>渠道</span>
                <Checkbox
                  checked={value.channels.portal}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange({ channels: { ...value.channels, portal: event.target.checked } })
                  }
                >
                  Web Portal
                </Checkbox>
              </label>
              <label className="conversation-security-review-compact-field">
                <span>智能体</span>
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
                  maxTagCount="responsive"
                  onChange={(agentModeIds) => onChange({ agentModeIds })}
                />
              </label>
              <label className="conversation-security-review-compact-field">
                <span>资料集</span>
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
                  maxTagCount="responsive"
                  onChange={(knowledgeSetIds) => onChange({ knowledgeSetIds })}
                />
              </label>
            </div>
            <p className="conversation-security-review-footnote">
              <Info size={13} aria-hidden="true" />
              审核异步运行，不向客户智能体追加提示词，也不延长正常回答。
            </p>
          </section>

          <section className="conversation-security-review-card">
            <div className="conversation-security-review-card-heading">
              <h4><span>2.</span> 审核引擎</h4>
              <p>选择隔离 Codex Runtime，或使用独立 LLM Provider。</p>
            </div>

            <div className="conversation-security-review-engine-row">
              <label className="conversation-security-review-compact-field">
                <span>引擎</span>
                <Select
                  value={value.engine}
                  disabled={disabled}
                  options={[
                    { value: "codex_runtime", label: "Codex Runtime（活动 Provider）" },
                    { value: "llm", label: "可配置 LLM" }
                  ]}
                  onChange={(engine) => onChange({ engine })}
                />
              </label>
              {value.engine === "llm" ? (
                <label className="conversation-security-review-compact-field">
                  <span>Provider</span>
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
                <div className="conversation-security-review-compact-field">
                  <span>Provider</span>
                  <div className="conversation-security-review-static-field">活动 Codex Provider</div>
                </div>
              )}
              <label className="conversation-security-review-compact-field">
                <span>模型</span>
                <Input
                  value={value.llmModel}
                  disabled={disabled}
                  spellCheck={false}
                  placeholder="Provider 默认"
                  aria-invalid={Boolean(modelError)}
                  onChange={(event) => onChange({ llmModel: event.target.value })}
                />
              </label>
              <label className="conversation-security-review-compact-field">
                <span>推理强度</span>
                <Select
                  value={value.reasoningEffort}
                  disabled={disabled}
                  options={REASONING_OPTIONS}
                  onChange={(reasoningEffort) => onChange({ reasoningEffort })}
                />
              </label>
              <Button
                className="conversation-security-review-test-button"
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
            {modelError ? <span className="field-error">{modelError}</span> : null}

            {value.engine === "llm" ? (
              <div className="conversation-security-review-provider-details">
                <label className="conversation-security-review-compact-field">
                  <span>API 模式</span>
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
                {value.llmProvider !== "active_codex_provider" ? (
                  <>
                    <label className="conversation-security-review-compact-field conversation-security-review-provider-url">
                      <span>Base URL</span>
                      <Input
                        value={value.llmBaseUrl}
                        disabled={disabled}
                        spellCheck={false}
                        placeholder="https://api.openai.com/v1"
                        onChange={(event) => onChange({ llmBaseUrl: event.target.value })}
                      />
                    </label>
                    <label className="conversation-security-review-compact-field">
                      <span>Key 环境变量</span>
                      <Input
                        value={value.llmApiKeyEnv}
                        disabled={disabled}
                        spellCheck={false}
                        onChange={(event) => onChange({ llmApiKeyEnv: event.target.value })}
                      />
                    </label>
                    {value.llmProvider === "azure_openai" ? (
                      <label className="conversation-security-review-compact-field">
                        <span>API Version</span>
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
            ) : null}
            <p className="conversation-security-review-footnote">
              <Info size={13} aria-hidden="true" />
              Codex Runtime 创建无知识库、无附加目录、无网络的独立只读会话。
            </p>
          </section>

          <section className="conversation-security-review-card">
            <div className="conversation-security-review-card-heading">
              <h4><span>3.</span> 提示词与上下文</h4>
              <p>审核提示词独立于客户智能体，不改变客户回答行为。</p>
            </div>

            <div className="conversation-security-review-prompt-row">
              <div className="conversation-security-review-prompt-label">
                <strong>安全审核提示词</strong>
                <small>系统提示词</small>
              </div>
              <div>
                <Input.TextArea
                  value={value.prompt}
                  disabled={disabled}
                  rows={6}
                  aria-invalid={Boolean(promptError)}
                  onChange={(event) => onChange({ prompt: event.target.value })}
                />
                {promptError ? <span className="field-error">{promptError}</span> : null}
              </div>
            </div>

            <div className="conversation-security-review-context-row">
              <strong>上下文窗口</strong>
              <label>
                当前会话
                <InputNumber
                  min={1}
                  max={20}
                  value={value.context.currentThreadTurns}
                  disabled={disabled}
                  suffix="轮"
                  onChange={(next) => updateContext({ currentThreadTurns: next ?? 8 })}
                />
              </label>
              <label>
                跨会话
                <InputNumber
                  min={0}
                  max={720}
                  value={value.context.crossThreadHours}
                  disabled={disabled}
                  suffix="小时"
                  onChange={(next) => updateContext({ crossThreadHours: next ?? 24 })}
                />
              </label>
              <label>
                历史风险
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

            <div className="conversation-security-review-include-row" role="group" aria-label="包含的审核上下文">
              <strong>包含上下文</strong>
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
              <h4><span>4.</span> 风险与通知</h4>
              <p>达到记录阈值进入告警中心；观察模式不发送钉钉。</p>
            </div>

            <div className="conversation-security-review-threshold-row">
              <strong>风险阈值（分）</strong>
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

            <div className="conversation-security-review-notify-row">
              <strong>通知冷却期</strong>
              <InputNumber
                min={0}
                max={10080}
                value={value.notification.cooldownMinutes}
                disabled={disabled}
                suffix="分钟"
                onChange={(next) => updateNotification({ cooldownMinutes: next ?? 45 })}
              />
              <small>冷却期内同一用户的重复告警将合并。</small>
              <label className="conversation-security-review-switch-control">
                <Switch
                  checked={value.notification.dingtalkEnabled}
                  disabled={disabled}
                  onChange={(dingtalkEnabled) => updateNotification({ dingtalkEnabled })}
                />
                钉钉通知
              </label>
              <label className="conversation-security-review-switch-control">
                <Switch
                  checked={value.observationMode}
                  disabled={disabled}
                  onChange={(observationMode) => onChange({ observationMode })}
                />
                观察模式
              </label>
            </div>

            <div className="conversation-security-review-recipient-row">
              <strong>接收范围</strong>
              <Radio.Group
                value={value.notification.recipientMode}
                disabled={disabled}
                onChange={(event) => updateNotification({ recipientMode: event.target.value })}
              >
                <Radio value="all_super_admins">所有超级管理员</Radio>
                <Radio value="specified_users">指定用户</Radio>
              </Radio.Group>
              {value.notification.recipientMode === "specified_users" ? (
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
                  maxTagCount="responsive"
                  onChange={(recipientUserIds) => updateNotification({ recipientUserIds })}
                />
              ) : (
                <span className="conversation-security-review-recipient-hint">
                  <BellRing size={13} aria-hidden="true" />
                  通知所有已绑定钉钉的超级管理员
                </span>
              )}
            </div>
            {recipientError ? <span className="field-error">{recipientError}</span> : null}

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
            <ShieldAlert size={17} aria-hidden="true" />
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
              <dd>
                Web Portal
                <small>
                  智能体：{effective.agentModeIds.length || "全部"}<br />
                  资料集：{effective.knowledgeSetIds.length || "全部"}
                </small>
              </dd>
            </div>
            <div>
              <dt>引擎</dt>
              <dd>
                {engineLabel(effective)}
                <small>
                  模型：<span className="conversation-security-review-mono">{effective.llmModel || "Provider 默认"}</span><br />
                  推理强度：{effective.reasoningEffort}
                </small>
              </dd>
            </div>
            <div>
              <dt>上下文</dt>
              <dd>{effective.context.currentThreadTurns} 轮 / {effective.context.crossThreadHours} 小时</dd>
            </div>
            <div>
              <dt>通知</dt>
              <dd>
                {effective.notification.recipientMode === "all_super_admins" ? "超级管理员" : `${effective.notification.recipientUserIds.length} 个指定用户`}
                <small>冷却期：{effective.notification.cooldownMinutes} 分钟</small>
              </dd>
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
