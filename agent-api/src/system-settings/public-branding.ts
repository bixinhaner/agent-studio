import {
  createDefaultSystemSettingsPayload,
  normalizeSystemSettingsPayload,
  systemSettingsBrandingSchema,
  type SystemSettingsBranding,
  type SystemSettingsVersionRecord
} from "./types.js";

type SystemSettingsBrandingReader = {
  getCurrentPublished(): Promise<SystemSettingsVersionRecord | undefined>;
};

export type PublicBrandingResponse = {
  branding: SystemSettingsBranding;
  adminConsole: {
    showOperationsAndConversationMenus: boolean;
  };
  behavior: {
    portalWelcomeMessageDesktop: string;
    portalWelcomeMessageMobile: string;
    portalWelcomeSuggestions: Array<{
      label: string;
      prompt: string;
    }>;
    answerFeedback: {
      enabledForExternalUsers: boolean;
      enabledForInternalUsers: boolean;
      prompt: string;
    };
  };
  publishedAt?: string;
};

export function defaultBranding(): SystemSettingsBranding {
  return createDefaultSystemSettingsPayload().branding;
}

export function defaultPublicBehavior(): PublicBrandingResponse["behavior"] {
  const behavior = createDefaultSystemSettingsPayload().behavior;
  return {
    portalWelcomeMessageDesktop: behavior.portalWelcomeMessageDesktop,
    portalWelcomeMessageMobile: behavior.portalWelcomeMessageMobile,
    portalWelcomeSuggestions: behavior.portalWelcomeSuggestions.map((item) => ({
      label: item.label,
      prompt: item.prompt
    })),
    answerFeedback: { ...behavior.answerFeedback }
  };
}

export async function resolvePublicBranding(reader: SystemSettingsBrandingReader): Promise<PublicBrandingResponse> {
  const published = await reader.getCurrentPublished().catch(() => undefined);
  const payload = published?.payload
    ? normalizeSystemSettingsPayload(published.payload)
    : createDefaultSystemSettingsPayload();
  const behavior = payload.behavior;
  return {
    branding: systemSettingsBrandingSchema.parse(payload.branding ?? defaultBranding()),
    adminConsole: {
      showOperationsAndConversationMenus: payload.safety.showAdminOperationsAndConversationMenus
    },
    behavior: {
      portalWelcomeMessageDesktop: behavior.portalWelcomeMessageDesktop,
      portalWelcomeMessageMobile: behavior.portalWelcomeMessageMobile,
      portalWelcomeSuggestions: behavior.portalWelcomeSuggestions.map((item) => ({
        label: item.label,
        prompt: item.prompt
      })),
      answerFeedback: { ...behavior.answerFeedback }
    },
    publishedAt: published?.publishedAt
  };
}

export async function resolvePublicPlatformName(reader?: SystemSettingsBrandingReader): Promise<string> {
  if (!reader) {
    return defaultBranding().platformName;
  }
  const response = await resolvePublicBranding(reader);
  return response.branding.platformName;
}
