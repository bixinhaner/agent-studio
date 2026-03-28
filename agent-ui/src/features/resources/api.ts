import { api } from "../../lib/api";
import type { PortalResourcesResponse } from "./types";

export async function fetchPortalResources(): Promise<PortalResourcesResponse> {
  return await api<PortalResourcesResponse>("/api/portal/resources");
}
