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
  const [transcriptQuery, setTranscriptQuery] = useState("");
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
              highlighted={false} 
              onMount={(node) => {
                if (node) messageRefs.current.set(msg.id, node);
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
    fetchAdminConversationAuditList({ query: deferredQuery || undefined, status: statusFilter, sort, page, pageSize: 20 })
      .then(res => active && setListData(res))
      .finally(() => active && setListLoading(false));
    return () => { active = false; };
  }, [deferredQuery, statusFilter, sort, page]);

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
            <Select size="small" value={statusFilter} options={STATUS_OPTIONS} onChange={setStatusFilter} style={{ width: 100 }} />
            <Select size="small" value={sort} options={SORT_OPTIONS} onChange={setSort} style={{ width: 100 }} />
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

export function ConversationAuditView() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, height: '100%' }}>
      <ConversationWorkspace />
    </div>
  );
}

export default ConversationAuditView;
