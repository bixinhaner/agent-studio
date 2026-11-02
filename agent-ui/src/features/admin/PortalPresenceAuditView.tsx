import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Empty, Spin, Table } from "antd";
import { api } from "../../lib/api";
import { formatAdminDateTime } from "../../lib/formatters";

type PresenceItem = {
  userId: string;
  userName: string | null;
  userEmail: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  activeMinutes: number;
  hits: number;
  buildId: string | null;
  slots: string[];
};
type Result = { slotMinutes: number; total: number; items: PresenceItem[] };
type Filters = { from: string; to: string; user: string };

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Value for <input type="datetime-local"> in the viewer's own time zone. */
export function toLocalInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function defaultFilters(now = new Date()): Filters {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return { from: toLocalInputValue(midnight), to: "", user: "" };
}

function readFilters(): Filters {
  const q = new URLSearchParams(window.location.hash.split("?")[1]);
  const defaults = defaultFilters();
  return { from: q.get("presence_from") ?? defaults.from, to: q.get("presence_to") ?? "", user: q.get("presence_user") ?? "" };
}

function formatClock(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** Joins consecutive slots into local-time ranges such as "09:00–11:30". */
export function presenceRanges(slots: string[], slotMinutes: number): string[] {
  const slotMs = slotMinutes * 60_000;
  const starts = slots.map((slot) => new Date(slot).getTime()).filter(Number.isFinite).sort((a, b) => a - b);
  const ranges: Array<[number, number]> = [];
  for (const start of starts) {
    const last = ranges.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], start + slotMs);
    else ranges.push([start, start + slotMs]);
  }
  return ranges.map(([start, end]) => {
    const from = new Date(start);
    const to = new Date(end);
    const sameDay = from.toDateString() === new Date(end - 1).toDateString();
    return sameDay ? `${formatClock(from)}–${formatClock(to)}` : `${formatAdminDateTime(from)}–${formatAdminDateTime(to)}`;
  });
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `约 ${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `约 ${hours} 小时 ${rest} 分钟` : `约 ${hours} 小时`;
}

export function PortalPresenceAuditView() {
  const [filters, setFilters] = useState(readFilters);
  const [draft, setDraft] = useState(filters);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const read = () => {
      const next = readFilters();
      setFilters(next);
      setDraft(next);
    };
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  useEffect(() => {
    let active = true;
    const from = new Date(filters.from);
    const to = filters.to ? new Date(filters.to) : new Date();
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
      setError("时间范围无效，请重新选择开始和结束时间");
      setResult(null);
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    if (filters.user) query.set("user", filters.user);
    void api<Result>(`/api/admin/portal-presence?${query}`)
      .then((data) => {
        if (active) setResult(data);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "加载失败，请重试");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filters, revision]);

  const apply = (next: Filters) => {
    const q = new URLSearchParams({ mode: "portal_presence" });
    if (next.from) q.set("presence_from", next.from);
    if (next.to) q.set("presence_to", next.to);
    if (next.user) q.set("presence_user", next.user);
    window.history.replaceState(null, "", `#admin/conversations?${q}`);
    setFilters(next);
    setDraft(next);
  };

  const columns = useMemo(
    () => [
      {
        title: "用户",
        key: "user",
        render: (_: unknown, item: PresenceItem) => (
          <span className="admin-presence-user">
            <strong>{item.userName || item.userEmail || item.userId}</strong>
            {item.userEmail && item.userName ? <span>{item.userEmail}</span> : null}
          </span>
        )
      },
      {
        title: "首次",
        key: "first",
        sorter: (a: PresenceItem, b: PresenceItem) => Date.parse(a.firstSeenAt) - Date.parse(b.firstSeenAt),
        render: (_: unknown, item: PresenceItem) => <time className="admin-presence-time">{formatAdminDateTime(item.firstSeenAt)}</time>
      },
      {
        title: "最近",
        key: "last",
        sorter: (a: PresenceItem, b: PresenceItem) => Date.parse(a.lastSeenAt) - Date.parse(b.lastSeenAt),
        render: (_: unknown, item: PresenceItem) => <time className="admin-presence-time">{formatAdminDateTime(item.lastSeenAt)}</time>
      },
      {
        title: "打开时长",
        key: "minutes",
        sorter: (a: PresenceItem, b: PresenceItem) => a.activeMinutes - b.activeMinutes,
        render: (_: unknown, item: PresenceItem) => <span className="admin-presence-time">{formatMinutes(item.activeMinutes)}</span>
      },
      {
        title: "打开的时段",
        key: "ranges",
        render: (_: unknown, item: PresenceItem) => (
          <span className="admin-presence-ranges">{presenceRanges(item.slots, result?.slotMinutes ?? 10).join("、")}</span>
        )
      }
    ],
    [result?.slotMinutes]
  );

  return (
    <div className="admin-page-container admin-send-failure-audit">
      <h2>Portal 访问</h2>
      <p>谁在什么时间打开过 Portal。页面打开期间每几分钟记录一次，按 10 分钟时段汇总；聊天服务故障时同样会记录，可用来确认受影响的用户。</p>
      <form
        className="admin-send-failure-filters"
        onSubmit={(e) => {
          e.preventDefault();
          apply(draft);
        }}
      >
        <label>
          用户
          <input
            name="presence_user"
            value={draft.user}
            placeholder="姓名、邮箱或用户 ID"
            spellCheck={false}
            onChange={(e) => setDraft({ ...draft, user: e.target.value })}
          />
        </label>
        <label>
          开始时间
          <input type="datetime-local" name="presence_from" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
        </label>
        <label>
          结束时间
          <input type="datetime-local" name="presence_to" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        </label>
        <Button htmlType="submit" type="primary">
          查询访问记录
        </Button>
        <Button onClick={() => setRevision((x) => x + 1)}>刷新</Button>
      </form>
      {error ? <Alert type="error" showIcon message={error} action={<Button onClick={() => setRevision((x) => x + 1)}>重试</Button>} /> : null}
      {loading ? <Spin aria-label="正在加载 Portal 访问记录" /> : null}
      {result && result.items.length === 0 ? (
        <Empty description="这段时间没有访问记录。用户登录后打开 Portal，就会出现在这里。" />
      ) : null}
      {result && result.items.length > 0 ? (
        <Table
          rowKey="userId"
          size="small"
          dataSource={result.items}
          columns={columns}
          pagination={{ pageSize: 50, showSizeChanger: false, showTotal: (total) => `共 ${total} 人` }}
          scroll={{ x: 720 }}
        />
      ) : null}
    </div>
  );
}
