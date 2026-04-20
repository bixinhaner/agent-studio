import {
  createDefaultSystemSettingsPayload,
  systemSettingsBrandingSchema,
  type SystemSettingsBranding,
  type SystemSettingsVersionRecord
} from "./types.js";

type SystemSettingsBrandingReader = {
  getCurrentPublished(): Promise<SystemSettingsVersionRecord | undefined>;
};

export type PublicBrandingResponse = {
  branding: SystemSettingsBranding;
  publishedAt?: string;
};

export function defaultBranding(): SystemSettingsBranding {
  return createDefaultSystemSettingsPayload().branding;
}

export async function resolvePublicBranding(reader: SystemSettingsBrandingReader): Promise<PublicBrandingResponse> {
  const published = await reader.getCurrentPublished().catch(() => undefined);
  return {
    branding: systemSettingsBrandingSchema.parse(published?.payload.branding ?? defaultBranding()),
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
