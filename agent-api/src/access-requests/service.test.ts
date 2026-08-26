import { describe, expect, it, vi } from "vitest";

import { createAccessRequestService } from "./service.js";
import type {
  AccessRequestAttachmentRecord,
  CreateAccessRequestAttachmentInput
} from "../persistence/access-request-attachment-repository.js";
import type { AccessRequestRecord } from "../persistence/access-request-repository.js";
import type { AccessRequestReviewerRecord } from "../persistence/access-request-reviewer-repository.js";
import type { PurchaseProofUploadFile } from "./purchase-proof-storage.js";

function buildRequest(overrides: Partial<AccessRequestRecord> = {}): AccessRequestRecord {
  return {
    id: "request_1",
    requestType: "trial",
    commercialIntent: "trial",
    status: "under_review",
    applicantEmail: "applicant@example.com",
    applicantEmailDomain: "example.com",
    contactName: "Alice",
    companyName: "Example Corp",
    countryRegion: "Indonesia",
    deviceInfoText: "ODU + CPE",
    purchaseDate: "2026-04-21T00:00:00.000Z",
    poNumber: "PO-123",
    snNumber: "SN-123456",
    salesContactEmail: "sales@baicells.com",
    customerNote: "Need trial",
    adminNote: undefined,
    reviewSummary: undefined,
    rejectionReason: undefined,
    reviewMode: "any_to_approve",
    minimumApprovals: undefined,
    rejectionMode: "any_to_reject",
    ownerUserId: undefined,
    requestedPlanId: undefined,
    approvedPlanId: undefined,
    targetOrganizationId: undefined,
    targetUserId: undefined,
    organizationInviteId: undefined,
    publicToken: "public-token-1",
    lastSubmittedAt: "2026-04-21T00:00:00.000Z",
    reviewRequestedAt: "2026-04-21T00:00:00.000Z",
    approvedAt: undefined,
    rejectedAt: undefined,
    provisionedAt: undefined,
    invitedAt: undefined,
    activatedAt: undefined,
    createdAt: "2026-04-21T00:00:00.000Z",
    updatedAt: "2026-04-21T00:00:00.000Z",
    ...overrides
  };
}

function buildReviewer(overrides: Partial<AccessRequestReviewerRecord> = {}): AccessRequestReviewerRecord {
  return {
    id: "reviewer_1",
    accessRequestId: "request_1",
    reviewerEmail: "reviewer@baicells.com",
    reviewerUserId: "reviewer_user",
    deliveryType: "to",
    decision: "pending",
    comment: undefined,
    notifiedAt: "2026-04-21T00:00:00.000Z",
    decidedAt: undefined,
    createdAt: "2026-04-21T00:00:00.000Z",
    updatedAt: "2026-04-21T00:00:00.000Z",
    ...overrides
  };
}

function buildAttachment(overrides: Partial<AccessRequestAttachmentRecord> = {}): AccessRequestAttachmentRecord {
  return {
    id: "attachment_1",
    accessRequestId: "request_1",
    kind: "purchase_proof",
    originalName: "proof.pdf",
    mimeType: "application/pdf",
    sizeBytes: 4,
    storagePath: "/tmp/proof.pdf",
    createdAt: "2026-04-21T00:00:00.000Z",
    ...overrides
  };
}

function proofFile(name = "proof.pdf") {
  const buffer = Buffer.from("proof");
  return {
    originalName: name,
    mimeType: "application/pdf",
    sizeBytes: buffer.length,
    buffer
  };
}

function createServiceHarness() {
  const requests = new Map<string, AccessRequestRecord>();
  const reviewers = new Map<string, AccessRequestReviewerRecord[]>();
  const attachments = new Map<string, AccessRequestAttachmentRecord[]>();
  const emailSender = {
    send: vi.fn(async (_input: { text?: string; [key: string]: unknown }) => ({ delivered: true, mode: "smtp" as const }))
  };
  const adminNotifier = { notify: vi.fn(async () => null) };
  let policy = {
    id: "policy_1",
    policyKey: "global",
    internalEmailDomains: ["baicells.com"],
    blockedApplicantEmailDomains: [
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
    ],
    defaultTrialDays: 14,
    createdAt: "2026-04-21T00:00:00.000Z",
    updatedAt: "2026-04-21T00:00:00.000Z"
  };

  const service = createAccessRequestService({
    requests: {
      create: vi.fn(async (input) => {
        const next = buildRequest({
          id: "request_created",
          status: input.status ?? "submitted",
          applicantEmail: input.applicantEmail,
          applicantEmailDomain: input.applicantEmailDomain,
          companyName: input.companyName,
          contactName: input.contactName,
          countryRegion: input.countryRegion,
          deviceInfoText: input.deviceInfoText,
          purchaseDate: input.purchaseDate instanceof Date ? input.purchaseDate.toISOString() : input.purchaseDate ?? undefined,
          poNumber: input.poNumber ?? "",
          snNumber: input.snNumber,
          salesContactEmail: input.salesContactEmail,
          publicToken: input.publicToken,
          lastSubmittedAt: input.lastSubmittedAt instanceof Date ? input.lastSubmittedAt.toISOString() : undefined
        });
        requests.set(next.id, next);
        return next;
      }),
      getById: vi.fn(async (id) => requests.get(id) ?? null),
      getByPublicToken: vi.fn(async (token) => [...requests.values()].find((item) => item.publicToken === token) ?? null),
      getByOrganizationInviteId: vi.fn(async () => null),
      list: vi.fn(async () => [...requests.values()]),
      update: vi.fn(async (id, input) => {
        const existing = requests.get(id);
        if (!existing) throw new Error("missing request");
        const next = {
          ...existing,
          ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
          updatedAt: "2026-04-22T00:00:00.000Z",
          approvedAt:
            input.approvedAt instanceof Date
              ? input.approvedAt.toISOString()
              : input.approvedAt === undefined
                ? existing.approvedAt
                : undefined
        } as AccessRequestRecord;
        requests.set(id, next);
        return next;
      })
    } as never,
    attachments: {
      createMany: vi.fn(async (items: CreateAccessRequestAttachmentInput[]) => {
        const created = items.map((item: CreateAccessRequestAttachmentInput, index: number) =>
          buildAttachment({
            id: `attachment_${index + 1}`,
            accessRequestId: item.accessRequestId,
            kind: item.kind ?? "purchase_proof",
            originalName: item.originalName,
            mimeType: item.mimeType,
            sizeBytes: item.sizeBytes,
            storagePath: item.storagePath
          })
        );
        for (const item of created) {
          const bucket = attachments.get(item.accessRequestId) ?? [];
          bucket.push(item);
          attachments.set(item.accessRequestId, bucket);
        }
        return created;
      }),
      listForRequest: vi.fn(async (requestId: string) => attachments.get(requestId) ?? []),
      getById: vi.fn(async (id: string) => [...attachments.values()].flat().find((item) => item.id === id) ?? null)
    } as never,
    purchaseProofStorage: {
      saveFiles: vi.fn(async (requestId: string, files: PurchaseProofUploadFile[]) =>
        files.map((file: PurchaseProofUploadFile) => ({
          originalName: file.originalName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          storagePath: `/tmp/${requestId}/${file.originalName}`
        }))
      ),
      readFile: vi.fn(async () => Buffer.from("proof"))
    } as never,
    reviewers: {
      listForRequest: vi.fn(async (requestId: string) => reviewers.get(requestId) ?? []),
      listForRequests: vi.fn(async (requestIds: string[]) => requestIds.flatMap((requestId: string) => reviewers.get(requestId) ?? [])),
      replaceForRequest: vi.fn(async (
        requestId: string,
        items: Array<{ reviewerEmail: string; reviewerUserId?: string | null; deliveryType?: string; decision?: string }>
      ) => {
        const next = items.map((item: { reviewerEmail: string; reviewerUserId?: string | null; deliveryType?: string; decision?: string }, index: number) =>
          buildReviewer({
            id: `reviewer_${index + 1}`,
            accessRequestId: requestId,
            reviewerEmail: item.reviewerEmail,
            reviewerUserId: item.reviewerUserId ?? undefined,
            deliveryType: item.deliveryType ?? "to",
            decision: item.decision ?? "pending"
          })
        );
        reviewers.set(requestId, next);
        return next;
      }),
      resetDecisions: vi.fn(async (requestId) => {
        const next = (reviewers.get(requestId) ?? []).map((reviewer) => ({ ...reviewer, decision: "pending", comment: undefined }));
        reviewers.set(requestId, next);
        return next;
      }),
      markNotified: vi.fn(async (requestId) => reviewers.get(requestId) ?? []),
      setReviewToken: vi.fn(async (reviewerId: string, reviewTokenHash: string, expiresAt: Date) => {
        for (const [requestId, bucket] of reviewers.entries()) {
          const next = bucket.map((reviewer) => reviewer.id === reviewerId
            ? { ...reviewer, reviewTokenHash, reviewTokenExpiresAt: expiresAt.toISOString() }
            : reviewer);
          reviewers.set(requestId, next);
          const matched = next.find((reviewer) => reviewer.id === reviewerId);
          if (matched) return matched;
        }
        throw new Error("missing reviewer");
      }),
      getByReviewTokenHash: vi.fn(async (reviewTokenHash: string) =>
        [...reviewers.values()].flat().find((reviewer) => reviewer.reviewTokenHash === reviewTokenHash) ?? null
      ),
      decide: vi.fn(async ({ reviewerId, decision, comment }) => {
        const bucket = reviewers.get("request_1") ?? [];
        const next = bucket.map((reviewer) =>
          reviewer.id === reviewerId
            ? { ...reviewer, decision, comment: comment ?? undefined, decidedAt: "2026-04-22T00:00:00.000Z" }
            : reviewer
        );
        reviewers.set("request_1", next);
        return next.find((reviewer) => reviewer.id === reviewerId)!;
      })
    } as never,
    events: {
      create: vi.fn(async (input) => ({
        id: randomId(),
        accessRequestId: input.accessRequestId,
        eventType: input.eventType,
        actorType: input.actorType,
        actorUserId: input.actorUserId ?? undefined,
        actorEmail: input.actorEmail ?? undefined,
        title: input.title,
        detail: input.detail ?? undefined,
        metadata: input.metadata,
        createdAt: "2026-04-21T00:00:00.000Z"
      })),
      listForRequest: vi.fn(async () => []),
      listForRequests: vi.fn(async () => [])
    } as never,
    users: {
      getById: vi.fn(async (id: string) =>
        id === "reviewer_user"
          ? {
              id,
              email: "reviewer@baicells.com",
              displayName: "Reviewer",
              role: "employee",
              userType: "internal_employee",
              createdAt: "2026-04-21T00:00:00.000Z",
              updatedAt: "2026-04-21T00:00:00.000Z"
            }
          : undefined
      )
    } as never,
    organizations: {
      getById: vi.fn(async () => undefined),
      listByIds: vi.fn(async () => []),
      list: vi.fn(async () => []),
      create: vi.fn(),
      getBySlug: vi.fn()
    } as never,
    memberships: {} as never,
    invites: {
      create: vi.fn(),
      getByTokenHash: vi.fn(),
      listPendingByEmail: vi.fn(),
      accept: vi.fn()
    } as never,
    subscriptionPlans: {
      list: vi.fn(async () => []),
      getById: vi.fn(async () => null)
    } as never,
    subscriptionGrants: {
      upsertForPrincipal: vi.fn()
    } as never,
    policies: {
      getOrCreate: vi.fn(async () => policy),
      update: vi.fn(async (input) => {
        policy = {
          ...policy,
          internalEmailDomains: input.internalEmailDomains ?? policy.internalEmailDomains,
          blockedApplicantEmailDomains: input.blockedApplicantEmailDomains ?? policy.blockedApplicantEmailDomains,
          defaultTrialDays: input.defaultTrialDays ?? policy.defaultTrialDays,
          updatedAt: "2026-04-22T00:00:00.000Z"
        };
        return policy;
      })
    } as never,
    emailSender,
    adminNotifier,
    appBaseUrl: "https://example.com",
    publicBrands: {
      getById: vi.fn(async (brandId: string) => brandId === "brand_ranley" ? {
        id: "brand_ranley",
        key: "ranley",
        name: "Ranley",
        platformName: "Ranley",
        primaryBaseUrl: "https://ranley.cloud-ran.ai",
        emailFromName: "ranley",
        emailFromAddress: "ranley@cloud-ran.ai",
        emailReplyTo: "lion.li@cloud-ran.ai",
        emailSenderVerified: true,
        supportEmail: "lion.li@cloud-ran.ai",
        billingSupportEmail: "lion.li@cloud-ran.ai"
      } : null)
    } as never,
    accessRequestConfig: {
      internalEmailDomains: ["baicells.com"],
      publicEmailBlocklistExtra: [],
      defaultTrialDays: 14
    },
    findInternalUsers: vi.fn(async () => [
      {
        id: "admin_1",
        email: "admin@baicells.com",
        displayName: "Admin",
        role: "admin",
        userType: "internal_employee"
      },
      {
        id: "reviewer_user",
        email: "reviewer@baicells.com",
        displayName: "Reviewer",
        role: "employee",
        userType: "internal_employee"
      }
    ])
  });

  return { service, requests, reviewers, attachments, emailSender, adminNotifier };
}

function randomId(): string {
  return Math.random().toString(36).slice(2);
}

describe("createAccessRequestService", () => {
  it("rejects public mailbox domains for applicants", async () => {
    const { service } = createServiceHarness();

    await expect(
      service.submitPublicRequest({
        applicantEmail: "trial@163.com",
        contactName: "Alice",
        companyName: "Example Corp",
        countryRegion: "Indonesia",
        deviceInfoText: "ODU",
        purchaseDate: "2026-04-21",
        poNumber: "PO-1",
        snNumber: "SN-1",
        salesContactEmail: "Alice Sales",
        purchaseProofFiles: [proofFile()]
      })
    ).rejects.toThrow("business email");
  });

  it("submits a public request with proof files, no purchase date, no PO, and a non-email sales contact", async () => {
    const { service, requests, attachments, reviewers } = createServiceHarness();

    const result = await service.submitPublicRequest({
      applicantEmail: "trial@example-corp.com",
      contactName: "Alice",
      companyName: "Example Corp",
      countryRegion: "Indonesia",
      purchaseDate: null,
      poNumber: "",
      snNumber: "SN-1",
      salesContactEmail: "Alice Sales",
      purchaseProofFiles: [proofFile("invoice.pdf")]
    });

    const created = requests.get(result.request.id);
    expect(created?.purchaseDate).toBeUndefined();
    expect(created?.poNumber).toBe("");
    expect(created?.salesContactEmail).toBe("Alice Sales");
    expect(result.request.snNumber).toBe("SN-1");
    expect(result.request.purchaseProofAttachments).toHaveLength(1);
    expect(attachments.get(result.request.id)?.[0]?.originalName).toBe("invoice.pdf");
    expect(reviewers.get(result.request.id)).toBeUndefined();
  });

  it("promotes the request to approved_pending_provision when a required reviewer approves", async () => {
    const { service, requests, reviewers } = createServiceHarness();
    requests.set("request_1", buildRequest());
    reviewers.set("request_1", [buildReviewer()]);

    const result = await service.submitReviewerDecision(
      "request_1",
      {
        id: "reviewer_user",
        email: "reviewer@baicells.com",
        displayName: "Reviewer",
        role: "employee",
        userType: "internal_employee",
        createdAt: "2026-04-21T00:00:00.000Z",
        updatedAt: "2026-04-21T00:00:00.000Z"
      },
      { decision: "approved", comment: "Looks good" }
    );

    expect(result.reviewer.decision).toBe("approved");
    expect(result.request.status).toBe("approved_pending_provision");
    expect(requests.get("request_1")?.status).toBe("approved_pending_provision");
  });

  it("routes a Ranley request to a brand-domain reviewer with a scoped token", async () => {
    const { service, requests, reviewers, emailSender } = createServiceHarness();
    requests.set("request_1", buildRequest({ publicBrandId: "brand_ranley", status: "submitted" }));

    await service.updateAdminRequest("request_1", {
      reviewers: [{ reviewerEmail: "lion.li@cloud-ran.ai", deliveryType: "to" }]
    }, { actorType: "admin", actorUserId: "admin_1", actorEmail: "admin@baicells.com" });
    await service.sendReviewRequest(
      "request_1",
      { actorType: "admin", actorUserId: "admin_1", actorEmail: "admin@baicells.com" }
    );

    const reviewer = reviewers.get("request_1")?.[0];
    expect(reviewer?.reviewTokenHash).toBeTruthy();
    expect(reviewer?.reviewTokenExpiresAt).toBeTruthy();
    expect(emailSender.send).toHaveBeenCalledWith(expect.objectContaining({
      to: "lion.li@cloud-ran.ai",
      publicBrandId: "brand_ranley",
      from: "ranley <ranley@cloud-ran.ai>",
      debugLabel: "access-request-external-review-requested",
      text: expect.stringContaining("https://ranley.cloud-ran.ai/review/access-requests/request_1?token=")
    }));

    const rawToken = String(emailSender.send.mock.calls.at(-1)?.[0]?.text).match(/[?&]token=([a-z0-9]+)/i)?.[1];
    expect(rawToken).toBeTruthy();
    const view = await service.getExternalReviewerView("request_1", rawToken!);
    expect(view.viewer.reviewerEmail).toBe("lion.li@cloud-ran.ai");
    await expect(service.getExternalReviewerView("request_1", "invalid-token")).rejects.toThrow("invalid or expired");

    const result = await service.submitExternalReviewerDecision(
      "request_1",
      rawToken!,
      { decision: "approved", comment: "Approved" }
    );
    expect(result.request.status).toBe("approved_pending_provision");
  });

  it("reads and updates access request policy", async () => {
    const { service } = createServiceHarness();

    const initial = await service.getPolicy();
    expect(initial.defaultTrialDays).toBe(14);
    expect(initial.internalEmailDomains).toEqual(["baicells.com"]);
    expect(initial.blockedApplicantEmailDomains).toContain("gmail.com");

    const updated = await service.updatePolicy(
      {
        internalEmailDomains: ["baicells.com", "baicells.net"],
        blockedApplicantEmailDomains: ["corp-mail.example", "examplemail.com"],
        defaultTrialDays: 30
      },
      { actorType: "admin", actorUserId: "admin_1", actorEmail: "admin@baicells.com" }
    );

    expect(updated.defaultTrialDays).toBe(30);
    expect(updated.internalEmailDomains).toEqual(["baicells.com", "baicells.net"]);
    expect(updated.blockedApplicantEmailDomains).toEqual(["corp-mail.example", "examplemail.com"]);
  });
});
