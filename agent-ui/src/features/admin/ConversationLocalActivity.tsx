import { useState } from "react";
import { AlertCircle, Check, Cloud, Folder, LoaderCircle, Monitor, MousePointerClick } from "lucide-react";

import { formatAdminDateTime } from "../../lib/formatters";
import { fetchAdminConversationLocalOperation } from "./api";
import type {
  AdminConversationExecutionLocation,
  AdminConversationLocalEvent,
  AdminConversationLocalOperation,
  AdminConversationLocalOperationDetail,
  AdminConversationLocalWorkspace
} from "./types";

/** Same wording as the portal's local tool cards, so admins read what the user saw. */
const LOCAL_OP_VERBS: Record<string, string> = {
  workspace_info: "查看工作目录",
  read: "读取文件",
  list: "浏览文件夹",
  write: "保存文件",
  edit: "修改文件",
  mkdir: "创建文件夹",
  move: "移动文件",
  delete: "删除文件",
  exec: "执行命令",
  process: "处理命令输出",
  open: "打开文件",
  request_result: "核对执行结果"
};

export function localOperationVerb(op: string): string {
  return LOCAL_OP_VERBS[op] ?? `处理本机任务（${op}）`;
}

export function localOperationStatusLabel(operation: AdminConversationLocalOperation): string {
  if (operation.status === "pending") return "等待电脑返回";
  if (operation.status === "expired") return "超时，结果未知";
  if (operation.status === "cancelled") return "已取消";
  if (operation.status === "unknown") return "状态未知";
  return operation.ok === false ? "失败" : "成功";
}

function statusTone(operation: AdminConversationLocalOperation): "ok" | "error" | "pending" {
  if (operation.status === "pending") return "pending";
  if (operation.status === "completed" && operation.ok !== false) return "ok";
  return "error";
}

export function describeExecutionLocation(location: AdminConversationExecutionLocation | null | undefined): string {
  if (!location) return "未知";
  if (location.mode === "cloud") return "云端工作区";
  return [location.deviceName || "用户电脑", location.path || location.label].filter(Boolean).join(" · ");
}

function formatChars(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M 字符`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K 字符`;
  return `${value} 字符`;
}

/** Shown on user turns: where this turn ran when it was sent. */
export function TranscriptExecutionLocationChip(props: { location: AdminConversationExecutionLocation }) {
  const { location } = props;
  const local = location.mode === "local";
  const title = [
    local ? `本地工作区：${location.deviceName || "用户电脑"}` : "云端工作区",
    local && location.path ? `目录：${location.path}` : "",
    local && location.platform ? `系统：${location.platform}` : "",
    location.source === "derived" ? "根据工作区切换记录推断" : "发送时记录"
  ].filter(Boolean).join("\n");
  return (
    <span className={`admin-execution-location-chip ${local ? "is-local" : "is-cloud"}`} title={title}>
      {local ? <Folder size={12} /> : <Cloud size={12} />}
      {local ? `本地 · ${location.deviceName || "用户电脑"} · ${location.label || location.path}` : "云端"}
      {location.source === "derived" ? <em>推断</em> : null}
    </span>
  );
}

function DetailValue(props: { value: unknown }) {
  const { value } = props;
  if (value === null || value === undefined) return <span className="admin-local-op-empty">（空）</span>;
  if (typeof value === "string") return <pre>{value}</pre>;
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
}

function DetailSection(props: { title: string; value: unknown }) {
  const record = props.value && typeof props.value === "object" && !Array.isArray(props.value)
    ? (props.value as Record<string, unknown>)
    : null;
  return (
    <div className="admin-local-op-detail-section">
      <div className="admin-local-op-detail-title">{props.title}</div>
      {record && Object.keys(record).length > 0 ? (
        <dl>
          {Object.entries(record).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd><DetailValue value={value} /></dd>
            </div>
          ))}
        </dl>
      ) : (
        <DetailValue value={record ? null : props.value} />
      )}
    </div>
  );
}

function LocalOperationCard(props: { threadId: string; operation: AdminConversationLocalOperation }) {
  const { operation } = props;
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<AdminConversationLocalOperationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const tone = statusTone(operation);
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || detail || loading) return;
    setLoading(true);
    setError("");
    try {
      setDetail(await fetchAdminConversationLocalOperation(props.threadId, operation.id));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };
  return (
    <li className={`admin-local-op is-${tone}`}>
      <div className="admin-local-op-head">
        <Monitor size={14} />
        <span className="admin-local-op-verb">
          {operation.deviceName ? `${operation.deviceName} · ` : ""}
          {localOperationVerb(operation.op)}
        </span>
        <span className={`admin-local-op-status is-${tone}`}>
          {tone === "ok" ? <Check size={12} /> : tone === "pending" ? <LoaderCircle size={12} /> : <AlertCircle size={12} />}
          {localOperationStatusLabel(operation)}
          {operation.exitCode !== null ? ` · exit ${operation.exitCode}` : ""}
          {operation.running ? " · 仍在运行" : ""}
        </span>
        {operation.createdAt ? <span className="admin-local-op-time">{formatAdminDateTime(operation.createdAt, { seconds: true })}</span> : null}
      </div>
      {operation.target ? (
        <code className="admin-local-op-target" title={operation.target}>
          {operation.target}
          {operation.destination ? ` → ${operation.destination}` : ""}
        </code>
      ) : null}
      {operation.error ? <div className="admin-local-op-error">{operation.error}</div> : null}
      {operation.hasDetail ? (
        <button type="button" className="admin-local-op-toggle" aria-expanded={open} onClick={() => void toggle()}>
          {open ? "收起完整参数与结果" : `查看完整参数与结果（参数 ${formatChars(operation.argsChars)}，结果 ${formatChars(operation.resultChars)}）`}
        </button>
      ) : (
        <div className="admin-local-op-note">此操作早于本地操作审计记录，只保留了用户看到的结果卡片。</div>
      )}
      {open ? (
        <div className="admin-local-op-detail">
          {loading ? <span className="admin-local-op-empty">加载中…</span> : null}
          {error ? <span className="admin-local-op-error">{error}</span> : null}
          {detail ? (
            <>
              <div className="admin-local-op-meta">
                {[
                  detail.rootPath ? `工作目录：${detail.rootPath}` : "",
                  detail.platform ? `系统：${detail.platform}` : "",
                  detail.completedAt ? `完成于 ${formatAdminDateTime(detail.completedAt, { seconds: true })}` : "",
                  `请求 ID：${detail.id}`
                ].filter(Boolean).join("　")}
              </div>
              <DetailSection title="参数" value={detail.args} />
              <DetailSection title="结果" value={detail.result} />
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** The portal's local tool cards for one assistant turn, with full details on demand. */
export function TranscriptLocalOperations(props: { threadId: string; operations: AdminConversationLocalOperation[] }) {
  const failed = props.operations.filter((operation) => statusTone(operation) === "error").length;
  return (
    <details className="admin-local-ops" open={failed > 0 || props.operations.length <= 3}>
      <summary>
        <Monitor size={13} />
        本机操作 {props.operations.length} 项{failed > 0 ? `，${failed} 项未完成` : ""}
      </summary>
      <ol>
        {props.operations.map((operation) => (
          <LocalOperationCard key={operation.id} threadId={props.threadId} operation={operation} />
        ))}
      </ol>
    </details>
  );
}

function eventText(event: AdminConversationLocalEvent): string {
  if (event.kind === "operation" && event.operation) {
    const operation = event.operation;
    const action = operation.op === "read" ? "下载文件" : localOperationVerb(operation.op);
    const who = operation.source === "portal" ? "用户在 Portal 中" : "助手在回合外";
    return `${who}${action}：${operation.target ?? "（无路径）"} · ${localOperationStatusLabel(operation)}`;
  }
  if (event.kind === "switched") {
    return `切换工作区：${describeExecutionLocation(event.from)} → ${describeExecutionLocation(event.to)}`;
  }
  if (event.kind === "unbound") return `切回云端工作区（之前：${describeExecutionLocation(event.from)}）`;
  return `${event.backfilled ? "当时已" : ""}选择本地工作区：${describeExecutionLocation(event.to)}`;
}

/** Folder switches and portal open/download actions between turns. */
export function TranscriptLocalEventRow(props: { threadId: string; event: AdminConversationLocalEvent }) {
  const { event } = props;
  const isOperation = event.kind === "operation";
  return (
    <div className={`admin-local-event ${isOperation ? "is-operation" : "is-binding"}`} data-local-event-id={event.id}>
      <span className="admin-local-event-icon">
        {isOperation ? <MousePointerClick size={13} /> : event.kind === "unbound" ? <Cloud size={13} /> : <Folder size={13} />}
      </span>
      <span className="admin-local-event-text">{eventText(event)}</span>
      <span className="admin-local-event-time">{formatAdminDateTime(event.at, { seconds: true })}</span>
      {isOperation && event.operation?.hasDetail ? (
        <div className="admin-local-event-detail">
          <TranscriptLocalOperations threadId={props.threadId} operations={[event.operation]} />
        </div>
      ) : null}
    </div>
  );
}

/** Header value: the cloud workspace plus the local folder the task is bound to now. */
export function currentWorkspaceSummary(cloudWorkspace: string | null, local: AdminConversationLocalWorkspace | undefined) {
  const current = local?.current;
  if (!current) {
    return { label: cloudWorkspace || "无关联工作区", title: cloudWorkspace || "无关联工作区", local: false, online: false };
  }
  return {
    label: `本地 · ${current.deviceName || "用户电脑"} · ${current.path}`,
    title: [
      `当前绑定本地文件夹：${current.path}`,
      `电脑：${current.deviceName || "用户电脑"}${current.platform ? `（${current.platform}）` : ""} · ${current.online ? "在线" : "离线"}`,
      cloudWorkspace ? `云端工作区：${cloudWorkspace}` : ""
    ].filter(Boolean).join("\n"),
    local: true,
    online: current.online
  };
}
