import {
  DEFAULT_BRANDING,
  DEFAULT_PORTAL_BEHAVIOR,
  type PublicBranding,
  type PublicBrandingResponse,
  type PublicPortalBehavior,
  type PublicPortalWelcomeSuggestion
} from "./types";
import { resolveBrandingAssetUrl } from "./asset-url";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeBranding(value: Partial<PublicBranding> | null | undefined): PublicBranding {
  const legacyLoginCopy = asString((value as { loginCopy?: unknown } | null | undefined)?.loginCopy);
  return {
    platformName: asString(value?.platformName) || DEFAULT_BRANDING.platformName,
    headerSubtitle: asString(value?.headerSubtitle) || DEFAULT_BRANDING.headerSubtitle,
    internalLoginCopy: asString(value?.internalLoginCopy) || legacyLoginCopy || DEFAULT_BRANDING.internalLoginCopy,
    externalLoginCopy: asString(value?.externalLoginCopy) || DEFAULT_BRANDING.externalLoginCopy,
    logoUrl: resolveBrandingAssetUrl(asString(value?.logoUrl)),
    iconUrl: resolveBrandingAssetUrl(asString(value?.iconUrl)),
    loginBackgroundUrl: resolveBrandingAssetUrl(asString(value?.loginBackgroundUrl)),
    portalWelcomeIllustrationUrl: resolveBrandingAssetUrl(asString(value?.portalWelcomeIllustrationUrl)),
    assistantName: asString(value?.assistantName) || DEFAULT_BRANDING.assistantName,
    assistantAvatarUrl: resolveBrandingAssetUrl(asString(value?.assistantAvatarUrl))
  };
}

function normalizeWelcomeSuggestion(
  value: Partial<PublicPortalWelcomeSuggestion> | null | undefined
): PublicPortalWelcomeSuggestion | null {
  const label = asString(value?.label);
  const prompt = asString(value?.prompt);
  if (!label || !prompt) return null;
  return { label, prompt };
}

function normalizeAnswerFeedback(
  value: Partial<PublicPortalBehavior["answerFeedback"]> | null | undefined
): PublicPortalBehavior["answerFeedback"] {
  return {
    enabledForExternalUsers:
      typeof value?.enabledForExternalUsers === "boolean"
        ? value.enabledForExternalUsers
        : DEFAULT_PORTAL_BEHAVIOR.answerFeedback.enabledForExternalUsers,
    enabledForInternalUsers:
      typeof value?.enabledForInternalUsers === "boolean"
        ? value.enabledForInternalUsers
        : DEFAULT_PORTAL_BEHAVIOR.answerFeedback.enabledForInternalUsers,
    prompt: asString(value?.prompt) || DEFAULT_PORTAL_BEHAVIOR.answerFeedback.prompt
  };
}

export function normalizeBehavior(value: Partial<PublicPortalBehavior> | null | undefined): PublicPortalBehavior {
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
    portalWelcomeSuggestions: suggestions.length ? suggestions : DEFAULT_PORTAL_BEHAVIOR.portalWelcomeSuggestions,
    answerFeedback: normalizeAnswerFeedback(value?.answerFeedback)
  };
}

export function normalizeBrandingResponse(
  value: Partial<PublicBrandingResponse> | null | undefined
): PublicBrandingResponse {
  return {
    branding: normalizeBranding(value?.branding),
    behavior: normalizeBehavior(value?.behavior),
    publishedAt: asString(value?.publishedAt) || undefined
  };
}
