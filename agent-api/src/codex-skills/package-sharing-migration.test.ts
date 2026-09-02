import { describe, expect, it } from "vitest";

import { planPackageSharingMigration } from "./package-sharing-migration.js";

const skills = ["alarm", "bss", "power"].map((skillName) => ({
  id: `skill-${skillName}`,
  organizationId: "org-1",
  ownerUserId: "owner-1",
  scope: "agent_mode",
  status: "active",
  skillName,
  slug: skillName,
  publishedPath: `/skills/managed/${skillName}`
}));

const packagePolicies = ["owner-1", "member-1", "member-2"].map((subjectId) => ({
  id: `policy-${subjectId}`,
  organizationId: "org-1",
  subjectType: "user",
  subjectId,
  resourceType: "skill_package",
  resourceId: "package-1",
  effect: "allow"
}));

describe("planPackageSharingMigration", () => {
  it("converts one multi-Skill package into member grants without duplicating the owner", () => {
    const plan = planPackageSharingMigration({
      skills,
      packages: [{
        id: "package-1",
        slug: "reports",
        bindings: skills.map((skill) => ({
          runtimeType: "codex",
          bindingType: "codex_skill",
          bindingPayload: { managedSkillId: skill.id }
        }))
      }],
      packagePolicies,
      managedSkillPolicies: []
    });

    expect(plan.skills).toHaveLength(3);
    expect(plan.packagePolicyIdsToDelete).toHaveLength(3);
    expect(plan.managedPoliciesToCreate).toHaveLength(6);
    expect(plan.managedPoliciesToCreate.some((policy) => policy.subjectId === "owner-1")).toBe(false);
    expect(plan.blockers).toEqual([]);
  });

  it("is repeatable and blocks conflicting existing member grants", () => {
    const sameAllow = {
      id: "existing-allow",
      organizationId: "org-1",
      subjectType: "user",
      subjectId: "member-1",
      resourceType: "managed_skill",
      resourceId: "skill-alarm",
      effect: "allow"
    };
    const opposite = {
      ...sameAllow,
      id: "existing-deny",
      subjectId: "member-2",
      effect: "deny"
    };
    const plan = planPackageSharingMigration({
      skills,
      packages: [{
        id: "package-1",
        slug: "reports",
        bindings: skills.map((skill) => ({
          runtimeType: "codex",
          bindingType: "codex_skill",
          bindingPayload: { managedSkillId: skill.id }
        }))
      }],
      packagePolicies,
      managedSkillPolicies: [sameAllow, opposite]
    });

    expect(plan.retainedManagedPolicies).toBe(1);
    expect(plan.managedPoliciesToCreate).toHaveLength(4);
    expect(plan.blockers).toContain("用户 member-2 对 Skill alarm 已存在相反的 deny 授权");
  });

  it("skips a package that mixes a target Skill with an unsupported binding", () => {
    const plan = planPackageSharingMigration({
      skills,
      packages: [{
        id: "package-1",
        slug: "mixed",
        bindings: [
          { runtimeType: "codex", bindingType: "codex_skill", bindingPayload: { managedSkillId: "skill-alarm" } },
          { runtimeType: "mcp", bindingType: "tool", bindingPayload: { name: "lookup" } }
        ]
      }],
      packagePolicies,
      managedSkillPolicies: []
    });

    expect(plan.skills).toEqual([]);
    expect(plan.packagePolicyIdsToDelete).toEqual([]);
    expect(plan.skippedPackages).toHaveLength(1);
  });
});
