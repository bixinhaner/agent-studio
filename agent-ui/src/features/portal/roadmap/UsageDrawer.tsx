import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Drawer, Empty, Input, Segmented, Skeleton, Tooltip } from "antd";
import { ArrowLeft, BarChart3, Building2, ChevronRight, Search, Trophy } from "lucide-react";

import { formatListTimestamp } from "../../../lib/formatters";
import { usePortalI18n, type PortalMessageKey } from "../i18n";
import {
  fetchPersonalUsage,
  fetchTeamMemberUsage,
  fetchTeamUsage,
  fetchUsageRanking,
  type PersonalUsagePeriod,
  type PersonalUsageSummary,
  type TeamDepartmentNode,
  type TeamMemberUsage,
  type TeamUsageSummary,
  type UsageRankEntry,
  type UsageRanking
} from "./api";
import { browserTimezone } from "./schedule-format";

const PERIODS: PersonalUsagePeriod[] = ["month", "last_month", "7d", "30d"];

export function useTurnCount() {
  const { t, intlLocale } = usePortalI18n();
  return (count: number) =>
    count === 1 ? t("usage.turnCountOne") : t("usage.turnCount", { count: new Intl.NumberFormat(intlLocale).format(count) });
}

export function formatTokens(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function DailyBars(props: { daily: PersonalUsageSummary["daily"]; locale: string }) {
  const { t } = usePortalI18n();
  const turnCount = useTurnCount();
  const max = Math.max(1, ...props.daily.map((day) => day.total_tokens));
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(props.locale, { month: "numeric", day: "numeric", timeZone: "UTC" }), [props.locale]);
  const label = (date: string) => dateFormat.format(new Date(`${date}T00:00:00Z`));
  const first = props.daily[0];
  const last = props.daily[props.daily.length - 1];
  return (
    <figure className="usage-daily">
      <div className="usage-daily-bars" role="img" aria-label={t("usage.daily")}>
        {props.daily.map((day) => (
          <Tooltip
            key={day.date}
            title={t("usage.dayTooltip", { date: label(day.date), tokens: formatTokens(day.total_tokens, props.locale), turns: turnCount(day.turns) })}
            mouseEnterDelay={0}
          >
            <span className="usage-daily-slot">
              <span
                className={day.total_tokens > 0 ? "usage-daily-bar" : "usage-daily-bar is-empty"}
                style={{ height: day.total_tokens > 0 ? `${Math.max(4, (day.total_tokens / max) * 100)}%` : undefined }}
              />
            </span>
          </Tooltip>
        ))}
      </div>
      {first && last ? (
        <figcaption className="usage-daily-axis" aria-hidden="true">
          <span>{label(first.date)}</span>
          <span>{label(last.date)}</span>
        </figcaption>
      ) : null}
      <table className="usage-sr-only">
        <caption>{t("usage.daily")}</caption>
        <tbody>
          {props.daily.map((day) => (
            <tr key={day.date}>
              <th scope="row">{day.date}</th>
              <td>{day.total_tokens}</td>
              <td>{day.turns}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function BreakdownList(props: { title: string; rows: Array<{ key: string; label: string; value: number; detail: string }>; locale: string }) {
  if (!props.rows.length) return null;
  const max = Math.max(1, ...props.rows.map((row) => row.value));
  return (
    <section className="usage-breakdown">
      <h3>{props.title}</h3>
      <ul>
        {props.rows.map((row) => (
          <li key={row.key}>
            <span className="usage-breakdown-label" title={row.label}>{row.label}</span>
            <span className="usage-breakdown-track" aria-hidden="true">
              <span style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }} />
            </span>
            <span className="usage-breakdown-value">
              {formatTokens(row.value, props.locale)}
              <small>{row.detail}</small>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Loads `fetcher` whenever its inputs change; keeps the last result visible while reloading. */
function useLoader<T>(enabled: boolean, fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setData(await fetcher());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [fetcher]);
  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);
  return { data, error, loading, reload: load };
}

function RankCell(props: { label: string; entry: UsageRankEntry }) {
  const { t, intlLocale } = usePortalI18n();
  const number = (value: number) => new Intl.NumberFormat(intlLocale).format(value);
  return (
    <div className="usage-rank-cell">
      <span className="usage-rank-label" title={props.label}>{props.label}</span>
      {props.entry.rank ? (
        <strong>
          {t("usage.rank.position", { rank: number(props.entry.rank) })}
          <small> / {number(props.entry.size)}</small>
        </strong>
      ) : (
        <strong className="is-empty">{t("usage.rank.none")}</strong>
      )}
      <small>{t("usage.rank.active", { count: number(props.entry.active) })}</small>
    </div>
  );
}

function RankingCard(props: { ranking: UsageRanking | null }) {
  const { t } = usePortalI18n();
  if (!props.ranking) return null;
  const { department, company } = props.ranking;
  return (
    <section className="usage-rank" aria-label={t("usage.rank.title")}>
      <h3><Trophy size={14} aria-hidden="true" />{t("usage.rank.title")}</h3>
      <div className="usage-rank-grid">
        {department ? <RankCell label={t("usage.rank.department", { name: department.name })} entry={department} /> : null}
        <RankCell label={t("usage.rank.company")} entry={company} />
      </div>
      <p className="usage-note">{t("usage.rank.note")}</p>
    </section>
  );
}

function UsageSummaryBody(props: {
  data: PersonalUsageSummary | null;
  period: PersonalUsagePeriod;
  loading: boolean;
  error: boolean;
  onRetry(): void;
  ranking?: UsageRanking | null;
}) {
  const { t, intlLocale } = usePortalI18n();
  const turnCount = useTurnCount();
  const { data } = props;
  const number = (value: number) => new Intl.NumberFormat(intlLocale).format(value);
  const totals = data?.totals;
  const change = useMemo(() => {
    if (!data?.previous || !totals) return null;
    if (data.previous.total_tokens <= 0) return totals.total_tokens > 0 ? t("usage.noPrevious") : null;
    const ratio = (totals.total_tokens - data.previous.total_tokens) / data.previous.total_tokens;
    const formatted = new Intl.NumberFormat(intlLocale, { style: "percent", maximumFractionDigits: 0, signDisplay: "exceptZero" }).format(ratio);
    return t("usage.vsPrevious", { change: formatted });
  }, [data, intlLocale, t, totals]);

  if (props.error) {
    return (
      <Alert
        type="error"
        showIcon
        message={t("usage.loadFailed")}
        action={<Button size="small" onClick={props.onRetry}>{t("usage.retry")}</Button>}
      />
    );
  }
  if (!data || (props.loading && data.period !== props.period)) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (!totals) return null;
  if (totals.turns === 0) {
    return (
      <>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("usage.empty")} />
        {props.ranking !== undefined ? <RankingCard ranking={props.ranking} /> : null}
      </>
    );
  }
  return (
    <>
      <section className="usage-hero" aria-live="polite">
        <span className="usage-hero-label">{t("usage.totalTokens")}</span>
        <strong className="usage-hero-value">{number(totals.total_tokens)}</strong>
        {change ? <span className="usage-hero-change">{change}</span> : null}
        <div className="usage-token-split">
          <span><i className="is-input" aria-hidden="true" />{t("usage.input")} <b>{formatTokens(totals.input_tokens, intlLocale)}</b></span>
          <Tooltip title={t("usage.cachedHint")}>
            <span><i className="is-cached" aria-hidden="true" />{t("usage.cached")} <b>{formatTokens(totals.cached_input_tokens, intlLocale)}</b></span>
          </Tooltip>
          <span><i className="is-output" aria-hidden="true" />{t("usage.output")} <b>{formatTokens(totals.output_tokens, intlLocale)}</b></span>
        </div>
      </section>

      {props.ranking !== undefined ? <RankingCard ranking={props.ranking} /> : null}

      <div className="usage-stats">
        <div>
          <span>{t("usage.turns")}</span>
          <strong>{number(totals.turns)}</strong>
          {totals.failed_turns ? <small>{t("usage.failed", { count: totals.failed_turns })}</small> : null}
        </div>
        <div>
          <span>{t("usage.tasks")}</span>
          <strong>{number(totals.tasks)}</strong>
        </div>
        <div>
          <span>{t("usage.files")}</span>
          <strong>{number(totals.output_files)}</strong>
        </div>
      </div>

      <section className="usage-breakdown">
        <h3>{t("usage.daily")}</h3>
        <DailyBars daily={data.daily} locale={intlLocale} />
      </section>

      <BreakdownList
        title={t("usage.byChannel")}
        locale={intlLocale}
        rows={data.by_channel.map((row) => ({
          key: row.key,
          label: t(`usage.channel.${row.key}` as PortalMessageKey),
          value: row.total_tokens,
          detail: turnCount(row.turns)
        }))}
      />
      <BreakdownList
        title={t("usage.byModel")}
        locale={intlLocale}
        rows={data.by_model.map((row) => ({
          key: row.model,
          label: row.model,
          value: row.total_tokens,
          detail: turnCount(row.turns)
        }))}
      />
      {data.outputs_by_type.length ? (
        <section className="usage-breakdown">
          <h3>{t("usage.outputs")}</h3>
          <div className="usage-output-chips">
            {data.outputs_by_type.map((row) => (
              <span key={row.type}>
                {t(`outputs.type${row.type[0].toUpperCase()}${row.type.slice(1)}` as PortalMessageKey)}
                <b>{number(row.count)}</b>
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <p className="usage-note">{t("usage.note", { tz: data.timezone })}</p>
      {data.truncated ? <p className="usage-note">{t("usage.truncated")}</p> : null}
    </>
  );
}

function TeamView(props: { period: PersonalUsagePeriod; timezone: string; onOpenMember(userId: string): void }) {
  const { t, intlLocale } = usePortalI18n();
  const turnCount = useTurnCount();
  const [query, setQuery] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const fetcher = useCallback(() => fetchTeamUsage(props.period, props.timezone), [props.period, props.timezone]);
  const { data, error, loading, reload } = useLoader<TeamUsageSummary>(true, fetcher);
  const number = (value: number) => new Intl.NumberFormat(intlLocale).format(value);
  const departments = data?.departments ?? [];
  const departmentById = useMemo(() => new Map(departments.map((item) => [item.id, item])), [departments]);
  const focus = focusId ? departmentById.get(focusId) ?? null : null;
  // Breadcrumb from the top led department down to the focused one.
  const trail = useMemo(() => {
    const result: TeamDepartmentNode[] = [];
    for (let node = focus; node; node = node.parent_id ? departmentById.get(node.parent_id) ?? null : null) result.unshift(node);
    return result;
  }, [departmentById, focus]);
  const childDepartments = departments.filter((item) => item.parent_id === (focus?.id ?? null));
  const members = useMemo(() => {
    if (!data) return [];
    const allowed = focus ? new Set(focus.member_ids) : null;
    const needle = query.trim().toLowerCase();
    return data.members.filter(
      (member) =>
        (!allowed || allowed.has(member.user_id)) &&
        (!needle || [member.name, member.title, member.department].some((value) => value?.toLowerCase().includes(needle)))
    );
  }, [data, focus, query]);

  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        message={t("usage.team.loadFailed")}
        action={<Button size="small" onClick={() => void reload()}>{t("usage.retry")}</Button>}
      />
    );
  }
  if (!data || (loading && data.period !== props.period)) return <Skeleton active paragraph={{ rows: 8 }} />;
  const stats = focus ?? data.totals;
  const maxTokens = Math.max(1, ...members.map((member) => member.total_tokens));
  const maxDepartmentTokens = Math.max(1, ...childDepartments.map((item) => item.total_tokens));
  return (
    <>
      {departments.length ? (
        <nav className="usage-team-trail" aria-label={t("usage.team.trail")}>
          <button type="button" onClick={() => setFocusId(null)} aria-current={focus ? undefined : "page"}>
            {t("usage.team.all")}
          </button>
          {trail.map((node) => (
            <span key={node.id}>
              <ChevronRight size={12} aria-hidden="true" />
              <button type="button" onClick={() => setFocusId(node.id)} aria-current={node.id === focus?.id ? "page" : undefined} title={node.name}>
                {node.name}
              </button>
            </span>
          ))}
        </nav>
      ) : null}

      <div className="usage-stats">
        <div>
          <span>{t("usage.team.members")}</span>
          <strong>{number(stats.members)}</strong>
        </div>
        <div>
          <span>{t("usage.team.active")}</span>
          <strong>{number(stats.active_members)}</strong>
          <small className="is-neutral">
            {new Intl.NumberFormat(intlLocale, { style: "percent", maximumFractionDigits: 0 }).format(
              stats.members ? stats.active_members / stats.members : 0
            )}
          </small>
        </div>
        <div>
          <span>{t("usage.totalTokens")}</span>
          <strong>{formatTokens(stats.total_tokens, intlLocale)}</strong>
        </div>
      </div>

      {childDepartments.length ? (
        <section className="usage-breakdown">
          <h3>{focus ? t("usage.team.subDepartments") : t("usage.team.ledDepartments")}</h3>
          <ul className="usage-team-list">
            {childDepartments.map((node) => (
              <li key={node.id}>
                <button type="button" className="usage-team-row" onClick={() => setFocusId(node.id)}>
                  <span className="usage-team-person">
                    <span className="usage-team-name">
                      <Building2 size={14} aria-hidden="true" className="usage-team-dept-icon" />
                      <span className="usage-team-label">{node.name}</span>
                    </span>
                    <span className="usage-team-meta">
                      {t("usage.team.deptMeta", { active: number(node.active_members), members: number(node.members) })}
                    </span>
                  </span>
                  <span className="usage-team-usage">
                    <span className="usage-team-tokens">{node.total_tokens > 0 ? formatTokens(node.total_tokens, intlLocale) : "—"}</span>
                    <span className="usage-breakdown-track" aria-hidden="true">
                      <span style={{ width: node.total_tokens > 0 ? `${Math.max(2, (node.total_tokens / maxDepartmentTokens) * 100)}%` : 0 }} />
                    </span>
                    <span className="usage-team-meta">{node.turns > 0 ? turnCount(node.turns) : t("usage.team.noUsage")}</span>
                  </span>
                  <ChevronRight size={16} aria-hidden="true" className="usage-team-chevron" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="usage-breakdown">
        <h3>{t("usage.team.people", { count: number(focus ? focus.members : data.totals.members) })}</h3>
        <Input
          allowClear
          prefix={<Search size={14} aria-hidden="true" />}
          placeholder={t("usage.team.search")}
          aria-label={t("usage.team.search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {members.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("usage.team.noMatch")} />
        ) : (
          <ul className="usage-team-list">
            {members.map((member) => (
              <li key={member.user_id}>
                <button type="button" className="usage-team-row" onClick={() => props.onOpenMember(member.user_id)}>
                  <span className="usage-team-person">
                    <span className="usage-team-name">
                      <span className="usage-team-label">{member.name}</span>
                      <span className={`usage-team-relation is-${member.relation}`}>{t(`usage.team.relation.${member.relation}` as PortalMessageKey)}</span>
                    </span>
                    <span className="usage-team-meta">{[member.department, member.title].filter(Boolean).join(" · ") || "—"}</span>
                  </span>
                  <span className="usage-team-usage">
                    <span className="usage-team-tokens">{member.total_tokens > 0 ? formatTokens(member.total_tokens, intlLocale) : "—"}</span>
                    <span className="usage-breakdown-track" aria-hidden="true">
                      <span style={{ width: member.total_tokens > 0 ? `${Math.max(2, (member.total_tokens / maxTokens) * 100)}%` : 0 }} />
                    </span>
                    <span className="usage-team-meta">
                      {member.turns > 0
                        ? `${turnCount(member.turns)} · ${t("usage.team.lastActive", { time: formatListTimestamp(member.last_active_at) })}`
                        : t("usage.team.noUsage")}
                    </span>
                  </span>
                  <ChevronRight size={16} aria-hidden="true" className="usage-team-chevron" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="usage-note">{t("usage.team.note")}</p>
    </>
  );
}

function MemberView(props: { userId: string; period: PersonalUsagePeriod; timezone: string; onBack(): void }) {
  const { t } = usePortalI18n();
  const fetcher = useCallback(
    () => fetchTeamMemberUsage(props.userId, props.period, props.timezone),
    [props.period, props.timezone, props.userId]
  );
  const { data, error, loading, reload } = useLoader<TeamMemberUsage>(true, fetcher);
  const member = data?.member.user_id === props.userId ? data.member : null;
  return (
    <>
      <div className="usage-member-header">
        <Button type="text" size="small" icon={<ArrowLeft size={14} aria-hidden="true" />} onClick={props.onBack}>
          {t("usage.team.back")}
        </Button>
        {member ? (
          <div className="usage-member-title">
            <strong>{member.name}</strong>
            <span className="usage-team-meta">{[member.department, member.title].filter(Boolean).join(" · ")}</span>
          </div>
        ) : null}
      </div>
      <UsageSummaryBody
        data={member ? data!.usage : null}
        period={props.period}
        loading={loading}
        error={error}
        onRetry={() => void reload()}
      />
    </>
  );
}

type UsageView = "me" | "team";

export function UsageDrawer(props: { open: boolean; onClose(): void }) {
  const { t, intlLocale } = usePortalI18n();
  const [period, setPeriod] = useState<PersonalUsagePeriod>("month");
  const [view, setView] = useState<UsageView>("me");
  const [memberId, setMemberId] = useState<string | null>(null);
  const timezone = useMemo(() => browserTimezone(), []);

  const personalFetcher = useCallback(() => fetchPersonalUsage(period, timezone), [period, timezone]);
  const personal = useLoader<PersonalUsageSummary>(props.open && view === "me", personalFetcher);
  const rankingFetcher = useCallback(() => fetchUsageRanking(period, timezone), [period, timezone]);
  // Ranking is a side card; a failure just hides it instead of blocking the personal view.
  const ranking = useLoader<UsageRanking>(props.open, rankingFetcher);
  const rankingData = ranking.data?.period === period ? ranking.data : null;
  const teamAvailable = Boolean(ranking.data?.team.available);

  useEffect(() => {
    if (!props.open) setMemberId(null);
  }, [props.open]);

  const number = (value: number) => new Intl.NumberFormat(intlLocale).format(value);

  return (
    <Drawer
      open={props.open}
      onClose={props.onClose}
      width={view === "team" ? 600 : 520}
      rootClassName="roadmap-drawer"
      title={
        <span className="roadmap-drawer-title">
          <BarChart3 size={18} aria-hidden="true" />
          {t("usage.title")}
        </span>
      }
    >
      <div className="usage-drawer">
        {teamAvailable ? (
          <Segmented
            block
            value={view}
            onChange={(value) => {
              setView(value as UsageView);
              setMemberId(null);
            }}
            options={[
              { value: "me", label: t("usage.view.me") },
              { value: "team", label: t("usage.view.team", { count: number(ranking.data?.team.size ?? 0) }) }
            ]}
          />
        ) : null}
        <Segmented
          block
          value={period}
          onChange={(value) => setPeriod(value as PersonalUsagePeriod)}
          options={PERIODS.map((key) => ({ value: key, label: t(`usage.period.${key}` as PortalMessageKey) }))}
        />

        {view === "team" && teamAvailable ? (
          <>
            {/* Stays mounted under the member view so search and scroll survive "Back". */}
            <div className="usage-drawer" hidden={Boolean(memberId)}>
              <TeamView period={period} timezone={timezone} onOpenMember={setMemberId} />
            </div>
            {memberId ? <MemberView userId={memberId} period={period} timezone={timezone} onBack={() => setMemberId(null)} /> : null}
          </>
        ) : (
          <UsageSummaryBody
            data={personal.data}
            period={period}
            loading={personal.loading}
            error={personal.error}
            onRetry={() => void personal.reload()}
            ranking={rankingData}
          />
        )}
      </div>
    </Drawer>
  );
}
