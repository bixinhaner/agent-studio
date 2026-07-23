import { describe, expect, it } from "vitest";

import { normalizeLatexDelimiters } from "../latex-delimiters";

describe("normalizeLatexDelimiters", () => {
  it("normalizes inline and display LaTeX delimiters used by agent responses", () => {
    const source = [
      "当前面向 \\(\\tau\\) 的轻量短时预测。",
      "",
      "\\[",
      "\\mathbf H_{\\mathrm{FR1}}^{\\mathrm{UL}}(t) \\neq \\mathbf H_{\\mathrm{FR2}}^{\\mathrm{DL}}(t)",
      "\\]"
    ].join("\n");

    expect(normalizeLatexDelimiters(source)).toBe(
      [
        "当前面向 $\\tau$ 的轻量短时预测。",
        "",
        "$$",
        "\\mathbf H_{\\mathrm{FR1}}^{\\mathrm{UL}}(t) \\neq \\mathbf H_{\\mathrm{FR2}}^{\\mathrm{DL}}(t)",
        "$$"
      ].join("\n")
    );
  });

  it("preserves existing dollar math and unmatched streaming delimiters", () => {
    const source = ["$E=mc^2$", "$$", "\\int_0^1 x^2 dx", "$$", "生成中：\\(\\tau"].join("\n");
    expect(normalizeLatexDelimiters(source)).toBe(source);
  });

  it("keeps compact display delimiters as display math", () => {
    expect(normalizeLatexDelimiters("Before \\[x+y\\] after")).toBe(
      ["Before ", "", "$$", "x+y", "$$", "", " after"].join("\n")
    );
  });

  it("does not transform inline or fenced code examples", () => {
    const source = [
      "正文 \\(x+y\\)",
      "",
      "`inline \\(x+y\\)`",
      "",
      "```tex",
      "\\[",
      "x+y",
      "\\]",
      "```",
      "",
      "~~~md",
      "\\(literal\\)",
      "~~~"
    ].join("\n");

    expect(normalizeLatexDelimiters(source)).toBe(
      [
        "正文 $x+y$",
        "",
        "`inline \\(x+y\\)`",
        "",
        "```tex",
        "\\[",
        "x+y",
        "\\]",
        "```",
        "",
        "~~~md",
        "\\(literal\\)",
        "~~~"
      ].join("\n")
    );
  });

  it("keeps escaped delimiter examples literal", () => {
    const source = String.raw`literal \\(x+y\\)`;
    expect(normalizeLatexDelimiters(source)).toBe(source);
  });
});
