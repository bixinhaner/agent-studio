import {
  createDefaultSystemSettingsPayload,
  normalizeSystemSettingsPayload,
  systemSettingsBrandingSchema,
  type SystemSettingsBranding,
  type SystemSettingsVersionRecord
} from "./types.js";
import type { PublicBrandRecord } from "../public-brands/types.js";

type SystemSettingsBrandingReader = {
  getCurrentPublished(): Promise<SystemSettingsVersionRecord | undefined>;
};

export type PublicBrandingResponse = {
  branding: SystemSettingsBranding & {
    primaryColor?: string;
    accentColor?: string;
  };
  brand: {
    id?: string;
    key: string;
    custom: boolean;
    externalOnly: boolean;
    accessRequestEnabled: boolean;
    billingEnabled: boolean;
  };
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
    brand: {
      key: "default",
      custom: false,
      externalOnly: false,
      accessRequestEnabled: true,
      billingEnabled: true
    },
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

export function resolveBrandPublicBranding(brand: PublicBrandRecord): PublicBrandingResponse {
  return {
    brand: {
      id: brand.id,
      key: brand.key,
      custom: true,
      externalOnly: brand.externalOnly,
      accessRequestEnabled: brand.accessRequestEnabled,
      billingEnabled: brand.billingEnabled
    },
    branding: {
      platformName: brand.platformName,
      headerSubtitle: brand.headerSubtitle,
      internalLoginCopy: brand.externalLoginCopy,
      externalLoginCopy: brand.externalLoginCopy,
      logoUrl: brand.logoUrl ?? "",
      iconUrl: brand.iconUrl ?? "",
      loginBackgroundUrl: brand.loginBackgroundUrl ?? "",
      portalWelcomeIllustrationUrl: brand.portalWelcomeIllustrationUrl ?? "",
      assistantName: brand.assistantName,
      assistantAvatarUrl: brand.assistantAvatarUrl ?? "",
      primaryColor: brand.primaryColor,
      accentColor: brand.accentColor
    },
    adminConsole: {
      showOperationsAndConversationMenus: false
    },
    behavior: {
      portalWelcomeMessageDesktop: brand.portalWelcomeMessageDesktop,
      portalWelcomeMessageMobile: brand.portalWelcomeMessageMobile,
      portalWelcomeSuggestions: brand.portalWelcomeSuggestions,
      answerFeedback: {
        enabledForExternalUsers: brand.answerFeedbackEnabled,
        enabledForInternalUsers: false,
        prompt: brand.answerFeedbackPrompt
      }
    },
    publishedAt: brand.updatedAt
  };
}

export async function resolvePublicPlatformName(reader?: SystemSettingsBrandingReader): Promise<string> {
  if (!reader) {
    return defaultBranding().platformName;
  }
  const response = await resolvePublicBranding(reader);
  return response.branding.platformName;
}
