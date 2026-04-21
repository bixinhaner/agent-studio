import { api } from "../../lib/api";
import {
  DEFAULT_BRANDING,
  DEFAULT_PORTAL_BEHAVIOR,
  type PublicBranding,
  type PublicBrandingResponse,
  type PublicPortalBehavior,
  type PublicPortalWelcomeSuggestion
} from "./types";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBranding(value: Partial<PublicBranding> | null | undefined): PublicBranding {
  const legacyLoginCopy = asString((value as { loginCopy?: unknown } | null | undefined)?.loginCopy);
  return {
    platformName: asString(value?.platformName) || DEFAULT_BRANDING.platformName,
    headerSubtitle: asString(value?.headerSubtitle) || DEFAULT_BRANDING.headerSubtitle,
    internalLoginCopy: asString(value?.internalLoginCopy) || legacyLoginCopy || DEFAULT_BRANDING.internalLoginCopy,
    externalLoginCopy: asString(value?.externalLoginCopy) || DEFAULT_BRANDING.externalLoginCopy,
    logoUrl: asString(value?.logoUrl),
    iconUrl: asString(value?.iconUrl),
    assistantName: asString(value?.assistantName) || DEFAULT_BRANDING.assistantName,
    assistantAvatarUrl: asString(value?.assistantAvatarUrl)
  };
}

function normalizeWelcomeSuggestion(value: Partial<PublicPortalWelcomeSuggestion> | null | undefined): PublicPortalWelcomeSuggestion | null {
  const label = asString(value?.label);
  const prompt = asString(value?.prompt);
  if (!label || !prompt) return null;
  return { label, prompt };
}

function normalizeBehavior(value: Partial<PublicPortalBehavior> | null | undefined): PublicPortalBehavior {
  const suggestions = Array.isArray(value?.portalWelcomeSuggestions)
    ? value.portalWelcomeSuggestions
      .map((item) => normalizeWelcomeSuggestion(item))
      .filter((item): item is PublicPortalWelcomeSuggestion => Boolean(item))
    : [];

  return {
    portalWelcomeMessageDesktop:
      asString(value?.portalWelcomeMessageDesktop) || DEFAULT_PORTAL_BEHAVIOR.portalWelcomeMessageDesktop,
    portalWelcomeMessageMobile:
      asString(value?.portalWelcomeMessageMobile) || DEFAULT_PORTAL_BEHAVIOR.portalWelcomeMessageMobile,
    portalWelcomeSuggestions: suggestions.length ? suggestions : DEFAULT_PORTAL_BEHAVIOR.portalWelcomeSuggestions
  };
}

export async function fetchPublicBranding(): Promise<PublicBrandingResponse> {
  const response = await api<Partial<PublicBrandingResponse>>("/public-api/branding");
  return {
    branding: normalizeBranding(response.branding),
    behavior: normalizeBehavior(response.behavior),
    publishedAt: asString(response.publishedAt) || undefined
  };
}
