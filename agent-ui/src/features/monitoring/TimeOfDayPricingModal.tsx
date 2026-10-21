import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Modal, Switch, Typography } from "antd";
import { CalendarPlus, Plus, Trash2, X } from "lucide-react";

import {
  CN_HOLIDAYS_2026,
  CN_MAKEUP_WORKDAYS_2026,
  DEEPSEEK_TIME_OF_DAY_PRICING,
  TIMEZONE_OPTIONS,
  WEEKDAY_LABELS,
  formatMultiplier,
  minutesOf,
  pricingPeriodAt,
  validateTimeOfDayPricing
} from "./time-of-day-pricing";
import type { TimeOfDayPricing } from "./types";

type Props = {
  open: boolean;
  model: string;
  value: TimeOfDayPricing | null | undefined;
  saving?: boolean;
  onCancel: () => void;
  onSave: (value: TimeOfDayPricing | null) => void | Promise<void>;
};

function cloneConfig(value: TimeOfDayPricing): TimeOfDayPricing {
  return {
    ...value,
    peakWindows: value.peakWindows.map((window) => ({ ...window, weekdays: [...window.weekdays] })),
    offPeakDates: [...(value.offPeakDates ?? [])],
    workdayDates: [...(value.workdayDates ?? [])]
  };
}

export function TimeOfDayPricingModal({ open, model, value, saving, onCancel, onSave }: Props) {
  const [enabled, setEnabled] = useState(Boolean(value));
  const [draft, setDraft] = useState<TimeOfDayPricing>(() => cloneConfig(value ?? DEEPSEEK_TIME_OF_DAY_PRICING));
  const [multiplierText, setMultiplierText] = useState(String((value ?? DEEPSEEK_TIME_OF_DAY_PRICING).offPeakMultiplier));
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    if (!open) return;
    const base = value ?? DEEPSEEK_TIME_OF_DAY_PRICING;
    setEnabled(Boolean(value));
    setDraft(cloneConfig(base));
    setMultiplierText(String(base.offPeakMultiplier));
    setErrorText("");
  }, [open, value]);

  const config: TimeOfDayPricing = { ...draft, timezone: draft.timezone.trim(), offPeakMultiplier: Number(multiplierText) };
  const validation = enabled ? validateTimeOfDayPricing(config) : "";

  function patchWindow(index: number, patch: Partial<TimeOfDayPricing["peakWindows"][number]>) {
    setDraft((current) => ({
      ...current,
      peakWindows: current.peakWindows.map((window, position) => (position === index ? { ...window, ...patch } : window))
    }));
  }

  function toggleWeekday(index: number, weekday: number) {
    const window = draft.peakWindows[index];
    const weekdays = window.weekdays.includes(weekday)
      ? window.weekdays.filter((day) => day !== weekday)
      : [...window.weekdays, weekday].sort((left, right) => left - right);
    patchWindow(index, { weekdays });
  }

  function setDates(key: "offPeakDates" | "workdayDates", dates: string[]) {
    setDraft((current) => ({ ...current, [key]: [...new Set(dates)].sort() }));
  }

  async function handleSave() {
    if (validation) {
      setErrorText(validation);
      return;
    }
    setErrorText("");
    if (!enabled) return onSave(null);
    return onSave({
      ...config,
      offPeakDates: config.offPeakDates?.length ? config.offPeakDates : undefined,
      workdayDates: config.workdayDates?.length ? config.workdayDates : undefined
    });
  }

  return (
    <Modal
      open={open}
      width={760}
      title={
        <span className="tod-modal-title">
          峰谷计价
          <span className="tod-mono">{model || "未填写模型"}</span>
        </span>
      }
      onCancel={onCancel}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={onCancel}>
          取消
        </Button>,
        <Button key="save" type="primary" loading={saving} onClick={() => void handleSave()}>
          {saving ? "保存中…" : "保存峰谷设置"}
        </Button>
      ]}
    >
      <div className="tod-editor">
        <div className="tod-switch-row">
          <div>
            <div className="tod-section-title">按时段计价</div>
            <Typography.Text type="secondary" className="tod-help">
              表格里的单价为高峰（标价）；高峰时段之外、周末和节假日全天按标价 × 谷时系数计费。每次调用按发生时间判定。
            </Typography.Text>
          </div>
          <Switch checked={enabled} onChange={setEnabled} aria-label="启用峰谷计价" />
        </div>

        {!enabled ? (
          <p className="tod-disabled-note">已关闭：所有时段都按标价计费。</p>
        ) : (
          <>
            <div className="tod-grid-2">
              <label className="field">
                <span className="field-label">时区</span>
                <input
                  className="field-input"
                  aria-label="峰谷时区"
                  name="tod-timezone"
                  list="tod-timezone-options"
                  spellCheck={false}
                  autoComplete="off"
                  value={draft.timezone}
                  onChange={(event) => setDraft((current) => ({ ...current, timezone: event.target.value }))}
                />
                <datalist id="tod-timezone-options">
                  {TIMEZONE_OPTIONS.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
                <small className="field-help">高峰时段、星期和日期都按这个时区判断。</small>
              </label>
              <label className="field">
                <span className="field-label">谷时价格系数</span>
                <input
                  className="field-input tod-mono"
                  aria-label="谷时价格系数"
                  name="tod-off-peak-multiplier"
                  inputMode="decimal"
                  value={multiplierText}
                  onChange={(event) => setMultiplierText(event.target.value)}
                />
                <small className="field-help">0.5 表示谷时半价，1 表示不打折。</small>
              </label>
            </div>

            <section className="tod-section" aria-label="高峰时段">
              <div className="tod-section-head">
                <div className="tod-section-title">高峰时段</div>
                <Button
                  size="small"
                  icon={<Plus size={14} aria-hidden="true" />}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      peakWindows: [...current.peakWindows, { weekdays: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" }]
                    }))
                  }
                >
                  添加时段
                </Button>
              </div>
              {draft.peakWindows.length === 0 ? <p className="tod-empty">还没有高峰时段，所有时间都会按谷时计费。</p> : null}
              {draft.peakWindows.map((window, index) => (
                <div className="tod-window" key={index}>
                  <div className="tod-weekdays" role="group" aria-label={`高峰时段 ${index + 1} 的星期`}>
                    {WEEKDAY_LABELS.map((label, dayIndex) => {
                      const weekday = dayIndex + 1;
                      const selected = window.weekdays.includes(weekday);
                      return (
                        <button
                          key={weekday}
                          type="button"
                          className={`tod-day${selected ? " is-selected" : ""}`}
                          aria-pressed={selected}
                          aria-label={`高峰时段 ${index + 1} 周${label}`}
                          onClick={() => toggleWeekday(index, weekday)}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="tod-times">
                    <input
                      type="time"
                      className="field-input tod-mono"
                      aria-label={`高峰时段 ${index + 1} 开始`}
                      value={window.start}
                      onChange={(event) => patchWindow(index, { start: event.target.value })}
                    />
                    <span aria-hidden="true">–</span>
                    <input
                      type="time"
                      className="field-input tod-mono"
                      aria-label={`高峰时段 ${index + 1} 结束`}
                      value={window.end}
                      onChange={(event) => patchWindow(index, { end: event.target.value })}
                    />
                  </div>
                  <Button
                    type="text"
                    className="tod-icon-btn"
                    aria-label={`删除高峰时段 ${index + 1}`}
                    icon={<Trash2 size={16} aria-hidden="true" />}
                    onClick={() =>
                      setDraft((current) => ({ ...current, peakWindows: current.peakWindows.filter((_, position) => position !== index) }))
                    }
                  />
                </div>
              ))}
              <WeekPreview config={config} valid={!validation} />
            </section>

            <DateListEditor
              title="节假日（全天谷时）"
              help="法定节假日即使落在工作日也按谷时计费。每年国务院公布次年安排后需要补充。"
              dates={draft.offPeakDates ?? []}
              presetLabel="填入 2026 年法定节假日"
              preset={CN_HOLIDAYS_2026}
              onChange={(dates) => setDates("offPeakDates", dates)}
            />
            <DateListEditor
              title="调休上班日（按工作日计价）"
              help="周末调休上班的日期会按周一至周五的高峰时段计费。DeepSeek 官方规则只写了周一至周五，未提调休，所以 DeepSeek 默认留空。"
              dates={draft.workdayDates ?? []}
              presetLabel="填入 2026 年调休上班日"
              preset={CN_MAKEUP_WORKDAYS_2026}
              onChange={(dates) => setDates("workdayDates", dates)}
            />
          </>
        )}
        {errorText ? <Alert type="error" showIcon message={errorText} role="alert" /> : null}
      </div>
    </Modal>
  );
}

function WeekPreview({ config, valid }: { config: TimeOfDayPricing; valid: boolean }) {
  const now = useMemo(() => new Date(), []);
  if (!valid) return null;
  const current = pricingPeriodAt(config, now);
  const localNow = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(now);
  return (
    <div className="tod-preview">
      <div className="tod-preview-head">
        <span>每周预览（{config.timezone}）</span>
        <span className="tod-legend">
          <span className="tod-swatch is-peak" aria-hidden="true" />
          高峰 · 标价
          <span className="tod-swatch" aria-hidden="true" />
          谷时 · {formatMultiplier(config.offPeakMultiplier)}
        </span>
      </div>
      {WEEKDAY_LABELS.map((label, dayIndex) => {
        const weekday = dayIndex + 1;
        const windows = config.peakWindows.filter((window) => window.weekdays.includes(weekday));
        const description = windows.length ? windows.map((window) => `${window.start}–${window.end}`).join("、") : "全天谷时";
        return (
          <div className="tod-row" key={weekday}>
            <span className="tod-row-label">周{label}</span>
            <div className="tod-track" role="img" aria-label={`周${label}高峰：${description}`}>
              {windows.map((window, index) => (
                <span
                  key={index}
                  className="tod-segment"
                  style={{
                    left: `${(minutesOf(window.start) / 1440) * 100}%`,
                    width: `${((minutesOf(window.end) - minutesOf(window.start)) / 1440) * 100}%`
                  }}
                />
              ))}
            </div>
          </div>
        );
      })}
      <div className="tod-row tod-axis" aria-hidden="true">
        <span className="tod-row-label" />
        <div className="tod-axis-ticks">
          {["00", "06", "12", "18", "24"].map((tick) => (
            <span key={tick}>{tick}</span>
          ))}
        </div>
      </div>
      <p className="tod-now" aria-live="polite">
        现在（你的本地时间 <span className="tod-mono">{localNow}</span>，{config.timezone}{" "}
        <span className="tod-mono">
          {current.date} {current.localTime}
        </span>
        ）按 <strong>{current.peak ? "高峰 · 标价" : `谷时 · ${formatMultiplier(config.offPeakMultiplier)}`}</strong> 计费。
      </p>
    </div>
  );
}

function DateListEditor(props: {
  title: string;
  help: string;
  dates: string[];
  presetLabel: string;
  preset: string[];
  onChange: (dates: string[]) => void;
}) {
  const [pending, setPending] = useState("");
  const missingPreset = props.preset.filter((date) => !props.dates.includes(date)).length;
  const byYear = props.dates.reduce<Map<string, string[]>>((groups, date) => {
    const year = date.slice(0, 4);
    groups.set(year, [...(groups.get(year) ?? []), date]);
    return groups;
  }, new Map());

  function add() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pending)) return;
    props.onChange([...props.dates, pending]);
    setPending("");
  }

  return (
    <section className="tod-section" aria-label={props.title}>
      <div className="tod-section-head">
        <div>
          <div className="tod-section-title">
            {props.title}
            <span className="tod-count">{props.dates.length} 天</span>
          </div>
          <small className="field-help">{props.help}</small>
        </div>
        <div className="tod-date-actions">
          <Button
            size="small"
            icon={<CalendarPlus size={14} aria-hidden="true" />}
            disabled={missingPreset === 0}
            title={missingPreset === 0 ? "已全部填入" : undefined}
            onClick={() => props.onChange([...props.dates, ...props.preset])}
          >
            {props.presetLabel}
          </Button>
          {props.dates.length > 0 ? (
            <Button size="small" type="text" onClick={() => props.onChange([])}>
              清空
            </Button>
          ) : null}
        </div>
      </div>
      <div className="tod-date-add">
        <input
          type="date"
          className="field-input tod-mono"
          aria-label={`添加${props.title}`}
          value={pending}
          onChange={(event) => setPending(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button size="small" onClick={add} disabled={!pending}>
          添加日期
        </Button>
      </div>
      {props.dates.length === 0 ? (
        <p className="tod-empty">未设置。</p>
      ) : (
        [...byYear.entries()].map(([year, dates]) => (
          <div className="tod-date-year" key={year}>
            <span className="tod-year-label">{year}</span>
            <ul className="tod-chips">
              {dates.map((date) => (
                <li key={date} className="tod-chip">
                  <span className="tod-mono">{date.slice(5)}</span>
                  <button
                    type="button"
                    className="tod-chip-remove"
                    aria-label={`移除 ${date}`}
                    onClick={() => props.onChange(props.dates.filter((item) => item !== date))}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
