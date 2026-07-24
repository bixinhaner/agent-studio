import { api } from "../../lib/api";

export type PublicExternalWebAccessState = {
  maintenanceEnabled: boolean;
};

export async function fetchPublicExternalWebAccessState(): Promise<PublicExternalWebAccessState> {
  const response = await api<{ maintenance_enabled?: unknown }>("/public-api/external-web-access");
  return {
    maintenanceEnabled: response.maintenance_enabled === true
  };
}
