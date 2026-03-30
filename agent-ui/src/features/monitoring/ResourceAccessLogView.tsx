import { useEffect, useState, type ReactNode } from "react";

import { fetchResourceAccessLogs, fetchUsageEvents } from "./api";
import type { ResourceAccessLogRecord, UsageEventRecord } from "./types";
import { formatLocalDateTime } from "./types";

function LogTable(props: { title: string; columns: string[]; rows: ReactNode[][]; emptyText: string }) {
  return (
    <section className="monitoring-subcard">
      <h3>{props.title}</h3>
      {props.rows.length ? (
        <div className="monitoring-table-wrap">
          <table className="monitoring-table">
            <thead>
              <tr>
                {props.columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {props.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${index}-${cellIndex}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="monitoring-empty">{props.emptyText}</p>
      )}
    </section>
  );
}

function resourceRows(items: ResourceAccessLogRecord[]): ReactNode[][] {
  return items.map((item) => [
    item.resourceType,
    item.actionType,
    item.resultStatus,
    item.resourceId,
    item.threadId ?? "—",
    item.sessionId ?? "—",
    formatLocalDateTime(item.createdAt)
  ]);
}

function usageRows(items: UsageEventRecord[]): ReactNode[][] {
  return items.map((item) => [
    item.featureType,
    item.model,
    String(item.inputTokens + item.cachedInputTokens + item.outputTokens),
    item.resultStatus,
    formatLocalDateTime(item.createdAt)
  ]);
}

export function ResourceAccessLogView() {
  const [resourceAccessLogs, setResourceAccessLogs] = useState<ResourceAccessLogRecord[]>([]);
  const [usageEvents, setUsageEvents] = useState<UsageEventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setErrorText("");
      try {
        const [resourceAccessResponse, usageResponse] = await Promise.all([
          fetchResourceAccessLogs(),
          fetchUsageEvents()
        ]);
        if (active) {
          setResourceAccessLogs(resourceAccessResponse.resourceAccessLogs);
          setUsageEvents(usageResponse.usageEvents);
        }
      } catch (error) {
        if (active) setErrorText(error instanceof Error ? error.message : "加载资源访问日志失败");
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="admin-card monitoring-card">
      <div className="monitoring-heading">
        <div>
          <h2>资源访问日志</h2>
          <p>记录 workspace、资料集和权限拒绝等关键运行事件。</p>
        </div>
      </div>
      {loading ? <p>加载中...</p> : null}
      {errorText ? <p className="err-text">{errorText}</p> : null}
      {!loading || resourceAccessLogs.length || usageEvents.length ? (
        <div className="monitoring-subgrid">
          <LogTable
            title="访问事件"
            columns={["资源类型", "动作", "结果", "资源 ID", "线程", "会话", "时间"]}
            rows={resourceRows(resourceAccessLogs)}
            emptyText="暂无资源访问日志"
          />
          <LogTable
            title="使用事件"
            columns={["功能", "模型", "Token", "结果", "时间"]}
            rows={usageRows(usageEvents)}
            emptyText="暂无使用事件"
          />
        </div>
      ) : null}
    </section>
  );
}
