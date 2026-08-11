import { describe, expect, it } from "vitest";

import { resolveModeLabel, resolveModeOptions } from "./runtime-labels";

describe("portal runtime labels", () => {
  it("does not invent a General Assistant while runtime options are loading", () => {
    expect(resolveModeOptions([], "standard")).toEqual([]);
    expect(resolveModeLabel([], "standard")).toBe("");
  });

  it("returns only server-provided mode labels", () => {
    const options = [{ id: "support", label: "Tech-support" }];
    expect(resolveModeOptions(options, "support")).toBe(options);
    expect(resolveModeLabel(options, "support")).toBe("Tech-support");
    expect(resolveModeLabel(options, "missing")).toBe("");
  });
});
