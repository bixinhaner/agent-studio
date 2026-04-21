import {
  createDefaultSystemSettingsPayload,
  systemSettingsBrandingSchema,
  systemSettingsBehaviorSchema,
  type SystemSettingsBranding,
  type SystemSettingsVersionRecord
} from "./types.js";

type SystemSettingsBrandingReader = {
  getCurrentPublished(): Promise<SystemSettingsVersionRecord | undefined>;
};

export type PublicBrandingResponse = {
  branding: SystemSettingsBranding;
  behavior: {
    portalWelcomeMessageDesktop: string;
    portalWelcomeMessageMobile: string;
    portalWelcomeSuggestions: Array<{
      label: string;
      prompt: string;
    }>;
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
    }))
  };
}

export async function resolvePublicBranding(reader: SystemSettingsBrandingReader): Promise<PublicBrandingResponse> {
  const published = await reader.getCurrentPublished().catch(() => undefined);
  const behavior = systemSettingsBehaviorSchema.parse(
    published?.payload.behavior ?? createDefaultSystemSettingsPayload().behavior
  );
  return {
    branding: systemSettingsBrandingSchema.parse(published?.payload.branding ?? defaultBranding()),
    behavior: {
      portalWelcomeMessageDesktop: behavior.portalWelcomeMessageDesktop,
      portalWelcomeMessageMobile: behavior.portalWelcomeMessageMobile,
      portalWelcomeSuggestions: behavior.portalWelcomeSuggestions.map((item) => ({
        label: item.label,
        prompt: item.prompt
      }))
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
