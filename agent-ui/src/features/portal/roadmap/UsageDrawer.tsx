import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Drawer, Empty, Segmented, Skeleton, Tooltip } from "antd";
import { BarChart3 } from "lucide-react";

import { usePortalI18n, type PortalMessageKey } from "../i18n";
import { fetchPersonalUsage, type PersonalUsagePeriod, type PersonalUsageSummary } from "./api";
import { browserTimezone } from "./schedule-format";

const PERIODS: PersonalUsagePeriod[] = ["month", "last_month", "7d", "30d"];

export function formatTokens(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function DailyBars(props: { daily: PersonalUsageSummary["daily"]; locale: string }) {
  const { t } = usePortalI18n();
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
            title={t("usage.dayTooltip", { date: label(day.date), tokens: formatTokens(day.total_tokens, props.locale), turns: day.turns })}
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

export function UsageDrawer(props: { open: boolean; onClose(): void }) {
  const { t, intlLocale } = usePortalI18n();
  const [period, setPeriod] = useState<PersonalUsagePeriod>("month");
  const [data, setData] = useState<PersonalUsageSummary | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const timezone = useMemo(() => browserTimezone(), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setData(await fetchPersonalUsage(period, timezone));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [period, timezone]);

  useEffect(() => {
    if (props.open) void load();
  }, [load, props.open]);

  const number = (value: number) => new Intl.NumberFormat(intlLocale).format(value);
  const totals = data?.totals;
  const change = useMemo(() => {
    if (!data?.previous || !totals) return null;
    if (data.previous.total_tokens <= 0) return totals.total_tokens > 0 ? t("usage.noPrevious") : null;
    const ratio = (totals.total_tokens - data.previous.total_tokens) / data.previous.total_tokens;
    const formatted = new Intl.NumberFormat(intlLocale, { style: "percent", maximumFractionDigits: 0, signDisplay: "exceptZero" }).format(ratio);
    return t("usage.vsPrevious", { change: formatted });
  }, [data, intlLocale, t, totals]);

  return (
    <Drawer
      open={props.open}
      onClose={props.onClose}
      width={520}
      rootClassName="roadmap-drawer"
      title={
        <span className="roadmap-drawer-title">
          <BarChart3 size={18} aria-hidden="true" />
          {t("usage.title")}
        </span>
      }
    >
      <div className="usage-drawer">
        <Segmented
          block
          value={period}
          onChange={(value) => setPeriod(value as PersonalUsagePeriod)}
          options={PERIODS.map((key) => ({ value: key, label: t(`usage.period.${key}` as PortalMessageKey) }))}
        />

        {error ? (
          <Alert
            type="error"
            showIcon
            message={t("usage.loadFailed")}
            action={<Button size="small" onClick={() => void load()}>{t("usage.retry")}</Button>}
          />
        ) : !data || (loading && data.period !== period) ? (
          <Skeleton active paragraph={{ rows: 8 }} />
        ) : totals && totals.turns === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("usage.empty")} />
        ) : totals ? (
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
                detail: `${number(row.turns)} ${t("usage.turns")}`
              }))}
            />
            <BreakdownList
              title={t("usage.byModel")}
              locale={intlLocale}
              rows={data.by_model.map((row) => ({
                key: row.model,
                label: row.model,
                value: row.total_tokens,
                detail: `${number(row.turns)} ${t("usage.turns")}`
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
        ) : null}
      </div>
    </Drawer>
  );
}
