import { describe, expect, it } from "vitest";

import { buildTrainingTranslationPrompt, parseTrainingTranslations } from "./training-translation-prompt.js";

describe("parseTrainingTranslations", () => {
  it("accepts plain and fenced JSON while enforcing item count", () => {
    expect(parseTrainingTranslations('{"translations":["One","Two"]}', 2)).toEqual(["One", "Two"]);
    expect(parseTrainingTranslations('```json\n{"translations":["One"]}\n```', 1)).toEqual(["One"]);
    expect(() => parseTrainingTranslations('{"translations":["One"]}', 2)).toThrow(/数量不匹配/);
  });
});

describe("buildTrainingTranslationPrompt", () => {
  it("preserves technical identifiers and extensions in filename mode", () => {
    const prompt = buildTrainingTranslationPrompt(["销售分析_华北华东_20260730_v04.xlsx"], "filename");
    expect(prompt).toContain("Preserve file extensions, version numbers, dates");
    expect(prompt).toContain("销售分析_华北华东_20260730_v04.xlsx");
  });
});
