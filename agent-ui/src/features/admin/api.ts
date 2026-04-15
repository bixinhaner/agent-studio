import { api } from "../../lib/api";

import type {
  AdminApiAuditDetailResponse,
  AdminApiAuditListInput,
  AdminApiAuditListResponse,
  AdminConversationDetailResponse,
  AdminConversationListInput,
  AdminConversationListResponse,
  AdminCreatedInvite,
  AdminCustomerOrganizationCreateInput,
  AdminCustomerOrganizationDetailResponse,
  AdminCustomerOrganizationListResponse,
  AdminCustomerOrganizationUpdateInput,
  AdminExternalInviteInput,
  AdminProductFeedbackDetailResponse,
  AdminProductFeedbackListInput,
  AdminProductFeedbackListResponse,
  AdminProductFeedbackStatus,
  AdminOverview,
  AdminUserDetailResponse,
  AdminUserListResponse,
  AdminUserLocalSettingsInput,
  DepartmentTreeResponse,
  OrgSyncConfigResponse,
  OrgSyncJobListResponse,
  OrgSyncTriggerResponse
} from "./types";

type CreateAdminInvitePayload = {
  invite: {
    id: string;
    organization_id: string;
    email: string;
    status: string;
    expires_at?: string | null;
  };
};

export async function fetchAdminOverview(): Promise<AdminOverview> {
  return api<AdminOverview>("/api/admin/overview");
}

export async function fetchAdminConversationAuditList(
  input: AdminConversationListInput = {}
): Promise<AdminConversationListResponse> {
  const params = new URLSearchParams();
  if (input.query?.trim()) params.set("query", input.query.trim());
  if (input.status) params.set("status", input.status);
  if (input.feedback) params.set("feedback", input.feedback);
  if (input.sort) params.set("sort", input.sort);
  if (typeof input.page === "number") params.set("page", String(input.page));
  if (typeof input.pageSize === "number") params.set("page_size", String(input.pageSize));
  const query = params.toString();
  return api<AdminConversationListResponse>(`/api/admin/conversations${query ? `?${query}` : ""}`);
}

export async function fetchAdminConversationAuditDetail(
  conversationId: string
): Promise<AdminConversationDetailResponse> {
  return api<AdminConversationDetailResponse>(`/api/admin/conversations/${encodeURIComponent(conversationId)}`);
}

export async function fetchAdminApiAuditList(
  input: AdminApiAuditListInput = {}
): Promise<AdminApiAuditListResponse> {
  const params = new URLSearchParams();
  if (input.query?.trim()) params.set("query", input.query.trim());
  if (input.result) params.set("result", input.result);
  if (input.delivery) params.set("delivery", input.delivery);
  if (input.sort) params.set("sort", input.sort);
  if (typeof input.page === "number") params.set("page", String(input.page));
  if (typeof input.pageSize === "number") params.set("page_size", String(input.pageSize));
  const query = params.toString();
  return api<AdminApiAuditListResponse>(`/api/admin/conversations/api-usage${query ? `?${query}` : ""}`);
}

export async function fetchAdminApiAuditDetail(
  eventId: string
): Promise<AdminApiAuditDetailResponse> {
  return api<AdminApiAuditDetailResponse>(`/api/admin/conversations/api-usage/${encodeURIComponent(eventId)}`);
}

export async function fetchAdminProductFeedbackList(
  input: AdminProductFeedbackListInput = {}
): Promise<AdminProductFeedbackListResponse> {
  const params = new URLSearchParams();
  if (input.query?.trim()) params.set("query", input.query.trim());
  if (input.type) params.set("type", input.type);
  if (input.status) params.set("status", input.status);
  if (input.sort) params.set("sort", input.sort);
  if (typeof input.page === "number") params.set("page", String(input.page));
  if (typeof input.pageSize === "number") params.set("page_size", String(input.pageSize));
  const query = params.toString();
  return api<AdminProductFeedbackListResponse>(`/api/admin/product-feedback${query ? `?${query}` : ""}`);
}

export async function fetchAdminProductFeedbackDetail(
  feedbackId: string
): Promise<AdminProductFeedbackDetailResponse> {
  return api<AdminProductFeedbackDetailResponse>(`/api/admin/product-feedback/${encodeURIComponent(feedbackId)}`);
}

export async function updateAdminProductFeedbackStatus(
  feedbackId: string,
  status: AdminProductFeedbackStatus
): Promise<AdminProductFeedbackDetailResponse> {
  return api<AdminProductFeedbackDetailResponse>(`/api/admin/product-feedback/${encodeURIComponent(feedbackId)}`, {
    method: "PATCH",
    json: { status }
  });
}

export async function fetchAdminUsers(): Promise<AdminUserListResponse> {
  return api<AdminUserListResponse>("/api/admin/users");
}

export async function fetchAdminUser(userId: string): Promise<AdminUserDetailResponse> {
  return api<AdminUserDetailResponse>(`/api/admin/users/${encodeURIComponent(userId)}`);
}

export async function patchAdminUserLocalSettings(
  userId: string,
  input: AdminUserLocalSettingsInput
): Promise<AdminUserDetailResponse> {
  return api<AdminUserDetailResponse>(`/api/admin/users/${encodeURIComponent(userId)}/local-settings`, {
    method: "PATCH",
    json: input
  });
}

export async function fetchAdminCustomerOrganizations(): Promise<AdminCustomerOrganizationListResponse> {
  return api<AdminCustomerOrganizationListResponse>("/api/admin/customer-organizations");
}

export async function createAdminCustomerOrganization(
  input: AdminCustomerOrganizationCreateInput
): Promise<AdminCustomerOrganizationDetailResponse> {
  return api<AdminCustomerOrganizationDetailResponse>("/api/admin/customer-organizations", {
    method: "POST",
    json: input
  });
}

export async function patchAdminCustomerOrganization(
  organizationId: string,
  input: AdminCustomerOrganizationUpdateInput
): Promise<AdminCustomerOrganizationDetailResponse> {
  return api<AdminCustomerOrganizationDetailResponse>(
    `/api/admin/customer-organizations/${encodeURIComponent(organizationId)}`,
    {
      method: "PATCH",
      json: input
    }
  );
}

export async function createAdminOrganizationInvite(input: AdminExternalInviteInput): Promise<AdminCreatedInvite> {
  const payload = await api<CreateAdminInvitePayload>("/api/auth/invites", {
    method: "POST",
    json: {
      organization_id: input.organizationId,
      email: input.email,
      membership_type: input.membershipType
    }
  });
  return {
    id: payload.invite.id,
    organizationId: payload.invite.organization_id,
    email: payload.invite.email,
    status: payload.invite.status,
    expiresAt: payload.invite.expires_at ?? null
  };
}

export async function fetchDepartmentTree(): Promise<DepartmentTreeResponse> {
  return api<DepartmentTreeResponse>("/api/admin/departments/tree");
}

export async function fetchOrgSyncConfig(): Promise<OrgSyncConfigResponse> {
  return api<OrgSyncConfigResponse>("/api/admin/org-sync/config");
}

export async function fetchOrgSyncJobs(): Promise<OrgSyncJobListResponse> {
  return api<OrgSyncJobListResponse>("/api/admin/org-sync/jobs");
}

export async function triggerFullOrgSync(): Promise<OrgSyncTriggerResponse> {
  return api<OrgSyncTriggerResponse>("/api/admin/org-sync/jobs", { method: "POST" });
}

export async function triggerDepartmentOrgSync(externalId: string): Promise<OrgSyncTriggerResponse> {
  return api<OrgSyncTriggerResponse>(`/api/admin/org-sync/jobs/department/${encodeURIComponent(externalId)}`, {
    method: "POST"
  });
}

export async function triggerUserOrgSync(externalId: string): Promise<OrgSyncTriggerResponse> {
  return api<OrgSyncTriggerResponse>(`/api/admin/org-sync/jobs/user/${encodeURIComponent(externalId)}`, {
    method: "POST"
  });
}
