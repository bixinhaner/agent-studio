import { describe, expect, it } from "vitest";

import {
  resolveAssistantCompletionLocale,
  resolveCompletedAssistantText
} from "./assistant-completion.js";

describe("assistant completion", () => {
  it("preserves a non-empty runtime answer", () => {
    expect(resolveCompletedAssistantText({
      answerText: "  Done.  ",
      emptyAnswerText: "Fallback",
      generatedArtifactCount: 2,
      locale: "zh-CN"
    })).toBe("Done.");
  });

  it("describes persisted generated artifacts when the final text is empty", () => {
    expect(resolveCompletedAssistantText({
      answerText: "",
      generatedArtifactCount: 2,
      locale: "zh-CN"
    })).toBe("生成已完成，结果已附在本次回复中。");
    expect(resolveCompletedAssistantText({
      answerText: "",
      generatedArtifactCount: 1,
      locale: "en-US"
    })).toBe("Generation completed. The result is attached to this response.");
  });

  it("uses the channel fallback when no artifact or text was produced", () => {
    expect(resolveCompletedAssistantText({
      answerText: "   ",
      emptyAnswerText: "No answer was generated.",
      generatedArtifactCount: 0,
      locale: "en"
    })).toBe("No answer was generated.");
  });

  it("treats only Chinese locale prefixes as Chinese", () => {
    expect(resolveAssistantCompletionLocale("zh-Hans-CN")).toBe("zh");
    expect(resolveAssistantCompletionLocale("en-US,en;q=0.9")).toBe("en");
    expect(resolveAssistantCompletionLocale(undefined)).toBe("en");
  });
});
