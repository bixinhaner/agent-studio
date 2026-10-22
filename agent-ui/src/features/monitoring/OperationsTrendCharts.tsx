import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { OperationsInsightsTrendPoint } from "./types";

const DEFAULT_WIDTH = 360;
const HEIGHT = 150;
const PAD = { top: 12, right: 8, bottom: 22, left: 40 };
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;
const MAX_BAR = 24;

/** Draw in real pixels so axis text stays 10px and the height stays fixed at any card width. */
function useMeasuredWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

type ChartKind = "bar" | "line";

type ChartSpec = {
  key: string;
  title: string;
  kind: ChartKind;
  value: (row: OperationsInsightsTrendPoint) => number | null;
  format: (value: number) => string;
  tick: (value: number) => string;
  summary: string;
  domain: (values: number[]) => [number, number];
  detail: (row: OperationsInsightsTrendPoint) => string;
};

const countFormat = new Intl.NumberFormat(undefined);
const compactFormat = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

function percent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/** Percent lines zoom to the data (values cluster near 100%), with whole-percent bounds. */
function percentDomain(values: number[]): [number, number] {
  if (!values.length) return [0, 1];
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = Math.max(high - low, 0.02);
  const min = Math.max(0, Math.floor((low - span * 0.25) * 100) / 100);
  const max = Math.min(1, Math.ceil((high + span * 0.25) * 100) / 100);
  return [min, Math.max(max, min + 0.01)];
}

function countDomain(values: number[]): [number, number] {
  const high = Math.max(0, ...values);
  if (high === 0) return [0, 1];
  const magnitude = 10 ** Math.floor(Math.log10(high));
  const step =
    [1, 2, 2.5, 5, 10]
      .map((factor) => factor * magnitude)
      .find((candidate) => candidate * 4 >= high) ?? magnitude * 10;
  return [0, step * Math.ceil(high / step)];
}

function shortDay(day: string): string {
  return day.slice(5);
}

export const TREND_CHARTS: ChartSpec[] = [
  {
    key: "requests",
    title: "每日问题次数",
    kind: "bar",
    value: (row) => row.requestCount,
    format: (value) => countFormat.format(value),
    tick: (value) => compactFormat.format(value),
    summary: "柱高为当天业务问题数",
    domain: countDomain,
    detail: (row) =>
      `${countFormat.format(row.userCount)} 位用户 · ${countFormat.format(row.sessionCount)} 个会话`,
  },
  {
    key: "successRate",
    title: "回答成功率",
    kind: "line",
    value: (row) => row.successRate,
    format: (value) => percent(value),
    tick: (value) => percent(value, 0),
    summary: "成功 ÷（成功 + 失败），不含用户中止；纵轴不从 0 开始",
    domain: percentDomain,
    detail: (row) =>
      `成功 ${countFormat.format(row.successfulRequestCount)} · 失败 ${countFormat.format(row.failedRequestCount)} · 中止 ${countFormat.format(row.cancelledRequestCount)}`,
  },
  {
    key: "cacheShare",
    title: "缓存占比",
    kind: "line",
    value: (row) => row.cacheShare,
    format: (value) => percent(value),
    tick: (value) => percent(value, 0),
    summary: "缓存命中的输入 tokens ÷ 全部输入 tokens；纵轴不从 0 开始",
    domain: percentDomain,
    detail: (row) => `总 tokens ${countFormat.format(row.totalTokens)}`,
  },
];

function TrendChart(props: {
  spec: ChartSpec;
  rows: OperationsInsightsTrendPoint[];
  activeIndex: number | null;
  onActiveIndexChange: (index: number | null) => void;
}) {
  const { spec, rows, activeIndex } = props;
  const [frameRef, WIDTH] = useMeasuredWidth();
  const PLOT_W = WIDTH - PAD.left - PAD.right;
  const values = rows.map(spec.value);
  const present = values.filter((value): value is number => value !== null);
  const [min, max] = spec.domain(present);
  const slot = PLOT_W / Math.max(rows.length, 1);
  const x = (index: number) => PAD.left + slot * index + slot / 2;
  const y = (value: number) =>
    PAD.top + PLOT_H - ((value - min) / (max - min)) * PLOT_H;
  const ticks = [min, (min + max) / 2, max];
  const barWidth = Math.max(1, Math.min(MAX_BAR, slot - 2));
  const baseline = PAD.top + PLOT_H;

  // Lines break over days without a value instead of drawing through them.
  const segments: string[] = [];
  let current = "";
  values.forEach((value, index) => {
    if (value === null) {
      if (current) segments.push(current);
      current = "";
      return;
    }
    current += `${current ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
  });
  if (current) segments.push(current);

  const latestIndex = values.reduce<number | null>(
    (found, value, index) => (value === null ? found : index),
    null,
  );
  const shownIndex = activeIndex ?? latestIndex;
  const shownRow = shownIndex === null ? null : rows[shownIndex];
  const shownValue = shownIndex === null ? null : values[shownIndex];
  const average = present.length
    ? present.reduce((sum, value) => sum + value, 0) / present.length
    : null;

  const handleKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!rows.length) return;
    const start = activeIndex ?? rows.length - 1;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      props.onActiveIndexChange(Math.max(0, start - 1));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      props.onActiveIndexChange(Math.min(rows.length - 1, start + 1));
    } else if (event.key === "Escape") {
      props.onActiveIndexChange(null);
    }
  };

  return (
    <figure className="ops-trend-chart">
      <figcaption className="ops-trend-chart-head">
        <span className="ops-trend-chart-title">{spec.title}</span>
        <span className="ops-trend-chart-readout" aria-live="polite">
          <strong>
            {shownValue === null || shownValue === undefined
              ? "—"
              : spec.format(shownValue)}
          </strong>
          <span>
            {shownRow
              ? activeIndex === null
                ? `最近 ${shortDay(shownRow.day)}`
                : shortDay(shownRow.day)
              : "暂无数据"}
          </span>
        </span>
      </figcaption>
      <p className="ops-trend-chart-detail">
        {shownRow ? spec.detail(shownRow) : spec.summary}
        {average !== null && spec.kind === "line"
          ? ` · 区间均值 ${spec.format(average)}`
          : ""}
      </p>
      <div ref={frameRef} className="ops-trend-chart-frame">
        <svg
          className="ops-trend-chart-svg"
          width={WIDTH}
          height={HEIGHT}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`${spec.title}，${rows.length} 天。${spec.summary}。用左右方向键逐日查看。`}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onBlur={() => props.onActiveIndexChange(null)}
          onPointerLeave={() => props.onActiveIndexChange(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                className="ops-trend-grid"
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text
                className="ops-trend-axis"
                x={PAD.left - 6}
                y={y(tick)}
                dy="0.32em"
                textAnchor="end"
              >
                {spec.tick(tick)}
              </text>
            </g>
          ))}
          {rows.length ? (
            <>
              <text
                className="ops-trend-axis"
                x={PAD.left}
                y={HEIGHT - 4}
                textAnchor="start"
              >
                {shortDay(rows[0].day)}
              </text>
              <text
                className="ops-trend-axis"
                x={WIDTH - PAD.right}
                y={HEIGHT - 4}
                textAnchor="end"
              >
                {shortDay(rows[rows.length - 1].day)}
              </text>
            </>
          ) : null}

          {activeIndex !== null ? (
            <line
              className="ops-trend-crosshair"
              x1={x(activeIndex)}
              x2={x(activeIndex)}
              y1={PAD.top}
              y2={baseline}
            />
          ) : null}

          {spec.kind === "bar"
            ? values.map((value, index) => {
                if (value === null || value <= 0) return null;
                const top = y(value);
                const height = baseline - top;
                const radius = Math.min(4, barWidth / 2, height);
                const left = x(index) - barWidth / 2;
                const right = left + barWidth;
                return (
                  <path
                    key={rows[index].day}
                    className={`ops-trend-bar ${activeIndex !== null && activeIndex !== index ? "is-muted" : ""}`}
                    d={`M${left},${baseline}V${top + radius}Q${left},${top} ${left + radius},${top}H${right - radius}Q${right},${top} ${right},${top + radius}V${baseline}Z`}
                  />
                );
              })
            : segments.map((segment) => (
                <path key={segment} className="ops-trend-line" d={segment} />
              ))}

          {spec.kind === "line" &&
          shownIndex !== null &&
          shownValue !== null &&
          shownValue !== undefined ? (
            <circle
              className="ops-trend-dot"
              cx={x(shownIndex)}
              cy={y(shownValue)}
              r={4}
            />
          ) : null}

          {rows.map((row, index) => (
            <rect
              key={row.day}
              className="ops-trend-hit"
              x={PAD.left + slot * index}
              y={PAD.top}
              width={slot}
              height={PLOT_H}
              onPointerEnter={() => props.onActiveIndexChange(index)}
            />
          ))}
        </svg>
      </div>
    </figure>
  );
}

export function OperationsTrendCharts(props: {
  rows: OperationsInsightsTrendPoint[];
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  if (!props.rows.length) return null;
  return (
    <section className="ops-trend-charts" aria-label="每日趋势图">
      {TREND_CHARTS.map((spec) => (
        <TrendChart
          key={spec.key}
          spec={spec}
          rows={props.rows}
          activeIndex={activeIndex}
          onActiveIndexChange={setActiveIndex}
        />
      ))}
    </section>
  );
}
