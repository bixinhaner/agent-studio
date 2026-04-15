import { Alert, Button, Empty, Input, Pagination, Select, Spin, Tag, Typography } from "antd";
import { RefreshCcw, Search } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { fetchOperationsInsights } from "./api";
import type {
  OperationsInsightsBreakdownRow,
  OperationsInsightsOrganizationRow,
  OperationsInsightsResponse,
  OperationsInsightsSessionRow,
  OperationsInsightsUserRow
} from "./types";
import { formatLocalDateTime } from "./types";

const DAY_OPTIONS = [
  { label: "7天", value: 7 },
  { label: "30天", value: 30 },
  { label: "90天", value: 90 }
];

function formatCount(value: number): string {
  return new Intl.NumberFormat(undefined).format(value);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function resolveLocalTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function MetricCard(props: { label: string; value: string; meta: string }) {
  return (
    <article className="ops-analytics-metric-card">
      <span className="ops-analytics-metric-label">{props.label}</span>
      <strong className="ops-analytics-metric-value">{props.value}</strong>
      <span className="ops-analytics-metric-meta">{props.meta}</span>
    </article>
  );
}

function BreakdownPanel(props: { title: string; subtitle: string; rows: OperationsInsightsBreakdownRow[]; emptyText: string }) {
  return (
    <section className="ops-analytics-panel">
      <div className="ops-analytics-panel-head">
        <div>
          <h3>{props.title}</h3>
          <p>{props.subtitle}</p>
        </div>
      </div>
      {props.rows.length ? (
        <div className="ops-analytics-breakdown-list">
          {props.rows.slice(0, 8).map((row) => (
            <article key={row.key} className="ops-analytics-breakdown-item">
              <div className="ops-analytics-breakdown-topline">
                <strong>{row.label}</strong>
                <span>{row.internalCost}</span>
              </div>
              <div className="ops-analytics-breakdown-bar">
                <span style={{ width: `${Math.max(4, row.shareOfInternalCost * 100)}%` }} />
              </div>
              <div className="ops-analytics-breakdown-meta">
                <span>{formatCount(row.sessionCount)} 会话</span>
                <span>{formatCount(row.requestCount)} 次调用</span>
                <span>{formatCount(row.totalTokens)} tokens</span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="monitoring-empty">{props.emptyText}</p>
      )}
    </section>
  );
}

function TableShell(props: { title: string; subtitle: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="ops-analytics-table-section">
      <div className="ops-analytics-panel-head">
        <div>
          <h3>{props.title}</h3>
          <p>{props.subtitle}</p>
        </div>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

function renderOrgLabel(row: OperationsInsightsOrganizationRow): string {
  return row.organizationSlug ? `${row.organizationName} (${row.organizationSlug})` : row.organizationName;
}

function OrganizationTable(props: { rows: OperationsInsightsOrganizationRow[] }) {
  return props.rows.length ? (
    <div className="monitoring-table-wrap">
      <table className="monitoring-table">
        <thead>
          <tr>
            <th>组织</th>
            <th>用户数</th>
            <th>会话数</th>
            <th>调用数</th>
            <th>总 tokens</th>
            <th>预估价值</th>
            <th>内部价值</th>
            <th>主模型</th>
            <th>主路径</th>
            <th>缓存占比</th>
            <th>最近活跃</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr key={row.organizationId}>
              <td>
                <div className="ops-analytics-cell-stack">
                  <strong>{renderOrgLabel(row)}</strong>
                  <span>{row.organizationType || "—"}</span>
                </div>
              </td>
              <td>{formatCount(row.userCount)}</td>
              <td>{formatCount(row.sessionCount)}</td>
              <td>{formatCount(row.requestCount)}</td>
              <td>{formatCount(row.totalTokens)}</td>
              <td>{row.estimatedCost}</td>
              <td>{row.internalCost}</td>
              <td>{row.topModel}</td>
              <td>{row.topPath}</td>
              <td>{formatPercent(row.cacheShare)}</td>
              <td>{formatLocalDateTime(row.lastActiveAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty description="当前筛选下没有组织统计数据" />
  );
}

function UserTable(props: { rows: OperationsInsightsUserRow[] }) {
  return props.rows.length ? (
    <div className="monitoring-table-wrap">
      <table className="monitoring-table">
        <thead>
          <tr>
            <th>用户</th>
            <th>组织</th>
            <th>部门</th>
            <th>会话数</th>
            <th>调用数</th>
            <th>总 tokens</th>
            <th>预估价值</th>
            <th>内部价值</th>
            <th>主模型</th>
            <th>主路径</th>
            <th>缓存占比</th>
            <th>最近活跃</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr key={row.userId}>
              <td>
                <div className="ops-analytics-cell-stack">
                  <strong>{row.userName}</strong>
                  <span>{row.userEmail || row.userId}</span>
                </div>
              </td>
              <td>{row.organizationName || "—"}</td>
              <td>{row.departmentName || "—"}</td>
              <td>{formatCount(row.sessionCount)}</td>
              <td>{formatCount(row.requestCount)}</td>
              <td>{formatCount(row.totalTokens)}</td>
              <td>{row.estimatedCost}</td>
              <td>{row.internalCost}</td>
              <td>{row.topModel}</td>
              <td>{row.topPath}</td>
              <td>{formatPercent(row.cacheShare)}</td>
              <td>{formatLocalDateTime(row.lastActiveAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty description="当前筛选下没有用户统计数据" />
  );
}

function SessionTable(props: { rows: OperationsInsightsSessionRow[] }) {
  return props.rows.length ? (
    <div className="monitoring-table-wrap">
      <table className="monitoring-table">
        <thead>
          <tr>
            <th>会话</th>
            <th>用户 / 组织</th>
            <th>模型</th>
            <th>入口</th>
            <th>路径</th>
            <th>调用数</th>
            <th>输入</th>
            <th>缓存</th>
            <th>输出</th>
            <th>总 tokens</th>
            <th>预估价值</th>
            <th>内部价值</th>
            <th>最近活跃</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr key={row.sessionId}>
              <td>
                <div className="ops-analytics-cell-stack ops-analytics-code-stack">
                  <strong>{row.sessionId}</strong>
                  <span>{row.threadId || "无 thread"}</span>
                </div>
              </td>
              <td>
                <div className="ops-analytics-cell-stack">
                  <strong>{row.userName}</strong>
                  <span>{row.organizationName || "未关联组织"}</span>
                </div>
              </td>
              <td>{row.model}</td>
              <td>{row.entryLabel}</td>
              <td>{row.pathLabel}</td>
              <td>{formatCount(row.requestCount)}</td>
              <td>{formatCount(row.inputTokens)}</td>
              <td>{formatCount(row.cachedInputTokens)}</td>
              <td>{formatCount(row.outputTokens)}</td>
              <td>
                <div className="ops-analytics-cell-stack">
                  <strong>{formatCount(row.totalTokens)}</strong>
                  <span>均值 {formatCount(Math.round(row.avgTokensPerRequest))}/次</span>
                </div>
              </td>
              <td>{row.estimatedCost}</td>
              <td>
                <div className="ops-analytics-cell-stack">
                  <strong>{row.internalCost}</strong>
                  <span>缓存 {formatPercent(row.cacheShare)}</span>
                </div>
              </td>
              <td>
                <div className="ops-analytics-cell-stack">
                  <strong>{formatLocalDateTime(row.lastActiveAt)}</strong>
                  <span>首条 {formatLocalDateTime(row.firstActiveAt)}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty description="当前筛选下没有会话台账" />
  );
}

export function OperationsAnalyticsView() {
  const [days, setDays] = useState(30);
  const [organizationId, setOrganizationId] = useState<string | undefined>();
  const [model, setModel] = useState<string | undefined>();
  const [path, setPath] = useState<string | undefined>();
  const [entry, setEntry] = useState<string | undefined>();
  const [query, setQuery] = useState("");
  const [sessionPage, setSessionPage] = useState(1);
  const [sessionPageSize, setSessionPageSize] = useState(20);
  const [refreshToken, setRefreshToken] = useState(0);

  const [data, setData] = useState<OperationsInsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");

  const deferredQuery = useDeferredValue(query.trim());
  const timeZone = useMemo(() => resolveLocalTimeZone(), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrorText("");

    fetchOperationsInsights({
      days,
      timezone: timeZone,
      organizationId,
      model,
      path,
      entry,
      query: deferredQuery || undefined,
      sessionPage,
      sessionPageSize
    })
      .then((response) => {
        if (!active) return;
        setData(response);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setErrorText(error instanceof Error ? error.message : "加载运营分析失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [days, timeZone, organizationId, model, path, entry, deferredQuery, sessionPage, sessionPageSize, refreshToken]);

  const valueHint =
    data && data.summary.estimatedCost === "0.000000" && data.summary.internalCost === "0.000000"
      ? "当前价值列为 0，说明模型定价尚未配置或未命中成本档。"
      : "价值按模型定价配置折算；内部价值=预估价值 × 内部成本系数。";

  return (
    <div className="admin-page-container">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">运营分析</h1>
          <p className="admin-page-desc">按组织、用户、模型、路径和会话五个层级统一追踪消耗、价值和调用结构。</p>
        </div>
        <div className="ops-analytics-header-tags">
          <Tag color="processing">本地时区：{timeZone}</Tag>
          <Tag color="blue">默认窗口：近 {days} 天</Tag>
        </div>
      </div>

      <section className="ops-analytics-filterbar">
        <label className="field">
          <span className="field-label">时间窗口</span>
          <Select
            value={days}
            options={DAY_OPTIONS}
            onChange={(value) => {
              setDays(value);
              setSessionPage(1);
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">组织</span>
          <Select
            allowClear
            placeholder="全部组织"
            value={organizationId}
            options={data?.options.organizations ?? []}
            onChange={(value) => {
              setOrganizationId(value);
              setSessionPage(1);
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">模型</span>
          <Select
            allowClear
            placeholder="全部模型"
            value={model}
            options={data?.options.models ?? []}
            onChange={(value) => {
              setModel(value);
              setSessionPage(1);
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">路径</span>
          <Select
            allowClear
            placeholder="全部路径"
            value={path}
            options={data?.options.paths ?? []}
            onChange={(value) => {
              setPath(value);
              setSessionPage(1);
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">入口</span>
          <Select
            allowClear
            placeholder="全部入口"
            value={entry}
            options={data?.options.entries ?? []}
            onChange={(value) => {
              setEntry(value);
              setSessionPage(1);
            }}
          />
        </label>
        <label className="field ops-analytics-search">
          <span className="field-label">搜索</span>
          <Input
            prefix={<Search size={14} />}
            value={query}
            placeholder="搜索用户 / 组织 / session / 线程 / 路径"
            onChange={(event) => {
              setQuery(event.target.value);
              setSessionPage(1);
            }}
          />
        </label>
        <div className="field ops-analytics-refresh">
          <span className="field-label">刷新</span>
          <Button icon={<RefreshCcw size={14} />} onClick={() => setRefreshToken((current) => current + 1)}>
            重新拉取
          </Button>
        </div>
      </section>

      {errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={errorText} /> : null}

      {loading && !data ? (
        <div className="ops-analytics-loading">
          <Spin size="large" />
        </div>
      ) : null}

      {data ? (
        <>
          <section className="ops-analytics-hero">
            <MetricCard label="活跃组织" value={formatCount(data.summary.totalOrganizations)} meta="当前窗口内有调用的组织" />
            <MetricCard label="活跃用户" value={formatCount(data.summary.totalUsers)} meta="当前窗口内有调用的用户" />
            <MetricCard label="有效会话" value={formatCount(data.summary.totalSessions)} meta="至少发生过一次模型调用" />
            <MetricCard label="模型调用" value={formatCount(data.summary.totalRequests)} meta={`平均 ${data.summary.avgRequestsPerSession} 次/会话`} />
            <MetricCard label="总 tokens" value={formatCount(data.summary.totalTokens)} meta={`平均 ${data.summary.avgTokensPerSession} /会话`} />
            <MetricCard label="预估价值" value={data.summary.estimatedCost} meta="按模型单价折算" />
            <MetricCard label="内部价值" value={data.summary.internalCost} meta={`平均 ${data.summary.avgInternalCostPerSession} /会话`} />
            <MetricCard label="缓存占比" value={formatPercent(data.summary.cacheShare)} meta={`平均 ${data.summary.avgTokensPerRequest} tokens/次调用`} />
          </section>

          <section className="ops-analytics-context-strip">
            <div className="ops-analytics-context-block">
              <span className="ops-analytics-context-label">统计窗口</span>
              <strong>
                {formatLocalDateTime(data.window.from)} - {formatLocalDateTime(data.window.to)}
              </strong>
            </div>
            <div className="ops-analytics-context-block">
              <span className="ops-analytics-context-label">价值口径</span>
              <strong>{valueHint}</strong>
            </div>
          </section>

          <div className="ops-analytics-breakdown-grid">
            <BreakdownPanel
              title="路径分布"
              subtitle="看调用最终落到哪条运行路径，适合查 Azure / 本地登录态 / 外部 API 的占比。"
              rows={data.breakdowns.paths}
              emptyText="当前窗口内没有路径分布数据"
            />
            <BreakdownPanel
              title="模型分布"
              subtitle="看哪些模型在吞掉 tokens 和价值预算。"
              rows={data.breakdowns.models}
              emptyText="当前窗口内没有模型分布数据"
            />
            <BreakdownPanel
              title="入口分布"
              subtitle="区分 AI 助手工作台和外部 OpenAI API 的消耗结构。"
              rows={data.breakdowns.entries}
              emptyText="当前窗口内没有入口分布数据"
            />
          </div>

          <TableShell title="趋势" subtitle="按本地时区天粒度回放会话、调用、tokens 和价值变化。">
            {data.trends.length ? (
              <div className="monitoring-table-wrap">
                <table className="monitoring-table">
                  <thead>
                    <tr>
                      <th>日期</th>
                      <th>组织数</th>
                      <th>用户数</th>
                      <th>会话数</th>
                      <th>调用数</th>
                      <th>总 tokens</th>
                      <th>预估价值</th>
                      <th>内部价值</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.trends.map((row) => (
                      <tr key={row.day}>
                        <td>{row.day}</td>
                        <td>{formatCount(row.organizationCount)}</td>
                        <td>{formatCount(row.userCount)}</td>
                        <td>{formatCount(row.sessionCount)}</td>
                        <td>{formatCount(row.requestCount)}</td>
                        <td>{formatCount(row.totalTokens)}</td>
                        <td>{row.estimatedCost}</td>
                        <td>{row.internalCost}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty description="当前窗口内没有趋势数据" />
            )}
          </TableShell>

          <TableShell
            title="组织透视"
            subtitle="适合运营看哪个组织最耗资源、最常用什么模型、主要走哪条路径。"
          >
            <OrganizationTable rows={data.organizations} />
          </TableShell>

          <TableShell
            title="用户透视"
            subtitle="适合排查个人使用强度、模型偏好、缓存命中和最近活跃。"
          >
            <UserTable rows={data.users} />
          </TableShell>

          <TableShell
            title="会话台账"
            subtitle="逐会话查看 model、路径、tokens 和价值，直接落到具体 session 级别。"
            action={
              <div className="ops-analytics-session-meta">
                <span>共 {formatCount(data.sessions.totalItems)} 条</span>
              </div>
            }
          >
            <SessionTable rows={data.sessions.items} />
            {data.sessions.totalItems > 0 ? (
              <div className="ops-analytics-pagination">
                <Pagination
                  current={data.sessions.page}
                  pageSize={data.sessions.pageSize}
                  total={data.sessions.totalItems}
                  showSizeChanger
                  pageSizeOptions={["10", "20", "50", "100"]}
                  onChange={(page, nextPageSize) => {
                    setSessionPage(page);
                    if (nextPageSize !== sessionPageSize) {
                      setSessionPageSize(nextPageSize);
                    }
                  }}
                />
              </div>
            ) : null}
          </TableShell>
        </>
      ) : null}
    </div>
  );
}

export default OperationsAnalyticsView;
