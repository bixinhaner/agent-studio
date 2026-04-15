export function formatUsdAmount(value: string | number | null | undefined): string {
  const normalized = String(value ?? "0.000000").trim();
  if (!normalized) return "USD 0.000000";
  if (/^(USD|\$)/i.test(normalized)) return normalized;
  return `USD ${normalized}`;
}
