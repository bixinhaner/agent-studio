import { describe, expect, it } from "vitest";

import { parseTrainingTranslations } from "./training-translation-prompt.js";

describe("parseTrainingTranslations", () => {
  it("accepts plain and fenced JSON while enforcing item count", () => {
    expect(parseTrainingTranslations('{"translations":["One","Two"]}', 2)).toEqual(["One", "Two"]);
    expect(parseTrainingTranslations('```json\n{"translations":["One"]}\n```', 1)).toEqual(["One"]);
    expect(() => parseTrainingTranslations('{"translations":["One"]}', 2)).toThrow(/数量不匹配/);
  });
});
