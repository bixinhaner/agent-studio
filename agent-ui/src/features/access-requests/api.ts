import { api } from "../../lib/api";

import type {
  AdminAccessRequestDetail,
  AdminAccessRequestPolicyUpdateInput,
  AdminAccessRequestProvisionInput,
  AdminAccessRequestUpdateInput,
  AccessRequestPolicy,
  AccessRequestWorkspaceResponse,
  PublicAccessRequest,
  PublicAccessRequestCreateResponse,
  PublicAccessRequestInput,
  ReviewerAccessRequestView
} from "./types";

export async function createPublicAccessRequest(input: PublicAccessRequestInput): Promise<PublicAccessRequestCreateResponse> {
  return api<PublicAccessRequestCreateResponse>("/public-api/access-requests", {
    method: "POST",
    json: input
  });
}

export async function fetchPublicAccessRequest(token: string): Promise<PublicAccessRequest> {
  const payload = await api<{ request: PublicAccessRequest }>(`/public-api/access-requests/${encodeURIComponent(token)}`);
  return payload.request;
}

export async function updatePublicAccessRequest(token: string, input: PublicAccessRequestInput): Promise<PublicAccessRequest> {
  const payload = await api<{ request: PublicAccessRequest }>(`/public-api/access-requests/${encodeURIComponent(token)}`, {
    method: "PATCH",
    json: input
  });
  return payload.request;
}

export async function fetchAdminAccessRequestWorkspace(input?: {
  status?: string;
  query?: string;
}): Promise<AccessRequestWorkspaceResponse> {
  const params = new URLSearchParams();
  if (input?.status?.trim()) params.set("status", input.status.trim());
  if (input?.query?.trim()) params.set("query", input.query.trim());
  const query = params.toString();
  return api<AccessRequestWorkspaceResponse>(`/api/admin/access-requests${query ? `?${query}` : ""}`);
}

export async function fetchAdminAccessRequestDetail(requestId: string): Promise<AdminAccessRequestDetail> {
  const payload = await api<{ request: AdminAccessRequestDetail }>(`/api/admin/access-requests/${encodeURIComponent(requestId)}`);
  return payload.request;
}

export async function updateAdminAccessRequestPolicy(
  input: AdminAccessRequestPolicyUpdateInput
): Promise<AccessRequestPolicy> {
  const payload = await api<{ policy: AccessRequestPolicy }>("/api/admin/access-requests/policy", {
    method: "PUT",
    json: input
  });
  return payload.policy;
}

export async function patchAdminAccessRequest(
  requestId: string,
  input: AdminAccessRequestUpdateInput
): Promise<AdminAccessRequestDetail> {
  const payload = await api<{ request: AdminAccessRequestDetail }>(`/api/admin/access-requests/${encodeURIComponent(requestId)}`, {
    method: "PATCH",
    json: input
  });
  return payload.request;
}

export async function sendAdminAccessRequestReview(requestId: string): Promise<AdminAccessRequestDetail> {
  const payload = await api<{ request: AdminAccessRequestDetail }>(
    `/api/admin/access-requests/${encodeURIComponent(requestId)}/send-review`,
    {
      method: "POST"
    }
  );
  return payload.request;
}

export async function requestAdminAccessRequestNeedsInfo(
  requestId: string,
  message: string
): Promise<AdminAccessRequestDetail> {
  const payload = await api<{ request: AdminAccessRequestDetail }>(
    `/api/admin/access-requests/${encodeURIComponent(requestId)}/needs-info`,
    {
      method: "POST",
      json: { message }
    }
  );
  return payload.request;
}

export async function rejectAdminAccessRequest(
  requestId: string,
  reason: string
): Promise<AdminAccessRequestDetail> {
  const payload = await api<{ request: AdminAccessRequestDetail }>(
    `/api/admin/access-requests/${encodeURIComponent(requestId)}/reject`,
    {
      method: "POST",
      json: { reason }
    }
  );
  return payload.request;
}

export async function provisionAdminAccessRequest(
  requestId: string,
  input: AdminAccessRequestProvisionInput
): Promise<AdminAccessRequestDetail> {
  const payload = await api<{ request: AdminAccessRequestDetail }>(
    `/api/admin/access-requests/${encodeURIComponent(requestId)}/provision`,
    {
      method: "POST",
      json: input
    }
  );
  return payload.request;
}

export async function fetchReviewerAccessRequest(requestId: string): Promise<ReviewerAccessRequestView> {
  return api<ReviewerAccessRequestView>(`/api/access-requests-review/${encodeURIComponent(requestId)}`);
}

export async function submitReviewerAccessRequestDecision(
  requestId: string,
  input: { decision: "approved" | "rejected" | "needs_info"; comment?: string | null }
): Promise<ReviewerAccessRequestView> {
  const payload = await api<{ reviewer: unknown; request: AdminAccessRequestDetail }>(
    `/api/access-requests-review/${encodeURIComponent(requestId)}/decision`,
    {
      method: "POST",
      json: input
    }
  );
  return fetchReviewerAccessRequest(requestId);
}
