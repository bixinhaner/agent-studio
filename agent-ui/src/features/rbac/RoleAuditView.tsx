import type { AuditLogSummary } from "./types";

function formatLocalTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export function RoleAuditView(props: { auditLogs: AuditLogSummary[] }) {
  return (
    <div className="rbac-audit-list">
      {props.auditLogs.map((log) => (
        <article key={log.id} className="admin-list-card">
          <div className="admin-list-card-header">
            <strong>{log.actionType}</strong>
            <span>{formatLocalTime(log.createdAt)}</span>
          </div>
          <p>{log.actorUserId || "system"}</p>
        </article>
      ))}
      {props.auditLogs.length === 0 ? <p>暂无审计记录</p> : null}
    </div>
  );
}
