import { describe, expect, it } from "vitest";

import { mergeRunConfigPreservingSkillSelection } from "./thread-turn-config.js";

const ACTIVATION_KEY = "_agentStudioSkillActivationPrompts";

describe("mergeRunConfigPreservingSkillSelection", () => {
  it("does not let an unhydrated empty skill list overwrite the persisted selection", () => {
    const persisted = {
      mode: "tech-support",
      enabledSkills: [{ id: "vpn", name: "surge-vpn-manage" }],
      [ACTIVATION_KEY]: [{ name: "surge-vpn-manage", prompt: "Use the VPN management workflow." }]
    };

    expect(
      mergeRunConfigPreservingSkillSelection(
        persisted,
        {
          mode: "tech-support",
          sandboxMode: "read-only",
          enabledSkills: []
        },
        ACTIVATION_KEY
      )
    ).toEqual({
      ...persisted,
      sandboxMode: "read-only"
    });
  });

  it("keeps skill selection absent when a new thread has no persisted selection", () => {
    expect(
      mergeRunConfigPreservingSkillSelection(
        undefined,
        { mode: "tech-support", enabledSkills: [] },
        ACTIVATION_KEY
      )
    ).toEqual({ mode: "tech-support" });
  });
});
