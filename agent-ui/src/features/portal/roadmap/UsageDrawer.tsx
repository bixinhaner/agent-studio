import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Drawer, Empty, Input, Segmented, Skeleton, Tooltip } from "antd";
import { ArrowLeft, BarChart3, Building2, ChevronRight, Search, Trophy, Users } from "lucide-react";

import { formatListTimestamp } from "../../../lib/formatters";
import { usePortalI18n, type PortalMessageKey } from "../i18n";
import {
  fetchCompanyUsage,
  fetchPersonalUsage,
  fetchTeamMemberUsage,
  fetchTeamUsage,
  fetchUsageRanking,
  type CompanyPersonRow,
  type CompanyUsageSummary,
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

function TeamView(props: {
  period: PersonalUsagePeriod;
  timezone: string;
  initialFocusId?: string | null;
  onOpenMember(userId: string): void;
  onOpenSelf(): void;
  onBackToCompany(): void;
}) {
  const { t, intlLocale } = usePortalI18n();
  const turnCount = useTurnCount();
  const [query, setQuery] = useState("");
  const [focusId, setFocusId] = useState<string | null>(props.initialFocusId ?? null);
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
  // People counted in the focused department, then those who only also belong there ("兼").
  const secondaryIds = useMemo(
    () => new Set(focus ? focus.secondary_ids : (data?.members ?? []).filter((member) => member.secondary).map((member) => member.user_id)),
    [data, focus]
  );
  const members = useMemo(() => {
    if (!data) return [];
    const allowed = focus ? new Set([...focus.member_ids, ...focus.secondary_ids]) : null;
    const needle = query.trim().toLowerCase();
    return data.members
      .filter(
        (member) =>
          (!allowed || allowed.has(member.user_id)) &&
          (!needle || [member.name, member.title, member.department].some((value) => value?.toLowerCase().includes(needle)))
      )
      .sort((left, right) => Number(right.relation === "self") - Number(left.relation === "self"));
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
      <nav className="usage-team-trail" aria-label={t("usage.team.trail")}>
        <button type="button" onClick={props.onBackToCompany}>
          {t("usage.company.backToCompany")}
        </button>
        <span>
          <ChevronRight size={12} aria-hidden="true" />
          <button type="button" onClick={() => setFocusId(null)} aria-current={focus ? undefined : "page"}>
            {t("usage.company.myTeam")}
          </button>
        </span>
          {trail.map((node) => (
            <span key={node.id}>
              <ChevronRight size={12} aria-hidden="true" />
              <button type="button" onClick={() => setFocusId(node.id)} aria-current={node.id === focus?.id ? "page" : undefined} title={node.name}>
                {node.name}
              </button>
            </span>
          ))}
      </nav>

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
        <h3>
          {secondaryIds.size
            ? t("usage.team.peopleWithSecondary", { count: number(stats.members), secondary: number(secondaryIds.size) })
            : t("usage.team.people", { count: number(stats.members) })}
        </h3>
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
                <button
                  type="button"
                  className="usage-team-row"
                  onClick={() => (member.relation === "self" ? props.onOpenSelf() : props.onOpenMember(member.user_id))}
                >
                  <span className="usage-team-person">
                    <span className="usage-team-name">
                      <span className="usage-team-label">{member.name}</span>
                      <span className={`usage-team-relation is-${member.relation}`}>{t(`usage.team.relation.${member.relation}` as PortalMessageKey)}</span>
                      {secondaryIds.has(member.user_id) ? (
                        <span className="usage-team-relation is-secondary" title={t("usage.team.secondaryHint")}>
                          {t("usage.team.secondary")}
                        </span>
                      ) : null}
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

const COMPANY_PAGE_SIZE = 50;

function CompanyPersonItem(props: {
  person: CompanyPersonRow;
  maxTokens: number;
  onOpenMember(userId: string): void;
  onOpenSelf(): void;
}) {
  const { t, intlLocale } = usePortalI18n();
  const turnCount = useTurnCount();
  const { person } = props;
  const openable = person.self || Boolean(person.user_id);
  const content = (
    <>
      <span className="usage-team-person">
        <span className="usage-team-name">
          <span className="usage-team-rank">{person.rank}</span>
          <span className="usage-team-label">{person.name}</span>
          {person.self ? <span className="usage-team-relation is-self">{t("usage.team.relation.self")}</span> : null}
        </span>
        <span className="usage-team-meta usage-team-meta-indent">{person.department ?? "—"}</span>
      </span>
      <span className="usage-team-usage">
        <span className="usage-team-tokens">{person.total_tokens > 0 ? formatTokens(person.total_tokens, intlLocale) : "—"}</span>
        <span className="usage-breakdown-track" aria-hidden="true">
          <span style={{ width: person.total_tokens > 0 ? `${Math.max(2, (person.total_tokens / props.maxTokens) * 100)}%` : 0 }} />
        </span>
        <span className="usage-team-meta">{turnCount(person.turns)}</span>
      </span>
      {openable ? <ChevronRight size={16} aria-hidden="true" className="usage-team-chevron" /> : <span aria-hidden="true" />}
    </>
  );
  if (!openable) return <div className={`usage-team-row is-static${person.self ? " is-self" : ""}`}>{content}</div>;
  return (
    <button
      type="button"
      className={`usage-team-row${person.self ? " is-self" : ""}`}
      onClick={() => (person.self ? props.onOpenSelf() : props.onOpenMember(person.user_id!))}
    >
      {content}
    </button>
  );
}

function CompanyView(props: {
  period: PersonalUsagePeriod;
  timezone: string;
  onOpenTeam(departmentId: string | null): void;
  onOpenMember(userId: string): void;
  onOpenSelf(): void;
}) {
  const { t, intlLocale } = usePortalI18n();
  const turnCount = useTurnCount();
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(COMPANY_PAGE_SIZE);
  const fetcher = useCallback(() => fetchCompanyUsage(props.period, props.timezone), [props.period, props.timezone]);
  const { data, error, loading, reload } = useLoader<CompanyUsageSummary>(true, fetcher);
  const number = (value: number) => new Intl.NumberFormat(intlLocale).format(value);
  const people = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.people ?? []).filter((person) => !needle || [person.name, person.department].some((value) => value?.toLowerCase().includes(needle)));
  }, [data, query]);

  useEffect(() => setVisible(COMPANY_PAGE_SIZE), [query, props.period]);

  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        message={t("usage.company.loadFailed")}
        action={<Button size="small" onClick={() => void reload()}>{t("usage.retry")}</Button>}
      />
    );
  }
  if (!data || (loading && data.period !== props.period)) return <Skeleton active paragraph={{ rows: 8 }} />;
  const maxDepartmentTokens = Math.max(1, ...data.departments.map((item) => item.total_tokens));
  const maxTokens = Math.max(1, ...data.people.map((person) => person.total_tokens));
  const shown = people.slice(0, visible);
  const self = people.find((person) => person.self);
  const selfHidden = Boolean(self && !shown.includes(self));
  return (
    <>
      <div className="usage-stats">
        <div>
          <span>{t("usage.team.members")}</span>
          <strong>{number(data.totals.members)}</strong>
        </div>
        <div>
          <span>{t("usage.team.active")}</span>
          <strong>{number(data.totals.active_members)}</strong>
          <small className="is-neutral">
            {new Intl.NumberFormat(intlLocale, { style: "percent", maximumFractionDigits: 0 }).format(
              data.totals.members ? data.totals.active_members / data.totals.members : 0
            )}
          </small>
        </div>
        <div>
          <span>{t("usage.totalTokens")}</span>
          <strong>{formatTokens(data.totals.total_tokens, intlLocale)}</strong>
        </div>
      </div>

      {data.team.available ? (
        <button type="button" className="usage-team-row usage-team-entry" onClick={() => props.onOpenTeam(null)}>
          <span className="usage-team-person">
            <span className="usage-team-name">
              <Users size={14} aria-hidden="true" className="usage-team-dept-icon" />
              <span className="usage-team-label">{t("usage.company.myTeam")}</span>
            </span>
            <span className="usage-team-meta">{t("usage.company.myTeamMeta", { count: number(data.team.size) })}</span>
          </span>
          <span aria-hidden="true" />
          <ChevronRight size={16} aria-hidden="true" className="usage-team-chevron" />
        </button>
      ) : null}

      {data.departments.length ? (
        <section className="usage-breakdown">
          <h3>{t("usage.company.departments")}</h3>
          <ul className="usage-team-list">
            {data.departments.map((node) => {
              const content = (
                <>
                  <span className="usage-team-person">
                    <span className="usage-team-name">
                      <Building2 size={14} aria-hidden="true" className="usage-team-dept-icon" />
                      <span className="usage-team-label">{node.name}</span>
                      {node.mine ? <span className="usage-team-relation is-self">{t("usage.company.myDepartment")}</span> : null}
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
                  {node.led ? <ChevronRight size={16} aria-hidden="true" className="usage-team-chevron" /> : <span aria-hidden="true" />}
                </>
              );
              return (
                <li key={node.id}>
                  {node.led ? (
                    <button type="button" className="usage-team-row" onClick={() => props.onOpenTeam(node.id)}>
                      {content}
                    </button>
                  ) : (
                    <div className="usage-team-row is-static">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="usage-breakdown">
        <h3>{t("usage.company.people", { count: number(data.people.length) })}</h3>
        <p className="usage-note">{t("usage.company.tokenNote")}</p>
        <Input
          allowClear
          prefix={<Search size={14} aria-hidden="true" />}
          placeholder={t("usage.team.search")}
          aria-label={t("usage.team.search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {people.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("usage.team.noMatch")} />
        ) : (
          <ul className="usage-team-list">
            {shown.map((person) => (
              <li key={`${person.rank}-${person.name}-${person.user_id ?? ""}`}>
                <CompanyPersonItem person={person} maxTokens={maxTokens} onOpenMember={props.onOpenMember} onOpenSelf={props.onOpenSelf} />
              </li>
            ))}
            {selfHidden && self ? (
              <li className="usage-team-pinned">
                <CompanyPersonItem person={self} maxTokens={maxTokens} onOpenMember={props.onOpenMember} onOpenSelf={props.onOpenSelf} />
              </li>
            ) : null}
          </ul>
        )}
        {people.length > shown.length ? (
          <Button block onClick={() => setVisible((count) => count + COMPANY_PAGE_SIZE)}>
            {t("usage.company.loadMore", { count: number(people.length - shown.length) })}
          </Button>
        ) : null}
        {data.inactive_members > 0 && !query.trim() ? (
          <p className="usage-note usage-team-footnote">{t("usage.company.inactive", { count: number(data.inactive_members) })}</p>
        ) : null}
      </section>
    </>
  );
}

function MemberView(props: { userId: string; period: PersonalUsagePeriod; timezone: string; backLabel: string; onBack(): void }) {
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
          {props.backLabel}
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
  // Everyone sees the company view; leaders can open their own team from it.
  const companyAvailable = Boolean(ranking.data && ranking.data.company.size > 0);
  // undefined: company overview; null: the viewer's team root; id: a led department.
  const [teamFocus, setTeamFocus] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!props.open) {
      setMemberId(null);
      setTeamFocus(undefined);
    }
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
        {companyAvailable ? (
          <Segmented
            block
            value={view}
            onChange={(value) => {
              setView(value as UsageView);
              setMemberId(null);
              setTeamFocus(undefined);
            }}
            options={[
              { value: "me", label: t("usage.view.me") },
              { value: "team", label: t("usage.view.company", { count: number(ranking.data?.company.size ?? 0) }) }
            ]}
          />
        ) : null}
        <Segmented
          block
          value={period}
          onChange={(value) => setPeriod(value as PersonalUsagePeriod)}
          options={PERIODS.map((key) => ({ value: key, label: t(`usage.period.${key}` as PortalMessageKey) }))}
        />

        {view === "team" && companyAvailable ? (
          <>
            {/* Stays mounted under the member view so search and scroll survive "Back". */}
            <div className="usage-drawer" hidden={Boolean(memberId)}>
              {teamFocus === undefined ? (
                <CompanyView
                  period={period}
                  timezone={timezone}
                  onOpenTeam={setTeamFocus}
                  onOpenMember={setMemberId}
                  onOpenSelf={() => setView("me")}
                />
              ) : (
                <TeamView
                  key={teamFocus ?? "root"}
                  period={period}
                  timezone={timezone}
                  initialFocusId={teamFocus}
                  onOpenMember={setMemberId}
                  onOpenSelf={() => setView("me")}
                  onBackToCompany={() => setTeamFocus(undefined)}
                />
              )}
            </div>
            {memberId ? (
              <MemberView
                userId={memberId}
                period={period}
                timezone={timezone}
                backLabel={teamFocus === undefined ? t("usage.company.back") : t("usage.team.back")}
                onBack={() => setMemberId(null)}
              />
            ) : null}
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
