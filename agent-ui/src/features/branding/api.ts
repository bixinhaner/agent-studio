import { api } from "../../lib/api";
import { DEFAULT_BRANDING, type PublicBranding, type PublicBrandingResponse } from "./types";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBranding(value: Partial<PublicBranding> | null | undefined): PublicBranding {
  return {
    platformName: asString(value?.platformName) || DEFAULT_BRANDING.platformName,
    headerSubtitle: asString(value?.headerSubtitle) || DEFAULT_BRANDING.headerSubtitle,
    loginCopy: asString(value?.loginCopy) || DEFAULT_BRANDING.loginCopy,
    logoUrl: asString(value?.logoUrl),
    iconUrl: asString(value?.iconUrl),
    assistantName: asString(value?.assistantName) || DEFAULT_BRANDING.assistantName,
    assistantAvatarUrl: asString(value?.assistantAvatarUrl)
  };
}

export async function fetchPublicBranding(): Promise<PublicBrandingResponse> {
  const response = await api<Partial<PublicBrandingResponse>>("/public-api/branding");
  return {
    branding: normalizeBranding(response.branding),
    publishedAt: asString(response.publishedAt) || undefined
  };
}
