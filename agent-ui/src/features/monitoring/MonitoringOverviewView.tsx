import { useEffect, useState } from "react";

import { fetchMonitoringOverview } from "./api";
import type { MonitoringOverviewResponse } from "./types";

function formatCount(value: number): string {
  return new Intl.NumberFormat(undefined).format(value);
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="monitoring-metric">
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </div>
  );
}

export function MonitoringOverviewView() {
  const [data, setData] = useState<MonitoringOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setErrorText("");
      try {
        const next = await fetchMonitoringOverview();
        if (active) setData(next);
      } catch (error) {
        if (active) setErrorText(error instanceof Error ? error.message : "加载平台总览失败");
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
          <h2>平台总览</h2>
          <p>按平台口径汇总 token、成本、告警和访问事件。</p>
        </div>
        <span className="monitoring-badge">本地时区显示</span>
      </div>
      {loading ? <p>加载中...</p> : null}
      {errorText ? <p className="err-text">{errorText}</p> : null}
      {data ? (
        <>
          <dl className="monitoring-metric-grid">
            <Metric label="总请求" value={formatCount(data.overview.totalRequests)} />
            <Metric label="预估成本" value={data.overview.totalEstimatedCost} />
            <Metric label="内部成本" value={data.overview.totalInternalCost} />
            <Metric label="使用事件" value={formatCount(data.overview.totalUsageEvents)} />
            <Metric label="资源访问" value={formatCount(data.overview.totalResourceAccessLogs)} />
            <Metric label="开放告警" value={formatCount(data.overview.openAlertCount)} />
            <Metric label="已确认告警" value={formatCount(data.overview.acknowledgedAlertCount)} />
            <Metric label="通知记录" value={formatCount(data.overview.notificationCount)} />
          </dl>
          <div className="monitoring-trend-panel">
            <div className="panel-title-row">
              <h3>趋势概览</h3>
              <span className="monitoring-subtle">日期按平台汇总</span>
            </div>
            <div className="monitoring-table-wrap">
              <table className="monitoring-table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>请求</th>
                    <th>成功</th>
                    <th>失败</th>
                    <th>预估成本</th>
                    <th>内部成本</th>
                  </tr>
                </thead>
                <tbody>
                  {data.trends.map((trend) => (
                    <tr key={trend.rollupDate}>
                      <td>{trend.rollupDate}</td>
                      <td>{formatCount(trend.requestCount)}</td>
                      <td>{formatCount(trend.successCount)}</td>
                      <td>{formatCount(trend.failureCount)}</td>
                      <td>{trend.estimatedCost}</td>
                      <td>{trend.internalCost}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
