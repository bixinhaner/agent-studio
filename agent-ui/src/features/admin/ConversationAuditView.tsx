import { Alert, Button, Card, Empty, Input, Pagination, Segmented, Select, Space, Spin, Statistic, Tag, Typography } from "antd";
import {
  Activity,
  Clock3,
  HardDrive,
  MessageSquareText,
  Network,
  RefreshCcw,
  Search,
  ThumbsDown,
  ThumbsUp,
  UserRound,
  type LucideIcon
} from "lucide-react";
import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";

import {
  fetchAdminApiAuditDetail,
  fetchAdminApiAuditList,
  fetchAdminConversationAuditDetail,
  fetchAdminConversationAuditList
} from "./api";
import type {
  AdminApiAuditDeliveryFilter,
  AdminApiAuditDetailResponse,
  AdminApiAuditListResponse,
  AdminApiAuditRecord,
  AdminApiAuditResultFilter,
  AdminApiAuditSort,
  AdminConversationDetailResponse,
  AdminConversationFeedbackFilter,
  AdminConversationListResponse,
  AdminConversationSort,
  AdminConversationStatusFilter,
  AdminConversationSummary,
  AdminConversationTranscriptMessage,
  AdminConversationUser
} from "./types";

type AuditMode = "conversations" | "api";
type TranscriptRoleFilter = "all" | AdminConversationTranscriptMessage["role"];

const AUDIT_MODE_OPTIONS: Array<{ value: AuditMode; label: string }> = [
  { value: "conversations", label: "用户会话" },
  { value: "api", label: "API 调用" }
];

const AUDIT_MODE_STORY: Record<
  AuditMode,
  {
    eyebrow: string;
    title: string;
    detail: string;
    notes: Array<{ label: string; text: string }>;
  }
> = {
  conversations: {
    eyebrow: "Conversation Investigations",
    title: "围绕线程、反馈和转录上下文组织调查，而不是只翻聊天日志。",
    detail: "适合定位用户问题、回看模型响应、复盘负向反馈，沿着会话时间线快速理解发生过什么。",
    notes: [
      { label: "主索引", text: "先用标题、用户、反馈和模型锁定目标线程，再进入右侧详情。" },
      { label: "核心线索", text: "优先关注反馈、最近摘要和消息角色分布，能最快判断问题落点。" },
      { label: "复盘方式", text: "把时间线当叙事来阅读，而不是把记录当数据库行逐个检索。" }
    ]
  },
  api: {
    eyebrow: "Request Forensics",
    title: "把 API 审计做成请求取证视图，而不是纯技术流水账。",
    detail: "适合围绕 IP、传输状态、时延和 Token 消耗快速判断异常来源，定位生成与交付链路的断点。",
    notes: [
      { label: "主索引", text: "从 IP、实例、Session 和模型组合入手，优先锁定异常请求簇。" },
      { label: "核心线索", text: "结果状态、交付状态和时延一起看，能更快判断是生成问题还是传输问题。" },
      { label: "复盘方式", text: "把单条请求放回同 IP、同会话和同实例上下文里观察，不要孤立处理。" }
    ]
  }
};

const STATUS_OPTIONS: Array<{ value: AdminConversationStatusFilter; label: string }> = [
  { value: "all", label: "全部状态" },
  { value: "regular", label: "活跃线程" },
  { value: "archived", label: "已归档" }
];

const FEEDBACK_OPTIONS: Array<{ value: AdminConversationFeedbackFilter; label: string }> = [
  { value: "all", label: "全部反馈" },
  { value: "with_feedback", label: "有反馈" },
  { value: "positive", label: "含正向反馈" },
  { value: "negative", label: "含负向反馈" },
  { value: "none", label: "无反馈" }
];

const SORT_OPTIONS: Array<{ value: AdminConversationSort; label: string }> = [
  { value: "updated_desc", label: "最近更新" },
  { value: "created_desc", label: "最近创建" }
];

const TRANSCRIPT_ROLE_OPTIONS: Array<{ value: TranscriptRoleFilter; label: string }> = [
  { value: "all", label: "全部角色" },
  { value: "user", label: "用户" },
  { value: "assistant", label: "助手" },
  { value: "system", label: "系统" },
  { value: "tool", label: "工具" }
];

const API_RESULT_OPTIONS: Array<{ value: AdminApiAuditResultFilter; label: string }> = [
  { value: "all", label: "全部结果" },
  { value: "success", label: "生成成功" },
  { value: "failed", label: "生成失败" }
];

const API_DELIVERY_OPTIONS: Array<{ value: AdminApiAuditDeliveryFilter; label: string }> = [
  { value: "all", label: "全部传输" },
  { value: "delivered", label: "已送达" },
  { value: "client_aborted", label: "客户端中断" },
  { value: "connection_closed", label: "连接中断" },
  { value: "unknown", label: "未知" }
];

const API_SORT_OPTIONS: Array<{ value: AdminApiAuditSort; label: string }> = [
  { value: "created_desc", label: "最近请求" },
  { value: "tokens_desc", label: "Token 最高" },
  { value: "latency_desc", label: "时延最高" }
];

function formatLocalDateTime(value: string | null | undefined): string {
  if (!value) return "未知时间";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatInteger(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0";
  return value.toLocaleString();
}

function formatMs(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "未记录";
  return `${value.toLocaleString()} ms`;
}

function compactId(value: string | null | undefined, left = 6, right = 4): string {
  const normalized = value?.trim();
  if (!normalized) return "未记录";
  return normalized.length <= left + right + 2 ? normalized : `${normalized.slice(0, left)}··${normalized.slice(-right)}`;
}

function displayUserLabel(user: AdminConversationUser | null): string {
  return user?.displayName || user?.email || "未关联用户";
}

function userMonogram(user: AdminConversationUser | null): string {
  const source = displayUserLabel(user).replace(/\s+/g, "");
  if (!source) return "NA";
  return source.slice(0, 2).toUpperCase();
}

function ipIdentityLabel(record: AdminApiAuditRecord): string {
  return record.clientIp || "IP 暂缺";
}

function ipMonogram(record: AdminApiAuditRecord): string {
  if (!record.clientIp) return "IP";
  const normalized = record.clientIp.replace(/[^a-zA-Z0-9]/g, "");
  return (normalized.slice(-2) || "IP").toUpperCase();
}

function conversationStatusColor(status: string): string {
  return status === "archived" ? "default" : "blue";
}

function feedbackColor(type: "positive" | "negative"): string {
  return type === "positive" ? "success" : "error";
}

function apiResultLabel(value: string): string {
  return value === "success" ? "生成成功" : value === "failed" ? "生成失败" : value;
}

function apiResultColor(value: string): string {
  return value === "success" ? "success" : "error";
}

function apiDeliveryLabel(value: string): string {
  if (value === "delivered") return "已送达";
  if (value === "client_aborted") return "客户端中断";
  if (value === "connection_closed") return "连接中断";
  return "未知";
}

function apiDeliveryColor(value: string): string {
  return value === "delivered" ? "blue" : value === "unknown" ? "default" : "warning";
}

function apiTransportLabel(value: string): string {
  return value === "stream" ? "Streaming" : "Non-stream";
}

function apiPreviewText(record: AdminApiAuditRecord): string {
  return record.preview.latest || record.preview.prompt || "该调用未持久化正文摘要，通常是历史事件或仅记录了元数据。";
}

function apiInstanceLabel(record: AdminApiAuditRecord): string {
  return record.integration.name || record.integration.slug || "未识别实例";
}

function apiPromptLabel(record: AdminApiAuditRecord): string {
  return record.preview.prompt || "当前记录没有落下首轮请求摘要。";
}

function apiLatestLabel(record: AdminApiAuditRecord): string {
  return record.preview.latest || "当前记录没有落下最近消息摘要。";
}

function sentimentText(summary: AdminConversationSummary["feedbackSummary"]): string {
  if (summary.total === 0) return "暂无反馈";
  const ratio = Math.round((summary.positive / summary.total) * 100);
  return `正向率 ${ratio}%`;
}

function sentimentMood(summary: AdminConversationSummary["feedbackSummary"]): string {
  if (summary.total === 0) return "未形成反馈样本";
  if (summary.negative > summary.positive) return "负向占优";
  if (summary.negative === summary.positive) return "评价分化";
  return "整体偏正向";
}

function sentimentBar(summary: AdminConversationSummary["feedbackSummary"]): { positive: number; negative: number; neutral: number } {
  if (summary.total === 0) {
    return { positive: 0, negative: 0, neutral: 100 };
  }
  const positive = Math.round((summary.positive / summary.total) * 100);
  const negative = Math.round((summary.negative / summary.total) * 100);
  const neutral = Math.max(0, 100 - positive - negative);
  return { positive, negative, neutral };
}

function apiHealthBar(record: AdminApiAuditRecord): { positive: number; negative: number; neutral: number } {
  if (record.status.result !== "success") {
    return { positive: 0, neutral: 24, negative: 76 };
  }
  if (record.status.delivery !== "delivered") {
    return { positive: 42, neutral: 58, negative: 0 };
  }
  return { positive: 100, neutral: 0, negative: 0 };
}

function apiHealthText(record: AdminApiAuditRecord): string {
  if (record.status.result !== "success") return "生成失败";
  if (record.status.delivery !== "delivered") return "生成成功但传输未完整送达";
  return "生成与传输均正常";
}

function compactWorkspaceLabel(workspace: string): string {
  const normalized = workspace.trim();
  if (!normalized) return "未记录";
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length <= 2) return normalized;
  return segments.slice(-2).join("/");
}

function roleLabel(role: AdminConversationTranscriptMessage["role"]): string {
  if (role === "user") return "用户";
  if (role === "assistant") return "助手";
  if (role === "tool") return "工具";
  return "系统";
}

function MarkdownLink(props: { href?: string; children?: ReactNode }) {
  const href = typeof props.href === "string" ? props.href : "";
  if (!href) {
    return <span>{props.children}</span>;
  }
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {props.children}
    </a>
  );
}

function ConversationAuditMarkdown(props: { text: string; className?: string }) {
  return (
    <div className={props.className ? `conversation-audit-markdown ${props.className}` : "conversation-audit-markdown"}>
      <ReactMarkdown
        components={{
          h1: ({ className, ...rest }) => <h1 className={className ? `aui-md-h1 ${className}` : "aui-md-h1"} {...rest} />,
          h2: ({ className, ...rest }) => <h2 className={className ? `aui-md-h2 ${className}` : "aui-md-h2"} {...rest} />,
          h3: ({ className, ...rest }) => <h3 className={className ? `aui-md-h3 ${className}` : "aui-md-h3"} {...rest} />,
          h4: ({ className, ...rest }) => <h4 className={className ? `aui-md-h4 ${className}` : "aui-md-h4"} {...rest} />,
          p: ({ className, ...rest }) => <p className={className ? `aui-md-p ${className}` : "aui-md-p"} {...rest} />,
          a: MarkdownLink as never,
          ul: ({ className, ...rest }) => <ul className={className ? `aui-md-ul ${className}` : "aui-md-ul"} {...rest} />,
          ol: ({ className, ...rest }) => <ol className={className ? `aui-md-ol ${className}` : "aui-md-ol"} {...rest} />,
          blockquote: ({ className, ...rest }) => (
            <blockquote className={className ? `aui-md-blockquote ${className}` : "aui-md-blockquote"} {...rest} />
          ),
          code: ({ inline, className, ...rest }: any) =>
            inline ? (
              <code className={className ? `aui-md-inline-code ${className}` : "aui-md-inline-code"} {...rest} />
            ) : (
              <code className={className} {...rest} />
            ),
          pre: ({ className, ...rest }) => <pre className={className ? `aui-md-pre ${className}` : "aui-md-pre"} {...rest} />
        }}
      >
        {props.text}
      </ReactMarkdown>
    </div>
  );
}

function SummaryCard(props: { title: string; value: number | string; suffix?: string }) {
  return (
    <Card size="small" className="conversation-audit-summary-card">
      <Statistic title={props.title} value={props.value} suffix={props.suffix} />
    </Card>
  );
}

function InsightCard(props: { label: string; text: string }) {
  return (
    <article className="conversation-audit-insight-card">
      <span>{props.label}</span>
      <strong>{props.text}</strong>
    </article>
  );
}

function AuditGuidanceCard(props: { label: string; text: string }) {
  return (
    <article className="conversation-audit-command-card">
      <span>{props.label}</span>
      <strong>{props.text}</strong>
    </article>
  );
}

function MetricCard(props: { icon: LucideIcon; title: string; text: string; detail: string }) {
  const Icon = props.icon;
  return (
    <div className="conversation-audit-detail-metric">
      <Icon size={16} />
      <div>
        <strong>{props.text}</strong>
        <span>
          {props.title} · {props.detail}
        </span>
      </div>
    </div>
  );
}

function deriveLatestAssistantReply(
  conversation: AdminConversationDetailResponse["conversation"],
  transcript: AdminConversationTranscriptMessage[]
): string {
  const item = [...transcript].reverse().find((message) => message.role === "assistant" && message.text.trim());
  return item?.text || conversation.preview.latestText || "暂无助手文本回复";
}

function ThreadListItem(props: {
  conversation: AdminConversationSummary;
  active: boolean;
  onSelect(): void;
}) {
  const latestAt = props.conversation.feedbackSummary.latestAt;
  const sentiment = sentimentBar(props.conversation.feedbackSummary);

  return (
    <button
      type="button"
      className={props.active ? "conversation-audit-thread-card is-active" : "conversation-audit-thread-card"}
      onClick={props.onSelect}
    >
      <div className="conversation-audit-thread-top">
        <div className="conversation-audit-thread-lead">
          <span className="conversation-audit-thread-avatar">{userMonogram(props.conversation.user)}</span>
          <div className="conversation-audit-thread-title-block">
            <strong>{props.conversation.title}</strong>
            <small>{displayUserLabel(props.conversation.user)}</small>
          </div>
        </div>
        <span className="conversation-audit-thread-time">{formatLocalDateTime(props.conversation.updatedAt)}</span>
      </div>

      <p className="conversation-audit-thread-preview">
        {props.conversation.preview.latestText || props.conversation.preview.firstUserText || "该会话暂无可提取文本摘要。"}
      </p>

      <div className="conversation-audit-thread-meta">
        <Tag color={conversationStatusColor(props.conversation.status)}>
          {props.conversation.status === "archived" ? "已归档" : "活跃"}
        </Tag>
        <Tag>{props.conversation.metrics.messageCount} 条消息</Tag>
        {props.conversation.activeSession ? <Tag color="green">运行中</Tag> : null}
        {props.conversation.feedbackSummary.positive > 0 ? <Tag color="success">+{props.conversation.feedbackSummary.positive}</Tag> : null}
        {props.conversation.feedbackSummary.negative > 0 ? <Tag color="error">-{props.conversation.feedbackSummary.negative}</Tag> : null}
      </div>

      <div className="conversation-audit-thread-foot">
        <span>{props.conversation.model}</span>
        <span>{props.conversation.reasoningEffort}</span>
        <span>{latestAt ? `反馈更新 ${formatLocalDateTime(latestAt)}` : sentimentText(props.conversation.feedbackSummary)}</span>
      </div>

      <div className="conversation-audit-thread-sentiment">
        <div className="conversation-audit-thread-sentiment-bar" aria-hidden="true">
          <span className="is-positive" style={{ width: `${sentiment.positive}%` }} />
          <span className="is-neutral" style={{ width: `${sentiment.neutral}%` }} />
          <span className="is-negative" style={{ width: `${sentiment.negative}%` }} />
        </div>
        <small>{sentimentMood(props.conversation.feedbackSummary)}</small>
      </div>
    </button>
  );
}

function ApiUsageListItem(props: {
  record: AdminApiAuditRecord;
  active: boolean;
  onSelect(): void;
}) {
  const health = apiHealthBar(props.record);

  return (
    <button
      type="button"
      className={props.active ? "conversation-audit-thread-card is-active" : "conversation-audit-thread-card"}
      onClick={props.onSelect}
    >
      <div className="conversation-audit-thread-top">
        <div className="conversation-audit-thread-lead">
          <span className="conversation-audit-thread-avatar">{ipMonogram(props.record)}</span>
          <div className="conversation-audit-thread-title-block">
            <strong>{ipIdentityLabel(props.record)}</strong>
            <small>{apiInstanceLabel(props.record)}</small>
          </div>
        </div>
        <span className="conversation-audit-thread-time">{formatLocalDateTime(props.record.createdAt)}</span>
      </div>

      <p className="conversation-audit-thread-preview">{apiPreviewText(props.record)}</p>

      <div className="conversation-audit-thread-meta">
        <Tag color={apiResultColor(props.record.status.result)}>{apiResultLabel(props.record.status.result)}</Tag>
        <Tag color={apiDeliveryColor(props.record.status.delivery)}>{apiDeliveryLabel(props.record.status.delivery)}</Tag>
        <Tag>{props.record.model}</Tag>
        <Tag>{formatInteger(props.record.metrics.totalTokens)} tokens</Tag>
      </div>

      <div className="conversation-audit-thread-foot">
        <span>{compactId(props.record.sessionId)}</span>
        <span>{apiTransportLabel(props.record.transport.responseMode)}</span>
        <span>{formatMs(props.record.metrics.responseCompletedMs)}</span>
      </div>

      <div className="conversation-audit-thread-sentiment">
        <div className="conversation-audit-thread-sentiment-bar" aria-hidden="true">
          <span className="is-positive" style={{ width: `${health.positive}%` }} />
          <span className="is-neutral" style={{ width: `${health.neutral}%` }} />
          <span className="is-negative" style={{ width: `${health.negative}%` }} />
        </div>
        <small>{apiHealthText(props.record)}</small>
      </div>
    </button>
  );
}

function TranscriptMessageCard(props: {
  message: AdminConversationTranscriptMessage;
  highlighted: boolean;
  queryMatched: boolean;
  onMount(node: HTMLElement | null): void;
}) {
  const role = props.message.role;
  const stateClass =
    role === "user"
      ? "conversation-audit-message is-user"
      : role === "assistant"
        ? "conversation-audit-message is-assistant"
        : "conversation-audit-message is-system";
  const classes = [stateClass, props.highlighted ? "is-highlighted" : "", props.queryMatched ? "is-query-match" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={classes} ref={props.onMount} data-message-id={props.message.id}>
      <div className="conversation-audit-message-head">
        <span className="conversation-audit-message-role">{roleLabel(role)}</span>
        <span>{formatLocalDateTime(props.message.createdAt)}</span>
      </div>
      {props.message.text ? (
        <ConversationAuditMarkdown text={props.message.text} />
      ) : (
        <p className="conversation-audit-message-empty">该消息不包含可展示正文，可能仅包含结构化数据、附件或工具状态。</p>
      )}
      {props.message.hasRunConfig ? <Tag className="conversation-audit-run-tag">附带运行配置</Tag> : null}
    </article>
  );
}

function ConversationDetail(props: {
  detail: AdminConversationDetailResponse | null;
  loading: boolean;
  errorText: string;
  timezoneLabel: string;
}) {
  const [transcriptQuery, setTranscriptQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<TranscriptRoleFilter>("all");
  const [focusedMessageId, setFocusedMessageId] = useState("");
  const messageRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    setTranscriptQuery("");
    setRoleFilter("all");
    setFocusedMessageId("");
    messageRefs.current.clear();
  }, [props.detail?.conversation.id]);

  const deferredTranscriptQuery = useDeferredValue(transcriptQuery.trim().toLowerCase());
  const transcriptMessages = props.detail?.transcript.messages ?? [];
  const filteredTranscript = useMemo(() => {
    return transcriptMessages.filter((message) => {
      if (roleFilter !== "all" && message.role !== roleFilter) return false;
      if (!deferredTranscriptQuery) return true;
      return message.text.toLowerCase().includes(deferredTranscriptQuery) || roleLabel(message.role).toLowerCase().includes(deferredTranscriptQuery);
    });
  }, [deferredTranscriptQuery, roleFilter, transcriptMessages]);

  useEffect(() => {
    if (!focusedMessageId) return;
    const node = messageRefs.current.get(focusedMessageId);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [filteredTranscript, focusedMessageId]);

  if (props.loading && !props.detail) {
    return (
      <div className="conversation-audit-detail-loading">
        <Spin />
      </div>
    );
  }

  if (!props.detail) {
    return (
      <div className="conversation-audit-detail-empty">
        <Empty description="选择左侧会话后查看完整记录与反馈轨迹" />
      </div>
    );
  }

  const conversation = props.detail.conversation;
  const firstUserPrompt = conversation.preview.firstUserText || "暂无首轮用户文本";
  const latestAssistantReply = deriveLatestAssistantReply(conversation, transcriptMessages);

  return (
    <div className="conversation-audit-detail-body">
      <section className="conversation-audit-detail-hero">
        <div className="conversation-audit-detail-hero-copy">
          <span className="conversation-audit-detail-eyebrow">Conversation Audit</span>
          <h3>{conversation.title}</h3>
          <p>
            {displayUserLabel(conversation.user)} · 创建于 {formatLocalDateTime(conversation.createdAt)} · 所有时间按 {props.timezoneLabel} 展示
          </p>
        </div>
        <div className="conversation-audit-detail-tags">
          <Tag color={conversationStatusColor(conversation.status)}>
            {conversation.status === "archived" ? "已归档" : "活跃会话"}
          </Tag>
          <Tag>{conversation.model}</Tag>
          <Tag>{conversation.reasoningEffort}</Tag>
          {conversation.activeSession ? <Tag color="green">活跃 Runtime</Tag> : null}
          {conversation.externalId ? <Tag>外部 ID</Tag> : null}
        </div>
      </section>

      <section className="conversation-audit-detail-fingerprint">
        <article className="conversation-audit-fingerprint-card">
          <span>Thread 指纹</span>
          <strong>{compactId(conversation.id)}</strong>
        </article>
        <article className="conversation-audit-fingerprint-card">
          <span>工作区尾段</span>
          <strong>{compactWorkspaceLabel(conversation.workspace)}</strong>
        </article>
        <article className="conversation-audit-fingerprint-card">
          <span>反馈判断</span>
          <strong>{sentimentMood(conversation.feedbackSummary)}</strong>
        </article>
      </section>

      {props.errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={props.errorText} /> : null}

      <section className="conversation-audit-detail-grid">
        <div className="conversation-audit-detail-metrics">
          <MetricCard
            icon={UserRound}
            title="身份"
            text={displayUserLabel(conversation.user)}
            detail={conversation.user ? `${conversation.user.role} · ${conversation.user.status}` : "匿名或已删除用户"}
          />
          <MetricCard
            icon={MessageSquareText}
            title="消息规模"
            text={`${formatInteger(conversation.metrics.messageCount)} 条消息`}
            detail={`用户 ${conversation.metrics.userMessageCount} / 助手 ${conversation.metrics.assistantMessageCount}`}
          />
          <MetricCard
            icon={Activity}
            title="反馈状态"
            text={`${formatInteger(conversation.feedbackSummary.total)} 条反馈`}
            detail={`正向 ${conversation.feedbackSummary.positive} / 负向 ${conversation.feedbackSummary.negative}`}
          />
          <MetricCard
            icon={HardDrive}
            title="工作区"
            text={conversation.workspace || "未记录工作区"}
            detail={`最后更新 ${formatLocalDateTime(conversation.updatedAt)}`}
          />
        </div>

        <div className="conversation-audit-insight-grid">
          <InsightCard label="首轮用户问题" text={firstUserPrompt} />
          <InsightCard label="最近一条助手回复" text={latestAssistantReply} />
        </div>

        <div className="conversation-audit-section">
          <div className="conversation-audit-section-head">
            <div>
              <h4>反馈记录</h4>
              <p>管理员可直接查看用户对具体消息的正负向反馈及其时间点。</p>
            </div>
          </div>
          <div className="conversation-audit-feedback-grid">
            {conversation.feedback.length === 0 ? (
              <div className="conversation-audit-feedback-empty">当前会话还没有记录到用户反馈。</div>
            ) : (
              conversation.feedback.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={
                    item.messageId && item.messageId === focusedMessageId
                      ? "conversation-audit-feedback-card is-active"
                      : "conversation-audit-feedback-card"
                  }
                  onClick={() => {
                    if (!item.messageId) return;
                    startTransition(() => {
                      setTranscriptQuery("");
                      setRoleFilter("all");
                      setFocusedMessageId(item.messageId || "");
                    });
                  }}
                >
                  <div className="conversation-audit-feedback-head">
                    <Tag color={feedbackColor(item.type)}>
                      <Space size={4}>
                        {item.type === "positive" ? <ThumbsUp size={12} /> : <ThumbsDown size={12} />}
                        <span>{item.type === "positive" ? "正向反馈" : "负向反馈"}</span>
                      </Space>
                    </Tag>
                    <span>{formatLocalDateTime(item.createdAt)}</span>
                  </div>
                  <p>{item.contentPreview || "未附带正文摘要"}</p>
                  {item.messageId ? <small>点击可定位到 Message ID: {item.messageId}</small> : null}
                </button>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="conversation-audit-section">
        <div className="conversation-audit-section-head">
          <div>
            <h4>完整对话</h4>
            <p>时间、角色和正文按照线程顺序展开，便于排查模型表现与用户反馈原因。</p>
          </div>
          <Tag>
            {filteredTranscript.length}/{props.detail.transcript.messageCount} 条
          </Tag>
        </div>

        <div className="conversation-audit-transcript-toolbar">
          <Input
            allowClear
            value={transcriptQuery}
            prefix={<Search size={15} />}
            placeholder="搜索消息正文"
            onChange={(event) => setTranscriptQuery(event.target.value)}
          />
          <Segmented
            options={TRANSCRIPT_ROLE_OPTIONS}
            value={roleFilter}
            onChange={(value) => setRoleFilter(value as TranscriptRoleFilter)}
          />
        </div>

        <div className="conversation-audit-transcript">
          {filteredTranscript.length === 0 ? (
            <div className="conversation-audit-feedback-empty">
              {props.detail.transcript.messageCount === 0 ? "当前会话还没有持久化消息。" : "当前筛选条件下没有匹配到消息。"}
            </div>
          ) : (
            filteredTranscript.map((message) => (
              <TranscriptMessageCard
                key={message.id}
                message={message}
                highlighted={Boolean(focusedMessageId) && message.id === focusedMessageId}
                queryMatched={Boolean(deferredTranscriptQuery) && message.text.toLowerCase().includes(deferredTranscriptQuery)}
                onMount={(node) => {
                  if (!node) {
                    messageRefs.current.delete(message.id);
                    return;
                  }
                  messageRefs.current.set(message.id, node);
                }}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function ApiAuditDetail(props: {
  detail: AdminApiAuditDetailResponse | null;
  loading: boolean;
  errorText: string;
  timezoneLabel: string;
}) {
  if (props.loading && !props.detail) {
    return (
      <div className="conversation-audit-detail-loading">
        <Spin />
      </div>
    );
  }

  if (!props.detail) {
    return (
      <div className="conversation-audit-detail-empty">
        <Empty description="选择左侧 API 调用后查看 IP、实例、状态和传输轨迹" />
      </div>
    );
  }

  const { record, relatedSummary } = props.detail;
  const captureMood = record.clientIp
    ? record.preview.prompt || record.preview.latest
      ? "采集完整"
      : "仅落元数据"
    : "缺少 IP";

  const requestTrail = [
    { label: "收到请求", value: formatLocalDateTime(record.createdAt), hint: record.sessionId ? `Session ${compactId(record.sessionId)}` : "未附带 Session ID" },
    { label: "开始响应", value: formatLocalDateTime(record.responseStartedAt), hint: formatMs(record.metrics.responseStartedMs) },
    { label: "首包就绪", value: formatLocalDateTime(record.responseReadyAt), hint: formatMs(record.metrics.responseReadyMs) },
    { label: "响应结束", value: formatLocalDateTime(record.responseCompletedAt), hint: formatMs(record.metrics.responseCompletedMs) }
  ];

  return (
    <div className="conversation-audit-detail-body">
      <section className="conversation-audit-detail-hero">
        <div className="conversation-audit-detail-hero-copy">
          <span className="conversation-audit-detail-eyebrow">API Audit</span>
          <h3>{ipIdentityLabel(record)}</h3>
          <p>
            {apiInstanceLabel(record)} · 请求发起于 {formatLocalDateTime(record.createdAt)} · 所有时间按 {props.timezoneLabel} 展示
          </p>
        </div>
        <div className="conversation-audit-detail-tags">
          <Tag color={apiResultColor(record.status.result)}>{apiResultLabel(record.status.result)}</Tag>
          <Tag color={apiDeliveryColor(record.status.delivery)}>{apiDeliveryLabel(record.status.delivery)}</Tag>
          <Tag>{record.model}</Tag>
          <Tag>{apiTransportLabel(record.transport.responseMode)}</Tag>
          {!record.clientIp ? <Tag>IP 暂缺</Tag> : null}
        </div>
      </section>

      <section className="conversation-audit-detail-fingerprint">
        <article className="conversation-audit-fingerprint-card">
          <span>Session 指纹</span>
          <strong>{compactId(record.sessionId)}</strong>
        </article>
        <article className="conversation-audit-fingerprint-card">
          <span>API 实例</span>
          <strong>{record.integration.slug || apiInstanceLabel(record)}</strong>
        </article>
        <article className="conversation-audit-fingerprint-card">
          <span>采集完整度</span>
          <strong>{captureMood}</strong>
        </article>
      </section>

      {props.errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={props.errorText} /> : null}

      <section className="conversation-audit-detail-grid">
        <div className="conversation-audit-detail-metrics">
          <MetricCard
            icon={Network}
            title="身份主键"
            text={ipIdentityLabel(record)}
            detail={
              record.clientIp
                ? `同 IP 共 ${formatInteger(relatedSummary.sameIpRequests)} 次，请求最早 ${formatLocalDateTime(relatedSummary.firstSeenAt)}`
                : "历史记录尚未采集到客户端 IP"
            }
          />
          <MetricCard
            icon={MessageSquareText}
            title="消息规模"
            text={`${formatInteger(record.messageCount)} 条输入消息`}
            detail={`输出 ${formatInteger(record.metrics.outputChars)} chars`}
          />
          <MetricCard
            icon={Activity}
            title="Token 消耗"
            text={`${formatInteger(record.metrics.totalTokens)} tokens`}
            detail={`Ready ${formatMs(record.metrics.responseReadyMs)} / Full ${formatMs(record.metrics.responseCompletedMs)}`}
          />
          <MetricCard
            icon={HardDrive}
            title="传输状态"
            text={record.transport.responseStatusCode ? `HTTP ${record.transport.responseStatusCode}` : "未记录状态码"}
            detail={`${apiDeliveryLabel(record.status.delivery)} · ${apiTransportLabel(record.transport.responseMode)}`}
          />
        </div>

        <div className="conversation-audit-insight-grid">
          <InsightCard label="首轮请求摘要" text={apiPromptLabel(record)} />
          <InsightCard label="最近消息摘要" text={apiLatestLabel(record)} />
        </div>

        <div className="conversation-audit-section">
          <div className="conversation-audit-section-head">
            <div>
              <h4>调用轨迹</h4>
              <p>展示请求接入、首包就绪和响应结束时间，方便判断是生成失败还是链路中断。</p>
            </div>
          </div>
          <div className="conversation-audit-api-flow">
            {requestTrail.map((item) => (
              <article key={item.label} className="conversation-audit-api-flow-card">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.hint}</small>
              </article>
            ))}
          </div>
        </div>

        <div className="conversation-audit-section">
          <div className="conversation-audit-section-head">
            <div>
              <h4>调用上下文</h4>
              <p>用实例、模型、传输标记和错误摘要来还原这次 API 请求的行为边界。</p>
            </div>
          </div>
          <div className="conversation-audit-api-context">
            <article className="conversation-audit-feedback-empty conversation-audit-api-context-card">
              <strong>实例与模型</strong>
              <p>
                {apiInstanceLabel(record)} · 请求模型 {record.requestedModel || "未指定"} · 实际模型 {record.model}
                {record.requestedReasoningEffort ? ` · 推理强度 ${record.requestedReasoningEffort}` : ""}
              </p>
            </article>
            <article className="conversation-audit-feedback-empty conversation-audit-api-context-card">
              <strong>链路标记</strong>
              <p>
                {record.transport.requestAborted ? "客户端主动中断" : "未记录客户端中断"} ·{" "}
                {record.transport.responseClosedBeforeFinish ? "连接在完成前关闭" : "连接完整结束"} ·{" "}
                {record.transport.responseFinished ? "finish 已触发" : "finish 未触发"}
              </p>
            </article>
            <article className="conversation-audit-feedback-empty conversation-audit-api-context-card">
              <strong>范围信息</strong>
              <p>
                Agent Mode {record.agentModeId ? compactId(record.agentModeId) : "未记录"} · 资料集 {record.knowledgeSetIds.length || 0} 个 · 同 Session{" "}
                {formatInteger(relatedSummary.sameSessionRequests)} 次
              </p>
            </article>
            <article className="conversation-audit-feedback-empty conversation-audit-api-context-card">
              <strong>错误摘要</strong>
              <p>{record.errorMessage || "当前调用没有记录错误消息。"}</p>
            </article>
          </div>
        </div>
      </section>
    </div>
  );
}

function ConversationWorkspace(props: { timezoneLabel: string }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<AdminConversationStatusFilter>("all");
  const [feedbackFilter, setFeedbackFilter] = useState<AdminConversationFeedbackFilter>("all");
  const [sort, setSort] = useState<AdminConversationSort>("updated_desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
  const [refreshToken, setRefreshToken] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listErrorText, setListErrorText] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErrorText, setDetailErrorText] = useState("");
  const [listData, setListData] = useState<AdminConversationListResponse | null>(null);
  const [detailData, setDetailData] = useState<AdminConversationDetailResponse | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState("");

  const deferredQuery = useDeferredValue(query.trim());

  useEffect(() => {
    let active = true;
    setListLoading(true);
    setListErrorText("");

    void fetchAdminConversationAuditList({
      query: deferredQuery || undefined,
      status: statusFilter,
      feedback: feedbackFilter,
      sort,
      page,
      pageSize
    })
      .then((result) => {
        if (!active) return;
        setListData(result);
      })
      .catch((error) => {
        if (!active) return;
        setListErrorText(error instanceof Error ? error.message : "加载会话审计失败");
      })
      .finally(() => {
        if (!active) return;
        setListLoading(false);
      });

    return () => {
      active = false;
    };
  }, [deferredQuery, feedbackFilter, page, pageSize, refreshToken, sort, statusFilter]);

  useEffect(() => {
    if (!listData?.conversations.length) {
      setSelectedConversationId("");
      setDetailData(null);
      return;
    }
    setSelectedConversationId((current) =>
      listData.conversations.some((item) => item.id === current) ? current : listData.conversations[0]!.id
    );
  }, [listData]);

  useEffect(() => {
    if (!selectedConversationId) {
      setDetailData(null);
      setDetailErrorText("");
      return;
    }

    let active = true;
    setDetailLoading(true);
    setDetailErrorText("");

    void fetchAdminConversationAuditDetail(selectedConversationId)
      .then((result) => {
        if (!active) return;
        setDetailData(result);
      })
      .catch((error) => {
        if (!active) return;
        setDetailErrorText(error instanceof Error ? error.message : "加载会话详情失败");
      })
      .finally(() => {
        if (!active) return;
        setDetailLoading(false);
      });

    return () => {
      active = false;
    };
  }, [refreshToken, selectedConversationId]);

  const summary = listData?.summary;

  return (
    <div className="conversation-audit-shell">
      <div className="conversation-audit-summary-grid">
        <SummaryCard title="会话总数" value={summary?.totalThreads ?? 0} />
        <SummaryCard title="有反馈会话" value={summary?.threadsWithFeedback ?? 0} />
        <SummaryCard title="正向反馈" value={summary?.positiveFeedback ?? 0} />
        <SummaryCard title="负向反馈" value={summary?.negativeFeedback ?? 0} />
      </div>

      {listErrorText ? <Alert type="error" showIcon className="admin-alert-inline" message={listErrorText} /> : null}

      <div className="conversation-audit-layout">
        <Card className="admin-card conversation-audit-rail">
          <div className="conversation-audit-rail-head">
            <div>
              <Typography.Title level={4} className="admin-card-heading">
                用户会话台账
              </Typography.Title>
              <Typography.Paragraph>按标题、用户、反馈和摘要快速锁定问题线程，延续现有会话阅读式双栏节奏。</Typography.Paragraph>
            </div>
            <Space wrap>
              <Tag>
                <Space size={4}>
                  <Clock3 size={12} />
                  <span>{props.timezoneLabel}</span>
                </Space>
              </Tag>
              <Button icon={<RefreshCcw size={14} />} onClick={() => setRefreshToken((value) => value + 1)} loading={listLoading}>
                刷新
              </Button>
            </Space>
          </div>

          <div className="conversation-audit-filter-grid">
            <Input
              allowClear
              value={query}
              prefix={<Search size={15} />}
              placeholder="搜索标题、用户、模型、摘要"
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
            <Select
              value={statusFilter}
              options={STATUS_OPTIONS}
              onChange={(value) => {
                setStatusFilter(value as AdminConversationStatusFilter);
                setPage(1);
              }}
            />
            <Select
              value={feedbackFilter}
              options={FEEDBACK_OPTIONS}
              onChange={(value) => {
                setFeedbackFilter(value as AdminConversationFeedbackFilter);
                setPage(1);
              }}
            />
            <Select value={sort} options={SORT_OPTIONS} onChange={(value) => setSort(value as AdminConversationSort)} />
          </div>

          <div className="conversation-audit-list-meta">
            <span>
              当前筛选命中 {listData?.page.totalItems ?? 0} 条，会话涉及 {summary?.uniqueUsers ?? 0} 位用户
            </span>
            {listLoading ? <Spin size="small" /> : null}
          </div>

          <div className="conversation-audit-list">
            {!listLoading && (listData?.conversations.length ?? 0) === 0 ? (
              <div className="conversation-audit-list-empty">
                <Empty description="没有匹配到会话记录" />
              </div>
            ) : (
              listData?.conversations.map((conversation) => (
                <ThreadListItem
                  key={conversation.id}
                  conversation={conversation}
                  active={conversation.id === selectedConversationId}
                  onSelect={() => setSelectedConversationId(conversation.id)}
                />
              ))
            )}
          </div>

          <div className="conversation-audit-pagination">
            <Pagination
              current={listData?.page.page ?? page}
              pageSize={listData?.page.pageSize ?? pageSize}
              total={listData?.page.totalItems ?? 0}
              showSizeChanger
              onChange={(nextPage, nextPageSize) => {
                setPage(nextPage);
                if (nextPageSize !== pageSize) {
                  setPageSize(nextPageSize);
                }
              }}
            />
          </div>
        </Card>

        <Card className="admin-card conversation-audit-detail">
          <ConversationDetail detail={detailData} loading={detailLoading} errorText={detailErrorText} timezoneLabel={props.timezoneLabel} />
        </Card>
      </div>
    </div>
  );
}

function ApiAuditWorkspace(props: { timezoneLabel: string }) {
  const [query, setQuery] = useState("");
  const [resultFilter, setResultFilter] = useState<AdminApiAuditResultFilter>("all");
  const [deliveryFilter, setDeliveryFilter] = useState<AdminApiAuditDeliveryFilter>("all");
  const [sort, setSort] = useState<AdminApiAuditSort>("created_desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
  const [refreshToken, setRefreshToken] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listErrorText, setListErrorText] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErrorText, setDetailErrorText] = useState("");
  const [listData, setListData] = useState<AdminApiAuditListResponse | null>(null);
  const [detailData, setDetailData] = useState<AdminApiAuditDetailResponse | null>(null);
  const [selectedEventId, setSelectedEventId] = useState("");

  const deferredQuery = useDeferredValue(query.trim());

  useEffect(() => {
    let active = true;
    setListLoading(true);
    setListErrorText("");

    void fetchAdminApiAuditList({
      query: deferredQuery || undefined,
      result: resultFilter,
      delivery: deliveryFilter,
      sort,
      page,
      pageSize
    })
      .then((result) => {
        if (!active) return;
        setListData(result);
      })
      .catch((error) => {
        if (!active) return;
        setListErrorText(error instanceof Error ? error.message : "加载 API 审计失败");
      })
      .finally(() => {
        if (!active) return;
        setListLoading(false);
      });

    return () => {
      active = false;
    };
  }, [deferredQuery, deliveryFilter, page, pageSize, refreshToken, resultFilter, sort]);

  useEffect(() => {
    if (!listData?.records.length) {
      setSelectedEventId("");
      setDetailData(null);
      return;
    }
    setSelectedEventId((current) => (listData.records.some((item) => item.id === current) ? current : listData.records[0]!.id));
  }, [listData]);

  useEffect(() => {
    if (!selectedEventId) {
      setDetailData(null);
      setDetailErrorText("");
      return;
    }

    let active = true;
    setDetailLoading(true);
    setDetailErrorText("");

    void fetchAdminApiAuditDetail(selectedEventId)
      .then((result) => {
        if (!active) return;
        setDetailData(result);
      })
      .catch((error) => {
        if (!active) return;
        setDetailErrorText(error instanceof Error ? error.message : "加载 API 调用详情失败");
      })
      .finally(() => {
        if (!active) return;
        setDetailLoading(false);
      });

    return () => {
      active = false;
    };
  }, [refreshToken, selectedEventId]);

  const summary = listData?.summary;

  return (
    <div className="conversation-audit-shell">
      <div className="conversation-audit-summary-grid">
        <SummaryCard title="API 调用总数" value={summary?.totalRequests ?? 0} />
        <SummaryCard title="唯一 IP" value={summary?.uniqueIps ?? 0} />
        <SummaryCard title="缺失 IP" value={summary?.missingIpCount ?? 0} />
        <SummaryCard title="传输异常" value={summary?.deliveryFailureCount ?? 0} />
      </div>

      {listErrorText ? <Alert type="error" showIcon className="admin-alert-inline" message={listErrorText} /> : null}

      <div className="conversation-audit-layout">
        <Card className="admin-card conversation-audit-rail">
          <div className="conversation-audit-rail-head">
            <div>
              <Typography.Title level={4} className="admin-card-heading">
                API 调用台账
              </Typography.Title>
              <Typography.Paragraph>以 IP 作为主身份视角，串联实例、模型、传输状态和响应时延，旧数据没有 IP 时保持空缺。</Typography.Paragraph>
            </div>
            <Space wrap>
              <Tag>
                <Space size={4}>
                  <Clock3 size={12} />
                  <span>{props.timezoneLabel}</span>
                </Space>
              </Tag>
              <Button icon={<RefreshCcw size={14} />} onClick={() => setRefreshToken((value) => value + 1)} loading={listLoading}>
                刷新
              </Button>
            </Space>
          </div>

          <div className="conversation-audit-filter-grid">
            <Input
              allowClear
              value={query}
              prefix={<Search size={15} />}
              placeholder="搜索 IP、实例、Session、模型、摘要"
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
            <Select
              value={resultFilter}
              options={API_RESULT_OPTIONS}
              onChange={(value) => {
                setResultFilter(value as AdminApiAuditResultFilter);
                setPage(1);
              }}
            />
            <Select
              value={deliveryFilter}
              options={API_DELIVERY_OPTIONS}
              onChange={(value) => {
                setDeliveryFilter(value as AdminApiAuditDeliveryFilter);
                setPage(1);
              }}
            />
            <Select value={sort} options={API_SORT_OPTIONS} onChange={(value) => setSort(value as AdminApiAuditSort)} />
          </div>

          <div className="conversation-audit-list-meta">
            <span>
              当前筛选命中 {listData?.page.totalItems ?? 0} 条，识别到 {summary?.uniqueIps ?? 0} 个 IP，缺失 {summary?.missingIpCount ?? 0} 条
            </span>
            {listLoading ? <Spin size="small" /> : null}
          </div>

          <div className="conversation-audit-list">
            {!listLoading && (listData?.records.length ?? 0) === 0 ? (
              <div className="conversation-audit-list-empty">
                <Empty description="没有匹配到 API 调用记录" />
              </div>
            ) : (
              listData?.records.map((record) => (
                <ApiUsageListItem key={record.id} record={record} active={record.id === selectedEventId} onSelect={() => setSelectedEventId(record.id)} />
              ))
            )}
          </div>

          <div className="conversation-audit-pagination">
            <Pagination
              current={listData?.page.page ?? page}
              pageSize={listData?.page.pageSize ?? pageSize}
              total={listData?.page.totalItems ?? 0}
              showSizeChanger
              onChange={(nextPage, nextPageSize) => {
                setPage(nextPage);
                if (nextPageSize !== pageSize) {
                  setPageSize(nextPageSize);
                }
              }}
            />
          </div>
        </Card>

        <Card className="admin-card conversation-audit-detail">
          <ApiAuditDetail detail={detailData} loading={detailLoading} errorText={detailErrorText} timezoneLabel={props.timezoneLabel} />
        </Card>
      </div>
    </div>
  );
}

export function ConversationAuditView() {
  const [mode, setMode] = useState<AuditMode>("conversations");
  const timezoneLabel = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "本地时区", []);
  const story = AUDIT_MODE_STORY[mode];

  return (
    <div className="conversation-audit-hub">
      <section className="admin-flagship-surface conversation-audit-command">
        <div className="admin-flagship-top">
          <div className="admin-flagship-copy">
            <span className="conversation-audit-detail-eyebrow">{story.eyebrow}</span>
            <Typography.Title level={3} className="admin-flagship-title">
              {story.title}
            </Typography.Title>
            <Typography.Paragraph className="admin-flagship-detail">
              {story.detail} 所有时间都会跟随当前浏览器本地时区 {timezoneLabel}。
            </Typography.Paragraph>
            <div className="admin-flagship-pill-row">
              <span className="admin-console-pill">当前模式 · {mode === "conversations" ? "用户会话" : "API 调用"}</span>
              <span className="admin-console-pill">调查节奏 · 先筛选后下钻</span>
              <span className="admin-console-pill neutral">时区 · {timezoneLabel}</span>
            </div>
          </div>
          <div className="admin-flagship-actions conversation-audit-command-actions">
            <Segmented options={AUDIT_MODE_OPTIONS} value={mode} onChange={(value) => setMode(value as AuditMode)} />
          </div>
        </div>
        <div className="conversation-audit-command-grid">
          {story.notes.map((item) => (
            <AuditGuidanceCard key={item.label} label={item.label} text={item.text} />
          ))}
        </div>
      </section>

      {mode === "conversations" ? <ConversationWorkspace timezoneLabel={timezoneLabel} /> : <ApiAuditWorkspace timezoneLabel={timezoneLabel} />}
    </div>
  );
}

export default ConversationAuditView;
