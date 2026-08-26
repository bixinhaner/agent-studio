import { api, apiBase, authHeaders, notifyAuthInvalidStatus } from "../../lib/api";

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

function appendText(formData: FormData, key: string, value: string | null | undefined): void {
  if (value === undefined || value === null) return;
  formData.append(key, value);
}

function buildPublicAccessRequestFormData(input: PublicAccessRequestInput): FormData {
  const formData = new FormData();
  formData.append("applicantEmail", input.applicantEmail);
  formData.append("contactName", input.contactName);
  formData.append("companyName", input.companyName);
  formData.append("countryRegion", input.countryRegion);
  formData.append("snNumber", input.snNumber);
  formData.append("salesContactEmail", input.salesContactEmail);
  appendText(formData, "deviceInfoText", input.deviceInfoText);
  appendText(formData, "purchaseDate", input.purchaseDate);
  appendText(formData, "poNumber", input.poNumber);
  appendText(formData, "customerNote", input.customerNote);
  for (const file of input.purchaseProofFiles ?? []) {
    formData.append("purchaseProofFiles", file, file.name);
  }
  return formData;
}

async function publicAccessRequestFormApi<T>(path: string, method: "POST" | "PATCH", input: PublicAccessRequestInput): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    credentials: "include",
    headers: authHeaders(),
    body: buildPublicAccessRequestFormData(input)
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    notifyAuthInvalidStatus(res.status);
    const msg = (data && typeof data.detail === "string" && data.detail) || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export function accessRequestFileUrl(contentUrl: string | undefined): string {
  if (!contentUrl) return "#";
  if (/^https?:\/\//i.test(contentUrl)) return contentUrl;
  return `${apiBase()}${contentUrl.startsWith("/") ? contentUrl : `/${contentUrl}`}`;
}

export async function createPublicAccessRequest(input: PublicAccessRequestInput): Promise<PublicAccessRequestCreateResponse> {
  return publicAccessRequestFormApi<PublicAccessRequestCreateResponse>("/public-api/access-requests", "POST", input);
}

export async function fetchPublicAccessRequest(token: string): Promise<PublicAccessRequest> {
  const payload = await api<{ request: PublicAccessRequest }>(`/public-api/access-requests/${encodeURIComponent(token)}`);
  return payload.request;
}

export async function updatePublicAccessRequest(token: string, input: PublicAccessRequestInput): Promise<PublicAccessRequest> {
  const payload = await publicAccessRequestFormApi<{ request: PublicAccessRequest }>(
    `/public-api/access-requests/${encodeURIComponent(token)}`,
    "PATCH",
    input
  );
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

function reviewerQuery(reviewToken?: string): string {
  return reviewToken ? `?token=${encodeURIComponent(reviewToken)}` : "";
}

function reviewerApiBase(reviewToken?: string): string {
  return reviewToken ? "/public-api/access-request-reviews" : "/api/access-requests-review";
}

export async function fetchReviewerAccessRequest(requestId: string, reviewToken?: string): Promise<ReviewerAccessRequestView> {
  return api<ReviewerAccessRequestView>(
    `${reviewerApiBase(reviewToken)}/${encodeURIComponent(requestId)}${reviewerQuery(reviewToken)}`
  );
}

export async function submitReviewerAccessRequestDecision(
  requestId: string,
  input: { decision: "approved" | "rejected" | "needs_info"; comment?: string | null },
  reviewToken?: string
): Promise<ReviewerAccessRequestView> {
  const payload = await api<{ reviewer: unknown; request: AdminAccessRequestDetail }>(
    `${reviewerApiBase(reviewToken)}/${encodeURIComponent(requestId)}/decision${reviewerQuery(reviewToken)}`,
    {
      method: "POST",
      json: input
    }
  );
  return fetchReviewerAccessRequest(requestId, reviewToken);
}
