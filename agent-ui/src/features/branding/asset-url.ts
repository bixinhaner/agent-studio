import { apiBase } from "../../lib/api";

const BRANDING_ASSET_PATH_PREFIX = "/public-api/branding/assets/";

function hasUrlScheme(value: string): boolean {
  return /^[a-z][a-z\d+\-.]*:/i.test(value);
}

export function resolveBrandingAssetUrl(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";
  if (hasUrlScheme(normalized) || normalized.startsWith("//")) return normalized;
  if (!normalized.startsWith(BRANDING_ASSET_PATH_PREFIX)) return normalized;

  const base = apiBase();
  return base ? `${base}${normalized}` : normalized;
}
