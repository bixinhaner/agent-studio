import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CodexSkillService } from "./codex-skill-service.js";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const root = path.resolve(process.cwd(), "tmp");
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, "codex-skill-validation-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("CodexSkillService validation", () => {
  it("does not impose Agent Studio-specific file size, total size, or file count limits", async () => {
    const root = await createTemporaryDirectory();
    const skillDirectory = path.join(root, "large-assets-skill");
    const assetsDirectory = path.join(skillDirectory, "assets");
    await fs.mkdir(assetsDirectory, { recursive: true });
    await fs.writeFile(
      path.join(skillDirectory, "SKILL.md"),
      "---\nname: large-assets-skill\ndescription: Use large templates and reference assets.\n---\n\n# Large assets\n"
    );
    await fs.writeFile(path.join(assetsDirectory, "reviewed-template.pdf"), Buffer.alloc(3 * 1024 * 1024));
    await Promise.all(
      Array.from({ length: 81 }, (_, index) =>
        fs.writeFile(path.join(assetsDirectory, `reference-${index}.txt`), "reference")
      )
    );

    const service = new CodexSkillService(
      {} as ConstructorParameters<typeof CodexSkillService>[0],
      { draftRoot: path.join(root, "drafts"), publishedSkillsRoot: path.join(root, "published") }
    );
    const validation = await service.validateSkillDirectory(skillDirectory);

    expect(validation.ok).toBe(true);
    expect(validation.errors).toEqual([]);
    expect(validation.metadata?.fileCount).toBe(83);
    expect(validation.metadata?.totalBytes).toBeGreaterThan(3 * 1024 * 1024);
  });

  it("registers installed Skill presentation metadata before returning success", async () => {
    const root = await createTemporaryDirectory();
    const skillDirectory = path.join(root, "tp-generator");
    await fs.mkdir(path.join(skillDirectory, "agents"), { recursive: true });
    await fs.writeFile(
      path.join(skillDirectory, "SKILL.md"),
      "---\nname: tp-generator\ndescription: Build a customer-ready technical proposal.\n---\n\n# TP Generator\n"
    );
    await fs.writeFile(
      path.join(skillDirectory, "agents", "openai.yaml"),
      [
        "interface:",
        "  display_name: \"TP Generator\"",
        "  short_description: \"通过问答澄清需求并生成端到端技术方案\"",
        "  default_prompt: \"使用 $tp-generator 生成技术方案。\""
      ].join("\n")
    );

    const managedSkill = {
      id: "managed-tp",
      organizationId: "org-1",
      ownerUserId: "user-1",
      scope: "private",
      skillName: "tp-generator",
      slug: "tp-generator",
      displayName: "tp-generator",
      description: "Build a customer-ready technical proposal.",
      status: "active",
      version: "1.0.0",
      publishedPath: path.join(root, "published", "user", "org-1", "user-1", "tp-generator"),
      createdAt: "2026-09-02T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z"
    };
    const repository = {
      findManagedSkillByName: vi.fn().mockResolvedValue(undefined),
      upsertManagedSkill: vi.fn().mockResolvedValue(managedSkill)
    };
    const ensureManagedSkillEntry = vi.fn().mockResolvedValue(undefined);
    const service = new CodexSkillService(
      {
        repository,
        skillPackages: {} as never,
        agentModes: {} as never,
        skillCatalog: { ensureManagedSkillEntry }
      } as never,
      { draftRoot: path.join(root, "drafts"), publishedSkillsRoot: path.join(root, "published") }
    );

    const result = await service.installSkillFromDirectory({
      actor: { id: "user-1", organizationId: "org-1" },
      sourceDirectoryPath: skillDirectory
    });

    expect(result).toBe(managedSkill);
    expect(ensureManagedSkillEntry).toHaveBeenCalledWith({
      skill: managedSkill,
      defaultLocale: "zh-CN",
      initialTranslation: {
        displayName: "TP Generator",
        summary: "通过问答澄清需求并生成端到端技术方案",
        useCases: [],
        usageSteps: [],
        examplePrompts: ["使用 $tp-generator 生成技术方案。"],
        dataScope: undefined
      }
    });
  });
});

describe("CodexSkillService member sharing", () => {
  it("replaces direct member grants for the owned private Skill", async () => {
    const skill = {
      id: "managed-private",
      organizationId: "org-1",
      ownerUserId: "owner-1",
      scope: "private",
      skillName: "private-report",
      slug: "private-report",
      displayName: "Private report",
      status: "active",
      version: "1.0.0",
      publishedPath: "/managed/private-report",
      createdAt: "2026-09-02T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z"
    };
    let policies: Array<Record<string, unknown>> = [];
    const replacePoliciesForResource = vi.fn(async ({ policies: next }: { policies: Array<Record<string, unknown>> }) => {
      policies = next;
      return next;
    });
    const service = new CodexSkillService({
      repository: { getManagedSkill: vi.fn().mockResolvedValue(skill) },
      skillPackages: {} as never,
      agentModes: {} as never,
      resourcePolicies: {
        listAll: vi.fn(async () => policies),
        replacePoliciesForResource
      },
      memberDirectory: {
        listActiveForOrganization: vi.fn(async () => [
          { userId: "owner-1", displayName: "Owner" },
          { userId: "member-1", displayName: "Member One", email: "member1@example.com" }
        ])
      }
    } as never, {
      draftRoot: "/drafts",
      publishedSkillsRoot: "/published"
    });

    const result = await service.updateManagedSkillSharing({
      actor: { id: "owner-1", organizationId: "org-1" },
      skillId: skill.id,
      userIds: ["member-1", "member-1", "owner-1"]
    });

    expect(replacePoliciesForResource).toHaveBeenCalledWith({
      resourceType: "managed_skill",
      resourceId: skill.id,
      policies: [expect.objectContaining({ subjectId: "member-1", effect: "allow" })]
    });
    expect(result.members).toEqual([{ userId: "member-1", displayName: "Member One", email: "member1@example.com" }]);
    expect(result.owner).toEqual({ userId: "owner-1", displayName: "Owner" });
    expect(result.availableMembers).toHaveLength(1);
  });

  it("rejects recipients outside the current organization", async () => {
    const service = new CodexSkillService({
      repository: { getManagedSkill: vi.fn().mockResolvedValue({
        id: "managed-private",
        organizationId: "org-1",
        ownerUserId: "owner-1",
        scope: "private",
        skillName: "private-report",
        status: "active"
      }) },
      skillPackages: {} as never,
      agentModes: {} as never,
      resourcePolicies: { listAll: vi.fn(), replacePoliciesForResource: vi.fn() },
      memberDirectory: { listActiveForOrganization: vi.fn(async () => []) }
    } as never, { draftRoot: "/drafts", publishedSkillsRoot: "/published" });

    await expect(service.updateManagedSkillSharing({
      actor: { id: "owner-1", organizationId: "org-1" },
      skillId: "managed-private",
      userIds: ["other-org-user"]
    })).rejects.toThrow("只能共享给当前组织的有效成员");
  });
});
