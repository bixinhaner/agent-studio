/**
 * Locale-aware USD display: thousands separators, 2 decimals for amounts >= 1,
 * 4 decimals for cents and up to 6 significant digits for micro amounts, so
 * per-request costs stay readable without printing every stored decimal.
 */
export function formatUsdAmount(value: string | number | null | undefined): string {
  const raw = String(value ?? "0").trim();
  if (/^(USD|\$)/i.test(raw)) return raw;
  const amount = Number(raw || 0);
  if (!Number.isFinite(amount)) return `USD ${raw}`;
  const abs = Math.abs(amount);
  const options: Intl.NumberFormatOptions =
    abs === 0 || abs >= 1
      ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
      : abs >= 0.01
        ? { minimumFractionDigits: 4, maximumFractionDigits: 4 }
        : { maximumSignificantDigits: 6 };
  return `USD ${new Intl.NumberFormat("en-US", options).format(amount)}`;
}

/** Plain-text preview for list rows: drops common Markdown syntax and collapses whitespace. */
export function plainTextPreview(value: string | null | undefined, maxLength = 140): string {
  if (!value) return "";
  const text = value
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/(\*\*|__|~~)(.*?)\1/g, "$2")
    .replace(/(^|[^*\w])[*_]([^*_\n]+)[*_](?=[^*\w]|$)/g, "$1$2")
    .replace(/\*\*|__/g, "")
    .replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, " ")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

/** Compact list timestamp in the viewer's local zone: time for today, month-day otherwise, full date in other years. */
export function formatListTimestamp(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (date.toDateString() === now.toDateString()) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (date.getFullYear() === now.getFullYear()) return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

type DateInput = Date | string | number | null | undefined;

function toValidDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Admin console timestamps: one fixed, sortable shape ("2026-10-06 14:03") in the
 * viewer's local time zone, independent of the browser's language.
 */
export function formatAdminDateTime(value: DateInput, options: { seconds?: boolean; fallback?: string } = {}): string {
  const date = toValidDate(value);
  if (!date) return options.fallback ?? (typeof value === "string" && value ? value : "—");
  const base = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  return options.seconds ? `${base}:${pad2(date.getSeconds())}` : base;
}

export function formatAdminDate(value: DateInput, fallback = "—"): string {
  const date = toValidDate(value);
  if (!date) return fallback;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
