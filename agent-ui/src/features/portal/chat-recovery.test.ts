import { describe, expect, it } from "vitest";

import { resolvePortalChatRecoveryActive } from "./chat-recovery";

describe("portal chat recovery presentation", () => {
  it("shows recovery only while the automatic retry is active", () => {
    expect(resolvePortalChatRecoveryActive(false, "automatic-retry")).toBe(true);
    expect(resolvePortalChatRecoveryActive(true, "automatic-recovered")).toBe(false);
    expect(resolvePortalChatRecoveryActive(true, "run-complete")).toBe(false);
    expect(resolvePortalChatRecoveryActive(true, "run-failed")).toBe(false);
    expect(resolvePortalChatRecoveryActive(true, "run-start")).toBe(false);
  });
});
