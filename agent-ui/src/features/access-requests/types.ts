export type AccessRequestAttachment = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  contentUrl?: string;
  createdAt: string;
};

export type PublicAccessRequest = {
  id: string;
  status: string;
  requestType: string;
  applicantEmail: string;
  contactName?: string;
  companyName: string;
  countryRegion?: string;
  deviceInfoText: string;
  purchaseProofAttachments: AccessRequestAttachment[];
  purchaseDate?: string;
  poNumber: string;
  snNumber?: string;
  salesContactEmail: string;
  customerNote?: string;
  reviewSummary?: string;
  rejectionReason?: string;
  targetOrganization?: {
    id: string;
    name: string;
    slug: string;
  } | null;
  invitedAt?: string;
  activatedAt?: string;
  createdAt: string;
  updatedAt: string;
  needsMoreInfo: boolean;
};

export type PublicAccessRequestInput = {
  applicantEmail: string;
  contactName: string;
  companyName: string;
  countryRegion: string;
  deviceInfoText?: string | null;
  purchaseDate?: string | null;
  poNumber?: string;
  snNumber: string;
  salesContactEmail: string;
  purchaseProofFiles?: File[];
  customerNote?: string;
};

export type PublicAccessRequestCreateResponse = {
  request: PublicAccessRequest;
  publicToken: string;
};

export type AccessRequestReviewerSummary = {
  total: number;
  toCount: number;
  ccCount: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  needsInfoCount: number;
};

export type AdminAccessRequestSummary = {
  id: string;
  requestType: string;
  commercialIntent: string;
  status: string;
  applicantEmail: string;
  contactName?: string;
  companyName: string;
  countryRegion?: string;
  salesContactEmail: string;
  poNumber: string;
  snNumber?: string;
  purchaseDate?: string;
  owner: { id: string; displayName: string; email: string } | null;
  requestedPlan: { id: string; name: string; slug: string } | null;
  approvedPlan: { id: string; name: string; slug: string } | null;
  targetOrganization: { id: string; name: string; slug: string; status: string } | null;
  reviewers: AccessRequestReviewerSummary;
  reviewMode: string;
  minimumApprovals?: number;
  rejectionMode: string;
  reviewRequestedAt?: string;
  approvedAt?: string;
  rejectedAt?: string;
  provisionedAt?: string;
  invitedAt?: string;
  activatedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type AccessRequestEvent = {
  id: string;
  accessRequestId: string;
  eventType: string;
  actorType: string;
  actorUserId?: string;
  actorEmail?: string;
  title: string;
  detail?: string;
  metadata?: unknown;
  createdAt: string;
};

export type AccessRequestReviewer = {
  id: string;
  reviewerEmail: string;
  reviewerUserId?: string;
  reviewerDisplayName?: string;
  deliveryType: string;
  decision: string;
  comment?: string;
  notifiedAt?: string;
  decidedAt?: string;
};

export type AdminAccessRequestDetail = AdminAccessRequestSummary & {
  deviceInfoText: string;
  purchaseProofAttachments: AccessRequestAttachment[];
  customerNote?: string;
  adminNote?: string;
  reviewSummary?: string;
  rejectionReason?: string;
  publicAccessUrl?: string;
  reviewersList: AccessRequestReviewer[];
  events: AccessRequestEvent[];
};

export type AccessRequestWorkspaceLookups = {
  reviewerCandidates: Array<{ id: string; email: string; displayName: string; role: string }>;
  organizations: Array<{ id: string; slug: string; name: string; status: string }>;
  plans: Array<{ id: string; slug: string; name: string; status: string }>;
};

export type AccessRequestPolicy = {
  internalEmailDomains: string[];
  blockedApplicantEmailDomains: string[];
  defaultTrialDays: number;
  updatedAt?: string;
};

export type AccessRequestWorkspaceResponse = {
  requests: AdminAccessRequestSummary[];
  lookups: AccessRequestWorkspaceLookups;
  policy: AccessRequestPolicy;
};

export type AdminAccessRequestUpdateInput = {
  ownerUserId?: string | null;
  adminNote?: string | null;
  reviewMode?: "any_to_approve" | "all_to_approve" | "minimum_approvals";
  minimumApprovals?: number | null;
  rejectionMode?: "any_to_reject" | "manual_on_conflict";
  requestedPlanId?: string | null;
  approvedPlanId?: string | null;
  reviewers?: Array<{
    reviewerEmail: string;
    reviewerUserId?: string | null;
    deliveryType: "to" | "cc";
  }>;
};

export type AdminAccessRequestProvisionInput = {
  targetMode: "new_organization" | "existing_organization";
  organizationName?: string;
  organizationId?: string;
  membershipType?: "customer_admin" | "customer_member";
  planId?: string;
  startsAt?: string | null;
  expiresAt?: string | null;
  cycleAnchorAt?: string | null;
  completedTurnLimitOverride?: number | null;
  tokenLimitOverride?: number | null;
  note?: string | null;
};

export type ReviewerAccessRequestView = {
  request: AdminAccessRequestDetail;
  viewer: {
    reviewerId: string;
    reviewerEmail: string;
    deliveryType: string;
    decision: string;
  };
};

export type AdminAccessRequestPolicyUpdateInput = {
  internalEmailDomains?: string[];
  blockedApplicantEmailDomains?: string[];
  defaultTrialDays?: number;
};
