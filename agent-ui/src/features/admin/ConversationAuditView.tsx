import { Alert, Button, Empty, Input, Pagination, Select, Space, Spin, Tag, Typography, Badge, Tabs } from "antd";
import { createPortal } from "react-dom";
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
  UserRound
} from "lucide-react";
import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";

import { formatUsdAmount } from "../../lib/formatters";
import {
  extractMermaidCodeFromPreChildren,
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS,
  MarkdownMermaidBlock,
  MarkdownTable
} from "../markdown/markdown-rendering";
import {
  fetchAdminApiAuditDetail,
  fetchAdminApiAuditList,
  fetchAdminConversationAuditDetail,
  fetchAdminConversationAuditList,
  fetchAdminProductFeedbackDetail,
  fetchAdminProductFeedbackList,
  updateAdminProductFeedbackStatus
} from "./api";
import type {
  AdminApiAuditDeliveryFilter,
  AdminApiAuditDetailResponse,
  AdminApiAuditListResponse,
  AdminApiAuditRecord,
  AdminApiAuditResultFilter,
  AdminApiAuditSort,
  AdminConversationDetailResponse,
  AdminConversationFeedback,
  AdminConversationFeedbackFilter,
  AdminConversationListResponse,
  AdminConversationSort,
  AdminConversationStatusFilter,
  AdminConversationSummary,
  AdminConversationTranscriptMessage,
  AdminConversationUser,
  AdminProductFeedbackDetailResponse,
  AdminProductFeedbackListResponse,
  AdminProductFeedbackRecord,
  AdminProductFeedbackSort,
  AdminProductFeedbackStatus,
  AdminProductFeedbackStatusFilter,
  AdminProductFeedbackType,
  AdminProductFeedbackTypeFilter
} from "./types";

type AuditMode = "conversations" | "api" | "product_feedback";
type TranscriptRoleFilter = "all" | AdminConversationTranscriptMessage["role"];

type ConversationAuditHashState = {
  query: string;
  conversationId: string;
};

const STATUS_OPTIONS: Array<{ value: AdminConversationStatusFilter; label: string }> = [
  { value: "all", label: "全部状态" },
  { value: "regular", label: "活跃线程" },
  { value: "archived", label: "已归档" }
];

const FEEDBACK_OPTIONS: Array<{ value: AdminConversationFeedbackFilter; label: string }> = [
  { value: "all", label: "全部反馈" },
  { value: "with_feedback", label: "有反馈" },
  { value: "positive", label: "只看赞" },
  { value: "negative", label: "只看踩" },
  { value: "none", label: "无反馈" }
];

const SORT_OPTIONS: Array<{ value: AdminConversationSort; label: string }> = [
  { value: "updated_desc", label: "最近更新" },
  { value: "created_desc", label: "最近创建" }
];

function formatLocalDateTime(value: string | null | undefined): string {
  if (!value) return "未知时间";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function readConversationAuditHashState(): ConversationAuditHashState {
  if (typeof window === "undefined") return { query: "", conversationId: "" };
  const hash = window.location.hash;
  const queryStart = hash.indexOf("?");
  if (queryStart < 0) return { query: "", conversationId: "" };
  const params = new URLSearchParams(hash.slice(queryStart + 1));
  const conversationId = params.get("conversation")?.trim() ?? "";
  return {
    conversationId,
    query: params.get("query")?.trim() || conversationId
  };
}

function displayUserLabel(user: AdminConversationUser | null): string {
  return user?.displayName || user?.email || "未关联用户";
}

function conversationStatusColor(status: string): string {
  return status === "archived" ? "default" : "processing";
}

function feedbackLabel(type: AdminConversationFeedback["type"]): string {
  return type === "positive" ? "赞" : "踩";
}

function feedbackColor(type: AdminConversationFeedback["type"]): string {
  return type === "positive" ? "success" : "error";
}

function productFeedbackTypeLabel(type: AdminProductFeedbackType): string {
  if (type === "feature_request") return "功能建议";
  if (type === "usability_issue") return "体验问题";
  if (type === "other") return "其他";
  return "Bug";
}

function productFeedbackStatusLabel(status: AdminProductFeedbackStatus): string {
  if (status === "triaged") return "已分诊";
  if (status === "in_progress") return "处理中";
  if (status === "resolved") return "已解决";
  if (status === "closed") return "已关闭";
  return "待处理";
}

function productFeedbackSeverityLabel(severity: AdminProductFeedbackRecord["severity"]): string {
  if (severity === "blocking") return "阻塞";
  if (severity === "high") return "高";
  if (severity === "low") return "低";
  if (severity === "medium") return "中";
  return "未标记";
}

function productFeedbackStatusColor(status: AdminProductFeedbackStatus): string {
  if (status === "resolved" || status === "closed") return "success";
  if (status === "in_progress") return "processing";
  if (status === "triaged") return "warning";
  return "error";
}

function formatJsonBlock(value: unknown): string {
  if (value === undefined || value === null) return "无上下文";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function roleLabel(role: AdminConversationTranscriptMessage["role"]): string {
  if (role === "user") return "用户";
  if (role === "assistant") return "助手";
  if (role === "tool") return "工具";
  return "系统";
}

function decodeMaybeUri(value: string): string {
  if (!value.trim()) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeKnowledgeSetPath(value: string): string {
  return decodeMaybeUri(String(value || "").trim()).replace(/\\/g, "/");
}

function fileNameFromPath(filePath: string): string {
  const normalized = normalizeKnowledgeSetPath(filePath);
  if (!normalized) return "Untitled file";
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

function flattenNodeText(value: ReactNode): string {
  if (value === null || value === undefined || typeof value === "boolean") return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map((item) => flattenNodeText(item)).join("");
  if (typeof value === "object" && "props" in value) {
    return flattenNodeText((value as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

function isHttpUrl(value: string | undefined): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

const RAW_KNOWLEDGE_SET_IMAGE_DESTINATION_PATTERN =
  /(!\[[^\]\n]*\]\()(?!(?:<|https?:|data:|blob:|\/api\/portal\/resources\/files\/content))(\/usr\/local\/agent-studio\/data\/knowledge-sets\/Docs\/.*?\.(?:png|jpe?g|gif|webp|bmp|svg|avif))(\))/giu;
const RAW_KNOWLEDGE_SET_MARKDOWN_DESTINATION_PATTERN =
  /(!?\[[^\]\n]*\]\()(?!(?:<|https?:|data:|blob:|\/api\/portal\/resources\/files\/content))(\/usr\/local\/agent-studio\/data\/knowledge-sets\/Docs\/.*?\.(?:md|markdown|txt|json|pdf|html|htm|xml|ya?ml|png|jpe?g|gif|webp|bmp|svg|avif))(\))/giu;

function adminKnowledgeSetFileUrl(filePath: string): string {
  const query = new URLSearchParams({ path: normalizeKnowledgeSetPath(filePath) });
  return `/api/portal/resources/files/content?${query.toString()}`;
}

function preprocessConversationAuditMarkdown(text: string): string {
  return text
    .replace(RAW_KNOWLEDGE_SET_IMAGE_DESTINATION_PATTERN, (_match, prefix, destination, suffix) => {
      return `${prefix}<${adminKnowledgeSetFileUrl(destination)}>${suffix}`;
    })
    .replace(RAW_KNOWLEDGE_SET_MARKDOWN_DESTINATION_PATTERN, (_match, prefix, destination, suffix) => {
      return `${prefix}<${destination}>${suffix}`;
    });
}

function resolveKnowledgeSetFilePathFromHref(href: string): string | null {
  const rawHref = href.trim();
  if (!rawHref) return null;
  const normalized =
    rawHref.startsWith("<") && rawHref.endsWith(">") && rawHref.length > 1 ? rawHref.slice(1, -1).trim() : rawHref;
  const decoded = normalizeKnowledgeSetPath(normalized);
  if (decoded.startsWith("/usr/local/agent-studio/data/knowledge-sets/")) return decoded;

  try {
    const parsed = new URL(normalized, window.location.href);
    if (parsed.origin !== window.location.origin) return null;
    if (parsed.pathname !== "/api/portal/resources/files/content") return null;
    return normalizeKnowledgeSetPath(parsed.searchParams.get("path") || "");
  } catch {
    return null;
  }
}

function ConversationAuditMarkdownLink(props: {
  href?: string;
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}) {
  const { href, className, children, ...rest } = props;
  const filePath = typeof href === "string" ? resolveKnowledgeSetFilePathFromHref(href) : null;
  if (filePath) {
    const displayName = flattenNodeText(children).trim() || fileNameFromPath(filePath);
    return (
      <span className="admin-conversation-file-card" role="group" aria-label={`File ${displayName}`}>
        <span className="admin-conversation-file-meta">
          <span className="admin-conversation-file-tag">File</span>
          <span className="admin-conversation-file-name">{displayName}</span>
          <span className="admin-conversation-file-path">{filePath}</span>
        </span>
        <a
          className="admin-conversation-file-btn"
          href={adminKnowledgeSetFileUrl(filePath)}
          target="_blank"
          rel="noreferrer"
        >
          Open
        </a>
      </span>
    );
  }

  const resolvedHref = typeof href === "string" ? href : "";
  if (!resolvedHref) return <span className={className}>{children}</span>;
  return (
    <a className={className} href={resolvedHref} target="_blank" rel="noreferrer" {...rest}>
      {children}
    </a>
  );
}

function ConversationAuditMarkdownImage(props: {
  src?: string;
  alt?: string;
  className?: string;
  title?: string;
  [key: string]: unknown;
}) {
  const { src, alt, className, title, ...rest } = props;
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const normalizedSrc = typeof src === "string" ? src.trim() : "";
  const knowledgeSetFilePath = normalizedSrc ? resolveKnowledgeSetFilePathFromHref(normalizedSrc) : null;
  const resolvedSrc = knowledgeSetFilePath
    ? adminKnowledgeSetFileUrl(knowledgeSetFilePath)
    : normalizedSrc.startsWith("/api/portal/resources/files/content") || isHttpUrl(normalizedSrc)
      ? normalizedSrc
      : "";
  const caption = typeof alt === "string" ? alt.trim() : "";
  const imageTitle = typeof title === "string" ? title.trim() : "";
  const ariaLabel = caption || imageTitle || "Open image detail";

  useEffect(() => {
    if (!lightboxOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightboxOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [lightboxOpen]);

  if (!resolvedSrc) {
    return <span className="admin-conversation-image-missing">{caption || "Image unavailable"}</span>;
  }

  return (
    <span className="admin-conversation-image-card">
      <button
        type="button"
        className="admin-conversation-image-trigger"
        aria-label={ariaLabel}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setLightboxOpen(true);
        }}
      >
        <img
          {...rest}
          className={className ? `admin-conversation-image ${className}` : "admin-conversation-image"}
          src={resolvedSrc}
          alt={caption}
          title={imageTitle || undefined}
          loading="lazy"
        />
      </button>
      {caption ? <span className="admin-conversation-image-caption">{caption}</span> : null}
      {lightboxOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="admin-conversation-image-lightbox"
              role="dialog"
              aria-modal="true"
              aria-label={ariaLabel}
              onClick={() => setLightboxOpen(false)}
            >
              <button
                type="button"
                className="admin-conversation-image-lightbox-close"
                aria-label="Close image detail"
                onClick={() => setLightboxOpen(false)}
              >
                ×
              </button>
              <figure className="admin-conversation-image-lightbox-figure" onClick={(event) => event.stopPropagation()}>
                <img className="admin-conversation-image-lightbox-image" src={resolvedSrc} alt={caption} />
                {caption || imageTitle ? (
                  <figcaption className="admin-conversation-image-lightbox-caption">{caption || imageTitle}</figcaption>
                ) : null}
              </figure>
            </div>,
            document.body
          )
        : null}
    </span>
  );
}

function ConversationAuditMarkdown(props: { text: string; className?: string }) {
  const processedText = useMemo(() => preprocessConversationAuditMarkdown(props.text), [props.text]);
  return (
    <div className={props.className ? `conversation-audit-markdown ${props.className}` : "conversation-audit-markdown"}>
      <ReactMarkdown
        rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
        remarkPlugins={MARKDOWN_REMARK_PLUGINS}
        components={{
          pre: ({ children, ...rest }) => {
            const mermaidCode = extractMermaidCodeFromPreChildren(children);
            if (mermaidCode) return <MarkdownMermaidBlock code={mermaidCode} />;
            return <pre {...rest}>{children}</pre>;
          },
          table: MarkdownTable as never,
          a: ConversationAuditMarkdownLink as never,
          img: ConversationAuditMarkdownImage as never
        }}
      >
        {processedText}
      </ReactMarkdown>
    </div>
  );
}

function TranscriptMessageBubble(props: {
  message: AdminConversationTranscriptMessage;
  highlighted: boolean;
  onMount(node: HTMLElement | null): void;
}) {
  const isUser = props.message.role === "user";
  const isAssistant = props.message.role === "assistant";
  
  // Exclude system/tool for cleaner view unless needed
  if (!isUser && !isAssistant && !props.message.text) return null;

  return (
    <div 
      className={`admin-chat-bubble-container ${isUser ? 'is-user' : 'is-assistant'}`} 
      ref={props.onMount}
    >
      <div className="admin-chat-meta">
        {roleLabel(props.message.role)} • {formatLocalDateTime(props.message.createdAt)}
      </div>
      <div className="admin-chat-bubble" style={{ outline: props.highlighted ? '2px solid var(--admin-color-accent)' : 'none' }}>
        {props.message.text ? (
          <ConversationAuditMarkdown text={props.message.text} />
        ) : (
          <span style={{ fontStyle: 'italic', opacity: 0.7 }}>[无文本内容 / 附件]</span>
        )}
      </div>
      {props.message.hasRunConfig && <Tag style={{ marginTop: 4 }}>配置运行参数</Tag>}
    </div>
  );
}

function ConversationDetail(props: {
  detail: AdminConversationDetailResponse | null;
  loading: boolean;
  errorText: string;
}) {
  const [highlightedMessageId, setHighlightedMessageId] = useState("");
  const [feedbackExpanded, setFeedbackExpanded] = useState(false);
  const messageRefs = useRef(new Map<string, HTMLElement>());
  const conversationId = props.detail?.conversation.id ?? "";

  useEffect(() => {
    if (!conversationId) return;
    setFeedbackExpanded(false);
  }, [conversationId]);

  if (props.loading && !props.detail) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><Spin size="large" /></div>;
  }

  if (!props.detail) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--admin-color-subtle)' }}>
        <Empty description="选择左侧会话查看完整记录" />
      </div>
    );
  }

  const { conversation, transcript } = props.detail;
  const hasMultipleFeedback = conversation.feedback.length > 1;
  const latestFeedback = conversation.feedback[0];
  const latestFeedbackText = (
    latestFeedback?.comment ||
    (latestFeedback?.type === "negative" ? "未填写反馈备注" : latestFeedback ? "用户标记这条回答有帮助" : "")
  ).trim();
  const latestFeedbackPreview = latestFeedbackText.length > 72 ? `${latestFeedbackText.slice(0, 71)}…` : latestFeedbackText;

  const focusFeedbackMessage = (messageId: string | null) => {
    if (!messageId) return;
    setHighlightedMessageId(messageId);
    messageRefs.current.get(messageId)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Detail Header */}
      <div className="conversation-detail-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 4px 0' }}>{conversation.title}</h2>
            <div style={{ color: 'var(--admin-color-subtle)', fontSize: 13 }}>
              {displayUserLabel(conversation.user)} • {formatLocalDateTime(conversation.createdAt)}
            </div>
          </div>
          <Space>
            <Tag color={conversationStatusColor(conversation.status)}>
              {conversation.status === "archived" ? "已归档" : "活跃会话"}
            </Tag>
            <Tag>{conversation.model}</Tag>
          </Space>
        </div>
        
        <div className="conversation-detail-metrics">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--admin-color-subtle)' }}>
            <MessageSquareText size={14} />
            <span>{conversation.metrics.messageCount} 条消息</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--admin-color-subtle)' }}>
            <Activity size={14} />
            <span>{conversation.feedbackSummary.positive} 赞 / {conversation.feedbackSummary.negative} 踩</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--admin-color-subtle)' }}>
            <HardDrive size={14} />
            <span>{conversation.workspace || "无关联工作区"}</span>
          </div>
        </div>

        {conversation.feedback.length > 0 ? (
          <div className="conversation-feedback-section">
            <div className="conversation-feedback-summary">
              <div className="conversation-feedback-summary-main">
                <div className="conversation-feedback-title-row">
                  <span className="conversation-feedback-title">回答反馈</span>
                  <span className="conversation-feedback-caption">
                    共 {conversation.feedbackSummary.total} 条，最近更新于{" "}
                    {formatLocalDateTime(conversation.feedbackSummary.latestAt || conversation.updatedAt)}
                  </span>
                </div>
                <div className="conversation-feedback-badges">
                  <Tag color="success" icon={<ThumbsUp size={12} />}>
                    {conversation.feedbackSummary.positive} 赞
                  </Tag>
                  <Tag color="error" icon={<ThumbsDown size={12} />}>
                    {conversation.feedbackSummary.negative} 踩
                  </Tag>
                </div>
                {latestFeedbackPreview ? (
                  <div className="conversation-feedback-preview">最新反馈：{latestFeedbackPreview}</div>
                ) : null}
              </div>
              <Button
                type="link"
                className="conversation-feedback-toggle"
                onClick={() => setFeedbackExpanded((prev) => !prev)}
              >
                {feedbackExpanded
                  ? "收起反馈"
                  : hasMultipleFeedback
                    ? `展开 ${conversation.feedback.length} 条反馈`
                    : "展开反馈"}
              </Button>
            </div>
            {feedbackExpanded ? (
              <div className="conversation-feedback-list conversation-feedback-list-expanded">
                {conversation.feedback.map((item) => (
                  <div key={item.id} className="conversation-feedback-card">
                    <div className="conversation-feedback-card-meta">
                      <Tag color={feedbackColor(item.type)} icon={item.type === "positive" ? <ThumbsUp size={12} /> : <ThumbsDown size={12} />}>
                        {feedbackLabel(item.type)}
                      </Tag>
                      <span className="conversation-feedback-card-time">
                        {formatLocalDateTime(item.updatedAt || item.createdAt)}
                      </span>
                      {item.messageId ? (
                        <Button size="small" type="link" onClick={() => focusFeedbackMessage(item.messageId)}>
                          定位回答
                        </Button>
                      ) : null}
                    </div>
                    <div className="conversation-feedback-card-body">
                      {item.comment || (item.type === "negative" ? "未填写反馈备注" : "用户标记这条回答有帮助")}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Messages Area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 10%', background: '#f9fafb' }}>
        {transcript.messages.length === 0 ? (
           <Empty description="暂无消息内容" />
        ) : (
          transcript.messages.map((msg) => (
            <TranscriptMessageBubble 
              key={msg.id} 
              message={msg} 
              highlighted={highlightedMessageId === msg.id} 
              onMount={(node) => {
                if (node) {
                  messageRefs.current.set(msg.id, node);
                } else {
                  messageRefs.current.delete(msg.id);
                }
              }} 
            />
          ))
        )}
      </div>
    </div>
  );
}

function ConversationWorkspace() {
  const [initialHashState] = useState(readConversationAuditHashState);
  const [query, setQuery] = useState(initialHashState.query);
  const [statusFilter, setStatusFilter] = useState<AdminConversationStatusFilter>("all");
  const [feedbackFilter, setFeedbackFilter] = useState<AdminConversationFeedbackFilter>("all");
  const [sort, setSort] = useState<AdminConversationSort>("updated_desc");
  const [page, setPage] = useState(1);
  
  const [listLoading, setListLoading] = useState(true);
  const [listData, setListData] = useState<AdminConversationListResponse | null>(null);
  
  const [selectedId, setSelectedId] = useState(initialHashState.conversationId);
  const [detailData, setDetailData] = useState<AdminConversationDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const deferredQuery = useDeferredValue(query.trim());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleHashChange = () => {
      const next = readConversationAuditHashState();
      if (next.query) {
        setQuery(next.query);
        setPage(1);
      }
      if (next.conversationId) {
        setSelectedId(next.conversationId);
      }
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    let active = true;
    setListLoading(true);
    fetchAdminConversationAuditList({ query: deferredQuery || undefined, status: statusFilter, feedback: feedbackFilter, sort, page, pageSize: 20 })
      .then(res => active && setListData(res))
      .finally(() => active && setListLoading(false));
    return () => { active = false; };
  }, [deferredQuery, statusFilter, feedbackFilter, sort, page]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    setDetailLoading(true);
    fetchAdminConversationAuditDetail(selectedId)
      .then(res => active && setDetailData(res))
      .finally(() => active && setDetailLoading(false));
    return () => { active = false; };
  }, [selectedId]);

  return (
    <div className="admin-split-layout">
      {/* Master List */}
      <div className="admin-split-master">
        <div style={{ padding: '16px', borderBottom: '1px solid var(--admin-color-border)' }}>
          <Input 
            prefix={<Search size={14} />} 
            placeholder="搜索会话..." 
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ marginBottom: 12 }}
          />
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Select
              size="small"
              value={statusFilter}
              options={STATUS_OPTIONS}
              onChange={(value) => {
                setStatusFilter(value);
                setPage(1);
              }}
              style={{ width: 96 }}
            />
            <Select
              size="small"
              value={feedbackFilter}
              options={FEEDBACK_OPTIONS}
              onChange={(value) => {
                setFeedbackFilter(value);
                setPage(1);
              }}
              style={{ width: 96 }}
            />
            <Select size="small" value={sort} options={SORT_OPTIONS} onChange={setSort} style={{ width: 96 }} />
          </Space>
        </div>
        
        <div className="admin-master-list">
          {listLoading ? <Spin style={{ margin: 'auto', padding: 24 }} /> : 
           listData?.conversations.length === 0 ? <Empty style={{ margin: 'auto' }} /> :
           listData?.conversations.map(conv => (
             <button 
               key={conv.id}
               className={`admin-master-item ${selectedId === conv.id ? 'active' : ''}`}
               onClick={() => setSelectedId(conv.id)}
             >
               <div className="admin-master-header">
                 <span className="admin-master-title">{conv.title}</span>
                 <span className="admin-master-time">{formatLocalDateTime(conv.updatedAt).split(' ')[1]}</span>
               </div>
               <div className="admin-master-preview">
                 {conv.preview.latestText || conv.preview.firstUserText || "无预览"}
               </div>
               <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                 <Badge status={conv.status === 'archived' ? 'default' : 'processing'} />
                 <span style={{ fontSize: 11, opacity: selectedId === conv.id ? 0.8 : 0.5 }}>{displayUserLabel(conv.user)}</span>
                 {conv.feedbackSummary.total > 0 ? (
                   <span style={{ fontSize: 11, opacity: selectedId === conv.id ? 0.85 : 0.65 }}>
                     {conv.feedbackSummary.positive} 赞 / {conv.feedbackSummary.negative} 踩
                   </span>
                 ) : null}
               </div>
             </button>
           ))}
        </div>
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--admin-color-border)', textAlign: 'center' }}>
          <Pagination simple current={page} total={listData?.page.totalItems || 0} pageSize={20} onChange={setPage} />
        </div>
      </div>

      {/* Detail View */}
      <div className="admin-split-detail">
        <ConversationDetail detail={detailData} loading={detailLoading} errorText="" />
      </div>
    </div>
  );
}

const API_STATUS_OPTIONS: Array<{ value: AdminApiAuditResultFilter; label: string }> = [
  { value: "all", label: "全部结果" },
  { value: "success", label: "请求成功" },
  { value: "failed", label: "请求失败" }
];

const API_SORT_OPTIONS: Array<{ value: AdminApiAuditSort; label: string }> = [
  { value: "created_desc", label: "最近调用" },
  { value: "tokens_desc", label: "消耗 Token 最多" },
  { value: "latency_desc", label: "耗时最长" }
];

function ApiAuditWorkspace() {
  const [query, setQuery] = useState("");
  const [resultFilter, setResultFilter] = useState<AdminApiAuditResultFilter>("all");
  const [sort, setSort] = useState<AdminApiAuditSort>("created_desc");
  const [page, setPage] = useState(1);
  
  const [listLoading, setListLoading] = useState(true);
  const [listData, setListData] = useState<AdminApiAuditListResponse | null>(null);
  
  const [selectedId, setSelectedId] = useState("");
  const [detailData, setDetailData] = useState<AdminApiAuditDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const deferredQuery = useDeferredValue(query.trim());

  useEffect(() => {
    let active = true;
    setListLoading(true);
    fetchAdminApiAuditList({ query: deferredQuery || undefined, result: resultFilter === "all" ? undefined : resultFilter, sort, page, pageSize: 20 })
      .then(res => active && setListData(res))
      .finally(() => active && setListLoading(false));
    return () => { active = false; };
  }, [deferredQuery, resultFilter, sort, page]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    setDetailLoading(true);
    fetchAdminApiAuditDetail(selectedId)
      .then(res => active && setDetailData(res))
      .finally(() => active && setDetailLoading(false));
    return () => { active = false; };
  }, [selectedId]);

  return (
    <div className="admin-split-layout">
      {/* Master List */}
      <div className="admin-split-master">
        <div style={{ padding: '16px', borderBottom: '1px solid var(--admin-color-border)' }}>
          <Input 
            prefix={<Search size={14} />} 
            placeholder="搜索调用 IP、模型或 ID..." 
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ marginBottom: 12 }}
          />
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Select size="small" value={resultFilter} options={API_STATUS_OPTIONS} onChange={setResultFilter} style={{ width: 100 }} />
            <Select size="small" value={sort} options={API_SORT_OPTIONS} onChange={setSort} style={{ width: 100 }} />
          </Space>
        </div>
        
        <div className="admin-master-list">
          {listLoading ? <Spin style={{ margin: 'auto', padding: 24 }} /> : 
           listData?.records.length === 0 ? <Empty style={{ margin: 'auto' }} /> :
           listData?.records.map(rec => (
             <button 
               key={rec.id}
               className={`admin-master-item ${selectedId === rec.id ? 'active' : ''}`}
               onClick={() => setSelectedId(rec.id)}
             >
               <div className="admin-master-header">
                 <span className="admin-master-title">{rec.model}</span>
                 <span className="admin-master-time">{formatLocalDateTime(rec.createdAt).split(' ')[1]}</span>
               </div>
               <div className="admin-master-preview" style={{ fontFamily: 'monospace' }}>
                 {rec.preview.prompt || "<无请求数据>"}
               </div>
               <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
                 <Badge status={rec.status.result === 'success' ? 'success' : 'error'} />
                 <span style={{ fontSize: 11, opacity: selectedId === rec.id ? 0.8 : 0.5 }}>{rec.clientIp || "Internal"} • {rec.metrics.totalTokens} Tk</span>
               </div>
             </button>
           ))}
        </div>
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--admin-color-border)', textAlign: 'center' }}>
          <Pagination simple current={page} total={listData?.page.totalItems || 0} pageSize={20} onChange={setPage} />
        </div>
      </div>

      {/* Detail View */}
      <div className="admin-split-detail">
        <ApiAuditDetail detail={detailData} loading={detailLoading} />
      </div>
    </div>
  );
}

function ApiAuditDetail(props: { detail: AdminApiAuditDetailResponse | null; loading: boolean }) {
  if (props.loading && !props.detail) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><Spin size="large" /></div>;
  }
  if (!props.detail) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--admin-color-subtle)' }}>
        <Empty description="选择左侧记录查看完整 API 详情" />
      </div>
    );
  }

  const { record } = props.detail;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--admin-color-border)', background: 'var(--admin-color-surface)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 4px 0' }}>API: {record.id.slice(0, 8)}...</h2>
            <div style={{ color: 'var(--admin-color-subtle)', fontSize: 13 }}>
              {formatLocalDateTime(record.createdAt)} • IP: {record.clientIp || "Unknown"}
            </div>
          </div>
          <Space>
            <Tag color={record.status.result === "success" ? "success" : "error"}>{record.status.result}</Tag>
            <Tag color={record.status.delivery === "delivered" ? "success" : "warning"}>{record.status.delivery}</Tag>
            <Tag>{record.model}</Tag>
          </Space>
        </div>
        
        <div style={{ display: 'flex', gap: 24, fontSize: 13, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--admin-color-subtle)' }}>
            <Activity size={14} />
            <span>输入: {record.metrics.inputTokens} | 输出: {record.metrics.outputTokens}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--admin-color-subtle)' }}>
            <Clock3 size={14} />
             <span>首字准备: {record.metrics.responseReadyMs ? `${record.metrics.responseReadyMs}ms` : 'N/A'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--admin-color-subtle)' }}>
            <HardDrive size={14} />
            <span>预估成本: {formatUsdAmount(record.metrics.estimatedCost)}</span>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px', background: '#f9fafb' }}>
        <div style={{ marginBottom: 24 }}>
          <Typography.Title level={5} style={{ fontSize: 14 }}>Prompt / Request</Typography.Title>
          <div style={{ background: '#282c34', color: '#abb2bf', padding: 16, borderRadius: 8, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 13 }}>
            {record.preview.prompt || "<无请求数据>"}
          </div>
        </div>
        
        <div style={{ marginBottom: 24 }}>
          <Typography.Title level={5} style={{ fontSize: 14 }}>Response / Latest Message</Typography.Title>
          <div style={{ background: '#f1f3f5', padding: 16, borderRadius: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-all', border: '1px solid var(--admin-color-border)', fontSize: 14 }}>
            {record.preview.latest || "<无响应数据>"}
          </div>
        </div>

        {record.errorMessage && (
           <div style={{ marginBottom: 24 }}>
            <Typography.Title level={5} style={{ fontSize: 14 }} type="danger">Error Message</Typography.Title>
            <Alert type="error" message={record.errorMessage} />
          </div>
        )}
      </div>
    </div>
  );
}

const PRODUCT_FEEDBACK_TYPE_OPTIONS: Array<{ value: AdminProductFeedbackTypeFilter; label: string }> = [
  { value: "all", label: "全部类型" },
  { value: "bug", label: "Bug" },
  { value: "feature_request", label: "功能建议" },
  { value: "usability_issue", label: "体验问题" },
  { value: "other", label: "其他" }
];

const PRODUCT_FEEDBACK_STATUS_OPTIONS: Array<{ value: AdminProductFeedbackStatusFilter; label: string }> = [
  { value: "all", label: "全部状态" },
  { value: "open", label: "待处理" },
  { value: "triaged", label: "已分诊" },
  { value: "in_progress", label: "处理中" },
  { value: "resolved", label: "已解决" },
  { value: "closed", label: "已关闭" }
];

const PRODUCT_FEEDBACK_STATUS_UPDATE_OPTIONS: Array<{ value: AdminProductFeedbackStatus; label: string }> = PRODUCT_FEEDBACK_STATUS_OPTIONS
  .filter((item): item is { value: AdminProductFeedbackStatus; label: string } => item.value !== "all");

const PRODUCT_FEEDBACK_SORT_OPTIONS: Array<{ value: AdminProductFeedbackSort; label: string }> = [
  { value: "created_desc", label: "最近提交" },
  { value: "updated_desc", label: "最近处理" }
];

function ProductFeedbackWorkspace() {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<AdminProductFeedbackTypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<AdminProductFeedbackStatusFilter>("all");
  const [sort, setSort] = useState<AdminProductFeedbackSort>("created_desc");
  const [page, setPage] = useState(1);

  const [listLoading, setListLoading] = useState(true);
  const [listData, setListData] = useState<AdminProductFeedbackListResponse | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [detailData, setDetailData] = useState<AdminProductFeedbackDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [errorText, setErrorText] = useState("");

  const deferredQuery = useDeferredValue(query.trim());

  useEffect(() => {
    let active = true;
    setListLoading(true);
    setErrorText("");
    fetchAdminProductFeedbackList({
      query: deferredQuery || undefined,
      type: typeFilter,
      status: statusFilter,
      sort,
      page,
      pageSize: 20
    })
      .then((res) => {
        if (!active) return;
        setListData(res);
        if (!selectedId && res.feedback[0]?.id) {
          setSelectedId(res.feedback[0].id);
        }
      })
      .catch((error) => {
        if (active) setErrorText(error instanceof Error ? error.message : "加载系统反馈失败");
      })
      .finally(() => active && setListLoading(false));
    return () => { active = false; };
  }, [deferredQuery, page, selectedId, sort, statusFilter, typeFilter]);

  useEffect(() => {
    if (!selectedId) {
      setDetailData(null);
      return;
    }
    let active = true;
    setDetailLoading(true);
    setErrorText("");
    fetchAdminProductFeedbackDetail(selectedId)
      .then((res) => active && setDetailData(res))
      .catch((error) => {
        if (active) {
          setErrorText(error instanceof Error ? error.message : "加载系统反馈详情失败");
          setDetailData(null);
        }
      })
      .finally(() => active && setDetailLoading(false));
    return () => { active = false; };
  }, [selectedId]);

  return (
    <div className="admin-split-layout">
      <div className="admin-split-master">
        <div style={{ padding: '16px', borderBottom: '1px solid var(--admin-color-border)' }}>
          <Input
            prefix={<Search size={14} />}
            placeholder="搜索反馈内容、用户或上下文..."
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setPage(1);
            }}
            style={{ marginBottom: 12 }}
          />
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Select
              size="small"
              value={typeFilter}
              options={PRODUCT_FEEDBACK_TYPE_OPTIONS}
              onChange={(value) => {
                setTypeFilter(value);
                setPage(1);
              }}
              style={{ width: 96 }}
            />
            <Select
              size="small"
              value={statusFilter}
              options={PRODUCT_FEEDBACK_STATUS_OPTIONS}
              onChange={(value) => {
                setStatusFilter(value);
                setPage(1);
              }}
              style={{ width: 96 }}
            />
            <Select size="small" value={sort} options={PRODUCT_FEEDBACK_SORT_OPTIONS} onChange={setSort} style={{ width: 96 }} />
          </Space>
        </div>

        <div className="admin-master-list">
          {listLoading ? <Spin style={{ margin: 'auto', padding: 24 }} /> :
           listData?.feedback.length === 0 ? <Empty style={{ margin: 'auto' }} /> :
           listData?.feedback.map(item => (
             <button
               key={item.id}
               className={`admin-master-item ${selectedId === item.id ? 'active' : ''}`}
               onClick={() => setSelectedId(item.id)}
             >
               <div className="admin-master-header">
                 <span className="admin-master-title">{productFeedbackTypeLabel(item.type)}</span>
                 <span className="admin-master-time">{formatLocalDateTime(item.createdAt).split(' ')[1]}</span>
               </div>
               <div className="admin-master-preview">
                 {item.description || "无反馈内容"}
               </div>
               <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                 <Tag color={productFeedbackStatusColor(item.status)} style={{ marginInlineEnd: 0 }}>
                   {productFeedbackStatusLabel(item.status)}
                 </Tag>
                 {item.severity ? <Tag style={{ marginInlineEnd: 0 }}>影响: {productFeedbackSeverityLabel(item.severity)}</Tag> : null}
                 <span style={{ fontSize: 11, opacity: selectedId === item.id ? 0.8 : 0.5 }}>{displayUserLabel(item.user)}</span>
               </div>
             </button>
           ))}
        </div>
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--admin-color-border)', textAlign: 'center' }}>
          <Pagination simple current={page} total={listData?.page.totalItems || 0} pageSize={20} onChange={setPage} />
        </div>
      </div>

      <div className="admin-split-detail">
        {errorText ? <Alert type="error" message={errorText} showIcon style={{ margin: 16 }} /> : null}
        <ProductFeedbackDetail
          detail={detailData}
          loading={detailLoading}
          onStatusChange={(nextStatus) => {
            if (!detailData?.feedback) return;
            const feedbackId = detailData.feedback.id;
            setDetailLoading(true);
            updateAdminProductFeedbackStatus(feedbackId, nextStatus)
              .then((next) => {
                setDetailData(next);
                setListData((prev) => prev
                  ? {
                      ...prev,
                      feedback: prev.feedback.map((item) => item.id === feedbackId ? next.feedback : item)
                    }
                  : prev
                );
              })
              .catch((error) => setErrorText(error instanceof Error ? error.message : "更新系统反馈失败"))
              .finally(() => setDetailLoading(false));
          }}
        />
      </div>
    </div>
  );
}

function ProductFeedbackDetail(props: {
  detail: AdminProductFeedbackDetailResponse | null;
  loading: boolean;
  onStatusChange(status: AdminProductFeedbackStatus): void;
}) {
  if (props.loading && !props.detail) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><Spin size="large" /></div>;
  }
  if (!props.detail) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--admin-color-subtle)' }}>
        <Empty description="选择左侧反馈查看详情" />
      </div>
    );
  }

  const { feedback } = props.detail;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--admin-color-border)', background: 'var(--admin-color-surface)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 12 }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 4px 0' }}>
              {productFeedbackTypeLabel(feedback.type)}
            </h2>
            <div style={{ color: 'var(--admin-color-subtle)', fontSize: 13 }}>
              {displayUserLabel(feedback.user)} • {formatLocalDateTime(feedback.createdAt)}
            </div>
          </div>
          <Space>
            <Select
              size="small"
              value={feedback.status}
              options={PRODUCT_FEEDBACK_STATUS_UPDATE_OPTIONS}
              onChange={props.onStatusChange}
              style={{ width: 104 }}
              disabled={props.loading}
            />
            <Tag color={productFeedbackStatusColor(feedback.status)}>{productFeedbackStatusLabel(feedback.status)}</Tag>
          </Space>
        </div>

        <div style={{ display: 'flex', gap: 24, fontSize: 13, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--admin-color-subtle)' }}>
            <MessageSquareText size={14} />
            <span>类型: {productFeedbackTypeLabel(feedback.type)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--admin-color-subtle)' }}>
            <Activity size={14} />
            <span>影响: {productFeedbackSeverityLabel(feedback.severity)}</span>
          </div>
          {feedback.threadId ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--admin-color-subtle)' }}>
              <HardDrive size={14} />
              <span>关联会话: {feedback.threadId.slice(0, 8)}</span>
              <Button size="small" type="link" href={`#admin/conversations?conversation=${encodeURIComponent(feedback.threadId)}`}>
                查看会话
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px', background: '#f9fafb' }}>
        <div style={{ marginBottom: 24 }}>
          <Typography.Title level={5} style={{ fontSize: 14 }}>反馈内容</Typography.Title>
          <div style={{ background: '#fff', padding: 16, borderRadius: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', border: '1px solid var(--admin-color-border)', fontSize: 14 }}>
            {feedback.description}
          </div>
        </div>

        <div style={{ marginBottom: 24 }}>
          <Typography.Title level={5} style={{ fontSize: 14 }}>提交信息</Typography.Title>
          <div style={{ background: '#fff', padding: 16, borderRadius: 8, border: '1px solid var(--admin-color-border)', display: 'grid', gap: 8, fontSize: 13 }}>
            <div>用户 ID: {feedback.userId || "未记录"}</div>
            <div>组织 ID: {feedback.organizationId || "未记录"}</div>
            <div>创建时间: {formatLocalDateTime(feedback.createdAt)}</div>
            <div>更新时间: {formatLocalDateTime(feedback.updatedAt)}</div>
          </div>
        </div>

        <div>
          <Typography.Title level={5} style={{ fontSize: 14 }}>现场上下文</Typography.Title>
          <div style={{ background: '#282c34', color: '#abb2bf', padding: 16, borderRadius: 8, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12 }}>
            {formatJsonBlock(feedback.context)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ConversationAuditView() {
  const [mode, setMode] = useState<AuditMode>("conversations");

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="admin-page-container" style={{ paddingBottom: 0, paddingTop: 0, gap: 0, flex: 'none', marginBottom: 12 }}>
        <Tabs 
          activeKey={mode} 
          onChange={k => setMode(k as AuditMode)} 
          items={[
            { key: "conversations", label: "用户交互会话" },
            { key: "product_feedback", label: "系统反馈" },
            { key: "api", label: "底层 API 调用" }
          ]}
          style={{ marginBottom: -12 }}
        />
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {mode === "conversations" ? (
          <ConversationWorkspace />
        ) : mode === "product_feedback" ? (
          <ProductFeedbackWorkspace />
        ) : (
          <ApiAuditWorkspace />
        )}
      </div>
    </div>
  );
}

export default ConversationAuditView;
