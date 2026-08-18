import { normalizeBrandingResponse } from "./normalize";
import {
  DEFAULT_BRANDING,
  DEFAULT_ADMIN_CONSOLE_CONFIG,
  DEFAULT_BRAND_IDENTITY,
  DEFAULT_PORTAL_BEHAVIOR,
  type PublicBranding,
  type PublicBrandingResponse
} from "./types";
import { resolveBrandingAssetUrl } from "./asset-url";

export const BRANDING_STORAGE_KEY = "agent-studio-public-branding";

export function fallbackBrandingResponse(): PublicBrandingResponse {
  return {
    branding: DEFAULT_BRANDING,
    brand: DEFAULT_BRAND_IDENTITY,
    adminConsole: DEFAULT_ADMIN_CONSOLE_CONFIG,
    behavior: DEFAULT_PORTAL_BEHAVIOR
  };
}

function setFaviconAsset(assetUrl: string): void {
  if (typeof document === "undefined") return;
  const normalized = resolveBrandingAssetUrl(assetUrl);
  let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!normalized) {
    link?.removeAttribute("href");
    return;
  }
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = normalized;
}

function setAuthBackgroundAsset(assetUrl: string): void {
  if (typeof document === "undefined") return;
  const normalized = resolveBrandingAssetUrl(assetUrl);
  document.documentElement.style.setProperty(
    "--auth-brand-background-image",
    normalized ? `url(${JSON.stringify(normalized)})` : "none"
  );
}

export function getAuthBackgroundAssetUrl(branding: PublicBranding): string {
  return resolveBrandingAssetUrl(branding.loginBackgroundUrl.trim());
}

export function applyDocumentBranding(branding: PublicBranding): void {
  if (typeof document === "undefined") return;
  document.title = branding.platformName.trim() || DEFAULT_BRANDING.platformName;
  setFaviconAsset(branding.iconUrl.trim() || branding.logoUrl.trim());
  setAuthBackgroundAsset(getAuthBackgroundAssetUrl(branding));
  document.documentElement.style.setProperty("--brand-primary", branding.primaryColor);
  document.documentElement.style.setProperty("--brand-accent", branding.accentColor);
}

export function readStoredBrandingResponse(): PublicBrandingResponse | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(BRANDING_STORAGE_KEY);
    if (!raw) return null;
    return normalizeBrandingResponse(JSON.parse(raw) as Partial<PublicBrandingResponse>);
  } catch {
    return null;
  }
}

export function writeStoredBrandingResponse(response: PublicBrandingResponse): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify(response));
  } catch {
    // Ignore storage failures in private browsing or restricted environments.
  }
}
