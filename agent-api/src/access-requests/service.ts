import { createHash, randomUUID } from "node:crypto";

import type { AuthEmailSender } from "../auth/email.js";
import type { AdminEmailNotificationInput } from "../notifications/admin-email-notification-service.js";
import type {
  AccessRequestAttachmentRecord,
  AccessRequestAttachmentRepository
} from "../persistence/access-request-attachment-repository.js";
import type { AccessRequestEventRecord, AccessRequestEventRepository } from "../persistence/access-request-event-repository.js";
import type { AccessRequestPolicyRepository } from "../persistence/access-request-policy-repository.js";
import type { AccessRequestRecord, AccessRequestRepository } from "../persistence/access-request-repository.js";
import type { AccessRequestReviewerRecord, AccessRequestReviewerRepository } from "../persistence/access-request-reviewer-repository.js";
import type { OrganizationInviteRepository } from "../persistence/organization-invite-repository.js";
import type { OrganizationMembershipRepository } from "../persistence/organization-membership-repository.js";
import type { OrganizationRecord, OrganizationRepository } from "../persistence/organization-repository.js";
import type { SubscriptionGrantRepository } from "../persistence/subscription-grant-repository.js";
import type { SubscriptionPlanRecord, SubscriptionPlanRepository } from "../persistence/subscription-plan-repository.js";
import type { AuthenticatedUser, UserRepositoryLike } from "../persistence/user-repository.js";
import type { PurchaseProofStorage, PurchaseProofUploadFile } from "./purchase-proof-storage.js";
import type { PublicBrandService } from "../public-brands/service.js";

export type AccessRequestStatus =
  | "submitted"
  | "under_review"
  | "needs_info"
  | "review_conflict"
  | "approved_pending_provision"
  | "provisioned"
  | "invited"
  | "activated"
  | "rejected"
  | "closed";

export type AccessRequestReviewMode = "any_to_approve" | "all_to_approve" | "minimum_approvals";
export type AccessRequestRejectionMode = "any_to_reject" | "manual_on_conflict";
export type AccessRequestDecision = "pending" | "approved" | "rejected" | "needs_info";
export type AccessRequestReviewerDeliveryType = "to" | "cc";

export type InternalAccessUser = {
  id: string;
  email: string;
  displayName?: string;
  role: string;
  userType: string;
};

export type AccessRequestActor = {
  actorType: "system" | "applicant" | "reviewer" | "admin";
  actorUserId?: string | null;
  actorEmail?: string | null;
  actorName?: string | null;
};

export type AccessRequestReviewDecisionResult = {
  reviewer: AccessRequestReviewerRecord;
  request: AdminAccessRequestDetail;
};

export type AccessRequestPublicFormInput = {
  publicBrandId?: string | null;
  applicantEmail: string;
  contactName: string;
  companyName: string;
  countryRegion: string;
  deviceInfoText?: string | null;
  purchaseDate?: string | null;
  poNumber?: string | null;
  snNumber: string;
  salesContactEmail: string;
  purchaseProofFiles?: PurchaseProofUploadFile[];
  customerNote?: string;
};

export type AccessRequestAttachmentView = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  contentUrl?: string;
  createdAt: string;
};

export type AccessRequestAdminUpdateInput = {
  ownerUserId?: string | null;
  adminNote?: string | null;
  reviewMode?: AccessRequestReviewMode;
  minimumApprovals?: number | null;
  rejectionMode?: AccessRequestRejectionMode;
  requestedPlanId?: string | null;
  approvedPlanId?: string | null;
  reviewers?: Array<{
    reviewerEmail: string;
    reviewerUserId?: string | null;
    deliveryType: AccessRequestReviewerDeliveryType;
  }>;
};

export type AccessRequestNeedsInfoInput = {
  message: string;
};

export type AccessRequestRejectInput = {
  reason: string;
};

export type AccessRequestProvisionInput = {
  targetMode: "new_organization" | "existing_organization";
  organizationName?: string;
  organizationId?: string;
  membershipType?: string;
  planId?: string;
  startsAt?: string | null;
  expiresAt?: string | null;
  cycleAnchorAt?: string | null;
  completedTurnLimitOverride?: number | null;
  tokenLimitOverride?: number | null;
  note?: string | null;
};

export type AdminAccessRequestSummary = {
  id: string;
  publicBrand: { id: string; key: string; name: string } | null;
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
  reviewers: {
    total: number;
    toCount: number;
    ccCount: number;
    pendingCount: number;
    approvedCount: number;
    rejectedCount: number;
    needsInfoCount: number;
  };
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

export type AdminAccessRequestDetail = AdminAccessRequestSummary & {
  deviceInfoText: string;
  purchaseProofAttachments: AccessRequestAttachmentView[];
  customerNote?: string;
  adminNote?: string;
  reviewSummary?: string;
  rejectionReason?: string;
  publicAccessUrl?: string;
  reviewersList: Array<{
    id: string;
    reviewerEmail: string;
    reviewerUserId?: string;
    reviewerDisplayName?: string;
    deliveryType: string;
    decision: string;
    comment?: string;
    notifiedAt?: string;
    decidedAt?: string;
  }>;
  events: AccessRequestEventRecord[];
};

export type AdminAccessRequestLookups = {
  reviewerCandidates: Array<{ id: string; email: string; displayName: string; role: string }>;
  organizations: Array<{ id: string; slug: string; name: string; status: string }>;
  plans: Array<{ id: string; slug: string; name: string; status: string }>;
};

export type AccessRequestPolicyView = {
  internalEmailDomains: string[];
  blockedApplicantEmailDomains: string[];
  defaultTrialDays: number;
  updatedAt?: string;
};

export type PublicAccessRequestView = {
  id: string;
  status: string;
  requestType: string;
  applicantEmail: string;
  contactName?: string;
  companyName: string;
  countryRegion?: string;
  deviceInfoText: string;
  purchaseProofAttachments: AccessRequestAttachmentView[];
  purchaseDate?: string;
  poNumber: string;
  snNumber?: string;
  salesContactEmail: string;
  customerNote?: string;
  reviewSummary?: string;
  rejectionReason?: string;
  targetOrganization?: { id: string; name: string; slug: string } | null;
  invitedAt?: string;
  activatedAt?: string;
  createdAt: string;
  updatedAt: string;
  needsMoreInfo: boolean;
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

type AccessRequestServiceOptions = {
  requests: AccessRequestRepository;
  attachments: AccessRequestAttachmentRepository;
  purchaseProofStorage: PurchaseProofStorage;
  reviewers: AccessRequestReviewerRepository;
  events: AccessRequestEventRepository;
  users: UserRepositoryLike;
  organizations: OrganizationRepository;
  memberships: OrganizationMembershipRepository;
  invites: OrganizationInviteRepository;
  subscriptionPlans: SubscriptionPlanRepository;
  subscriptionGrants: SubscriptionGrantRepository;
  policies?: AccessRequestPolicyRepository;
  emailSender: AuthEmailSender;
  adminNotifier: {
    notify(input: AdminEmailNotificationInput): Promise<unknown>;
  };
  appBaseUrl?: string;
  publicBrands?: Pick<PublicBrandService, "getById">;
  accessRequestConfig: {
    internalEmailDomains: string[];
    publicEmailBlocklistExtra: string[];
    defaultTrialDays: number;
  };
  findInternalUsers: () => Promise<InternalAccessUser[]>;
};

const PUBLIC_EMAIL_DOMAINS = new Set([
  "126.com",
  "163.com",
  "aliyun.com",
  "aol.com",
  "foxmail.com",
  "gmail.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "msn.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "qq.com",
  "sina.com",
  "sohu.com",
  "yahoo.com",
  "ymail.com"
]);

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeEmail(value: unknown): string | undefined {
  const trimmed = trimOrUndefined(value)?.toLowerCase();
  return trimmed || undefined;
}

function ensureEmail(value: unknown, fieldName: string): string {
  const email = normalizeEmail(value);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`${fieldName} is invalid`);
  }
  return email;
}

function optionalEmail(value: unknown): string | undefined {
  const email = normalizeEmail(value);
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

function emailDomain(email: string): string {
  return email.split("@")[1] || "";
}

function toIsoString(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function toDateOrUndefined(value: string | Date | null | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function issuePublicToken(): string {
  return randomUUID().replace(/-/g, "");
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = trimOrUndefined(value)?.toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeReviewMode(value: unknown): AccessRequestReviewMode {
  const normalized = trimOrUndefined(value);
  if (normalized === "all_to_approve" || normalized === "minimum_approvals") {
    return normalized;
  }
  return "any_to_approve";
}

function normalizeRejectionMode(value: unknown): AccessRequestRejectionMode {
  const normalized = trimOrUndefined(value);
  if (normalized === "manual_on_conflict") {
    return normalized;
  }
  return "any_to_reject";
}

function normalizeDecision(value: unknown): AccessRequestDecision {
  const normalized = trimOrUndefined(value);
  if (normalized === "approved" || normalized === "rejected" || normalized === "needs_info") {
    return normalized;
  }
  return "pending";
}

function reviewerSortValue(deliveryType: string): number {
  return deliveryType === "to" ? 0 : 1;
}

function isInternalReviewerMatch(reviewer: AccessRequestReviewerRecord, user: AuthenticatedUser): boolean {
  const currentEmail = normalizeEmail(user.email);
  return reviewer.reviewerUserId === user.id || (!!currentEmail && reviewer.reviewerEmail === currentEmail);
}

function buildUrl(baseUrl: string | undefined, pathname: string): string | undefined {
  const base = trimOrUndefined(baseUrl);
  if (!base) return undefined;
  return `${base.replace(/\/+$/, "")}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function buildBlockedApplicantEmailDomains(extraBlockedDomains: string[]): string[] {
  return dedupeStrings([...PUBLIC_EMAIL_DOMAINS, ...extraBlockedDomains]);
}

function ensureBusinessEmail(email: string, blockedDomains: string[]): void {
  const domain = emailDomain(email).toLowerCase();
  if (!domain) {
    throw new Error("Applicant email is invalid");
  }
  if (blockedDomains.includes(domain)) {
    throw new Error("Applicant email must be a business email");
  }
}

const OPEN_TRIAL_STATUSES = new Set<AccessRequestStatus>([
  "submitted",
  "under_review",
  "needs_info",
  "review_conflict",
  "approved_pending_provision",
  "provisioned",
  "invited",
  "activated"
]);

const PROVISIONED_TRIAL_STATUSES = new Set<AccessRequestStatus>([
  "approved_pending_provision",
  "provisioned",
  "invited",
  "activated"
]);

const EXTERNAL_REVIEW_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function normalizedTrialFingerprint(value: string | null | undefined): string {
  return trimOrUndefined(value)?.toLowerCase() ?? "";
}

function accessRequestStatus(value: string): AccessRequestStatus {
  return ([
    "submitted",
    "under_review",
    "needs_info",
    "review_conflict",
    "approved_pending_provision",
    "provisioned",
    "invited",
    "activated",
    "rejected",
    "closed"
  ] as string[]).includes(value) ? value as AccessRequestStatus : "submitted";
}

async function ensureTrialNotRepeated(options: {
  requests: AccessRequestRepository;
  applicantEmail: string;
  applicantEmailDomain: string;
  snNumber: string;
}) {
  const applicantEmail = normalizedTrialFingerprint(options.applicantEmail);
  const applicantEmailDomain = normalizedTrialFingerprint(options.applicantEmailDomain);
  const snNumber = normalizedTrialFingerprint(options.snNumber);
  const existingRequests = await options.requests.list();
  const conflict = existingRequests.find((request) => {
    if (request.requestType !== "trial") return false;
    const status = accessRequestStatus(request.status);
    if (!OPEN_TRIAL_STATUSES.has(status)) return false;
    if (normalizedTrialFingerprint(request.applicantEmail) === applicantEmail) return true;
    if (snNumber && normalizedTrialFingerprint(request.snNumber) === snNumber) return true;
    return PROVISIONED_TRIAL_STATUSES.has(status) && normalizedTrialFingerprint(request.applicantEmailDomain) === applicantEmailDomain;
  });
  if (!conflict) return;
  if (normalizedTrialFingerprint(conflict.applicantEmail) === applicantEmail) {
    throw new Error("This business email already has a trial request. Sign in or renew from the Portal instead of opening another trial.");
  }
  if (snNumber && normalizedTrialFingerprint(conflict.snNumber) === snNumber) {
    throw new Error("This device SN already has trial access history. Sign in or renew from the Portal instead of opening another trial.");
  }
  throw new Error("This company domain already has trial access history. Sign in or renew from the Portal instead of opening another trial.");
}

function ensureInternalReviewerEmail(email: string, allowedDomains: string[]): void {
  const domain = emailDomain(email).toLowerCase();
  if (!domain || !allowedDomains.includes(domain)) {
    throw new Error("Reviewer email must use an approved internal or brand domain");
  }
}

function brandReviewerDomains(brand: Awaited<ReturnType<NonNullable<AccessRequestServiceOptions["publicBrands"]>["getById"]>>): string[] {
  if (!brand) return [];
  return dedupeStrings([
    brand.emailFromAddress ? emailDomain(brand.emailFromAddress) : undefined,
    brand.emailReplyTo ? emailDomain(brand.emailReplyTo) : undefined,
    brand.supportEmail ? emailDomain(brand.supportEmail) : undefined,
    brand.billingSupportEmail ? emailDomain(brand.billingSupportEmail) : undefined
  ]);
}

function optionalInternalEmail(value: unknown, allowedDomains: string[]): string | undefined {
  const email = optionalEmail(value);
  if (!email) return undefined;
  return allowedDomains.includes(emailDomain(email).toLowerCase()) ? email : undefined;
}

function maskEmail(email: string): string {
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return email;
  if (localPart.length <= 2) return `${localPart[0] || "*"}***@${domain}`;
  return `${localPart.slice(0, 2)}***@${domain}`;
}

function defaultMembershipType(value: string | null | undefined): string {
  const normalized = trimOrUndefined(value);
  if (normalized === "customer_member" || normalized === "customer_admin") {
    return normalized;
  }
  return "customer_admin";
}

function slugifyOrganizationName(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "customer";
}

async function ensureUniqueOrganizationSlug(repository: OrganizationRepository, baseName: string): Promise<string> {
  const base = slugifyOrganizationName(baseName);
  let candidate = base;
  let sequence = 2;
  while (await repository.getBySlug(candidate)) {
    candidate = `${base}-${sequence}`;
    sequence += 1;
  }
  return candidate;
}

function formatReviewRecipients(reviewers: AccessRequestReviewerRecord[], directory: Map<string, InternalAccessUser>): {
  to: string[];
  cc: string[];
} {
  const to: string[] = [];
  const cc: string[] = [];
  for (const reviewer of [...reviewers].sort((left, right) => reviewerSortValue(left.deliveryType) - reviewerSortValue(right.deliveryType))) {
    const label = reviewer.reviewerUserId ? directory.get(reviewer.reviewerUserId)?.email ?? reviewer.reviewerEmail : reviewer.reviewerEmail;
    if (reviewer.deliveryType === "cc") {
      cc.push(label);
      continue;
    }
    to.push(label);
  }
  return { to: dedupeStrings(to), cc: dedupeStrings(cc) };
}

function summarizeReviewers(reviewers: AccessRequestReviewerRecord[]) {
  const active = reviewers.filter((reviewer) => reviewer.deliveryType === "to");
  return {
    total: reviewers.length,
    toCount: active.length,
    ccCount: reviewers.filter((reviewer) => reviewer.deliveryType === "cc").length,
    pendingCount: active.filter((reviewer) => reviewer.decision === "pending").length,
    approvedCount: active.filter((reviewer) => reviewer.decision === "approved").length,
    rejectedCount: active.filter((reviewer) => reviewer.decision === "rejected").length,
    needsInfoCount: active.filter((reviewer) => reviewer.decision === "needs_info").length
  };
}

function evaluateReviewOutcome(
  request: AccessRequestRecord,
  reviewers: AccessRequestReviewerRecord[]
): { status: AccessRequestStatus; reviewSummary?: string; rejectionReason?: string } {
  const toReviewers = reviewers.filter((reviewer) => reviewer.deliveryType === "to");
  if (!toReviewers.length) {
    return { status: "under_review" };
  }

  const approved = toReviewers.filter((reviewer) => reviewer.decision === "approved");
  const rejected = toReviewers.filter((reviewer) => reviewer.decision === "rejected");
  const needsInfo = toReviewers.filter((reviewer) => reviewer.decision === "needs_info");
  const pending = toReviewers.filter((reviewer) => reviewer.decision === "pending");

  if (needsInfo.length > 0) {
    return {
      status: "needs_info",
      reviewSummary: "Reviewer requested more information."
    };
  }

  const reviewMode = normalizeReviewMode(request.reviewMode);
  const rejectionMode = normalizeRejectionMode(request.rejectionMode);

  if (rejected.length > 0) {
    if (rejectionMode === "manual_on_conflict" && approved.length > 0) {
      return {
        status: "review_conflict",
        reviewSummary: "Review decisions are in conflict and require admin resolution."
      };
    }
    if (rejectionMode === "any_to_reject" || approved.length === 0) {
      return {
        status: "rejected",
        rejectionReason: rejected.map((reviewer) => reviewer.comment).filter(Boolean).join("\n") || "Rejected by reviewer."
      };
    }
  }

  if (reviewMode === "all_to_approve") {
    if (!pending.length && approved.length === toReviewers.length) {
      return {
        status: "approved_pending_provision",
        reviewSummary: "All required reviewers approved the request."
      };
    }
    return { status: "under_review" };
  }

  if (reviewMode === "minimum_approvals") {
    const minimum = Math.max(1, request.minimumApprovals ?? 1);
    if (approved.length >= minimum) {
      return {
        status: "approved_pending_provision",
        reviewSummary: `Reached ${approved.length} approvals.`
      };
    }
    return { status: "under_review" };
  }

  if (approved.length > 0) {
    return {
      status: "approved_pending_provision",
      reviewSummary: "At least one required reviewer approved the request."
    };
  }

  return { status: "under_review" };
}

async function resolveRelatedUsers(
  users: UserRepositoryLike,
  ids: string[]
): Promise<Map<string, AuthenticatedUser>> {
  const map = new Map<string, AuthenticatedUser>();
  for (const id of ids) {
    const normalized = trimOrUndefined(id);
    if (!normalized || map.has(normalized)) continue;
    const user = await users.getById(normalized);
    if (user) {
      map.set(normalized, user);
    }
  }
  return map;
}

async function resolvePlanMap(
  plansRepository: SubscriptionPlanRepository,
  planIds: string[]
): Promise<Map<string, SubscriptionPlanRecord>> {
  const normalized = new Set(planIds.map((id) => trimOrUndefined(id)).filter(Boolean) as string[]);
  if (!normalized.size) {
    return new Map();
  }
  const plans = await plansRepository.list();
  return new Map(plans.filter((plan) => normalized.has(plan.id)).map((plan) => [plan.id, plan] as const));
}

async function resolveOrganizationMap(
  organizationsRepository: OrganizationRepository,
  organizationIds: string[]
): Promise<Map<string, OrganizationRecord>> {
  const normalized = [...new Set(organizationIds.map((id) => trimOrUndefined(id)).filter(Boolean) as string[])];
  if (!normalized.length) {
    return new Map();
  }
  const organizations = await organizationsRepository.listByIds(normalized);
  return new Map(organizations.map((organization) => [organization.id, organization] as const));
}

function requestToPublicView(
  request: AccessRequestRecord,
  organization: OrganizationRecord | null,
  purchaseProofAttachments: AccessRequestAttachmentView[] = []
): PublicAccessRequestView {
  return {
    id: request.id,
    status: request.status,
    requestType: request.requestType,
    applicantEmail: request.applicantEmail,
    contactName: request.contactName,
    companyName: request.companyName,
    countryRegion: request.countryRegion,
    deviceInfoText: request.deviceInfoText,
    purchaseProofAttachments,
    purchaseDate: request.purchaseDate,
    poNumber: request.poNumber,
    snNumber: request.snNumber,
    salesContactEmail: request.salesContactEmail,
    customerNote: request.customerNote,
    reviewSummary: request.reviewSummary,
    rejectionReason: request.rejectionReason,
    targetOrganization: organization
      ? {
          id: organization.id,
          name: organization.name,
          slug: organization.slug
        }
      : null,
    invitedAt: request.invitedAt,
    activatedAt: request.activatedAt,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    needsMoreInfo: request.status === "needs_info"
  };
}

function attachmentToView(
  attachment: AccessRequestAttachmentRecord,
  contentUrl?: string
): AccessRequestAttachmentView {
  return {
    id: attachment.id,
    name: attachment.originalName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    contentUrl,
    createdAt: attachment.createdAt
  };
}

export function createAccessRequestService(options: AccessRequestServiceOptions) {
  async function requestBrand(request: Pick<AccessRequestRecord, "publicBrandId">) {
    return options.publicBrands?.getById(request.publicBrandId);
  }

  async function requestBaseUrl(request: Pick<AccessRequestRecord, "publicBrandId">): Promise<string | undefined> {
    return trimOrUndefined((await requestBrand(request))?.primaryBaseUrl) ?? trimOrUndefined(options.appBaseUrl);
  }

  async function requestEmailEnvelope(request: Pick<AccessRequestRecord, "publicBrandId">) {
    const brand = await requestBrand(request);
    if (!brand) return {};
    if (!brand.emailSenderVerified || !trimOrUndefined(brand.emailFromAddress)) {
      throw new Error(`${brand.platformName} email delivery is not ready`);
    }
    return {
      publicBrandId: brand.id,
      from: `${brand.emailFromName} <${brand.emailFromAddress}>`,
      replyTo: trimOrUndefined(brand.emailReplyTo) ?? trimOrUndefined(brand.supportEmail)
    };
  }

  function ensurePublicBrandMatch(request: Pick<AccessRequestRecord, "publicBrandId">, publicBrandId?: string | null) {
    if (trimOrUndefined(request.publicBrandId) !== trimOrUndefined(publicBrandId ?? undefined)) {
      throw new Error("Access request does not exist");
    }
  }
  async function listPurchaseProofViews(
    request: AccessRequestRecord,
    route: "admin" | "public" | "reviewer"
  ): Promise<AccessRequestAttachmentView[]> {
    const attachments = await options.attachments.listForRequest(request.id, "purchase_proof");
    return attachments.map((attachment) => {
      const contentUrl =
        route === "admin"
          ? `/api/admin/access-requests/${encodeURIComponent(request.id)}/proofs/${encodeURIComponent(attachment.id)}/content`
          : route === "reviewer"
            ? `/api/access-requests-review/${encodeURIComponent(request.id)}/proofs/${encodeURIComponent(attachment.id)}/content`
            : `/public-api/access-requests/${encodeURIComponent(request.publicToken)}/proofs/${encodeURIComponent(attachment.id)}/content`;
      return attachmentToView(attachment, contentUrl);
    });
  }

  async function buildPublicView(
    request: AccessRequestRecord,
    organization: OrganizationRecord | null
  ): Promise<PublicAccessRequestView> {
    return requestToPublicView(request, organization, await listPurchaseProofViews(request, "public"));
  }

  async function savePurchaseProofFiles(
    requestId: string,
    files: PurchaseProofUploadFile[] | undefined
  ): Promise<AccessRequestAttachmentRecord[]> {
    const validFiles = (files ?? []).filter((file) => file.sizeBytes > 0 && file.buffer.length > 0);
    if (!validFiles.length) return [];
    const storedFiles = await options.purchaseProofStorage.saveFiles(requestId, validFiles);
    return options.attachments.createMany(
      storedFiles.map((file) => ({
        accessRequestId: requestId,
        kind: "purchase_proof",
        originalName: file.originalName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        storagePath: file.storagePath
      }))
    );
  }

  async function readAttachmentFile(request: AccessRequestRecord, attachmentId: string): Promise<{
    attachment: AccessRequestAttachmentRecord;
    content: Buffer;
  }> {
    const attachment = await options.attachments.getById(attachmentId);
    if (!attachment || attachment.accessRequestId !== request.id) {
      throw new Error("Purchase proof file does not exist");
    }
    return {
      attachment,
      content: await options.purchaseProofStorage.readFile(attachment.storagePath)
    };
  }

  async function loadPolicy(): Promise<AccessRequestPolicyView> {
    const fallback = {
      internalEmailDomains: options.accessRequestConfig.internalEmailDomains,
      blockedApplicantEmailDomains: buildBlockedApplicantEmailDomains(options.accessRequestConfig.publicEmailBlocklistExtra),
      defaultTrialDays: options.accessRequestConfig.defaultTrialDays
    };
    if (!options.policies) {
      return fallback;
    }
    const policy = await options.policies.getOrCreate(fallback);
    return {
      internalEmailDomains: policy.internalEmailDomains,
      blockedApplicantEmailDomains: policy.blockedApplicantEmailDomains,
      defaultTrialDays: policy.defaultTrialDays,
      updatedAt: policy.updatedAt
    };
  }

  async function addEvent(
    accessRequestId: string,
    eventType: string,
    actor: AccessRequestActor,
    title: string,
    detail?: string,
    metadata?: unknown
  ): Promise<AccessRequestEventRecord> {
    return options.events.create({
      accessRequestId,
      eventType,
      actorType: actor.actorType,
      actorUserId: actor.actorUserId ?? null,
      actorEmail: actor.actorEmail ?? null,
      title,
      detail: detail ?? null,
      metadata
    });
  }

  async function loadInternalDirectory(): Promise<Map<string, InternalAccessUser>> {
    const users = await options.findInternalUsers();
    return new Map(users.map((user) => [user.id, user] as const));
  }

  async function notifyAdmins(
    request: AccessRequestRecord,
    event: AdminEmailNotificationInput["event"],
    variables: AdminEmailNotificationInput["variables"],
    dedupeKey?: string
  ): Promise<void> {
    const [internalUsers, policy] = await Promise.all([options.findInternalUsers(), loadPolicy()]);
    const ownerEmail = request.ownerUserId ? internalUsers.find((user) => user.id === request.ownerUserId)?.email : undefined;
    await options.adminNotifier.notify({
      event,
      accessRequestId: request.id,
      organizationId: request.targetOrganizationId,
      ownerEmail,
      salesContactEmail: optionalInternalEmail(request.salesContactEmail, policy.internalEmailDomains),
      variables,
      envelope: await requestEmailEnvelope(request),
      dedupeKey: dedupeKey ?? request.updatedAt
    });
  }

  async function ensureRequestExists(requestId: string): Promise<AccessRequestRecord> {
    const request = await options.requests.getById(requestId);
    if (!request) {
      throw new Error("Access request does not exist");
    }
    return request;
  }

  async function reviewerFromToken(rawToken: string, requestId?: string): Promise<AccessRequestReviewerRecord> {
    const normalized = trimOrUndefined(rawToken);
    if (!normalized) throw new Error("Review link is invalid or expired");
    const reviewer = await options.reviewers.getByReviewTokenHash(hashToken(normalized));
    const expiresAt = toDateOrUndefined(reviewer?.reviewTokenExpiresAt);
    if (
      !reviewer ||
      reviewer.deliveryType !== "to" ||
      !expiresAt ||
      expiresAt.getTime() <= Date.now() ||
      (requestId && reviewer.accessRequestId !== requestId)
    ) {
      throw new Error("Review link is invalid or expired");
    }
    return reviewer;
  }

  async function submitDecisionForReviewer(
    request: AccessRequestRecord,
    reviewer: AccessRequestReviewerRecord,
    actor: AccessRequestActor,
    input: { decision: AccessRequestDecision; comment?: string | null },
    reviewToken?: string
  ): Promise<AccessRequestReviewDecisionResult> {
    const updatedReviewer = await options.reviewers.decide({
      reviewerId: reviewer.id,
      decision: normalizeDecision(input.decision),
      comment: trimOrUndefined(input.comment ?? undefined) ?? null
    });
    const nextReviewers = await options.reviewers.listForRequest(request.id);
    const outcome = evaluateReviewOutcome(request, nextReviewers);
    const nextRequest = await options.requests.update(request.id, {
      status: outcome.status,
      reviewSummary: outcome.reviewSummary === undefined ? undefined : outcome.reviewSummary,
      rejectionReason: outcome.rejectionReason === undefined ? undefined : outcome.rejectionReason,
      approvedAt: outcome.status === "approved_pending_provision" ? new Date() : undefined,
      rejectedAt: outcome.status === "rejected" ? new Date() : undefined
    });
    await addEvent(
      nextRequest.id,
      "review_decision",
      actor,
      `Reviewer marked ${updatedReviewer.decision}`,
      updatedReviewer.comment
    );
    await notifyAdmins(
      nextRequest,
      "access_request.review_decision",
      {
        company_name: nextRequest.companyName,
        reviewer_name: actor.actorName ?? actor.actorEmail ?? reviewer.reviewerEmail,
        reviewer_decision: updatedReviewer.decision,
        reviewer_comment: updatedReviewer.comment,
        current_status: nextRequest.status
      },
      `${nextRequest.updatedAt}:${updatedReviewer.id}`
    );
    return {
      reviewer: updatedReviewer,
      request: reviewToken
        ? await buildExternalReviewerDetail(nextRequest, updatedReviewer, reviewToken)
        : await buildAdminDetail(nextRequest, "reviewer")
    };
  }

  async function buildAdminDetail(
    request: AccessRequestRecord,
    attachmentRoute: "admin" | "reviewer" = "admin",
    reviewToken?: string
  ): Promise<AdminAccessRequestDetail> {
    const [reviewers, events, ownerMap, orgMap, planMap, directory, purchaseProofAttachments, brand] = await Promise.all([
      options.reviewers.listForRequest(request.id),
      options.events.listForRequest(request.id),
      resolveRelatedUsers(options.users, [request.ownerUserId ?? "", request.targetUserId ?? ""]),
      resolveOrganizationMap(options.organizations, [request.targetOrganizationId ?? ""]),
      resolvePlanMap(options.subscriptionPlans, [request.requestedPlanId ?? "", request.approvedPlanId ?? ""]),
      loadInternalDirectory(),
      listPurchaseProofViews(request, attachmentRoute),
      requestBrand(request)
    ]);

    const owner = request.ownerUserId ? ownerMap.get(request.ownerUserId) ?? null : null;
    const targetOrganization = request.targetOrganizationId ? orgMap.get(request.targetOrganizationId) ?? null : null;
    const requestedPlan = request.requestedPlanId ? planMap.get(request.requestedPlanId) ?? null : null;
    const approvedPlan = request.approvedPlanId ? planMap.get(request.approvedPlanId) ?? null : null;

    return {
      id: request.id,
      publicBrand: brand ? { id: brand.id, key: brand.key, name: brand.name } : null,
      requestType: request.requestType,
      commercialIntent: request.commercialIntent,
      status: request.status,
      applicantEmail: request.applicantEmail,
      contactName: request.contactName,
      companyName: request.companyName,
      countryRegion: request.countryRegion,
      salesContactEmail: request.salesContactEmail,
      poNumber: request.poNumber,
      snNumber: request.snNumber,
      purchaseDate: request.purchaseDate,
      owner: owner
        ? {
            id: owner.id,
            displayName: owner.displayName ?? owner.email ?? owner.id,
            email: owner.email ?? ""
          }
        : null,
      requestedPlan: requestedPlan
        ? {
            id: requestedPlan.id,
            name: requestedPlan.name,
            slug: requestedPlan.slug
          }
        : null,
      approvedPlan: approvedPlan
        ? {
            id: approvedPlan.id,
            name: approvedPlan.name,
            slug: approvedPlan.slug
          }
        : null,
      targetOrganization: targetOrganization
        ? {
            id: targetOrganization.id,
            name: targetOrganization.name,
            slug: targetOrganization.slug,
            status: targetOrganization.status
          }
        : null,
      reviewers: summarizeReviewers(reviewers),
      reviewMode: request.reviewMode,
      minimumApprovals: request.minimumApprovals,
      rejectionMode: request.rejectionMode,
      reviewRequestedAt: request.reviewRequestedAt,
      approvedAt: request.approvedAt,
      rejectedAt: request.rejectedAt,
      provisionedAt: request.provisionedAt,
      invitedAt: request.invitedAt,
      activatedAt: request.activatedAt,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      deviceInfoText: request.deviceInfoText,
      purchaseProofAttachments: reviewToken
        ? purchaseProofAttachments.map((attachment) => ({
            ...attachment,
            contentUrl: attachment.contentUrl
              ? `${attachment.contentUrl.replace(
                  "/api/access-requests-review/",
                  "/public-api/access-request-reviews/"
                )}?token=${encodeURIComponent(reviewToken)}`
              : attachment.contentUrl
          }))
        : purchaseProofAttachments,
      customerNote: request.customerNote,
      adminNote: request.adminNote,
      reviewSummary: request.reviewSummary,
      rejectionReason: request.rejectionReason,
      publicAccessUrl: buildUrl(await requestBaseUrl(request), `/access/apply/${request.publicToken}`),
      reviewersList: reviewers.map((reviewer) => ({
        id: reviewer.id,
        reviewerEmail: reviewer.reviewerEmail,
        reviewerUserId: reviewer.reviewerUserId,
        reviewerDisplayName:
          (reviewer.reviewerUserId ? directory.get(reviewer.reviewerUserId)?.displayName : undefined) ??
          (reviewer.reviewerUserId ? directory.get(reviewer.reviewerUserId)?.email : undefined) ??
          undefined,
        deliveryType: reviewer.deliveryType,
        decision: reviewer.decision,
        comment: reviewer.comment,
        notifiedAt: reviewer.notifiedAt,
        decidedAt: reviewer.decidedAt
      })),
      events
    };
  }

  async function buildExternalReviewerDetail(
    request: AccessRequestRecord,
    reviewer: AccessRequestReviewerRecord,
    reviewToken: string
  ): Promise<AdminAccessRequestDetail> {
    const detail = await buildAdminDetail(request, "reviewer", reviewToken);
    return {
      ...detail,
      owner: null,
      adminNote: undefined,
      publicAccessUrl: undefined,
      events: [],
      reviewersList: detail.reviewersList.filter((item) => item.id === reviewer.id)
    };
  }

  async function buildAdminSummary(
    request: AccessRequestRecord,
    reviewers: AccessRequestReviewerRecord[],
    ownerMap: Map<string, AuthenticatedUser>,
    orgMap: Map<string, OrganizationRecord>,
    planMap: Map<string, SubscriptionPlanRecord>
  ): Promise<AdminAccessRequestSummary> {
    const owner = request.ownerUserId ? ownerMap.get(request.ownerUserId) ?? null : null;
    const targetOrganization = request.targetOrganizationId ? orgMap.get(request.targetOrganizationId) ?? null : null;
    const requestedPlan = request.requestedPlanId ? planMap.get(request.requestedPlanId) ?? null : null;
    const approvedPlan = request.approvedPlanId ? planMap.get(request.approvedPlanId) ?? null : null;
    const brand = await requestBrand(request);
    return {
      id: request.id,
      publicBrand: brand ? { id: brand.id, key: brand.key, name: brand.name } : null,
      requestType: request.requestType,
      commercialIntent: request.commercialIntent,
      status: request.status,
      applicantEmail: request.applicantEmail,
      contactName: request.contactName,
      companyName: request.companyName,
      countryRegion: request.countryRegion,
      salesContactEmail: request.salesContactEmail,
      poNumber: request.poNumber,
      snNumber: request.snNumber,
      purchaseDate: request.purchaseDate,
      owner: owner
        ? {
            id: owner.id,
            displayName: owner.displayName ?? owner.email ?? owner.id,
            email: owner.email ?? ""
          }
        : null,
      requestedPlan: requestedPlan
        ? {
            id: requestedPlan.id,
            name: requestedPlan.name,
            slug: requestedPlan.slug
          }
        : null,
      approvedPlan: approvedPlan
        ? {
            id: approvedPlan.id,
            name: approvedPlan.name,
            slug: approvedPlan.slug
          }
        : null,
      targetOrganization: targetOrganization
        ? {
            id: targetOrganization.id,
            name: targetOrganization.name,
            slug: targetOrganization.slug,
            status: targetOrganization.status
          }
        : null,
      reviewers: summarizeReviewers(reviewers),
      reviewMode: request.reviewMode,
      minimumApprovals: request.minimumApprovals,
      rejectionMode: request.rejectionMode,
      reviewRequestedAt: request.reviewRequestedAt,
      approvedAt: request.approvedAt,
      rejectedAt: request.rejectedAt,
      provisionedAt: request.provisionedAt,
      invitedAt: request.invitedAt,
      activatedAt: request.activatedAt,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt
    };
  }

  return {
    async submitPublicRequest(input: AccessRequestPublicFormInput): Promise<{ request: PublicAccessRequestView; publicToken: string }> {
      const applicantEmail = ensureEmail(input.applicantEmail, "Applicant email");
      const policy = await loadPolicy();
      ensureBusinessEmail(applicantEmail, policy.blockedApplicantEmailDomains);

      const contactName = trimOrUndefined(input.contactName);
      const companyName = trimOrUndefined(input.companyName);
      const countryRegion = trimOrUndefined(input.countryRegion);
      const salesContact = trimOrUndefined(input.salesContactEmail);
      const purchaseProofFiles = input.purchaseProofFiles ?? [];
      const deviceInfoText =
        trimOrUndefined(input.deviceInfoText) ??
        trimOrUndefined(purchaseProofFiles.map((file) => file.originalName.trim()).filter(Boolean).join("\n")) ??
        "Uploaded purchase proof";
      const purchaseDate = toDateOrUndefined(input.purchaseDate);
      const poNumber = trimOrUndefined(input.poNumber) ?? "";
      const snNumber = trimOrUndefined(input.snNumber);
      if (!contactName || !companyName || !countryRegion || !salesContact || !snNumber) {
        throw new Error("Contact name, company, country, sales contact, and at least one device SN are required");
      }
      if (!purchaseProofFiles.length) {
        throw new Error("Purchase proof file is required");
      }
      await ensureTrialNotRepeated({
        requests: options.requests,
        applicantEmail,
        applicantEmailDomain: emailDomain(applicantEmail),
        snNumber
      });

      const rawToken = issuePublicToken();
      const request = await options.requests.create({
        publicBrandId: input.publicBrandId ?? null,
        requestType: "trial",
        commercialIntent: "trial",
        status: "submitted",
        applicantEmail,
        applicantEmailDomain: emailDomain(applicantEmail),
        contactName,
        companyName,
        countryRegion,
        deviceInfoText,
        purchaseDate: purchaseDate ?? null,
        poNumber,
        snNumber,
        salesContactEmail: salesContact,
        customerNote: trimOrUndefined(input.customerNote) ?? null,
        reviewMode: "any_to_approve",
        rejectionMode: "any_to_reject",
        publicToken: rawToken,
        lastSubmittedAt: new Date()
      });
      await savePurchaseProofFiles(request.id, purchaseProofFiles);
      const salesContactReviewerEmail = optionalInternalEmail(salesContact, policy.internalEmailDomains);
      if (salesContactReviewerEmail) {
        await options.reviewers.replaceForRequest(request.id, [
          {
            reviewerEmail: salesContactReviewerEmail,
            deliveryType: "to",
            decision: "pending"
          }
        ]);
      }
      await addEvent(
        request.id,
        "submitted",
        { actorType: "applicant", actorEmail: applicantEmail },
        "Access request submitted",
        `${companyName} submitted a trial access request.`
      );

      const publicLink = buildUrl(await requestBaseUrl(request), `/access/apply/${rawToken}`);
      await options.emailSender.send({
        to: applicantEmail,
        ...await requestEmailEnvelope(request),
        subject: `We received your access request for ${companyName}`,
        text: [
          `We received your access request for ${companyName}.`,
          `Applicant: ${applicantEmail}`,
          publicLink ? `Track this request: ${publicLink}` : undefined,
          "We will review it and contact you after approval."
        ]
          .filter(Boolean)
          .join("\n"),
        debugLabel: "access-request-applicant-submitted"
      });

      await notifyAdmins(
        request,
        "access_request.submitted",
        {
          company_name: companyName,
          applicant_email: applicantEmail,
          sn_number: snNumber,
          sales_contact_email: salesContact,
          po_line: poNumber ? `PO: ${poNumber}` : "",
          public_link_line: publicLink ? `Public view: ${publicLink}` : ""
        }
      );

      return {
        request: await buildPublicView(request, null),
        publicToken: rawToken
      };
    },

    async getPublicRequestByToken(rawToken: string, publicBrandId?: string | null): Promise<PublicAccessRequestView> {
      const request = await options.requests.getByPublicToken(rawToken);
      if (!request) {
        throw new Error("Access request does not exist");
      }
      ensurePublicBrandMatch(request, publicBrandId);
      const targetOrganization = request.targetOrganizationId
        ? (await options.organizations.getById(request.targetOrganizationId)) ?? null
        : null;
      return buildPublicView(request, targetOrganization);
    },

    async getPublicPurchaseProofFile(rawToken: string, attachmentId: string, publicBrandId?: string | null): Promise<{
      attachment: AccessRequestAttachmentRecord;
      content: Buffer;
    }> {
      const request = await options.requests.getByPublicToken(rawToken);
      if (!request) {
        throw new Error("Access request does not exist");
      }
      ensurePublicBrandMatch(request, publicBrandId);
      return readAttachmentFile(request, attachmentId);
    },

    async resubmitPublicRequest(rawToken: string, input: AccessRequestPublicFormInput): Promise<PublicAccessRequestView> {
      const existing = await options.requests.getByPublicToken(rawToken);
      if (!existing) {
        throw new Error("Access request does not exist");
      }
      ensurePublicBrandMatch(existing, input.publicBrandId);
      if (existing.status !== "needs_info") {
        throw new Error("This request is not waiting for more information");
      }

      const applicantEmail = ensureEmail(input.applicantEmail, "Applicant email");
      const policy = await loadPolicy();
      ensureBusinessEmail(applicantEmail, policy.blockedApplicantEmailDomains);
      const contactName = trimOrUndefined(input.contactName);
      const countryRegion = trimOrUndefined(input.countryRegion);
      const salesContact = trimOrUndefined(input.salesContactEmail);
      const purchaseProofFiles = input.purchaseProofFiles ?? [];
      const existingProofs = await options.attachments.listForRequest(existing.id, "purchase_proof");
      const deviceInfoText =
        trimOrUndefined(input.deviceInfoText) ??
        (purchaseProofFiles.length
          ? trimOrUndefined(purchaseProofFiles.map((file) => file.originalName.trim()).filter(Boolean).join("\n")) ??
            "Uploaded purchase proof"
          : existing.deviceInfoText);
      const purchaseDate = toDateOrUndefined(input.purchaseDate);
      const poNumber = trimOrUndefined(input.poNumber) ?? "";
      const snNumber = trimOrUndefined(input.snNumber);
      if (!contactName || !countryRegion || !salesContact || !snNumber) {
        throw new Error("Contact name, country, sales contact, and at least one device SN are required");
      }
      if (!purchaseProofFiles.length && !existingProofs.length) {
        throw new Error("Purchase proof file is required");
      }

      const updated = await options.requests.update(existing.id, {
        status: "submitted",
        applicantEmail,
        applicantEmailDomain: emailDomain(applicantEmail),
        contactName,
        companyName: trimOrUndefined(input.companyName) ?? existing.companyName,
        countryRegion,
        deviceInfoText,
        purchaseDate: purchaseDate ?? null,
        poNumber,
        snNumber,
        salesContactEmail: salesContact,
        customerNote: trimOrUndefined(input.customerNote) ?? null,
        reviewSummary: null,
        rejectionReason: null,
        lastSubmittedAt: new Date()
      });
      await savePurchaseProofFiles(updated.id, purchaseProofFiles);
      await options.reviewers.resetDecisions(updated.id);
      await addEvent(
        updated.id,
        "resubmitted",
        { actorType: "applicant", actorEmail: applicantEmail },
        "Applicant resubmitted request",
        "Applicant provided more information and resubmitted the request."
      );
      await notifyAdmins(
        updated,
        "access_request.resubmitted",
        {
          company_name: updated.companyName,
          applicant_email: updated.applicantEmail,
          sn_number: updated.snNumber ?? "—",
          sales_contact_email: updated.salesContactEmail
        }
      );
      const targetOrganization = updated.targetOrganizationId
        ? (await options.organizations.getById(updated.targetOrganizationId)) ?? null
        : null;
      return buildPublicView(updated, targetOrganization);
    },

    async listAdminWorkspace(input?: { status?: string; query?: string }): Promise<{
      requests: AdminAccessRequestSummary[];
      lookups: AdminAccessRequestLookups;
      policy: AccessRequestPolicyView;
    }> {
      const [requests, internalUsers, plans, organizations, policy] = await Promise.all([
        options.requests.list({ status: trimOrUndefined(input?.status) }),
        options.findInternalUsers(),
        options.subscriptionPlans.list(),
        options.organizations.list({ type: "customer" }),
        loadPolicy()
      ]);
      const filtered = trimOrUndefined(input?.query)
        ? requests.filter((request) => {
            const query = input!.query!.trim().toLowerCase();
            return [request.applicantEmail, request.companyName, request.salesContactEmail, request.poNumber, request.snNumber]
              .join("\n")
              .toLowerCase()
              .includes(query);
          })
        : requests;

      const reviewers = await options.reviewers.listForRequests(filtered.map((request) => request.id));
      const reviewersByRequestId = new Map<string, AccessRequestReviewerRecord[]>();
      for (const reviewer of reviewers) {
        const bucket = reviewersByRequestId.get(reviewer.accessRequestId) ?? [];
        bucket.push(reviewer);
        reviewersByRequestId.set(reviewer.accessRequestId, bucket);
      }
      const ownerIds = filtered.map((request) => request.ownerUserId ?? "").filter(Boolean) as string[];
      const ownerMap = await resolveRelatedUsers(options.users, ownerIds);
      const orgMap = await resolveOrganizationMap(options.organizations, filtered.map((request) => request.targetOrganizationId ?? ""));
      const planMap = await resolvePlanMap(
        options.subscriptionPlans,
        filtered.flatMap((request) => [request.requestedPlanId ?? "", request.approvedPlanId ?? ""])
      );

      return {
        requests: await Promise.all(
          filtered.map((request) =>
            buildAdminSummary(request, reviewersByRequestId.get(request.id) ?? [], ownerMap, orgMap, planMap)
          )
        ),
        lookups: {
          reviewerCandidates: internalUsers
            .filter((user) => user.email)
            .map((user) => ({
              id: user.id,
              email: user.email,
              displayName: user.displayName ?? user.email,
              role: user.role
            }))
            .sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-CN")),
          organizations: organizations
            .filter((organization) => organization.status === "active")
            .map((organization) => ({
              id: organization.id,
              slug: organization.slug,
              name: organization.name,
              status: organization.status
            })),
          plans: plans
            .filter((plan) => plan.status === "active")
            .map((plan) => ({
              id: plan.id,
              slug: plan.slug,
              name: plan.name,
              status: plan.status
            }))
        },
        policy
      };
    },

    async getPolicy(): Promise<AccessRequestPolicyView> {
      return loadPolicy();
    },

    async updatePolicy(
      input: {
        internalEmailDomains?: string[];
        blockedApplicantEmailDomains?: string[];
        publicEmailBlocklistExtra?: string[];
        defaultTrialDays?: number;
      },
      _actor: AccessRequestActor
    ): Promise<AccessRequestPolicyView> {
      const fallback = {
        internalEmailDomains: options.accessRequestConfig.internalEmailDomains,
        blockedApplicantEmailDomains: buildBlockedApplicantEmailDomains(options.accessRequestConfig.publicEmailBlocklistExtra),
        defaultTrialDays: options.accessRequestConfig.defaultTrialDays
      };
      if (!options.policies) {
        const blockedApplicantEmailDomains = input.blockedApplicantEmailDomains ?? input.publicEmailBlocklistExtra;
        return {
          internalEmailDomains: input.internalEmailDomains ?? fallback.internalEmailDomains,
          blockedApplicantEmailDomains: blockedApplicantEmailDomains ?? fallback.blockedApplicantEmailDomains,
          defaultTrialDays: input.defaultTrialDays ?? fallback.defaultTrialDays
        };
      }
      const updated = await options.policies.update(
        {
          internalEmailDomains: input.internalEmailDomains,
          blockedApplicantEmailDomains: input.blockedApplicantEmailDomains ?? input.publicEmailBlocklistExtra,
          defaultTrialDays: input.defaultTrialDays
        },
        fallback
      );
      return {
        internalEmailDomains: updated.internalEmailDomains,
        blockedApplicantEmailDomains: updated.blockedApplicantEmailDomains,
        defaultTrialDays: updated.defaultTrialDays,
        updatedAt: updated.updatedAt
      };
    },

    async getAdminRequestDetail(requestId: string): Promise<AdminAccessRequestDetail> {
      const request = await ensureRequestExists(requestId);
      return buildAdminDetail(request);
    },

    async getAdminPurchaseProofFile(requestId: string, attachmentId: string): Promise<{
      attachment: AccessRequestAttachmentRecord;
      content: Buffer;
    }> {
      const request = await ensureRequestExists(requestId);
      return readAttachmentFile(request, attachmentId);
    },

    async updateAdminRequest(requestId: string, input: AccessRequestAdminUpdateInput, actor: AccessRequestActor): Promise<AdminAccessRequestDetail> {
      const existing = await ensureRequestExists(requestId);
      const policy = await loadPolicy();
      const brand = await requestBrand(existing);
      const allowedReviewerDomains = dedupeStrings([
        ...policy.internalEmailDomains,
        ...brandReviewerDomains(brand)
      ]);
      const internalUsers = await options.findInternalUsers();
      const internalUserByEmail = new Map(internalUsers.map((user) => [user.email.toLowerCase(), user] as const));
      const reviewers = (input.reviewers ?? []).map((reviewer) => {
        const reviewerEmail = ensureEmail(reviewer.reviewerEmail, "Reviewer email");
        ensureInternalReviewerEmail(reviewerEmail, allowedReviewerDomains);
        const matchedUser = reviewer.reviewerUserId
          ? internalUsers.find((user) => user.id === reviewer.reviewerUserId)
          : internalUserByEmail.get(reviewerEmail);
        return {
          reviewerEmail,
          reviewerUserId: matchedUser?.id ?? null,
          deliveryType: reviewer.deliveryType === "cc" ? "cc" : "to",
          decision: "pending"
        };
      });

      const updated = await options.requests.update(existing.id, {
        ownerUserId: input.ownerUserId === undefined ? undefined : trimOrUndefined(input.ownerUserId ?? undefined) ?? null,
        adminNote: input.adminNote === undefined ? undefined : trimOrUndefined(input.adminNote ?? undefined) ?? null,
        reviewMode: input.reviewMode === undefined ? undefined : normalizeReviewMode(input.reviewMode),
        minimumApprovals:
          input.minimumApprovals === undefined ? undefined : input.minimumApprovals === null ? null : input.minimumApprovals,
        rejectionMode: input.rejectionMode === undefined ? undefined : normalizeRejectionMode(input.rejectionMode),
        requestedPlanId:
          input.requestedPlanId === undefined ? undefined : trimOrUndefined(input.requestedPlanId ?? undefined) ?? null,
        approvedPlanId:
          input.approvedPlanId === undefined ? undefined : trimOrUndefined(input.approvedPlanId ?? undefined) ?? null
      });

      if (input.reviewers) {
        await options.reviewers.replaceForRequest(existing.id, reviewers);
      }

      await addEvent(
        updated.id,
        "updated",
        actor,
        "Request settings updated",
        "Admin updated owner, review routing, or plan settings."
      );
      return buildAdminDetail(updated);
    },

    async sendReviewRequest(requestId: string, actor: AccessRequestActor): Promise<AdminAccessRequestDetail> {
      const request = await ensureRequestExists(requestId);
      const reviewers = await options.reviewers.listForRequest(request.id);
      const directory = await loadInternalDirectory();
      const recipients = formatReviewRecipients(reviewers, directory);
      if (!recipients.to.length) {
        throw new Error("At least one primary reviewer is required");
      }

      const updated = await options.requests.update(request.id, {
        status: "under_review",
        reviewRequestedAt: new Date(),
        reviewSummary: null,
        rejectionReason: null
      });
      await options.reviewers.resetDecisions(request.id);
      const emailEnvelope = await requestEmailEnvelope(updated);
      const reviewLines = [
        `${updated.companyName} submitted an access request.`,
        `Applicant: ${updated.applicantEmail}`,
        `SN: ${updated.snNumber ?? "—"}`,
        `Sales contact: ${updated.salesContactEmail}`,
        updated.poNumber ? `PO: ${updated.poNumber}` : undefined
      ].filter(Boolean);
      const externalPrimaryReviewers = reviewers.filter(
        (reviewer) => reviewer.deliveryType === "to" && !reviewer.reviewerUserId
      );
      const internalPrimaryEmails = reviewers
        .filter((reviewer) => reviewer.deliveryType === "to" && reviewer.reviewerUserId)
        .map((reviewer) => directory.get(reviewer.reviewerUserId!)?.email ?? reviewer.reviewerEmail);

      if (internalPrimaryEmails.length) {
        const reviewUrl = buildUrl(options.appBaseUrl, `/review/access-requests/${request.id}`);
        await options.emailSender.send({
          to: dedupeStrings(internalPrimaryEmails),
          cc: recipients.cc,
          ...emailEnvelope,
          subject: `Review access request: ${updated.companyName}`,
          text: [...reviewLines, reviewUrl ? `Review in system: ${reviewUrl}` : undefined].filter(Boolean).join("\n"),
          debugLabel: "access-request-review-requested"
        });
      }

      for (const reviewer of externalPrimaryReviewers) {
        const rawToken = issuePublicToken();
        await options.reviewers.setReviewToken(
          reviewer.id,
          hashToken(rawToken),
          new Date(Date.now() + EXTERNAL_REVIEW_TOKEN_TTL_MS)
        );
        const reviewUrl = buildUrl(
          await requestBaseUrl(updated),
          `/review/access-requests/${request.id}?token=${encodeURIComponent(rawToken)}`
        );
        await options.emailSender.send({
          to: reviewer.reviewerEmail,
          ...emailEnvelope,
          subject: `Review access request: ${updated.companyName}`,
          text: [
            ...reviewLines,
            reviewUrl ? `Review this request: ${reviewUrl}` : undefined,
            "This secure review link expires in 7 days and only grants access to this request."
          ].filter(Boolean).join("\n"),
          debugLabel: "access-request-external-review-requested"
        });
      }
      await options.reviewers.markNotified(request.id);
      await addEvent(
        updated.id,
        "review_requested",
        actor,
        "Review requested",
        `Sent review request to ${recipients.to.join(", ")}${recipients.cc.length ? ` and cc ${recipients.cc.join(", ")}` : ""}.`
      );
      await notifyAdmins(
        updated,
        "access_request.review_requested",
        {
          company_name: updated.companyName,
          review_to: recipients.to.join(", "),
          review_cc_line: recipients.cc.length ? `Cc: ${recipients.cc.join(", ")}` : ""
        }
      );
      return buildAdminDetail(updated);
    },

    async markNeedsInfo(requestId: string, input: AccessRequestNeedsInfoInput, actor: AccessRequestActor): Promise<AdminAccessRequestDetail> {
      const existing = await ensureRequestExists(requestId);
      const message = trimOrUndefined(input.message);
      if (!message) {
        throw new Error("Message is required");
      }
      const updated = await options.requests.update(existing.id, {
        status: "needs_info",
        reviewSummary: message,
        rejectionReason: null
      });
      const publicLink = buildUrl(options.appBaseUrl, `/access/apply/${existing.publicToken}`);
      await options.emailSender.send({
        to: updated.applicantEmail,
        ...await requestEmailEnvelope(updated),
        subject: `More information needed for ${updated.companyName}`,
        text: [
          `We need more information to continue reviewing ${updated.companyName}.`,
          message,
          publicLink ? `Update your request: ${publicLink}` : undefined
        ]
          .filter(Boolean)
          .join("\n"),
        debugLabel: "access-request-needs-info"
      });
      await addEvent(updated.id, "needs_info", actor, "More information requested", message);
      await notifyAdmins(
        updated,
        "access_request.needs_info",
        { company_name: updated.companyName, message }
      );
      return buildAdminDetail(updated);
    },

    async rejectRequest(requestId: string, input: AccessRequestRejectInput, actor: AccessRequestActor): Promise<AdminAccessRequestDetail> {
      const existing = await ensureRequestExists(requestId);
      const reason = trimOrUndefined(input.reason);
      if (!reason) {
        throw new Error("Reason is required");
      }
      const updated = await options.requests.update(existing.id, {
        status: "rejected",
        rejectionReason: reason,
        rejectedAt: new Date()
      });
      await options.emailSender.send({
        to: updated.applicantEmail,
        ...await requestEmailEnvelope(updated),
        subject: `Access request update for ${updated.companyName}`,
        text: [`Your access request for ${updated.companyName} was rejected.`, reason].join("\n"),
        debugLabel: "access-request-rejected"
      });
      await addEvent(updated.id, "rejected", actor, "Request rejected", reason);
      await notifyAdmins(
        updated,
        "access_request.rejected",
        { company_name: updated.companyName, rejection_reason: reason }
      );
      return buildAdminDetail(updated);
    },

    async getReviewerView(requestId: string, currentUser: AuthenticatedUser): Promise<ReviewerAccessRequestView> {
      const request = await ensureRequestExists(requestId);
      const reviewers = await options.reviewers.listForRequest(request.id);
      const reviewer = reviewers.find((item) => isInternalReviewerMatch(item, currentUser));
      if (!reviewer) {
        throw new Error("You are not assigned to review this request");
      }
      return {
        request: await buildAdminDetail(request, "reviewer"),
        viewer: {
          reviewerId: reviewer.id,
          reviewerEmail: reviewer.reviewerEmail,
          deliveryType: reviewer.deliveryType,
          decision: reviewer.decision
        }
      };
    },

    async getExternalReviewerView(requestId: string, rawToken: string): Promise<ReviewerAccessRequestView> {
      const reviewer = await reviewerFromToken(rawToken, requestId);
      const request = await ensureRequestExists(requestId);
      return {
        request: await buildExternalReviewerDetail(request, reviewer, rawToken),
        viewer: {
          reviewerId: reviewer.id,
          reviewerEmail: reviewer.reviewerEmail,
          deliveryType: reviewer.deliveryType,
          decision: reviewer.decision
        }
      };
    },

    async getReviewerPurchaseProofFile(requestId: string, attachmentId: string, currentUser: AuthenticatedUser): Promise<{
      attachment: AccessRequestAttachmentRecord;
      content: Buffer;
    }> {
      const request = await ensureRequestExists(requestId);
      const reviewers = await options.reviewers.listForRequest(request.id);
      const reviewer = reviewers.find((item) => isInternalReviewerMatch(item, currentUser));
      if (!reviewer) {
        throw new Error("You are not assigned to review this request");
      }
      return readAttachmentFile(request, attachmentId);
    },

    async getExternalReviewerPurchaseProofFile(requestId: string, attachmentId: string, rawToken: string): Promise<{
      attachment: AccessRequestAttachmentRecord;
      content: Buffer;
    }> {
      await reviewerFromToken(rawToken, requestId);
      const request = await ensureRequestExists(requestId);
      return readAttachmentFile(request, attachmentId);
    },

    async submitReviewerDecision(
      requestId: string,
      currentUser: AuthenticatedUser,
      input: { decision: AccessRequestDecision; comment?: string | null }
    ): Promise<AccessRequestReviewDecisionResult> {
      const request = await ensureRequestExists(requestId);
      const reviewers = await options.reviewers.listForRequest(request.id);
      const reviewer = reviewers.find((item) => isInternalReviewerMatch(item, currentUser));
      if (!reviewer) {
        throw new Error("You are not assigned to review this request");
      }
      return submitDecisionForReviewer(request, reviewer, {
        actorType: "reviewer",
        actorUserId: currentUser.id,
        actorEmail: currentUser.email ?? null,
        actorName: currentUser.displayName ?? currentUser.email ?? null
      }, input);
    },

    async submitExternalReviewerDecision(
      requestId: string,
      rawToken: string,
      input: { decision: AccessRequestDecision; comment?: string | null }
    ): Promise<AccessRequestReviewDecisionResult> {
      const reviewer = await reviewerFromToken(rawToken, requestId);
      const request = await ensureRequestExists(requestId);
      return submitDecisionForReviewer(request, reviewer, {
        actorType: "reviewer",
        actorEmail: reviewer.reviewerEmail,
        actorName: reviewer.reviewerEmail
      }, input, rawToken);
    },

    async provisionRequest(requestId: string, input: AccessRequestProvisionInput, actor: AccessRequestActor): Promise<AdminAccessRequestDetail> {
      const request = await ensureRequestExists(requestId);
      const policy = await loadPolicy();
      const planId = trimOrUndefined(input.planId) ?? request.approvedPlanId ?? request.requestedPlanId;
      if (!planId) {
        throw new Error("A package plan is required before provisioning");
      }
      const plan = await options.subscriptionPlans.getById(planId);
      if (!plan || plan.status !== "active") {
        throw new Error("Selected plan does not exist");
      }
      const brand = await requestBrand(request);
      if (brand && !brand.subscriptionPlanIds.includes(plan.id)) {
        throw new Error("Selected package is not available for this brand");
      }

      let organization: OrganizationRecord | undefined;
      if (input.targetMode === "existing_organization") {
        const organizationId = trimOrUndefined(input.organizationId);
        if (!organizationId) {
          throw new Error("organizationId is required");
        }
        organization = await options.organizations.getById(organizationId);
        if (
          !organization ||
          organization.type !== "customer" ||
          organization.status !== "active" ||
          trimOrUndefined(organization.publicBrandId) !== trimOrUndefined(request.publicBrandId)
        ) {
          throw new Error("Target organization does not exist");
        }
      } else {
        const organizationName = trimOrUndefined(input.organizationName) ?? request.companyName;
        if (!organizationName) {
          throw new Error("organizationName is required");
        }
        const slug = await ensureUniqueOrganizationSlug(options.organizations, organizationName);
        organization = await options.organizations.create({
          slug,
          name: organizationName,
          type: "customer",
          status: "active",
          publicBrandId: request.publicBrandId ?? null,
          ownerUserId: actor.actorUserId ?? null
        });
      }

      const now = new Date();
      const startsAt = toDateOrUndefined(input.startsAt) ?? now;
      const cycleAnchorAt = toDateOrUndefined(input.cycleAnchorAt) ?? startsAt;
      const expiresAt =
        toDateOrUndefined(input.expiresAt) ??
        new Date(startsAt.getTime() + policy.defaultTrialDays * 24 * 60 * 60 * 1000);

      await options.subscriptionGrants.upsertForPrincipal({
        principalType: "organization",
        principalId: organization.id,
        planId: plan.id,
        status: "active",
        startsAt,
        expiresAt,
        cycleAnchorAt,
        completedTurnLimitOverride:
          input.completedTurnLimitOverride === undefined ? null : input.completedTurnLimitOverride ?? null,
        tokenLimitOverride: input.tokenLimitOverride === undefined ? null : input.tokenLimitOverride ?? null,
        note: trimOrUndefined(input.note) ?? `Provisioned from access request ${request.id}`,
        createdByUserId: actor.actorUserId ?? null
      });

      const rawInviteToken = randomUUID().replace(/-/g, "");
      const invite = await options.invites.create({
        organizationId: organization.id,
        email: request.applicantEmail,
        inviteTokenHash: hashToken(rawInviteToken),
        intendedProvider: "email_magic_link",
        roleTemplate: {
          membershipType: defaultMembershipType(input.membershipType)
        },
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        invitedByUserId: actor.actorUserId ?? null
      });
      const inviteUrl = buildUrl(await requestBaseUrl(request), `/invite/${rawInviteToken}`);
      await options.emailSender.send({
        to: request.applicantEmail,
        ...await requestEmailEnvelope(request),
        subject: `${organization.name} access is ready`,
        text: [
          `${organization.name} access has been approved.`,
          inviteUrl
            ? `Open this invite link to finish sign in: ${inviteUrl}`
            : `Use invite code ${rawInviteToken} on the sign-in page.`,
          `Package: ${plan.name}`
        ].join("\n"),
        debugLabel: "access-request-invite"
      });

      const updated = await options.requests.update(request.id, {
        status: "invited",
        approvedPlanId: plan.id,
        targetOrganizationId: organization.id,
        organizationInviteId: invite.id,
        provisionedAt: now,
        invitedAt: now
      });
      await addEvent(
        updated.id,
        "provisioned",
        actor,
        "Package provisioned",
        `Provisioned ${plan.name} for ${organization.name}.`
      );
      await notifyAdmins(
        updated,
        "access_request.provisioned",
        {
          company_name: updated.companyName,
          organization_name: organization.name,
          plan_name: plan.name
        }
      );
      return buildAdminDetail(updated);
    },

    async markActivatedFromInvite(organizationInviteId: string, userId: string): Promise<void> {
      const request = await options.requests.getByOrganizationInviteId(organizationInviteId);
      if (!request) {
        return;
      }
      const updated = await options.requests.update(request.id, {
        status: "activated",
        targetUserId: userId,
        activatedAt: new Date()
      });
      const user = await options.users.getById(userId);
      await addEvent(
        updated.id,
        "activated",
        {
          actorType: "system",
          actorUserId: userId,
          actorEmail: user?.email ?? null
        },
        "Applicant activated access",
        user?.email ? `${user.email} finished first sign-in.` : "Applicant finished first sign-in."
      );
      await notifyAdmins(
        updated,
        "access_request.activated",
        {
          company_name: updated.companyName,
          applicant_email: updated.applicantEmail
        }
      );
    }
  };
}
