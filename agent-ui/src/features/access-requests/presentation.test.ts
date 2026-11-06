import { describe, expect, it } from "vitest";

import {
  accessRequestActionAvailability,
  buildAccessRequestHash,
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
