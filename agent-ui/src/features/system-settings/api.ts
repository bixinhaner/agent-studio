import { api } from "../../lib/api";

import type { SystemSettingsPayload, SystemSettingsResponse } from "./types";

export async function fetchSystemSettings(): Promise<SystemSettingsResponse> {
  return api<SystemSettingsResponse>("/api/admin/system-settings");
}

export async function saveSystemSettingsDraft(payload: SystemSettingsPayload): Promise<SystemSettingsResponse> {
  return api<SystemSettingsResponse>("/api/admin/system-settings/draft", {
    method: "PUT",
    json: payload
  });
}

export async function publishSystemSettings(): Promise<SystemSettingsResponse> {
  return api<SystemSettingsResponse>("/api/admin/system-settings/publish", {
    method: "POST"
  });
}
