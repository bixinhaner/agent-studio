import { Alert, Button, Empty, Input, Pagination, Select, Spin, Tabs } from "antd";
import { ArrowDown, ArrowUp, ArrowUpDown, RefreshCcw, Search } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { formatUsdAmount } from "../../lib/formatters";
import { fetchOperationsInsights } from "./api";
import type {
  OperationsInsightsBreakdownRow,
  OperationsInsightsOrganizationRow,
  OperationsInsightsResponse,
  OperationsInsightsSessionRow,
  OperationsInsightsTrendPoint,
  OperationsInsightsUserRow
} from "./types";
import { formatLocalDateTime } from "./types";

const DAY_OPTIONS = [
  { label: "7天", value: 7 },
  { label: "30天", value: 30 },
  { label: "90天", value: 90 }
];

type OperationsAnalyticsTab = "overview" | "breakdowns" | "organizations" | "users" | "sessions";
type SortDirection = "asc" | "desc";
type SortValue = string | number | null | undefined;
type SortState<Key extends string> = {
  key: Key;
  direction: SortDirection;
};
type TrendSortKey = keyof Pick<
  OperationsInsightsTrendPoint,
  "day" | "organizationCount" | "userCount" | "sessionCount" | "requestCount" | "totalTokens" | "estimatedCost" | "internalCost"
>;
type OrganizationSortKey =
  | "organization"
  | "userCount"
  | "sessionCount"
  | "requestCount"
  | "totalTokens"
  | "estimatedCost"
  | "internalCost"
  | "topModel"
  | "topPath"
  | "cacheShare"
  | "lastActiveAt";
type UserSortKey =
  | "user"
  | "organizationName"
  | "departmentName"
  | "sessionCount"
  | "requestCount"
  | "totalTokens"
  | "estimatedCost"
  | "internalCost"
  | "topModel"
  | "topPath"
  | "cacheShare"
  | "lastActiveAt";
type SessionSortKey =
  | "sessionId"
  | "userName"
  | "model"
  | "entryLabel"
  | "pathLabel"
  | "requestCount"
  | "inputTokens"
  | "cachedInputTokens"
  | "outputTokens"
  | "totalTokens"
  | "estimatedCost"
  | "internalCost"
  | "lastActiveAt";

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

function compareSortValues(left: SortValue, right: SortValue): number {
  if (left === right) return 0;
  if (left === null || left === undefined) return 1;
  if (right === null || right === undefined) return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), "zh-CN", { numeric: true, sensitivity: "base" });
}

function sortRows<Row, Key extends string>(
  rows: readonly Row[],
  sort: SortState<Key>,
  accessors: Record<Key, (row: Row) => SortValue>
): Row[] {
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => compareSortValues(accessors[sort.key](left), accessors[sort.key](right)) * direction);
}

function nextSortState<Key extends string>(
  current: SortState<Key>,
  key: Key,
  defaultDirection: SortDirection = "desc"
): SortState<Key> {
  if (current.key !== key) return { key, direction: defaultDirection };
  return { key, direction: current.direction === "desc" ? "asc" : "desc" };
}

function SortableHeader<Key extends string>(props: {
  label: string;
  sortKey: Key;
  sort: SortState<Key>;
  defaultDirection?: SortDirection;
  onSort: (key: Key, defaultDirection?: SortDirection) => void;
}) {
  const active = props.sort.key === props.sortKey;
  const Icon = active ? (props.sort.direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  const directionLabel = active ? (props.sort.direction === "asc" ? "升序" : "降序") : "未排序";
  return (
    <button
      type="button"
      className={`ops-analytics-sort-button ${active ? "is-active" : ""}`}
      aria-label={`${props.label}，${directionLabel}，点击切换排序`}
      aria-pressed={active}
      onClick={() => props.onSort(props.sortKey, props.defaultDirection)}
    >
      <span>{props.label}</span>
      <Icon size={13} />
    </button>
  );
}

function MetricItem(props: { label: string; value: string; meta: string }) {
  return (
    <article className="ops-analytics-metric-item" title={`${props.label}: ${props.value} - ${props.meta}`}>
      <span className="ops-analytics-metric-label">{props.label}</span>
      <strong className="ops-analytics-metric-value" title={props.value}>{props.value}</strong>
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
                <span>{formatUsdAmount(row.internalCost)}</span>
              </div>
              <div className="ops-analytics-breakdown-bar">
                <span style={{ width: `${Math.max(4, row.shareOfInternalCost * 100)}%` }} />
              </div>
              <div className="ops-analytics-breakdown-meta">
                <span>{formatCount(row.sessionCount)} 会话</span>
                <span>{formatCount(row.requestCount)} 个问题</span>
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

function buildConversationRecordHref(row: OperationsInsightsSessionRow): string | null {
  const threadId = row.threadId?.trim();
  if (!threadId) return null;
  const params = new URLSearchParams();
  params.set("conversation", threadId);
  params.set("query", threadId);
  params.set("session", row.sessionId);
  return `#admin/conversations?${params.toString()}`;
}

const TREND_SORT_ACCESSORS: Record<TrendSortKey, (row: OperationsInsightsTrendPoint) => SortValue> = {
  day: (row) => row.day,
  organizationCount: (row) => row.organizationCount,
  userCount: (row) => row.userCount,
  sessionCount: (row) => row.sessionCount,
  requestCount: (row) => row.requestCount,
  totalTokens: (row) => row.totalTokens,
  estimatedCost: (row) => Number(row.estimatedCost),
  internalCost: (row) => Number(row.internalCost)
};

const ORGANIZATION_SORT_ACCESSORS: Record<OrganizationSortKey, (row: OperationsInsightsOrganizationRow) => SortValue> = {
  organization: renderOrgLabel,
  userCount: (row) => row.userCount,
  sessionCount: (row) => row.sessionCount,
  requestCount: (row) => row.requestCount,
  totalTokens: (row) => row.totalTokens,
  estimatedCost: (row) => Number(row.estimatedCost),
  internalCost: (row) => Number(row.internalCost),
  topModel: (row) => row.topModel,
  topPath: (row) => row.topPath,
  cacheShare: (row) => row.cacheShare,
  lastActiveAt: (row) => Date.parse(row.lastActiveAt)
};

const USER_SORT_ACCESSORS: Record<UserSortKey, (row: OperationsInsightsUserRow) => SortValue> = {
  user: (row) => `${row.userName} ${row.userEmail || row.userId}`,
  organizationName: (row) => row.organizationName || "",
  departmentName: (row) => row.departmentName || "",
  sessionCount: (row) => row.sessionCount,
  requestCount: (row) => row.requestCount,
  totalTokens: (row) => row.totalTokens,
  estimatedCost: (row) => Number(row.estimatedCost),
  internalCost: (row) => Number(row.internalCost),
  topModel: (row) => row.topModel,
  topPath: (row) => row.topPath,
  cacheShare: (row) => row.cacheShare,
  lastActiveAt: (row) => Date.parse(row.lastActiveAt)
};

function sortAria<Key extends string>(sort: SortState<Key>, key: Key): "ascending" | "descending" | "none" {
  if (sort.key !== key) return "none";
  return sort.direction === "asc" ? "ascending" : "descending";
}

function TrendTable(props: { rows: OperationsInsightsTrendPoint[] }) {
  const [sort, setSort] = useState<SortState<TrendSortKey>>({ key: "day", direction: "asc" });
  const rows = useMemo(() => sortRows(props.rows, sort, TREND_SORT_ACCESSORS), [props.rows, sort]);
  const handleSort = (key: TrendSortKey, defaultDirection?: SortDirection) => setSort((current) => nextSortState(current, key, defaultDirection));

  return rows.length ? (
    <div className="monitoring-table-wrap">
      <table className="monitoring-table ops-analytics-sortable-table">
        <thead>
          <tr>
            <th aria-sort={sortAria(sort, "day")}>
              <SortableHeader label="日期" sortKey="day" sort={sort} defaultDirection="asc" onSort={handleSort} />
            </th>
            <th aria-sort={sortAria(sort, "organizationCount")}>
              <SortableHeader label="组织数" sortKey="organizationCount" sort={sort} onSort={handleSort} />
            </th>
            <th aria-sort={sortAria(sort, "userCount")}>
              <SortableHeader label="用户数" sortKey="userCount" sort={sort} onSort={handleSort} />
            </th>
            <th aria-sort={sortAria(sort, "sessionCount")}>
              <SortableHeader label="会话数" sortKey="sessionCount" sort={sort} onSort={handleSort} />
            </th>
            <th aria-sort={sortAria(sort, "requestCount")}>
              <SortableHeader label="问题次数" sortKey="requestCount" sort={sort} onSort={handleSort} />
            </th>
            <th aria-sort={sortAria(sort, "totalTokens")}>
              <SortableHeader label="总 tokens" sortKey="totalTokens" sort={sort} onSort={handleSort} />
            </th>
            <th aria-sort={sortAria(sort, "estimatedCost")}>
              <SortableHeader label="预估价值" sortKey="estimatedCost" sort={sort} onSort={handleSort} />
            </th>
            <th aria-sort={sortAria(sort, "internalCost")}>
              <SortableHeader label="内部价值" sortKey="internalCost" sort={sort} onSort={handleSort} />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.day}>
              <td>{row.day}</td>
              <td>{formatCount(row.organizationCount)}</td>
              <td>{formatCount(row.userCount)}</td>
              <td>{formatCount(row.sessionCount)}</td>
              <td>{formatCount(row.requestCount)}</td>
              <td>{formatCount(row.totalTokens)}</td>
              <td>{formatUsdAmount(row.estimatedCost)}</td>
              <td>{formatUsdAmount(row.internalCost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty description="当前窗口内没有趋势数据" />
  );
}

function OrganizationTable(props: { rows: OperationsInsightsOrganizationRow[] }) {
  const [sort, setSort] = useState<SortState<OrganizationSortKey>>({ key: "internalCost", direction: "desc" });
  const rows = useMemo(() => sortRows(props.rows, sort, ORGANIZATION_SORT_ACCESSORS), [props.rows, sort]);
  const handleSort = (key: OrganizationSortKey, defaultDirection?: SortDirection) =>
    setSort((current) => nextSortState(current, key, defaultDirection));

  return props.rows.length ? (
    <div className="monitoring-table-wrap">
      <table className="monitoring-table ops-analytics-sortable-table">
        <thead>
          <tr>
            <th aria-sort={sortAria(sort, "organization")}>
              <SortableHeader label="组织" sortKey="organization" sort={sort} defaultDirection="asc" onSort={handleSort} />
            </th>
            <th aria-sort={sortAria(sort, "userCount")}>
              <SortableHeader label="用户数" sortKey="userCount" sort={sort} onSort={handleSort} />
            </th>
            <th aria-sort={sortAria(sort, "sessionCount")}>
              <SortableHeader label="会话数" sortKey="sessionCount" sort={sort} onSort={handleSort} />
            </th>
            <th aria-sort={sortAria(sort, "requestCount")}>
              <SortableHeader label="问题次数" sortKey="requestCount" sort={sort} onSort={handleSort} />
            </th>
            <th aria-sort={sortAria(sort, "totalTokens")}>
              <SortableHeader label="总 tokens" sortKey="totalTokens" sort={sort} onSort={handleSort} />
            </th>
            <th aria-sort={sortAria(sort, "estimatedCost")}>
              <SortableHeader label="预估价值" sortKey="estimatedCost" sort={sort} onSort={handleSort} />
            </th>
            <th aria-sort={sortAria(sort, "internalCost")}>
              <SortableHeader label="内部价值" sortKey="internalCost" sort={sort} onSort={handleSort} />
            </th>
            <th aria-sort={sortAria(sort, "topModel")}>
              <SortableHeader label="主模型" sortKey="topModel" sort={sort} defaultDirection="asc" onSort={handleSort} />
            </th>
            <th aria-sort={sortAria(sort, "topPath")}>
              <SortableHeader label="主路径" sortKey="topPath" sort={sort} defaultDirection="asc" onSort={handleSort} />
            </th>
            <th aria-sort={sortAria(sort, "cacheShare")}>
              <SortableHeader label="缓存占比" sortKey="cacheShare" sort={sort} onSort={handleSort} />
            </th>
            <th aria-sort={sortAria(sort, "lastActiveAt")}>
              <SortableHeader label="最近活跃" sortKey="lastActiveAt" sort={sort} onSort={handleSort} />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
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
              <td>{formatUsdAmount(row.estimatedCost)}</td>
              <td>{formatUsdAmount(row.internalCost)}</td>
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
  const [sort, setSort] = useState<SortState<UserSortKey>>({ key: "internalCost", direction: "desc" });
  const rows = useMemo(() => sortRows(props.rows, sort, USER_SORT_ACCESSORS), [props.rows, sort]);
  const handleSort = (key: UserSortKey, defaultDirection?: SortDirection) => setSort((current) => nextSortState(current, key, defaultDirection));

  return props.rows.length ? (
    <div className="monitoring-table-wrap">
      <table className="monitoring-table ops-analytics-sortable-table">
        <thead>
          <tr>
            <th aria-sort={sortAria(sort, "user")}>
              <SortableHeader label="用户" sortKey="user" sort={sort} defaultDirection="asc" onSort={handleSort} />
            </th>
            <th aria-sort={sortAria(sort, "organizationName")}>
              <SortableHeader label="组织" sortKey="organizationName" sort={sort} defaultDirection="asc" onSort={handleSort} />
            </th>
            <th aria-sort={sortAria(sort, "departmentName")}>
              <SortableHeader label="部门" sortKey="departmentName" sort={sort} defaultDirection="asc" onSort={handleSort} />
            </th>
            <th aria-sort={sortAria(sort, "sessionCount")}>
              <SortableHeader label="会话数" sortKey="sessionCount" sort={sort} onSort={handleSort} />
            </th>
            <th aria-sort={sortAria(sort, "requestCount")}>
              <SortableHeader label="问题次数" sortKey="requestCount" sort={sort} onSort={handleSort} />
            </th>
            <th aria-sort={sortAria(sort, "totalTokens")}>
              <SortableHeader label="总 tokens" sortKey="totalTokens" sort={sort} onSort={handleSort} />
            </th>
            <th aria-sort={sortAria(sort, "estimatedCost")}>
              <SortableHeader label="预估价值" sortKey="estimatedCost" sort={sort} onSort={handleSort} />
            </th>
            <th aria-sort={sortAria(sort, "internalCost")}>
              <SortableHeader label="内部价值" sortKey="internalCost" sort={sort} onSort={handleSort} />
            </th>
            <th aria-sort={sortAria(sort, "topModel")}>
              <SortableHeader label="主模型" sortKey="topModel" sort={sort} defaultDirection="asc" onSort={handleSort} />
            </th>
            <th aria-sort={sortAria(sort, "topPath")}>
              <SortableHeader label="主路径" sortKey="topPath" sort={sort} defaultDirection="asc" onSort={handleSort} />
            </th>
            <th aria-sort={sortAria(sort, "cacheShare")}>
              <SortableHeader label="缓存占比" sortKey="cacheShare" sort={sort} onSort={handleSort} />
            </th>
            <th aria-sort={sortAria(sort, "lastActiveAt")}>
              <SortableHeader label="最近活跃" sortKey="lastActiveAt" sort={sort} onSort={handleSort} />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
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
              <td>{formatUsdAmount(row.estimatedCost)}</td>
              <td>{formatUsdAmount(row.internalCost)}</td>
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

function SessionTable(props: {
  rows: OperationsInsightsSessionRow[];
  sort: SortState<SessionSortKey>;
  onSort: (key: SessionSortKey, defaultDirection?: SortDirection) => void;
}) {
  return props.rows.length ? (
    <div className="monitoring-table-wrap">
      <table className="monitoring-table ops-analytics-sortable-table">
        <thead>
          <tr>
            <th aria-sort={sortAria(props.sort, "sessionId")}>
              <SortableHeader label="会话" sortKey="sessionId" sort={props.sort} defaultDirection="asc" onSort={props.onSort} />
            </th>
            <th aria-sort={sortAria(props.sort, "userName")}>
              <SortableHeader label="用户 / 组织" sortKey="userName" sort={props.sort} defaultDirection="asc" onSort={props.onSort} />
            </th>
            <th aria-sort={sortAria(props.sort, "model")}>
              <SortableHeader label="模型" sortKey="model" sort={props.sort} defaultDirection="asc" onSort={props.onSort} />
            </th>
            <th aria-sort={sortAria(props.sort, "entryLabel")}>
              <SortableHeader label="入口" sortKey="entryLabel" sort={props.sort} defaultDirection="asc" onSort={props.onSort} />
            </th>
            <th aria-sort={sortAria(props.sort, "pathLabel")}>
              <SortableHeader label="路径" sortKey="pathLabel" sort={props.sort} defaultDirection="asc" onSort={props.onSort} />
            </th>
            <th aria-sort={sortAria(props.sort, "requestCount")}>
              <SortableHeader label="问题次数" sortKey="requestCount" sort={props.sort} onSort={props.onSort} />
            </th>
            <th aria-sort={sortAria(props.sort, "inputTokens")}>
              <SortableHeader label="输入" sortKey="inputTokens" sort={props.sort} onSort={props.onSort} />
            </th>
            <th aria-sort={sortAria(props.sort, "cachedInputTokens")}>
              <SortableHeader label="缓存" sortKey="cachedInputTokens" sort={props.sort} onSort={props.onSort} />
            </th>
            <th aria-sort={sortAria(props.sort, "outputTokens")}>
              <SortableHeader label="输出" sortKey="outputTokens" sort={props.sort} onSort={props.onSort} />
            </th>
            <th aria-sort={sortAria(props.sort, "totalTokens")}>
              <SortableHeader label="总 tokens" sortKey="totalTokens" sort={props.sort} onSort={props.onSort} />
            </th>
            <th aria-sort={sortAria(props.sort, "estimatedCost")}>
              <SortableHeader label="预估价值" sortKey="estimatedCost" sort={props.sort} onSort={props.onSort} />
            </th>
            <th aria-sort={sortAria(props.sort, "internalCost")}>
              <SortableHeader label="内部价值" sortKey="internalCost" sort={props.sort} onSort={props.onSort} />
            </th>
            <th aria-sort={sortAria(props.sort, "lastActiveAt")}>
              <SortableHeader label="最近活跃" sortKey="lastActiveAt" sort={props.sort} onSort={props.onSort} />
            </th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => {
            const detailHref = buildConversationRecordHref(row);
            return (
              <tr key={row.sessionId}>
                <td>
                  <div className="ops-analytics-cell-stack ops-analytics-code-stack">
                    {detailHref ? (
                      <a className="ops-analytics-session-link" href={detailHref} title="打开对话记录">
                        {row.sessionId}
                      </a>
                    ) : (
                      <strong>{row.sessionId}</strong>
                    )}
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
                    <span>均值 {formatCount(Math.round(row.avgTokensPerRequest))}/题</span>
                  </div>
                </td>
                <td>{formatUsdAmount(row.estimatedCost)}</td>
                <td>
                  <div className="ops-analytics-cell-stack">
                    <strong>{formatUsdAmount(row.internalCost)}</strong>
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
            );
          })}
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
  const [sessionSort, setSessionSort] = useState<SortState<SessionSortKey>>({ key: "lastActiveAt", direction: "desc" });
  const [activeTab, setActiveTab] = useState<OperationsAnalyticsTab>("overview");
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
      sessionPageSize,
      sessionSortKey: sessionSort.key,
      sessionSortDirection: sessionSort.direction
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
  }, [
    days,
    timeZone,
    organizationId,
    model,
    path,
    entry,
    deferredQuery,
    sessionPage,
    sessionPageSize,
    sessionSort.key,
    sessionSort.direction,
    refreshToken
  ]);

  const handleSessionSort = (key: SessionSortKey, defaultDirection?: SortDirection) => {
    setSessionSort((current) => nextSortState(current, key, defaultDirection));
    setSessionPage(1);
  };

  const valueHint =
    data && data.summary.estimatedCost === "0.000000" && data.summary.internalCost === "0.000000"
      ? "当前价值列为 0，说明模型定价尚未配置或未命中成本档。"
      : "价值按每 1M tokens 的模型定价折算；内部价值=预估价值 × 内部成本系数。";

  return (
    <div className="admin-page-container ops-analytics-page">
      <div className="ops-analytics-sticky-head">
        <section className="ops-analytics-filterbar">
          <label className="field">
            <span className="field-label">时间窗口</span>
            <Select
              size="small"
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
              size="small"
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
              size="small"
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
              size="small"
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
              size="small"
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
              size="small"
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
            <Button size="small" icon={<RefreshCcw size={14} />} onClick={() => setRefreshToken((current) => current + 1)}>
              重新拉取
            </Button>
          </div>
        </section>

        {data ? (
          <section className="ops-analytics-kpi-strip" aria-label="运营关键指标">
            <MetricItem label="活跃组织" value={formatCount(data.summary.totalOrganizations)} meta="当前窗口内有调用的组织" />
            <MetricItem label="活跃用户" value={formatCount(data.summary.totalUsers)} meta="当前窗口内有调用的用户" />
            <MetricItem label="有效会话" value={formatCount(data.summary.totalSessions)} meta="至少提交过一个问题" />
            <MetricItem label="问题次数" value={formatCount(data.summary.totalRequests)} meta={`平均 ${data.summary.avgRequestsPerSession} 次/会话`} />
            <MetricItem label="总 tokens" value={formatCount(data.summary.totalTokens)} meta={`平均 ${data.summary.avgTokensPerSession} /会话`} />
            <MetricItem label="预估价值" value={formatUsdAmount(data.summary.estimatedCost)} meta="按模型单价折算" />
            <MetricItem
              label="内部价值"
              value={formatUsdAmount(data.summary.internalCost)}
              meta={`平均 ${formatUsdAmount(data.summary.avgInternalCostPerSession)} /会话`}
            />
            <MetricItem label="缓存占比" value={formatPercent(data.summary.cacheShare)} meta={`平均 ${data.summary.avgTokensPerRequest} tokens/问题`} />
          </section>
        ) : null}
      </div>

      {errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={errorText} /> : null}

      {loading && !data ? (
        <div className="ops-analytics-loading">
          <Spin size="large" />
        </div>
      ) : null}

      {data ? (
        <>
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

          <Tabs
            className="ops-analytics-tabs"
            activeKey={activeTab}
            onChange={(key) => setActiveTab(key as OperationsAnalyticsTab)}
            items={[
              {
                key: "overview",
                label: "趋势总览",
                children: (
                  <TableShell title="趋势" subtitle="按本地时区天粒度回放会话、问题次数、tokens 和价值变化。">
                    <TrendTable rows={data.trends} />
                  </TableShell>
                )
              },
              {
                key: "breakdowns",
                label: "分布",
                children: (
                  <div className="ops-analytics-breakdown-grid ops-analytics-tab-panel">
                    <BreakdownPanel
                      title="路径分布"
                      subtitle="看问题最终落到哪条运行路径，适合查 Azure / 本地登录态 / 外部 API 的占比。"
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
                )
              },
              {
                key: "organizations",
                label: "组织",
                children: (
                  <TableShell title="组织透视" subtitle="适合运营看哪个组织最耗资源、最常用什么模型、主要走哪条路径。">
                    <OrganizationTable rows={data.organizations} />
                  </TableShell>
                )
              },
              {
                key: "users",
                label: "用户",
                children: (
                  <TableShell title="用户透视" subtitle="适合排查个人使用强度、模型偏好、缓存命中和最近活跃。">
                    <UserTable rows={data.users} />
                  </TableShell>
                )
              },
              {
                key: "sessions",
                label: "会话台账",
                children: (
                  <TableShell
                    title="会话台账"
                    subtitle="逐会话查看 model、路径、tokens 和价值，点击会话 ID 可打开对应对话记录。"
                    action={
                      <div className="ops-analytics-session-meta">
                        <span>共 {formatCount(data.sessions.totalItems)} 条</span>
                      </div>
                    }
                  >
                    <SessionTable rows={data.sessions.items} sort={sessionSort} onSort={handleSessionSort} />
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
                )
              }
            ]}
          />
        </>
      ) : null}
    </div>
  );
}

export default OperationsAnalyticsView;
