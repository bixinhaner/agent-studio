import { Alert, Button, Card, Empty, Input, Pagination, Segmented, Select, Space, Spin, Statistic, Tag, Typography } from "antd";
import {
  Activity,
  Clock3,
  HardDrive,
  MessageSquareText,
  RefreshCcw,
  Search,
  ThumbsDown,
  ThumbsUp,
  UserRound
} from "lucide-react";
import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";

import { fetchAdminConversationAuditDetail, fetchAdminConversationAuditList } from "./api";
import type {
  AdminConversationDetailResponse,
  AdminConversationFeedbackFilter,
  AdminConversationListResponse,
  AdminConversationSort,
  AdminConversationStatusFilter,
  AdminConversationSummary,
  AdminConversationTranscriptMessage,
  AdminConversationUser
} from "./types";

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

type TranscriptRoleFilter = "all" | AdminConversationTranscriptMessage["role"];

const TRANSCRIPT_ROLE_OPTIONS: Array<{ value: TranscriptRoleFilter; label: string }> = [
  { value: "all", label: "全部角色" },
  { value: "user", label: "用户" },
  { value: "assistant", label: "助手" },
  { value: "system", label: "系统" },
  { value: "tool", label: "工具" }
];

function formatLocalDateTime(value: string | null | undefined): string {
  if (!value) return "未知时间";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function displayUserLabel(user: AdminConversationUser | null): string {
  return user?.displayName || user?.email || "未关联用户";
}

function userMonogram(user: AdminConversationUser | null): string {
  const source = displayUserLabel(user).replace(/\s+/g, "");
  if (!source) return "NA";
  return source.slice(0, 2).toUpperCase();
}

function conversationStatusColor(status: string): string {
  return status === "archived" ? "default" : "blue";
}

function feedbackColor(type: "positive" | "negative"): string {
  return type === "positive" ? "success" : "error";
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

function compactWorkspaceLabel(workspace: string): string {
  const normalized = workspace.trim();
  if (!normalized) return "未记录";
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length <= 2) return normalized;
  return segments.slice(-2).join("/");
}

function compactThreadId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 6)}··${id.slice(-4)}`;
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
          a: MarkdownLink as any,
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

function deriveLatestAssistantReply(conversation: AdminConversationDetailResponse["conversation"], transcript: AdminConversationTranscriptMessage[]): string {
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
        {props.conversation.feedbackSummary.positive > 0 ? (
          <Tag color="success">+{props.conversation.feedbackSummary.positive}</Tag>
        ) : null}
        {props.conversation.feedbackSummary.negative > 0 ? (
          <Tag color="error">-{props.conversation.feedbackSummary.negative}</Tag>
        ) : null}
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
  const classes = [
    stateClass,
    props.highlighted ? "is-highlighted" : "",
    props.queryMatched ? "is-query-match" : ""
  ]
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
      return (
        message.text.toLowerCase().includes(deferredTranscriptQuery) ||
        roleLabel(message.role).toLowerCase().includes(deferredTranscriptQuery)
      );
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
            {displayUserLabel(conversation.user)} · 创建于 {formatLocalDateTime(conversation.createdAt)} · 所有时间按{" "}
            {props.timezoneLabel} 展示
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
          <strong>{compactThreadId(conversation.id)}</strong>
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
          <div className="conversation-audit-detail-metric">
            <UserRound size={16} />
            <div>
              <strong>{displayUserLabel(conversation.user)}</strong>
              <span>{conversation.user ? `${conversation.user.role} · ${conversation.user.status}` : "匿名或已删除用户"}</span>
            </div>
          </div>
          <div className="conversation-audit-detail-metric">
            <MessageSquareText size={16} />
            <div>
              <strong>{conversation.metrics.messageCount} 条消息</strong>
              <span>
                用户 {conversation.metrics.userMessageCount} / 助手 {conversation.metrics.assistantMessageCount}
              </span>
            </div>
          </div>
          <div className="conversation-audit-detail-metric">
            <Activity size={16} />
            <div>
              <strong>{conversation.feedbackSummary.total} 条反馈</strong>
              <span>
                正向 {conversation.feedbackSummary.positive} / 负向 {conversation.feedbackSummary.negative} / {sentimentText(conversation.feedbackSummary)}
              </span>
            </div>
          </div>
          <div className="conversation-audit-detail-metric">
            <HardDrive size={16} />
            <div>
              <strong title={conversation.workspace}>{conversation.workspace || "未记录工作区"}</strong>
              <span>最后更新 {formatLocalDateTime(conversation.updatedAt)}</span>
            </div>
          </div>
        </div>

        <div className="conversation-audit-insight-grid">
          <article className="conversation-audit-insight-card">
            <span>首轮用户问题</span>
            <strong>{firstUserPrompt}</strong>
          </article>
          <article className="conversation-audit-insight-card">
            <span>最近一条助手回复</span>
            <strong>{latestAssistantReply}</strong>
          </article>
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

export function ConversationAuditView() {
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
  const timezoneLabel = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "本地时区", []);

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
                会话台账
              </Typography.Title>
              <Typography.Paragraph>参考 magic 的会话侧栏结构，用搜索、筛选和卡片摘要快速定位问题线程。</Typography.Paragraph>
            </div>
            <Space wrap>
              <Tag>
                <Space size={4}>
                  <Clock3 size={12} />
                  <span>{timezoneLabel}</span>
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
          <ConversationDetail
            detail={detailData}
            loading={detailLoading}
            errorText={detailErrorText}
            timezoneLabel={timezoneLabel}
          />
        </Card>
      </div>
    </div>
  );
}
