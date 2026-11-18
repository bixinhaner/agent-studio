import { formatLocalDateTime } from "../monitoring/types";
import type { AdminConversationUpstreamWait } from "./types";

const KIND_LABELS: Record<string, string> = {
  serverOverloaded: "模型容量不足",
  rateLimited: "模型限流",
  rateLimitExceeded: "模型限流",
  usageLimitExceeded: "额度用尽",
  serverError: "模型服务 5xx",
  streamDisconnected: "连接中断重连"
};

export function upstreamWaitKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

const minuteFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

export function formatWaitDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "等待中";
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))} 秒`;
  return `${minuteFormat.format(ms / 60_000)} 分钟`;
}

/**
 * Admin-only record of an answer that waited on the model service: Codex retried a rejected
 * request (capacity / rate limit) after the server's delay. Users never see this in the portal.
 */
export function ConversationUpstreamWaits(props: { waits: AdminConversationUpstreamWait[] }) {
  if (props.waits.length === 0) return null;
  return (
    <>
      {props.waits.map((wait) => (
        <section key={wait.usageEventId} className="admin-turn-outcome is-upstream_wait" aria-label="模型服务等待">
          <div className="admin-turn-outcome-head">
            <span className="admin-turn-outcome-label">模型服务繁忙，等待后重试</span>
            {wait.kinds.map((kind) => (
              <span key={kind} className="admin-turn-outcome-tag">{upstreamWaitKindLabel(kind)}</span>
            ))}
            <span className="admin-turn-outcome-tag">{wait.resultStatus === "success" ? "最终完成" : wait.resultStatus === "cancelled" ? "已中止" : "最终失败"}</span>
          </div>
          <p className="admin-turn-outcome-reason">
            {`等待 ${wait.count} 次，共 ${formatWaitDuration(wait.totalWaitMs)}。仅管理员可见，用户侧没有提示。`}
          </p>
          {wait.entries.length > 0 ? (
            <ol className="admin-upstream-wait-list">
              {wait.entries.map((entry, index) => (
                <li key={`${entry.at}-${index}`}>
                  {formatLocalDateTime(entry.at)}
                  {entry.attempt !== null && entry.maxAttempts !== null ? ` · 第 ${entry.attempt}/${entry.maxAttempts} 次重试` : ""}
                  {` · ${upstreamWaitKindLabel(entry.kind)} · ${entry.resumedAt ? `等待 ${formatWaitDuration(entry.waitedMs)}后恢复` : "之后无新进展"}`}
                </li>
              ))}
            </ol>
          ) : null}
          {wait.entries.some((entry) => entry.message) ? (
            <details className="admin-turn-outcome-raw">
              <summary>原始信息</summary>
              <pre>{wait.entries.map((entry) => entry.message).filter(Boolean).join("\n")}</pre>
            </details>
          ) : null}
        </section>
      ))}
    </>
  );
}
