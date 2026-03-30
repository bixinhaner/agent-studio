import { useEffect, useState } from "react";

import { fetchMonitoringRankings } from "./api";
import type { MonitoringRankingsResponse } from "./types";

function formatCount(value: number): string {
  return new Intl.NumberFormat(undefined).format(value);
}

function RankingTable(props: { title: string; rows: Array<Record<string, string | number>>; emptyText: string }) {
  return (
    <section className="monitoring-subcard">
      <h3>{props.title}</h3>
      {props.rows.length ? (
        <div className="monitoring-table-wrap">
          <table className="monitoring-table">
            <thead>
              <tr>
                <th>对象</th>
                <th>请求</th>
                <th>预估成本</th>
                <th>内部成本</th>
              </tr>
            </thead>
            <tbody>
              {props.rows.map((row) => (
                <tr key={`${row.label}`}>
                  <td>{row.label}</td>
                  <td>{formatCount(Number(row.requestCount))}</td>
                  <td>{row.estimatedCost}</td>
                  <td>{row.internalCost}</td>
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

function toRows<T extends { requestCount: number; estimatedCost: string; internalCost: string }>(
  rows: T[],
  labelKey: keyof T
): Array<{ label: string; requestCount: number; estimatedCost: string; internalCost: string }> {
  return rows.map((row) => ({
    label: String(row[labelKey]),
    requestCount: row.requestCount,
    estimatedCost: row.estimatedCost,
    internalCost: row.internalCost
  }));
}

export function UsageRankingsView() {
  const [data, setData] = useState<MonitoringRankingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setErrorText("");
      try {
        const next = await fetchMonitoringRankings();
        if (active) setData(next);
      } catch (error) {
        if (active) setErrorText(error instanceof Error ? error.message : "加载使用排行失败");
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
          <h2>使用排行</h2>
          <p>查看用户、部门、模型和功能维度的成本分布。</p>
        </div>
      </div>
      {loading ? <p>加载中...</p> : null}
      {errorText ? <p className="err-text">{errorText}</p> : null}
      {data ? (
        <div className="monitoring-subgrid">
          <RankingTable title="用户排行" rows={toRows(data.rankings.topUsers, "userId")} emptyText="暂无用户排行数据" />
          <RankingTable
            title="部门排行"
            rows={toRows(data.rankings.topDepartments, "departmentId")}
            emptyText="暂无部门排行数据"
          />
          <RankingTable title="模型排行" rows={toRows(data.rankings.topModels, "model")} emptyText="暂无模型排行数据" />
          <RankingTable title="功能排行" rows={toRows(data.rankings.topFeatures, "featureType")} emptyText="暂无功能排行数据" />
        </div>
      ) : null}
    </section>
  );
}
