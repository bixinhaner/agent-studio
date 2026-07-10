import { ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Empty, Input, Segmented, Space, Spin, Tag } from "antd";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { fetchExternalApiUsage } from "./api";
import type { ExternalApiUsageBreakdownRow, ExternalApiUsageResponse, ExternalApiUsageRecord } from "./types";

const WINDOW_OPTIONS = [
  { label: "7 天", value: 7 },
  { label: "14 天", value: 14 },
  { label: "30 天", value: 30 },
  { label: "90 天", value: 90 }
] as const;

const EXECUTION_FILTERS = [
  { label: "全部生成态", value: "all" },
  { label: "生成成功", value: "success" },
  { label: "生成失败", value: "failed" }
] as const;

const DELIVERY_FILTERS = [
  { label: "全部交付态", value: "all" },
  { label: "已送达", value: "delivered" },
  { label: "已中断", value: "interrupted" }
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

function formatDuration(value: number | undefined): string {
  if (!value || value <= 0) return "—";
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} s`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function executionLabel(value: string): string {
  return value === "success" ? "生成成功" : value === "failed" ? "生成失败" : value || "未知";
}

function executionColor(value: string): "success" | "error" | "default" {
  return value === "success" ? "success" : value === "failed" ? "error" : "default";
}

function deliveryLabel(value: string): string {
  switch (value) {
    case "delivered":
      return "已送达";
    case "client_aborted":
      return "客户端中断";
    case "connection_closed":
      return "连接中断";
    default:
      return value || "未知";
  }
}

function deliveryColor(value: string): "success" | "warning" | "error" | "default" {
  if (value === "delivered") return "success";
  if (value === "client_aborted") return "warning";
  if (value === "connection_closed") return "error";
  return "default";
}

function responseModeLabel(value: string, stream: boolean): string {
  if (value === "stream" || stream) return "stream";
  return "non-stream";
}

function isInterruptedDelivery(value: string): boolean {
  return value !== "delivered";
}

function TrendChart(props: { data: ExternalApiUsageResponse["trends"] }) {
  const points = props.data;
  const width = 720;
  const height = 240;
  const padding = 24;
  const maxValue = Math.max(
    ...points.flatMap((item) => [item.requestCount, item.deliverySuccessCount, item.deliveryFailureCount]),
    1
  );

  const requestPolyline = points
    .map((item, index) => {
      const x = padding + (index * (width - padding * 2)) / Math.max(points.length - 1, 1);
      const y = height - padding - (item.requestCount / maxValue) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");

  const deliveryPolyline = points
    .map((item, index) => {
      const x = padding + (index * (width - padding * 2)) / Math.max(points.length - 1, 1);
      const y = height - padding - (item.deliverySuccessCount / maxValue) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="external-api-usage-chart-shell">
      <div className="external-api-usage-chart-meta">
        <div>
          <span className="field-label">请求与送达趋势</span>
          <p className="resource-center-subtle">同一时间窗内同时看请求量、已送达量和被中断量，更容易区分业务完成与链路送达。</p>
        </div>
        <div className="external-api-usage-legend">
          <span><i className="legend-request" />请求</span>
          <span><i className="legend-delivery" />已送达</span>
          <span><i className="legend-interrupted" />已中断</span>
        </div>
      </div>
      <div className="external-api-usage-chart">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="API 请求与送达趋势图">
          <defs>
            <linearGradient id="external-api-usage-fill" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(15, 118, 110, 0.3)" />
              <stop offset="100%" stopColor="rgba(15, 118, 110, 0.02)" />
            </linearGradient>
          </defs>
          <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} className="external-api-usage-axis" />
          <polyline points={requestPolyline} className="external-api-usage-line" />
          <polyline points={deliveryPolyline} className="external-api-usage-line-secondary" />
          {points.map((item, index) => {
            const x = padding + (index * (width - padding * 2)) / Math.max(points.length - 1, 1);
            const requestY = height - padding - (item.requestCount / maxValue) * (height - padding * 2);
            const deliveryY = height - padding - (item.deliverySuccessCount / maxValue) * (height - padding * 2);
            const interruptedHeight = (item.deliveryFailureCount / maxValue) * (height - padding * 2);
            return (
              <g key={item.date}>
                <rect
                  x={x - 8}
                  y={height - padding - interruptedHeight}
                  width="16"
                  height={interruptedHeight}
                  rx="6"
                  className="external-api-usage-interrupted-bar"
                />
                <circle cx={x} cy={requestY} r="4" className="external-api-usage-dot" />
                <circle cx={x} cy={deliveryY} r="4" className="external-api-usage-dot-secondary" />
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
                <span>生成成功 {formatCount(row.successCount)}</span>
                <span>生成失败 {formatCount(row.failureCount)}</span>
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

function recordMatchesDeliveryFilter(record: ExternalApiUsageRecord, filter: (typeof DELIVERY_FILTERS)[number]["value"]) {
  if (filter === "all") return true;
  if (filter === "delivered") return record.deliveryStatus === "delivered";
  return isInterruptedDelivery(record.deliveryStatus);
}

export function ExternalApiUsageView(props: { instanceId: string }) {
  const [windowDays, setWindowDays] = useState<number>(14);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [data, setData] = useState<ExternalApiUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [search, setSearch] = useState("");
  const [executionFilter, setExecutionFilter] = useState<(typeof EXECUTION_FILTERS)[number]["value"]>("all");
  const [deliveryFilter, setDeliveryFilter] = useState<(typeof DELIVERY_FILTERS)[number]["value"]>("all");
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
      if (executionFilter !== "all" && record.resultStatus !== executionFilter) {
        return false;
      }
      if (!recordMatchesDeliveryFilter(record, deliveryFilter)) {
        return false;
      }
      if (!keyword) return true;
      return [
        record.model,
        record.requestedModel,
        record.sessionId,
        record.agentModeId,
        record.errorMessage,
        record.deliveryStatus,
        ...record.knowledgeSetIds
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword));
    });
  }, [data, deferredSearch, deliveryFilter, executionFilter]);

  return (
    <section className="external-api-usage-shell">
      <Card className="resource-center-section external-api-usage-hero antd-admin-card" size="small">
        <div className="external-api-usage-hero-header">
          <div>
            <p className="external-api-usage-kicker">Delivery Observability Board</p>
            <h3>外部调用记录</h3>
            <p>把“模型是否做完”和“结果是否真正送达调用方”拆开看，才能定位长请求的真实不稳定点。</p>
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
            {data.summary.generatedUndeliveredCount > 0 ? (
              <Alert
                type="warning"
                showIcon
                className="admin-alert-inline"
                message={`最近 ${data.summary.windowDays} 天有 ${formatCount(
                  data.summary.generatedUndeliveredCount
                )} 次“生成完成但未送达”的请求。`}
              />
            ) : null}

            <div className="external-api-usage-metric-grid">
              <article className="external-api-usage-metric-card">
                <span>总调用数</span>
                <strong>{formatCount(data.summary.totalRequests)}</strong>
                <small>最近 {data.summary.windowDays} 天</small>
              </article>
              <article className="external-api-usage-metric-card">
                <span>生成成功率</span>
                <strong>{formatPercent(data.summary.successRate)}</strong>
                <small>
                  成功 {formatCount(data.summary.successCount)} / 失败 {formatCount(data.summary.failureCount)}
                </small>
              </article>
              <article className="external-api-usage-metric-card">
                <span>送达成功率</span>
                <strong>{formatPercent(data.summary.deliverySuccessRate)}</strong>
                <small>
                  已送达 {formatCount(data.summary.deliverySuccessCount)} / 中断 {formatCount(data.summary.deliveryFailureCount)}
                </small>
              </article>
              <article className="external-api-usage-metric-card">
                <span>生成未送达</span>
                <strong>{formatCount(data.summary.generatedUndeliveredCount)}</strong>
                <small>模型已完成，但结果没有完整送达调用方</small>
              </article>
              <article className="external-api-usage-metric-card">
                <span>平均准备耗时</span>
                <strong>{formatDuration(data.summary.averageReadyMs)}</strong>
                <small>P95 {formatDuration(data.summary.p95ReadyMs)}</small>
              </article>
              <article className="external-api-usage-metric-card">
                <span>平均总耗时</span>
                <strong>{formatDuration(data.summary.averageResponseMs)}</strong>
                <small>P95 {formatDuration(data.summary.p95ResponseMs)}</small>
              </article>
              <article className="external-api-usage-metric-card">
                <span>总 Tokens</span>
                <strong>{formatCount(data.summary.totalTokens)}</strong>
                <small>平均每次 {formatCount(data.summary.averageTokensPerRequest)}</small>
              </article>
              <article className="external-api-usage-metric-card">
                <span>最近送达</span>
                <strong>{data.summary.lastDeliveredAt ? "有交付" : "暂无"}</strong>
                <small>{formatLocalDateTime(data.summary.lastDeliveredAt || data.summary.lastRequestedAt)}</small>
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
            subtitle="看实际执行模型是否稳定，是否出现非预期模型切换。"
            rows={data.breakdowns.byModel}
            accentClassName="external-api-usage-panel-ink"
          />
          <BreakdownPanel
            title="生成结果"
            subtitle="聚焦模型执行是否成功，而不是只看 HTTP 是否返回。"
            rows={data.breakdowns.byStatus}
            accentClassName="external-api-usage-panel-sky"
          />
          <BreakdownPanel
            title="交付结果"
            subtitle="分离已送达、客户端中断和连接中断，定位链路问题。"
            rows={data.breakdowns.byDelivery}
            accentClassName="external-api-usage-panel-amber"
          />
          <BreakdownPanel
            title="响应形态"
            subtitle="区分 stream / non-stream，判断接入方式是否更容易触发长连接风险。"
            rows={data.breakdowns.byTransport}
            accentClassName="external-api-usage-panel-mist"
          />
        </div>
      ) : null}

      <Card className="resource-center-section external-api-usage-records antd-admin-card" size="small">
        <div className="external-api-usage-records-header">
          <div>
            <h3>详细调用列表</h3>
            <p>按调用时间倒序展示每次请求的生成态、交付态、耗时与上下文，适合排查“服务端已完成但客户端仍报错”的个案。</p>
          </div>
          <div className="external-api-usage-record-filters">
            <Input
              allowClear
              placeholder="搜索 model / session / delivery / error / 资料集"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Segmented
              value={executionFilter}
              options={EXECUTION_FILTERS.map((item) => ({ label: item.label, value: item.value }))}
              onChange={(value) => setExecutionFilter(value as (typeof EXECUTION_FILTERS)[number]["value"])}
            />
            <Segmented
              value={deliveryFilter}
              options={DELIVERY_FILTERS.map((item) => ({ label: item.label, value: item.value }))}
              onChange={(value) => setDeliveryFilter(value as (typeof DELIVERY_FILTERS)[number]["value"])}
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
                  <th>生成态</th>
                  <th>交付态</th>
                  <th>耗时</th>
                  <th>模型与形态</th>
                  <th>Tokens / 输出</th>
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
                      <div className="external-api-usage-status-stack">
                        <Tag color={executionColor(record.resultStatus)}>{executionLabel(record.resultStatus)}</Tag>
                        <span>{record.responseStatusCode ? `HTTP ${record.responseStatusCode}` : "未记录 HTTP 状态"}</span>
                      </div>
                    </td>
                    <td>
                      <div className="external-api-usage-status-stack">
                        <Tag color={deliveryColor(record.deliveryStatus)}>{deliveryLabel(record.deliveryStatus)}</Tag>
                        <span>
                          {record.responseFinished
                            ? "响应已完整结束"
                            : record.responseClosedBeforeFinish
                              ? "响应在完成前关闭"
                              : record.requestAborted
                                ? "请求已被调用方中断"
                                : "等待/未知"}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="external-api-usage-cell-stack">
                        <strong>准备 {formatDuration(record.responseReadyMs)}</strong>
                        <span>总耗时 {formatDuration(record.responseCompletedMs)}</span>
                      </div>
                    </td>
                    <td>
                      <div className="external-api-usage-cell-stack">
                        <strong>{record.model}</strong>
                        <span>请求侧: {record.requestedModel || "未传"}</span>
                        <div className="external-api-usage-chip-row">
                          <Tag color={responseModeLabel(record.responseMode, record.stream) === "stream" ? "processing" : "default"}>
                            {responseModeLabel(record.responseMode, record.stream)}
                          </Tag>
                          <Tag>{record.messageCount} 条消息</Tag>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="external-api-usage-cell-stack">
                        <strong>{formatCount(record.totalTokens)}</strong>
                        <span>
                          in {formatCount(record.inputTokens)} / out {formatCount(record.outputTokens)}
                        </span>
                        <span>
                          缓存读取 {formatCount(record.cachedInputTokens)} / 写入 {formatCount(record.cacheWriteTokens)}
                        </span>
                        <span>输出字符 {formatCount(record.outputChars)}</span>
                      </div>
                    </td>
                    <td>
                      <div className="external-api-usage-cell-stack">
                        <span>Agent Mode: {record.agentModeId || "—"}</span>
                        <span>资料集: {record.knowledgeSetIds.length ? record.knowledgeSetIds.join(", ") : "未绑定"}</span>
                        {record.requestedReasoningEffort ? <span>请求推理强度: {record.requestedReasoningEffort}</span> : null}
                        {record.responseReadyAt ? <span>生成完成: {formatLocalDateTime(record.responseReadyAt)}</span> : null}
                        {record.responseCompletedAt ? <span>响应结束: {formatLocalDateTime(record.responseCompletedAt)}</span> : null}
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
