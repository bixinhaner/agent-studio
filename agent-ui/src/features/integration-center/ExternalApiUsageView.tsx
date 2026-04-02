import { ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Empty, Input, Segmented, Space, Spin, Tag } from "antd";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { fetchExternalApiUsage } from "./api";
import type { ExternalApiUsageBreakdownRow, ExternalApiUsageResponse } from "./types";

const WINDOW_OPTIONS = [
  { label: "7 天", value: 7 },
  { label: "14 天", value: 14 },
  { label: "30 天", value: 30 },
  { label: "90 天", value: 90 }
] as const;

const STATUS_FILTERS = [
  { label: "全部", value: "all" },
  { label: "成功", value: "success" },
  { label: "失败", value: "failed" }
] as const;

function formatCount(value: number): string {
  return new Intl.NumberFormat(undefined).format(value);
}

function formatDecimal(value: string): string {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6
  }).format(Number(value || 0));
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatLocalDateTime(value: string | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
}

function TrendChart(props: { data: ExternalApiUsageResponse["trends"] }) {
  const points = props.data;
  const width = 640;
  const height = 220;
  const padding = 20;
  const maxRequests = Math.max(...points.map((item) => item.requestCount), 1);

  const requestPolyline = points
    .map((item, index) => {
      const x = padding + (index * (width - padding * 2)) / Math.max(points.length - 1, 1);
      const y = height - padding - (item.requestCount / maxRequests) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");

  const areaPolyline = [
    `${padding},${height - padding}`,
    requestPolyline,
    `${width - padding},${height - padding}`
  ].join(" ");

  return (
    <div className="external-api-usage-chart-shell">
      <div className="external-api-usage-chart-meta">
        <div>
          <span className="field-label">请求趋势</span>
          <p className="resource-center-subtle">按 UTC 天聚合请求量，帮助快速看出波峰、回落和异常空窗。</p>
        </div>
        <Tag color="blue">最近 {points.length} 天</Tag>
      </div>
      <div className="external-api-usage-chart">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="API 请求趋势图">
          <defs>
            <linearGradient id="external-api-usage-fill" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(12, 74, 110, 0.42)" />
              <stop offset="100%" stopColor="rgba(12, 74, 110, 0.02)" />
            </linearGradient>
          </defs>
          <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} className="external-api-usage-axis" />
          <polygon points={areaPolyline} className="external-api-usage-area" />
          <polyline points={requestPolyline} className="external-api-usage-line" />
          {points.map((item, index) => {
            const x = padding + (index * (width - padding * 2)) / Math.max(points.length - 1, 1);
            const y = height - padding - (item.requestCount / maxRequests) * (height - padding * 2);
            return (
              <g key={item.date}>
                <circle cx={x} cy={y} r="4" className="external-api-usage-dot" />
                <text x={x} y={height - 4} textAnchor="middle" className="external-api-usage-axis-label">
                  {item.date.slice(5)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function BreakdownPanel(props: {
  title: string;
  subtitle: string;
  rows: ExternalApiUsageBreakdownRow[];
  accentClassName: string;
}) {
  const maxRequests = Math.max(...props.rows.map((item) => item.requestCount), 1);

  return (
    <Card size="small" className={`external-api-usage-panel antd-admin-card ${props.accentClassName}`}>
      <div className="external-api-usage-panel-header">
        <div>
          <h3>{props.title}</h3>
          <p>{props.subtitle}</p>
        </div>
      </div>
      {props.rows.length ? (
        <div className="external-api-usage-breakdown-list">
          {props.rows.slice(0, 6).map((row) => (
            <article key={row.key} className="external-api-usage-breakdown-item">
              <div className="external-api-usage-breakdown-topline">
                <strong>{row.label}</strong>
                <span>{formatCount(row.requestCount)} 次</span>
              </div>
              <div className="external-api-usage-breakdown-bar">
                <span style={{ width: `${(row.requestCount / maxRequests) * 100}%` }} />
              </div>
              <div className="external-api-usage-breakdown-meta">
                <span>成功 {formatCount(row.successCount)}</span>
                <span>失败 {formatCount(row.failureCount)}</span>
                <span>Tokens {formatCount(row.totalTokens)}</span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="resource-center-empty">当前窗口内还没有统计数据。</p>
      )}
    </Card>
  );
}

export function ExternalApiUsageView(props: { instanceId: string }) {
  const [windowDays, setWindowDays] = useState<number>(14);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [data, setData] = useState<ExternalApiUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]["value"]>("all");
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setErrorText("");
      try {
        const next = await fetchExternalApiUsage(props.instanceId, {
          days: windowDays,
          take: 160
        });
        if (active) {
          setData(next);
        }
      } catch (error) {
        if (active) {
          setData(null);
          setErrorText(error instanceof Error ? error.message : "加载 API 调用记录失败");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [props.instanceId, reloadNonce, windowDays]);

  const filteredRecords = useMemo(() => {
    if (!data) return [];
    const keyword = deferredSearch.trim().toLowerCase();
    return data.records.filter((record) => {
      if (statusFilter !== "all" && record.resultStatus !== statusFilter) {
        return false;
      }
      if (!keyword) return true;
      return [
        record.model,
        record.requestedModel,
        record.sessionId,
        record.agentModeId,
        record.errorMessage,
        ...record.knowledgeSetIds
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword));
    });
  }, [data, deferredSearch, statusFilter]);

  return (
    <section className="external-api-usage-shell">
      <Card className="resource-center-section external-api-usage-hero antd-admin-card" size="small">
        <div className="external-api-usage-hero-header">
          <div>
            <p className="external-api-usage-kicker">API Signal Board</p>
            <h3>外部调用记录</h3>
            <p>聚焦单个 API Key 绑定实例的真实调用情况，先看总体信号，再下钻到每一条请求。</p>
          </div>
          <Space wrap>
            <Segmented
              value={windowDays}
              options={WINDOW_OPTIONS.map((item) => ({ label: item.label, value: item.value }))}
              onChange={(value) => setWindowDays(Number(value))}
            />
            <Button icon={<ReloadOutlined />} onClick={() => setReloadNonce((current) => current + 1)}>
              刷新
            </Button>
          </Space>
        </div>

        {loading ? <Spin size="small" /> : null}
        {errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={errorText} /> : null}

        {data ? (
          <>
            <div className="external-api-usage-metric-grid">
              <article className="external-api-usage-metric-card">
                <span>总调用数</span>
                <strong>{formatCount(data.summary.totalRequests)}</strong>
                <small>最近 {data.summary.windowDays} 天</small>
              </article>
              <article className="external-api-usage-metric-card">
                <span>成功率</span>
                <strong>{formatPercent(data.summary.successRate)}</strong>
                <small>
                  成功 {formatCount(data.summary.successCount)} / 失败 {formatCount(data.summary.failureCount)}
                </small>
              </article>
              <article className="external-api-usage-metric-card">
                <span>总 Tokens</span>
                <strong>{formatCount(data.summary.totalTokens)}</strong>
                <small>平均每次 {formatCount(data.summary.averageTokensPerRequest)}</small>
              </article>
              <article className="external-api-usage-metric-card">
                <span>Streaming 占比</span>
                <strong>{formatPercent(data.summary.streamRate)}</strong>
                <small>{formatCount(data.summary.streamCount)} 次流式调用</small>
              </article>
              <article className="external-api-usage-metric-card">
                <span>预估成本</span>
                <strong>{formatDecimal(data.summary.totalEstimatedCost)}</strong>
                <small>内部成本 {formatDecimal(data.summary.totalInternalCost)}</small>
              </article>
              <article className="external-api-usage-metric-card">
                <span>最近一次</span>
                <strong>{data.summary.lastRequestedAt ? "已接入" : "暂无调用"}</strong>
                <small>{formatLocalDateTime(data.summary.lastRequestedAt)}</small>
              </article>
            </div>

            <TrendChart data={data.trends} />
          </>
        ) : null}
      </Card>

      {data ? (
        <div className="external-api-usage-panels">
          <BreakdownPanel
            title="模型分布"
            subtitle="看实际执行模型是否稳定，是否出现与预期不一致的切换。"
            rows={data.breakdowns.byModel}
            accentClassName="external-api-usage-panel-ink"
          />
          <BreakdownPanel
            title="结果分布"
            subtitle="快速识别成功/失败结构，避免只看总调用量而忽略错误积压。"
            rows={data.breakdowns.byStatus}
            accentClassName="external-api-usage-panel-sky"
          />
          <BreakdownPanel
            title="传输形态"
            subtitle="区分流式与非流式请求，方便判断接入方的使用习惯。"
            rows={data.breakdowns.byTransport}
            accentClassName="external-api-usage-panel-mist"
          />
        </div>
      ) : null}

      <Card className="resource-center-section external-api-usage-records antd-admin-card" size="small">
        <div className="external-api-usage-records-header">
          <div>
            <h3>详细调用列表</h3>
            <p>按调用时间倒序展示，支持按状态和关键字过滤，方便定位单次请求的上下文。</p>
          </div>
          <div className="external-api-usage-record-filters">
            <Input
              allowClear
              placeholder="搜索 model / session / error / 资料集"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Segmented
              value={statusFilter}
              options={STATUS_FILTERS.map((item) => ({ label: item.label, value: item.value }))}
              onChange={(value) => setStatusFilter(value as (typeof STATUS_FILTERS)[number]["value"])}
            />
          </div>
        </div>

        {loading ? <Spin size="small" /> : null}

        {data && filteredRecords.length ? (
          <div className="external-api-usage-table-wrap">
            <table className="monitoring-table external-api-usage-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>结果</th>
                  <th>模型</th>
                  <th>请求形态</th>
                  <th>Tokens</th>
                  <th>成本</th>
                  <th>调用详情</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <div className="external-api-usage-cell-stack">
                        <strong>{formatLocalDateTime(record.createdAt)}</strong>
                        <span>{record.sessionId || "无 sessionId"}</span>
                      </div>
                    </td>
                    <td>
                      <Tag color={record.resultStatus === "success" ? "success" : "error"}>{record.resultStatus}</Tag>
                    </td>
                    <td>
                      <div className="external-api-usage-cell-stack">
                        <strong>{record.model}</strong>
                        <span>请求侧: {record.requestedModel || "未传"}</span>
                      </div>
                    </td>
                    <td>
                      <div className="external-api-usage-chip-row">
                        <Tag color={record.stream ? "processing" : "default"}>{record.stream ? "stream" : "non-stream"}</Tag>
                        <Tag>{record.messageCount} 条消息</Tag>
                      </div>
                    </td>
                    <td>
                      <div className="external-api-usage-cell-stack">
                        <strong>{formatCount(record.totalTokens)}</strong>
                        <span>
                          in {formatCount(record.inputTokens + record.cachedInputTokens)} / out {formatCount(record.outputTokens)}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="external-api-usage-cell-stack">
                        <strong>{formatDecimal(record.estimatedCost)}</strong>
                        <span>内部 {formatDecimal(record.internalCost)}</span>
                      </div>
                    </td>
                    <td>
                      <div className="external-api-usage-cell-stack">
                        <span>Agent Mode: {record.agentModeId || "—"}</span>
                        <span>资料集: {record.knowledgeSetIds.length ? record.knowledgeSetIds.join(", ") : "未绑定"}</span>
                        {record.requestedReasoningEffort ? <span>请求推理强度: {record.requestedReasoningEffort}</span> : null}
                        {record.errorMessage ? <span className="external-api-usage-error-text">{record.errorMessage}</span> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={data ? "当前筛选条件下还没有调用记录。" : "还没有可展示的 API 调用数据。"}
          />
        )}
      </Card>
    </section>
  );
}
