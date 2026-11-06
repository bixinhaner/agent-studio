import { describe, expect, it } from "vitest";

import { shouldHydratePortalThreadSkills } from "./thread-message-persistence";

describe("training read-only thread isolation", () => {
  it("does not load ordinary workspace thread details for a training conversation", () => {
    expect(shouldHydratePortalThreadSkills({
      threadId: "training-thread-1",
      trainingReadOnly: true
    })).toBe(false);
  });

  it("hydrates skills for editable conversations of internal and external users alike", () => {
    expect(shouldHydratePortalThreadSkills({
      threadId: "workspace-thread-1",
      trainingReadOnly: false
    })).toBe(true);
  });
});
