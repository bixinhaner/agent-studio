import { describe, expect, it } from "vitest";

import { PORTAL_STARTER_SUGGESTIONS } from "./starter-suggestions";

describe("starter suggestions", () => {
  it("contains structured-output and thread-document prompts", () => {
    const prompts = PORTAL_STARTER_SUGGESTIONS.map((item) => item.prompt);
    expect(prompts.some((p) => p.includes("结构化"))).toBe(true);
    expect(prompts.some((p) => p.includes("文档"))).toBe(true);
  });

  it("keeps prompt list unique and bounded", () => {
    const prompts = PORTAL_STARTER_SUGGESTIONS.map((item) => item.prompt);
    expect(new Set(prompts).size).toBe(prompts.length);
    expect(PORTAL_STARTER_SUGGESTIONS.length).toBeGreaterThanOrEqual(3);
    expect(PORTAL_STARTER_SUGGESTIONS.length).toBeLessThanOrEqual(6);
  });
});

