import { describe, expect, it } from "vitest";

import { applyBrandPolicyToUnknown, applyBrandTextPolicy, brandRuntimePolicyPrompt } from "./content-policy.js";
import type { PublicBrandRecord } from "./types.js";

function ranleyPolicy(): PublicBrandRecord {
  return {
    platformName: "Ranley",
    knowledgeReplacementRules: [
      { source: "Baicells", target: "CloudRAN.AI", mode: "replace" },
      { source: "Bailey", target: "Ranley", mode: "replace" },
      { source: "Agent Studio", target: "Ranley", mode: "replace" }
    ],
    outputProtectionEnabled: true,
    outputForbiddenTerms: ["Baicells", "Bailey", "Agent Studio"]
  } as PublicBrandRecord;
}

describe("public brand output policy", () => {
  it("rewrites source-brand terms before checking forbidden output", () => {
    expect(applyBrandTextPolicy("Baicells docs in Bailey Agent Studio", ranleyPolicy()))
      .toBe("CloudRAN.AI docs in Ranley Ranley");
  });

  it("sanitizes nested runtime payloads without changing non-text values", () => {
    expect(applyBrandPolicyToUnknown({
      title: "Bailey result",
      events: [{ detail: "Source: Baicells" }],
      count: 3
    }, ranleyPolicy())).toEqual({
      title: "Ranley result",
      events: [{ detail: "Source: CloudRAN.AI" }],
      count: 3
    });
  });

  it("injects the brand identity and output constraints into the runtime prompt", () => {
    const prompt = brandRuntimePolicyPrompt(ranleyPolicy());
    expect(prompt).toContain("serving the Ranley customer brand");
    expect(prompt).toContain("Baicells -> CloudRAN.AI");
    expect(prompt).toContain("Forbidden output terms");
  });
});
