import { Alert, Button, Empty, Input, Pagination, Select, Space, Spin, Tag, Typography, Badge, Tabs } from "antd";
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
  AdminConversationFeedback,
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

function roleLabel(role: AdminConversationTranscriptMessage["role"]): string {
  if (role === "user") return "用户";
  if (role === "assistant") return "助手";
  if (role === "tool") return "工具";
  return "系统";
}

function MarkdownLink(props: { href?: string; children?: ReactNode }) {
  const href = typeof props.href === "string" ? props.href : "";
  if (!href) return <span>{props.children}</span>;
  return <a href={href} target="_blank" rel="noreferrer">{props.children}</a>;
}

function ConversationAuditMarkdown(props: { text: string; className?: string }) {
  return (
    <div className={props.className ? `conversation-audit-markdown ${props.className}` : "conversation-audit-markdown"}>
      <ReactMarkdown
        components={{
          a: MarkdownLink as never,
        }}
      >
        {props.text}
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
  const messageRefs = useRef(new Map<string, HTMLElement>());

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
  const focusFeedbackMessage = (messageId: string | null) => {
    if (!messageId) return;
    setHighlightedMessageId(messageId);
    messageRefs.current.get(messageId)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Detail Header */}
      <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--admin-color-border)', background: 'var(--admin-color-surface)' }}>
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
        
        <div style={{ display: 'flex', gap: 24, fontSize: 13 }}>
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
          <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--admin-color-text)' }}>回答反馈</div>
            {conversation.feedback.map((item) => (
              <div
                key={item.id}
                style={{
                  border: '1px solid var(--admin-color-border)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  background: '#fff',
                  display: 'grid',
                  gap: 6
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Tag color={feedbackColor(item.type)} icon={item.type === "positive" ? <ThumbsUp size={12} /> : <ThumbsDown size={12} />}>
                    {feedbackLabel(item.type)}
                  </Tag>
                  <span style={{ color: 'var(--admin-color-subtle)', fontSize: 12 }}>
                    {formatLocalDateTime(item.updatedAt || item.createdAt)}
                  </span>
                  {item.messageId ? (
                    <Button size="small" type="link" onClick={() => focusFeedbackMessage(item.messageId)}>
                      定位回答
                    </Button>
                  ) : null}
                </div>
                <div style={{ fontSize: 13, color: 'var(--admin-color-text)', whiteSpace: 'pre-wrap' }}>
                  {item.comment || (item.type === "negative" ? "未填写反馈备注" : "用户标记这条回答有帮助")}
                </div>
              </div>
            ))}
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
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<AdminConversationStatusFilter>("all");
  const [feedbackFilter, setFeedbackFilter] = useState<AdminConversationFeedbackFilter>("all");
  const [sort, setSort] = useState<AdminConversationSort>("updated_desc");
  const [page, setPage] = useState(1);
  
  const [listLoading, setListLoading] = useState(true);
  const [listData, setListData] = useState<AdminConversationListResponse | null>(null);
  
  const [selectedId, setSelectedId] = useState("");
  const [detailData, setDetailData] = useState<AdminConversationDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const deferredQuery = useDeferredValue(query.trim());

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
            <span>预估成本: {record.metrics.estimatedCost}</span>
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
            { key: "api", label: "底层 API 调用" }
          ]}
          style={{ marginBottom: -12 }}
        />
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {mode === "conversations" ? <ConversationWorkspace /> : <ApiAuditWorkspace />}
      </div>
    </div>
  );
}

export default ConversationAuditView;
