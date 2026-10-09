import { useEffect, useState } from "react";
import { Alert, Button, Collapse, Empty, Pagination, Spin } from "antd";
import { api } from "../../lib/api";
import { formatAdminDateTime } from "../../lib/formatters";
import { ConversationSendFailures, sendFailureStageCopy } from "./ConversationSendFailures";
import type { AdminConversationSendFailure } from "./types";

type Failure = AdminConversationSendFailure & { threadId: string | null; userId: string | null; userName: string | null; userEmail: string | null };
type Result = { items: Failure[]; total: number; page: number; pageSize: number };
const stages = ["attachment_upload", "attachment_not_ready", "composer_send", "run_blocked", "thread_resolve", "thread_create", "message_save", "session_start"];
function readFilters() {
  const q = new URLSearchParams(window.location.hash.split("?")[1]);
  return { user: q.get("failure_user") ?? "", stage: q.get("failure_stage") ?? "", from: q.get("failure_from") ?? "", to: q.get("failure_to") ?? "", unlinked: q.get("failure_unlinked") !== "false", page: Math.max(1, Number(q.get("failure_page")) || 1) };
}

export function SendFailureAuditView() {
  const [filters, setFilters] = useState(readFilters);
  const [draft, setDraft] = useState(filters);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const read = () => { const next = readFilters(); setFilters(next); setDraft(next); };
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setResult(null);
    const query = new URLSearchParams({ unlinked: String(filters.unlinked), page: String(filters.page) });
    if (filters.user) query.set("user", filters.user);
    if (filters.stage) query.set("stage", filters.stage);
    for (const field of ["from", "to"] as const) {
      if (filters[field]) {
        const value = new Date(filters[field]);
        if (!Number.isFinite(value.getTime())) { setError("时间格式无效，请重新选择"); setLoading(false); return; }
        query.set(field, value.toISOString());
      }
    }
    void api<Result>(`/api/admin/conversations/send-failures?${query}`).then(data => {
      if (active) setResult(data);
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : "加载失败，请重试"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters, revision]);
  const apply = (next: typeof filters) => {
    const q = new URLSearchParams({ mode: "send_failures", failure_unlinked: String(next.unlinked), failure_page: String(next.page) });
    for (const field of ["user", "stage", "from", "to"] as const) if (next[field]) q.set(`failure_${field}`, next[field]);
    window.history.replaceState(null, "", `#admin/conversations?${q}`);
    setFilters(next); setDraft(next);
  };
  return <div className="admin-page-container admin-send-failure-audit">
    <h2>发送失败</h2>
    <p>查看任务创建前或发送过程中的失败。默认只显示未关联任务的记录。</p>
    <form className="admin-send-failure-filters" onSubmit={e => { e.preventDefault(); apply({ ...draft, page: 1 }); }}>
      <label>用户<input value={draft.user} placeholder="姓名、邮箱或用户 ID" onChange={e => setDraft({ ...draft, user: e.target.value })} /></label>
      <label>失败阶段<select value={draft.stage} onChange={e => setDraft({ ...draft, stage: e.target.value })}><option value="">全部阶段</option>{stages.map(stage => <option key={stage} value={stage}>{sendFailureStageCopy(stage).label}</option>)}</select></label>
      <label>开始时间<input type="datetime-local" value={draft.from} onChange={e => setDraft({ ...draft, from: e.target.value })} /></label>
      <label>结束时间<input type="datetime-local" value={draft.to} onChange={e => setDraft({ ...draft, to: e.target.value })} /></label>
      <label><input type="checkbox" checked={draft.unlinked} onChange={e => setDraft({ ...draft, unlinked: e.target.checked })} />仅未关联任务</label>
      <Button htmlType="submit" type="primary">查询</Button><Button onClick={() => setRevision(x => x + 1)}>刷新</Button>
    </form>
    {error ? <Alert type="error" showIcon message={error} action={<Button onClick={() => setRevision(x => x + 1)}>重试</Button>} /> : null}
    {loading ? <Spin aria-label="正在加载发送失败记录" /> : null}
    {result?.items.length === 0 ? <Empty description="没有符合条件的发送失败记录" /> : null}
    {result && result.items.length > 0 ? <>
      <Collapse items={result.items.map(item => ({ key: item.id, label: <span className="admin-send-failure-summary"><time>{formatAdminDateTime(item.createdAt)}</time><strong>{item.userName || item.userEmail || item.userId || "未知用户"}</strong><span>{sendFailureStageCopy(item.stage).label}</span><span>{item.threadId ? "已关联任务" : "未关联任务"}</span></span>, children: <>
        <p>用户：{item.userEmail || item.userId || "未知用户"}</p>
        {item.threadId ? <a href={`#admin/conversations?conversation=${encodeURIComponent(item.threadId)}`}>查看会话</a> : <p>此次失败尚未关联任务，可通过用户和时间定位。</p>}
        <ConversationSendFailures failures={[item]} />
      </> }))} />
      <Pagination current={result.page} total={result.total} pageSize={25} showSizeChanger={false} onChange={page => apply({ ...filters, page })} showTotal={total => `共 ${total} 条`} />
    </> : null}
  </div>;
}
