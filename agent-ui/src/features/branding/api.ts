import { api } from "../../lib/api";
import { normalizeBrandingResponse } from "./normalize";
import type { PublicBrandingResponse } from "./types";

export async function fetchPublicBranding(): Promise<PublicBrandingResponse> {
  const response = await api<Partial<PublicBrandingResponse>>("/public-api/branding");
  return normalizeBrandingResponse(response);
}
