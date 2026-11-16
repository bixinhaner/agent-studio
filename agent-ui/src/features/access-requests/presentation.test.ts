import { describe, expect, it } from "vitest";

import {
  accessRequestActionAvailability,
  buildAccessRequestHash,
  inviteNotice,
  trialShiftPreview,
  readAccessRequestHashState,
  reviewerCandidateMatches,
  reviewerCandidatesForBrand,
  reviewerRowsProblem
} from "./presentation";

describe("reviewerCandidateMatches", () => {
  const candidate = { email: "LiXuxian@baicells.com", displayName: "李旭娴" };

  it("matches email or name substrings case-insensitively", () => {
    expect(reviewerCandidateMatches("lixu", candidate)).toBe(true);
    expect(reviewerCandidateMatches("BAICELLS", candidate)).toBe(true);
    expect(reviewerCandidateMatches("旭娴", candidate)).toBe(true);
  });

  it("hides accounts that do not match the typed text", () => {
    expect(reviewerCandidateMatches("clou", candidate)).toBe(false);
    expect(reviewerCandidateMatches("clou", undefined)).toBe(false);
  });

  it("lists everyone before anything is typed", () => {
    expect(reviewerCandidateMatches("  ", candidate)).toBe(true);
  });
});

describe("reviewerCandidatesForBrand", () => {
  const internal = { id: "u1", publicBrandId: undefined };
  const ranley = { id: "u2", publicBrandId: "brand_ranley" };

  it("offers brand employees only on their own brand's requests", () => {
    expect(reviewerCandidatesForBrand([internal, ranley], "brand_ranley")).toEqual([internal, ranley]);
    expect(reviewerCandidatesForBrand([internal, ranley], "brand_bailey")).toEqual([internal]);
    expect(reviewerCandidatesForBrand([internal, ranley], null)).toEqual([internal]);
  });
});

describe("access request admin helpers", () => {
  it("blocks closing and re-review on finished requests, and warns before unusual provisioning", () => {
    const open = accessRequestActionAvailability("under_review");
    expect(open.closeBlockedReason).toBe("");
    expect(open.sendReviewBlockedReason).toBe("");
    expect(open.provisionWarning).toContain("还没有审核通过");

    const approved = accessRequestActionAvailability("approved_pending_provision");
    expect(approved.closeBlockedReason).toBe("");
    expect(approved.sendReviewBlockedReason).toContain("待开通");
    expect(approved.provisionWarning).toBe("");

    const rejected = accessRequestActionAvailability("rejected");
    expect(rejected.closeBlockedReason).toContain("已拒绝");
    expect(rejected.provisionWarning).toContain("已被拒绝");

    expect(accessRequestActionAvailability("activated").provisionWarning).toContain("覆盖目标组织的套餐");
  });

  it("reports the first invalid reviewer row", () => {
    expect(reviewerRowsProblem([], { requireTo: false })).toBe("");
    expect(reviewerRowsProblem([], { requireTo: true })).toBe("至少需要一位 To 审核人");
    expect(reviewerRowsProblem([{ reviewerEmail: " ", deliveryType: "to" }], { requireTo: false })).toBe("第 1 行审核人邮箱为空");
    expect(reviewerRowsProblem([
      { reviewerEmail: "a@x.com", deliveryType: "to" },
      { reviewerEmail: "bad", deliveryType: "cc" }
    ], { requireTo: false })).toBe("第 2 行不是有效邮箱：bad");
    expect(reviewerRowsProblem([
      { reviewerEmail: "A@x.com", deliveryType: "to" },
      { reviewerEmail: "a@x.com", deliveryType: "cc" }
    ], { requireTo: false })).toBe("审核人重复：a@x.com");
    expect(reviewerRowsProblem([{ reviewerEmail: "a@x.com", deliveryType: "cc" }], { requireTo: true })).toBe("至少需要一位 To 审核人");
  });

  it("round-trips view state through the admin hash", () => {
    const hash = buildAccessRequestHash("#admin/access-requests", { requestId: "req1", status: "needs_info", query: "acme co" });
    expect(hash).toBe("#admin/access-requests?request=req1&status=needs_info&q=acme+co");
    expect(readAccessRequestHashState(hash)).toEqual({ requestId: "req1", status: "needs_info", query: "acme co" });
    expect(buildAccessRequestHash(hash, { requestId: "", status: "all", query: " " })).toBe("#admin/access-requests");
    expect(readAccessRequestHashState("#admin/access-requests?status=bogus")).toEqual({ requestId: "", status: "all", query: "" });
  });
});

describe("inviteNotice", () => {
  const format = (value: string) => value.slice(0, 10);

  it("warns about an expired invite while the applicant still cannot sign in", () => {
    const notice = inviteNotice(
      { status: "invited", applicantEmail: "a@x.hr", invite: { status: "expired", expiresAt: "2026-11-13T05:51:34.956Z" } },
      format
    );
    expect(notice?.tone).toBe("warning");
    expect(notice?.message).toBe("邀请已于 2026-11-13 过期，申请人现在无法登录");
    expect(notice?.description).toContain("a@x.hr");
  });

  it("explains the sign-in options for a valid invite", () => {
    const notice = inviteNotice(
      { status: "provisioned", applicantEmail: "a@x.hr", invite: { status: "pending", expiresAt: "2026-11-20T00:00:00.000Z" } },
      format
    );
    expect(notice?.tone).toBe("info");
    expect(notice?.description).toContain("登录页输入 a@x.hr");
  });

  it("stays quiet once the applicant signed in or when no invite data is available", () => {
    const expired = { status: "expired", expiresAt: "2026-11-13T00:00:00.000Z" };
    expect(inviteNotice({ status: "activated", applicantEmail: "a@x.hr", invite: expired })).toBeNull();
    expect(inviteNotice({ status: "invited", applicantEmail: "a@x.hr" })).toBeNull();
    expect(inviteNotice({ status: "invited", applicantEmail: "a@x.hr", invite: { ...expired, status: "revoked" } })).toBeNull();
  });
});

describe("trialShiftPreview", () => {
  const now = new Date("2026-11-16T02:00:00.000Z");
  const format = (value: string) => value.slice(0, 10);

  it("restarts a started package from now and keeps its length", () => {
    expect(
      trialShiftPreview({ startsAt: "2026-11-06T05:51:00.000Z", expiresAt: "2027-01-06T05:51:00.000Z" }, now, format)
    ).toEqual({ fromStart: "2026-11-06", fromEnd: "2027-01-06", toStart: "2026-11-16", toEnd: "2027-01-16" });
  });

  it("offers nothing for open-ended or not-yet-started packages", () => {
    expect(trialShiftPreview({ startsAt: "2026-11-06T00:00:00.000Z" }, now, format)).toBeNull();
    expect(trialShiftPreview({ startsAt: "2026-12-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" }, now, format)).toBeNull();
    expect(trialShiftPreview(null, now, format)).toBeNull();
  });
});
