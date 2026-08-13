import { describe, expect, it } from "vitest";

import { shouldHydratePortalThreadSkills } from "./PortalShell";

describe("training read-only thread isolation", () => {
  it("does not load ordinary workspace thread details for a training conversation", () => {
    expect(shouldHydratePortalThreadSkills({
      threadId: "training-thread-1",
      isExternalPortalUser: false,
      trainingReadOnly: true
    })).toBe(false);
  });

  it("keeps skill hydration for an editable internal workspace conversation", () => {
    expect(shouldHydratePortalThreadSkills({
      threadId: "workspace-thread-1",
      isExternalPortalUser: false,
      trainingReadOnly: false
    })).toBe(true);
  });
});
