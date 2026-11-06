import { describe, expect, it } from "vitest";

import { reviewerCandidateMatches } from "./presentation";

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
