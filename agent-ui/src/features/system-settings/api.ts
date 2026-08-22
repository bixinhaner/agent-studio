import { api, apiBase, authHeaders, notifyAuthInvalidStatus } from "../../lib/api";

import type {
  SystemSettingsConversationSecurityReview,
  SystemSettingsPayload,
  SystemSettingsResponse
} from "./types";

export type BrandingAssetKind =
  | "logo"
  | "icon"
  | "assistant-avatar"
  | "login-background"
  | "portal-welcome-illustration";

export type UploadedBrandingAsset = {
  url: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

export type ExternalWebAccessState = {
  maintenanceEnabled: boolean;
  updatedAt: string | null;
  updatedByUserId: string | null;
};

export type AdminEmailNotificationRecord = {
  id: string;
  channelType: "email";
  targetRef: string;
  eventType: string;
  status: "pending" | "sent" | "failed";
  payload?: {
    recipients?: string[];
    subject?: string;
    attempts?: number;
    maxAttempts?: number;
    delivery?: { delivered?: boolean; mode?: string };
  };
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

export async function fetchSystemSettings(): Promise<SystemSettingsResponse> {
  return api<SystemSettingsResponse>("/api/admin/system-settings");
}

export async function fetchAdminEmailNotificationRecords(input?: {
  status?: "pending" | "sent" | "failed";
  take?: number;
}): Promise<{ records: AdminEmailNotificationRecord[] }> {
  const params = new URLSearchParams();
  if (input?.status) params.set("status", input.status);
  if (input?.take) params.set("take", String(input.take));
  const suffix = params.size ? `?${params.toString()}` : "";
  return api(`/api/admin/system-settings/admin-email-notifications/records${suffix}`);
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

export async function testConversationSecurityReview(input: {
  question: string;
  settings: SystemSettingsConversationSecurityReview;
}): Promise<{
  decision: {
    riskLevel: string;
    score: number;
    confidence?: number;
    categories: string[];
    evidenceMessageIds: string[];
    reason: string;
    assistantExposure: string;
    recommendedAction: string;
  };
  provider: string;
  model: string;
}> {
  return api("/api/admin/system-settings/conversation-security-review/test", {
    method: "POST",
    json: input
  });
}

export async function fetchExternalWebAccessState(): Promise<ExternalWebAccessState> {
  return api<ExternalWebAccessState>("/api/admin/system-settings/external-web-access");
}

export async function updateExternalWebAccessState(
  maintenanceEnabled: boolean
): Promise<ExternalWebAccessState> {
  return api<ExternalWebAccessState>("/api/admin/system-settings/external-web-access", {
    method: "PUT",
    json: {
      maintenance_enabled: maintenanceEnabled
    }
  });
}

export async function uploadSystemSettingsBrandingAsset(kind: BrandingAssetKind, file: File): Promise<UploadedBrandingAsset> {
  const formData = new FormData();
  formData.set("kind", kind);
  formData.set("file", file);

  const headers = new Headers(authHeaders());
  const res = await fetch(`${apiBase()}/api/admin/system-settings/assets`, {
    method: "POST",
    credentials: "include",
    headers,
    body: formData
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    notifyAuthInvalidStatus(res.status);
    const msg = (data && typeof data.detail === "string" && data.detail) || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  const asset = (data as { asset?: Record<string, unknown> }).asset ?? {};
  return {
    url: typeof asset.url === "string" ? asset.url : "",
    fileName: typeof asset.file_name === "string" ? asset.file_name : "",
    mimeType: typeof asset.mime_type === "string" ? asset.mime_type : "",
    sizeBytes: typeof asset.size_bytes === "number" ? asset.size_bytes : 0
  };
}
