import { describe, expect, it } from "vitest";

import { guardPortalThreadModeChange } from "./thread-mode-guard.js";

describe("guardPortalThreadModeChange", () => {
  it("keeps the persisted agent when a stale client submits its fallback", () => {
    const incoming = { mode: "standard", sandboxMode: "workspace-write" };

    expect(guardPortalThreadModeChange({
      persistedConfig: { mode: "tech-support" },
      incomingConfig: incoming
    })).toEqual({ mode: "tech-support", sandboxMode: "workspace-write" });
    expect(incoming.mode).toBe("standard");
  });

  it("allows an agent change only when the user explicitly selected it", () => {
    const incoming = { mode: "review" };
    expect(guardPortalThreadModeChange({
      persistedConfig: { mode: "tech-support" },
      incomingConfig: incoming,
      allowModeChange: true
    })).toBe(incoming);
  });

  it("leaves matching or new-task configuration unchanged", () => {
    const matching = { mode: "tech-support" };
    expect(guardPortalThreadModeChange({
      persistedConfig: { mode: "tech-support" },
      incomingConfig: matching
    })).toBe(matching);
    expect(guardPortalThreadModeChange({ incomingConfig: { mode: "sales" } })).toEqual({ mode: "sales" });
  });
});
