import { describe, expect, it } from "vitest";

import {
  LOW_SCORE_SUGGESTION_REQUIRED_MESSAGE,
  parseSubmitReviewInput
} from "./router.js";

describe("AI response review submission validation", () => {
  it("requires a reason and improvement suggestion for ratings 1-3", () => {
    expect(() => parseSubmitReviewInput({ score: 3, suggestion: "" })).toThrow(
      LOW_SCORE_SUGGESTION_REQUIRED_MESSAGE
    );
    expect(() => parseSubmitReviewInput({ score: 2, suggestion: "too short" })).toThrow(
      LOW_SCORE_SUGGESTION_REQUIRED_MESSAGE
    );
  });

  it("allows high scores without a suggestion and low scores with a useful suggestion", () => {
    expect(parseSubmitReviewInput({ score: 4, suggestion: null })).toMatchObject({
      score: 4,
      suggestion: null
    });
    expect(parseSubmitReviewInput({ score: 3, suggestion: "Need clearer evidence before replying." })).toMatchObject({
      score: 3,
      suggestion: "Need clearer evidence before replying."
    });
  });
});
