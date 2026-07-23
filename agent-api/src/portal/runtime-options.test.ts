import { describe, expect, it } from "vitest";

import { toPortalRuntimeOptions } from "./runtime-options.js";

describe("toPortalRuntimeOptions", () => {
  it("removes server-only Skill activation and path metadata from the Portal DTO", () => {
    const output = toPortalRuntimeOptions(
      {
        modes: [
          {
            id: "mode-tech",
            label: "Tech",
            runtimeProfile: {
              id: "profile-tech",
              name: "Tech profile",
              slug: "tech-profile",
              status: "active",
              defaultModel: "gpt-5.5",
              allowedModels: ["gpt-5.5"],
              defaultReasoningEffort: "high",
              sandboxMode: "workspace-write",
              approvalPolicy: "never",
              networkAccessEnabled: true,
              webSearchMode: "live"
            },
            allowDirectorySelection: false,
            availableSkills: [
              {
                id: "skill-a",
                name: "skill-a",
                label: "Skill A",
                system: false,
                activationPrompt: "private runtime instructions",
                sourcePath: "/private/skills/skill-a",
                presentation: {
                  displayName: "Skill A",
                  summary: "Use Skill A",
                  useCases: [],
                  usageSteps: [],
                  examplePrompts: [],
                  iconKey: "sparkles",
                  sortOrder: 100,
                  requestedLocale: "zh-CN",
                  resolvedLocale: "zh-CN"
                }
              }
            ],
            automaticSkills: [],
            skillPackages: [],
            instructionSources: []
          }
        ],
        recentSkillIds: ["skill-a"],
        canUpload: true,
        defaults: { mode: "mode-tech" }
      },
      { models: [], source: "fallback", fetchedAt: "2026-07-16T00:00:00.000Z" }
    );

    expect(output.recentSkillIds).toEqual(["skill-a"]);
    expect(output.modes[0]?.availableSkills[0]).not.toHaveProperty("activationPrompt");
    expect(output.modes[0]?.availableSkills[0]).not.toHaveProperty("sourcePath");
  });
});
