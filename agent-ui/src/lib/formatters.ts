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

/** Compact list timestamp in the viewer's local zone: time for today, month/day otherwise, year when it differs. */
export function formatListTimestamp(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString(undefined, date.getFullYear() === now.getFullYear()
    ? { month: "numeric", day: "numeric" }
    : { year: "numeric", month: "numeric", day: "numeric" });
}
