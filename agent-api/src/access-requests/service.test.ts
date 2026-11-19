import { describe, expect, it, vi } from "vitest";

import { createAccessRequestService } from "./service.js";
import type {
  AccessRequestAttachmentRecord,
  CreateAccessRequestAttachmentInput
} from "../persistence/access-request-attachment-repository.js";
import type { AccessRequestRecord } from "../persistence/access-request-repository.js";
import type { AccessRequestReviewerRecord } from "../persistence/access-request-reviewer-repository.js";
import type { OrganizationInviteRecord } from "../persistence/organization-invite-repository.js";
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
  const invites = new Map<string, OrganizationInviteRecord>();
  const grants = new Map<string, { planId?: string; status: string; startsAt: string; expiresAt?: string; cycleAnchorAt: string }>();
  const activeMemberOrgs = new Set<string>();
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
      getById: vi.fn(async (id: string) =>
        id === "org_1"
          ? { id: "org_1", slug: "example-corp", name: "Example Corp", type: "customer", status: "active", publicBrandId: "brand_ranley" }
          : undefined
      ),
      listByIds: vi.fn(async () => []),
      list: vi.fn(async () => []),
      create: vi.fn(),
      getBySlug: vi.fn()
    } as never,
    memberships: {
      hasActiveMembers: vi.fn(async (organizationId: string) => activeMemberOrgs.has(organizationId))
    } as never,
    invites: {
      create: vi.fn(async (input: Record<string, unknown>) => {
        const invite: OrganizationInviteRecord = {
          id: `invite_${invites.size + 1}`,
          organizationId: String(input.organizationId),
          email: String(input.email),
          inviteTokenHash: String(input.inviteTokenHash),
          intendedProvider: String(input.intendedProvider),
          roleTemplate: input.roleTemplate,
          status: "pending",
          expiresAt: (input.expiresAt as Date).toISOString(),
          createdAt: "2026-04-22T00:00:00.000Z",
          updatedAt: "2026-04-22T00:00:00.000Z"
        };
        invites.set(invite.id, invite);
        return invite;
      }),
      getById: vi.fn(async (id: string) => invites.get(id)),
      listByIds: vi.fn(async (ids: string[]) => ids.flatMap((id) => (invites.has(id) ? [invites.get(id)!] : []))),
      revoke: vi.fn(async (id: string) => {
        const next = { ...invites.get(id)!, status: "revoked" };
        invites.set(id, next);
        return next;
      }),
      getByTokenHash: vi.fn(),
      listPendingByEmail: vi.fn(),
      accept: vi.fn()
    } as never,
    subscriptionPlans: {
      list: vi.fn(async () => []),
      getById: vi.fn(async () => null)
    } as never,
    subscriptionGrants: {
      getByPrincipal: vi.fn(async (_type: string, principalId: string) => grants.get(principalId) ?? null),
      upsertForPrincipal: vi.fn(async (input: { principalId: string; planId?: string | null; status?: string; startsAt: Date; expiresAt?: Date; cycleAnchorAt?: Date }) => {
        const next = {
          planId: input.planId ?? undefined,
          status: input.status ?? "active",
          startsAt: input.startsAt.toISOString(),
          expiresAt: input.expiresAt?.toISOString(),
          cycleAnchorAt: (input.cycleAnchorAt ?? input.startsAt).toISOString()
        };
        grants.set(input.principalId, next);
        return next;
      })
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
    ]),
    findBrandEmployees: vi.fn(async () => [
      {
        id: "ranley_reviewer",
        email: "Lion.Li@cloud-ran.ai",
        displayName: "Lion Li",
        role: "employee",
        userType: "external_user",
        publicBrandId: "brand_ranley"
      },
      {
        id: "ranley_personal",
        email: "lion@gmail.com",
        displayName: "Lion personal",
        role: "employee",
        userType: "external_user",
        publicBrandId: "brand_ranley"
      }
    ])
  });

  return { service, requests, reviewers, attachments, invites, grants, activeMemberOrgs, emailSender, adminNotifier };
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

  it("offers to join when the company already has an active workspace on the same brand", async () => {
    const { service, requests } = createServiceHarness();
    requests.set(
      "request_ali",
      buildRequest({
        id: "request_ali",
        status: "activated",
        applicantEmail: "ali@opticoms.de",
        applicantEmailDomain: "opticoms.de",
        snNumber: "SN-ALI",
        publicBrandId: "brand_ranley",
        targetOrganizationId: "org_1"
      })
    );
    const submit = (publicBrandId: string | null) =>
      service.submitPublicRequest({
        applicantEmail: "batuhan@opticoms.de",
        contactName: "Batuhan",
        companyName: "Opticoms",
        countryRegion: "Germany",
        snNumber: "SN-NEW",
        salesContactEmail: "Sales",
        publicBrandId,
        purchaseProofFiles: [proofFile()]
      });

    const error = await submit("brand_ranley").catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "company_workspace_exists" });
    expect(String((error as Error).message)).not.toContain("ali@");
    // Another brand's applicant still gets the plain one-trial-per-domain message.
    await expect(submit(null)).rejects.toThrow("company domain already has trial access history");
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

  it("links a Ranley applicant back to the Ranley domain when more information is needed", async () => {
    const { service, requests, emailSender } = createServiceHarness();
    requests.set("request_1", buildRequest({ publicBrandId: "brand_ranley", status: "submitted" }));

    await service.markNeedsInfo(
      "request_1",
      { message: "Please upload the invoice." },
      { actorType: "admin", actorUserId: "admin_1", actorEmail: "admin@baicells.com" }
    );

    const sent = emailSender.send.mock.calls.at(-1)?.[0];
    expect(sent).toMatchObject({
      to: "applicant@example.com",
      publicBrandId: "brand_ranley",
      from: "ranley <ranley@cloud-ran.ai>",
      debugLabel: "access-request-needs-info"
    });
    expect(sent?.text).toContain("https://ranley.cloud-ran.ai/access/apply/public-token-1");
    expect(sent?.text).not.toContain("https://example.com");
  });

  it("keeps the platform domain in the more-information link for requests without a brand", async () => {
    const { service, requests, emailSender } = createServiceHarness();
    requests.set("request_1", buildRequest({ status: "submitted" }));

    await service.markNeedsInfo(
      "request_1",
      { message: "Please upload the invoice." },
      { actorType: "admin", actorUserId: "admin_1", actorEmail: "admin@baicells.com" }
    );

    expect(emailSender.send.mock.calls.at(-1)?.[0]?.text).toContain("https://example.com/access/apply/public-token-1");
  });

  it("suggests brand employees on the brand's own reviewer domain alongside internal reviewers", async () => {
    const { service } = createServiceHarness();

    const workspace = await service.listAdminWorkspace();

    expect(workspace.lookups.reviewerCandidates).toEqual([
      { id: "admin_1", email: "admin@baicells.com", displayName: "Admin", role: "admin" },
      { id: "ranley_reviewer", email: "lion.li@cloud-ran.ai", displayName: "Lion Li", role: "employee", publicBrandId: "brand_ranley" },
      { id: "reviewer_user", email: "reviewer@baicells.com", displayName: "Reviewer", role: "employee" }
    ]);
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

describe("access request invites", () => {
  function seedInvitedRequest(harness: ReturnType<typeof createServiceHarness>, overrides: Partial<AccessRequestRecord> = {}) {
    harness.invites.set("invite_old", {
      id: "invite_old",
      organizationId: "org_1",
      email: "applicant@example.com",
      inviteTokenHash: "old-hash",
      intendedProvider: "email_magic_link",
      roleTemplate: { membershipType: "customer_member" },
      status: "pending",
      expiresAt: "2026-04-01T00:00:00.000Z",
      createdAt: "2026-03-25T00:00:00.000Z",
      updatedAt: "2026-03-25T00:00:00.000Z"
    });
    harness.requests.set("request_1", buildRequest({
      status: "invited",
      publicBrandId: "brand_ranley",
      targetOrganizationId: "org_1",
      organizationInviteId: "invite_old",
      ...overrides
    }));
  }

  it("shows an unused invite past its expiry as expired in the admin list", async () => {
    const harness = createServiceHarness();
    seedInvitedRequest(harness);

    const workspace = await harness.service.listAdminWorkspace();

    expect(workspace.requests[0]?.invite).toEqual({ status: "expired", expiresAt: "2026-04-01T00:00:00.000Z" });
  });

  it("re-sends an expired invite without touching the package and cancels the old one", async () => {
    const harness = createServiceHarness();
    seedInvitedRequest(harness);

    const detail = await harness.service.resendInvite("request_1", { actorType: "admin", actorUserId: "admin_1" });

    expect(harness.invites.get("invite_old")?.status).toBe("revoked");
    const fresh = harness.invites.get(harness.requests.get("request_1")!.organizationInviteId!)!;
    expect(fresh.id).not.toBe("invite_old");
    expect(fresh.status).toBe("pending");
    expect(fresh.roleTemplate).toEqual({ membershipType: "customer_member" });
    expect(detail.invite?.status).toBe("pending");
    expect(detail.status).toBe("invited");
    const sent = harness.emailSender.send.mock.calls.at(-1)![0];
    expect(sent).toMatchObject({ to: "applicant@example.com", publicBrandId: "brand_ranley", from: "ranley <ranley@cloud-ran.ai>" });
    expect(sent.text).toContain("https://ranley.cloud-ran.ai/invite/");
    expect(sent.text).toContain("sign in with applicant@example.com on the sign-in page within 7 days");
  });

  it("keeps the old invite when the new invite email cannot be sent", async () => {
    const harness = createServiceHarness();
    seedInvitedRequest(harness, { status: "provisioned" });
    harness.emailSender.send.mockRejectedValueOnce(new Error("SMTP down"));

    await expect(harness.service.resendInvite("request_1", { actorType: "admin" })).rejects.toThrow("SMTP down");

    expect(harness.invites.get("invite_old")?.status).toBe("pending");
    expect([...harness.invites.values()].filter((invite) => invite.status === "pending")).toHaveLength(1);
    expect(harness.requests.get("request_1")?.organizationInviteId).toBe("invite_old");
  });

  it("refuses to re-send once the applicant has signed in or before a package exists", async () => {
    const harness = createServiceHarness();
    seedInvitedRequest(harness, { status: "activated" });
    await expect(harness.service.resendInvite("request_1", { actorType: "admin" })).rejects.toThrow("already signed in");

    harness.requests.set("request_1", buildRequest({ status: "approved_pending_provision" }));
    await expect(harness.service.resendInvite("request_1", { actorType: "admin" })).rejects.toThrow("Provision a package");
    expect(harness.emailSender.send).not.toHaveBeenCalled();
  });
});

describe("re-sending an invite with a shifted trial", () => {
  function seed(harness: ReturnType<typeof createServiceHarness>) {
    harness.requests.set("request_1", buildRequest({
      status: "invited",
      publicBrandId: "brand_ranley",
      targetOrganizationId: "org_1",
      approvedPlanId: "plan_trial"
    }));
    harness.grants.set("org_1", {
      planId: "plan_trial",
      status: "active",
      startsAt: "2026-11-06T05:51:00.000Z",
      expiresAt: "2027-01-06T05:51:00.000Z",
      cycleAnchorAt: "2026-11-06T05:51:00.000Z"
    });
  }

  it("restarts an unused trial from now and keeps its length", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-16T02:00:00.000Z"), toFake: ["Date"] });
    try {
      const harness = createServiceHarness();
      seed(harness);

      const detail = await harness.service.resendInvite("request_1", { actorType: "admin" }, { shiftTrial: true });

      expect(harness.grants.get("org_1")).toEqual({
        planId: "plan_trial",
        status: "active",
        startsAt: "2026-11-16T02:00:00.000Z",
        expiresAt: "2027-01-16T02:00:00.000Z",
        cycleAnchorAt: "2026-11-16T02:00:00.000Z"
      });
      expect(detail.targetSubscription).toEqual({ startsAt: "2026-11-16T02:00:00.000Z", expiresAt: "2027-01-16T02:00:00.000Z" });
      expect(harness.emailSender.send).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves the package alone unless asked", async () => {
    const harness = createServiceHarness();
    seed(harness);

    await harness.service.resendInvite("request_1", { actorType: "admin" });

    expect(harness.grants.get("org_1")?.startsAt).toBe("2026-11-06T05:51:00.000Z");
  });

  it("refuses to shift a package someone in the organization already uses, and sends nothing", async () => {
    const harness = createServiceHarness();
    seed(harness);
    harness.activeMemberOrgs.add("org_1");

    await expect(
      harness.service.resendInvite("request_1", { actorType: "admin" }, { shiftTrial: true })
    ).rejects.toThrow("already signed in");

    expect(harness.grants.get("org_1")?.startsAt).toBe("2026-11-06T05:51:00.000Z");
    expect(harness.emailSender.send).not.toHaveBeenCalled();
  });
});
