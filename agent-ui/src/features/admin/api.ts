import { api } from "../../lib/api";

import type {
  AdminApiAuditDetailResponse,
  AdminApiAuditListInput,
  AdminApiAuditListResponse,
  AdminAiResponseReviewListInput,
  AdminAiResponseReviewListResponse,
  AdminBillingOverviewResponse,
  AdminConversationDetailResponse,
  AdminConversationRecoveryDetailResponse,
  AdminConversationRecoveryListInput,
  AdminConversationRecoveryListResponse,
  AdminConversationRecoveryStatus,
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
  AdminSecurityDomain,
  AdminSecurityDomainInput,
  AdminSubscriptionDenialsResponse,
  AdminSubscriptionGrantDetailResponse,
  AdminSubscriptionGrantInput,
  AdminSubscriptionOrganizationsResponse,
  AdminSubscriptionPlanDetailResponse,
  AdminSubscriptionPlanInput,
  AdminSubscriptionPlansResponse,
  AdminSubscriptionUsersResponse,
  AdminUserDetailResponse,
  AdminUserListResponse,
  AdminUserLocalSettingsInput,
  DepartmentTreeResponse,
  OrgSyncConfigResponse,
  OrgSyncJobDiffsResponse,
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

export async function fetchAdminSubscriptionPlans(): Promise<AdminSubscriptionPlansResponse> {
  return api<AdminSubscriptionPlansResponse>("/api/admin/subscriptions/plans");
}

export async function createAdminSubscriptionPlan(
  input: AdminSubscriptionPlanInput
): Promise<AdminSubscriptionPlanDetailResponse> {
  return api<AdminSubscriptionPlanDetailResponse>("/api/admin/subscriptions/plans", {
    method: "POST",
    json: input
  });
}

export async function patchAdminSubscriptionPlan(
  planId: string,
  input: AdminSubscriptionPlanInput
): Promise<AdminSubscriptionPlanDetailResponse> {
  return api<AdminSubscriptionPlanDetailResponse>(`/api/admin/subscriptions/plans/${encodeURIComponent(planId)}`, {
    method: "PATCH",
    json: input
  });
}

export async function fetchAdminSubscriptionUsers(): Promise<AdminSubscriptionUsersResponse> {
  return api<AdminSubscriptionUsersResponse>("/api/admin/subscriptions/users");
}

export async function upsertAdminUserSubscriptionGrant(
  userId: string,
  input: AdminSubscriptionGrantInput
): Promise<AdminSubscriptionGrantDetailResponse> {
  return api<AdminSubscriptionGrantDetailResponse>(`/api/admin/subscriptions/users/${encodeURIComponent(userId)}/grant`, {
    method: "PUT",
    json: input
  });
}

export async function deleteAdminUserSubscriptionGrant(userId: string): Promise<{ ok: true }> {
  return api<{ ok: true }>(`/api/admin/subscriptions/users/${encodeURIComponent(userId)}/grant`, {
    method: "DELETE"
  });
}

export async function fetchAdminSubscriptionOrganizations(): Promise<AdminSubscriptionOrganizationsResponse> {
  return api<AdminSubscriptionOrganizationsResponse>("/api/admin/subscriptions/organizations");
}

export async function upsertAdminOrganizationSubscriptionGrant(
  organizationId: string,
  input: AdminSubscriptionGrantInput
): Promise<AdminSubscriptionGrantDetailResponse> {
  return api<AdminSubscriptionGrantDetailResponse>(
    `/api/admin/subscriptions/organizations/${encodeURIComponent(organizationId)}/grant`,
    {
      method: "PUT",
      json: input
    }
  );
}

export async function deleteAdminOrganizationSubscriptionGrant(organizationId: string): Promise<{ ok: true }> {
  return api<{ ok: true }>(`/api/admin/subscriptions/organizations/${encodeURIComponent(organizationId)}/grant`, {
    method: "DELETE"
  });
}

export async function fetchAdminSubscriptionDenials(): Promise<AdminSubscriptionDenialsResponse> {
  return api<AdminSubscriptionDenialsResponse>("/api/admin/subscriptions/denials");
}

export async function fetchAdminBillingOverview(): Promise<AdminBillingOverviewResponse> {
  return api<AdminBillingOverviewResponse>("/api/admin/billing/overview");
}

export async function createAdminPromotionCode(input: {
  code: string;
  name?: string;
  description?: string;
  type: string;
  value: number;
  currency?: string;
  status?: string;
  maxRedemptions?: number | null;
  perCustomerLimit?: number | null;
  startsAt?: string | null;
  expiresAt?: string | null;
  eligiblePlanIds?: string[];
  eligibleOrganizationIds?: string[];
  eligibleEmailDomains?: string[];
  eligibleSnValues?: string[];
  ownerUserId?: string | null;
  note?: string | null;
}): Promise<AdminBillingOverviewResponse["promotionCodes"][number]> {
  const response = await api<{ promotionCode: AdminBillingOverviewResponse["promotionCodes"][number] }>(
    "/api/admin/billing/promotion-codes",
    {
      method: "POST",
      json: input
    }
  );
  return response.promotionCode;
}

export async function patchAdminPromotionCode(
  promotionCodeId: string,
  input: {
    name?: string | null;
    description?: string | null;
    status?: string | null;
    maxRedemptions?: number | null;
    perCustomerLimit?: number | null;
    expiresAt?: string | null;
    note?: string | null;
  }
): Promise<AdminBillingOverviewResponse["promotionCodes"][number]> {
  const response = await api<{ promotionCode: AdminBillingOverviewResponse["promotionCodes"][number] }>(
    `/api/admin/billing/promotion-codes/${encodeURIComponent(promotionCodeId)}`,
    {
      method: "PATCH",
      json: input
    }
  );
  return response.promotionCode;
}

export async function createAdminBillingPaymentLink(input: {
  organizationId: string;
  planId: string;
  promotionCode?: string;
  autoRenew: boolean;
}): Promise<{ checkoutUrl: string | null; order: AdminBillingOverviewResponse["orders"][number] }> {
  return api<{ checkoutUrl: string | null; order: AdminBillingOverviewResponse["orders"][number] }>(
    "/api/admin/billing/payment-links",
    {
      method: "POST",
      json: input
    }
  );
}

export async function lookupAdminBillingStripeCustomer(
  billingCustomerId: string
): Promise<AdminBillingOverviewResponse["customers"][number]["billingCustomer"]> {
  const response = await api<{ billingCustomer: AdminBillingOverviewResponse["customers"][number]["billingCustomer"] }>(
    `/api/admin/billing/customers/${encodeURIComponent(billingCustomerId)}/stripe-customer/lookup`,
    {
      method: "POST"
    }
  );
  return response.billingCustomer;
}

export async function bindAdminBillingStripeCustomer(
  billingCustomerId: string,
  stripeCustomerId: string
): Promise<AdminBillingOverviewResponse["customers"][number]["billingCustomer"]> {
  const response = await api<{ billingCustomer: AdminBillingOverviewResponse["customers"][number]["billingCustomer"] }>(
    `/api/admin/billing/customers/${encodeURIComponent(billingCustomerId)}/stripe-customer`,
    {
      method: "PATCH",
      json: { stripeCustomerId }
    }
  );
  return response.billingCustomer;
}

export async function patchAdminBillingPlan(
  planId: string,
  input: {
    billingCurrency?: string | null;
    billingInterval?: string | null;
    billingIntervalCount?: number | null;
    billingPriceCents?: number | null;
    billingStatus?: string | null;
  }
): Promise<AdminBillingOverviewResponse["plans"][number]> {
  const response = await api<{ plan: AdminBillingOverviewResponse["plans"][number] }>(
    `/api/admin/billing/plans/${encodeURIComponent(planId)}`,
    {
      method: "PATCH",
      json: input
    }
  );
  return response.plan;
}

export async function patchAdminBillingStripeSettings(input: {
  mode?: string | null;
  stripeSecretKey?: string | null;
  webhookSigningSecret?: string | null;
  successUrl?: string | null;
  cancelUrl?: string | null;
  portalBillingUrl?: string | null;
  defaultCurrency?: string | null;
  defaultAutoRenew?: boolean | null;
  clearStripeSecretKey?: boolean;
  clearWebhookSigningSecret?: boolean;
}): Promise<AdminBillingOverviewResponse["stripe"]> {
  const response = await api<{ stripe: AdminBillingOverviewResponse["stripe"] }>("/api/admin/billing/stripe-settings", {
    method: "PATCH",
    json: input
  });
  return response.stripe;
}

export async function patchAdminBillingEmailSettings(input: {
  enabled: boolean;
}): Promise<AdminBillingOverviewResponse["emailSettings"]> {
  const response = await api<{ emailSettings: AdminBillingOverviewResponse["emailSettings"] }>("/api/admin/billing/email-settings", {
    method: "PATCH",
    json: input
  });
  return response.emailSettings;
}

export async function grantAdminBillingGiftDays(input: {
  organizationId: string;
  planId: string;
  days: number;
  reason?: string;
  promotionCodeId?: string;
}): Promise<{ order: AdminBillingOverviewResponse["orders"][number]; grant: AdminBillingOverviewResponse["customers"][number]["grant"] }> {
  return api<{ order: AdminBillingOverviewResponse["orders"][number]; grant: AdminBillingOverviewResponse["customers"][number]["grant"] }>(
    "/api/admin/billing/gift-days",
    {
      method: "POST",
      json: input
    }
  );
}

export async function patchAdminBillingEmailRule(
  ruleId: string,
  input: {
    status?: string;
    audience?: unknown;
    subject?: string;
    bodyText?: string;
    bodyHtml?: string | null;
  }
): Promise<AdminBillingOverviewResponse["emailRules"][number]> {
  const response = await api<{ emailRule: AdminBillingOverviewResponse["emailRules"][number] }>(
    `/api/admin/billing/email-rules/${encodeURIComponent(ruleId)}`,
    {
      method: "PATCH",
      json: input
    }
  );
  return response.emailRule;
}

export async function runAdminBillingEmailReminderSweep(input: { testEmail?: string } = {}): Promise<{
  ok: true;
  disabled?: boolean;
  results: Array<{ ruleId: string; sent: number; skipped: number; failed: number }>;
}> {
  return api("/api/admin/billing/email-reminders/run", {
    method: "POST",
    json: input
  });
}

export async function sendAdminBillingEmailRuleTest(
  ruleId: string,
  input: { testEmail: string }
): Promise<{ ok: true; delivered: boolean; mode: "smtp" | "debug" }> {
  return api(`/api/admin/billing/email-rules/${encodeURIComponent(ruleId)}/test`, {
    method: "POST",
    json: input
  });
}

export async function fetchAdminConversationAuditList(
  input: AdminConversationListInput = {}
): Promise<AdminConversationListResponse> {
  const params = new URLSearchParams();
  if (input.query?.trim()) params.set("query", input.query.trim());
  if (input.status) params.set("status", input.status);
  if (input.feedback) params.set("feedback", input.feedback);
  if (input.source) params.set("source", input.source);
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

export async function fetchAdminAiResponseReviewList(
  input: AdminAiResponseReviewListInput = {}
): Promise<AdminAiResponseReviewListResponse> {
  const params = new URLSearchParams();
  if (input.query?.trim()) params.set("query", input.query.trim());
  if (input.source) params.set("source", input.source);
  if (input.status) params.set("status", input.status);
  if (input.filter) params.set("filter", input.filter);
  if (input.sort) params.set("sort", input.sort);
  if (typeof input.page === "number") params.set("page", String(input.page));
  if (typeof input.pageSize === "number") params.set("page_size", String(input.pageSize));
  const query = params.toString();
  return api<AdminAiResponseReviewListResponse>(
    `/api/admin/conversations/ai-response-reviews${query ? `?${query}` : ""}`
  );
}

export async function hardDeleteAdminConversation(conversationId: string): Promise<{ ok: true; mode: "deleted" }> {
  return api<{ ok: true; mode: "deleted" }>(`/api/threads/${encodeURIComponent(conversationId)}?hard=true`, {
    method: "DELETE"
  });
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

export async function fetchAdminConversationRecoveryList(
  input: AdminConversationRecoveryListInput = {}
): Promise<AdminConversationRecoveryListResponse> {
  const params = new URLSearchParams();
  if (input.query?.trim()) params.set("query", input.query.trim());
  if (input.status) params.set("status", input.status);
  if (typeof input.page === "number") params.set("page", String(input.page));
  if (typeof input.pageSize === "number") params.set("page_size", String(input.pageSize));
  const query = params.toString();
  return api<AdminConversationRecoveryListResponse>(`/api/admin/customer-recovery/cases${query ? `?${query}` : ""}`);
}

export async function fetchAdminConversationRecoveryDetail(
  caseId: string
): Promise<AdminConversationRecoveryDetailResponse> {
  return api<AdminConversationRecoveryDetailResponse>(`/api/admin/customer-recovery/cases/${encodeURIComponent(caseId)}`);
}

export async function updateAdminConversationRecoveryStatus(
  caseId: string,
  status: AdminConversationRecoveryStatus
): Promise<{ case: AdminConversationRecoveryDetailResponse["case"] }> {
  return api<{ case: AdminConversationRecoveryDetailResponse["case"] }>(
    `/api/admin/customer-recovery/cases/${encodeURIComponent(caseId)}`,
    {
      method: "PATCH",
      json: { status }
    }
  );
}

export async function sendAdminConversationRecoveryEmail(
  caseId: string,
  input: {
    recipientEmail?: string;
    subject: string;
    bodyText: string;
    templateLanguage?: "zh" | "en";
    rootCause?: string;
    resolutionSummary?: string;
  }
): Promise<{ case: AdminConversationRecoveryDetailResponse["case"]; notificationId: string; delivered: boolean; mode: "smtp" | "debug" }> {
  return api(
    `/api/admin/customer-recovery/cases/${encodeURIComponent(caseId)}/send-email`,
    {
      method: "POST",
      json: input
    }
  );
}

export async function grantAdminConversationRecoveryDays(
  caseId: string,
  input: {
    planId?: string;
    days: number;
    reason?: string;
  }
): Promise<{ case: AdminConversationRecoveryDetailResponse["case"]; order: unknown; grant: unknown }> {
  return api(`/api/admin/customer-recovery/cases/${encodeURIComponent(caseId)}/grant-days`, {
    method: "POST",
    json: input
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

export async function fetchAdminSecurityDomains(): Promise<{ domains: AdminSecurityDomain[] }> {
  return api<{ domains: AdminSecurityDomain[] }>("/api/admin/security-domains");
}

export async function createAdminSecurityDomain(input: AdminSecurityDomainInput): Promise<AdminSecurityDomain> {
  const response = await api<{ domain: AdminSecurityDomain }>("/api/admin/security-domains", {
    method: "POST",
    json: input
  });
  return response.domain;
}

export async function updateAdminSecurityDomain(
  domainId: string,
  input: AdminSecurityDomainInput
): Promise<AdminSecurityDomain> {
  const response = await api<{ domain: AdminSecurityDomain }>(
    `/api/admin/security-domains/${encodeURIComponent(domainId)}`,
    { method: "PUT", json: input }
  );
  return response.domain;
}

export async function fetchOrgSyncConfig(): Promise<OrgSyncConfigResponse> {
  return api<OrgSyncConfigResponse>("/api/admin/org-sync/config");
}

export async function fetchOrgSyncJobs(): Promise<OrgSyncJobListResponse> {
  return api<OrgSyncJobListResponse>("/api/admin/org-sync/jobs");
}

export async function fetchOrgSyncJobDiffs(jobId: string): Promise<OrgSyncJobDiffsResponse> {
  return api<OrgSyncJobDiffsResponse>(`/api/admin/org-sync/jobs/${encodeURIComponent(jobId)}/diffs`);
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
