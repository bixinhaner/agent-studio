import { describe, expect, it, vi } from "vitest";

import { SkillCatalogService, resolveSkillCatalogPresentation, selectCatalogEntry } from "./service.js";
import type { SkillCatalogEntryRecord } from "./types.js";

const entry: SkillCatalogEntryRecord = {
  id: "catalog-skill-creator",
  catalogKey: "global:native:skill-creator",
  sourceType: "native",
  sourceRef: "skill-creator",
  canonicalName: "skill-creator",
  defaultLocale: "zh-CN",
  iconKey: "wand-sparkles",
  sortOrder: 30,
  shortcutKey: "create_skill",
  status: "active",
  createdAt: "2026-07-22T00:00:00.000Z",
  updatedAt: "2026-07-22T00:00:00.000Z",
  translations: {
    "zh-CN": {
      displayName: "Skill 创建助手",
      summary: "通过对话创建 Skill",
      useCases: ["创建新的 Skill"],
      usageSteps: ["描述目标"],
      examplePrompts: ["帮我创建一个 Skill"],
      dataScope: "当前会话"
    },
    "en-US": {
      displayName: "Skill Creator",
      summary: "Create a Skill through conversation",
      useCases: [],
      usageSteps: [],
      examplePrompts: [],
      dataScope: "Current conversation"
    }
  }
};

describe("resolveSkillCatalogPresentation", () => {
  it("returns the requested locale and non-localized shortcut configuration", () => {
    expect(resolveSkillCatalogPresentation({ entry, requestedLocale: "en-US", canonicalName: entry.canonicalName })).toMatchObject({
      displayName: "Skill Creator",
      summary: "Create a Skill through conversation",
      shortcutKey: "create_skill",
      resolvedLocale: "en-US"
    });
  });

  it("falls back to the default locale when a requested locale is missing", () => {
    expect(resolveSkillCatalogPresentation({ entry, requestedLocale: "id-ID", canonicalName: entry.canonicalName })).toMatchObject({
      displayName: "Skill 创建助手",
      resolvedLocale: "zh-CN",
      fallbackLocale: "zh-CN"
    });
  });

  it("prefers organization entries over global entries", () => {
    const organizationEntry = { ...entry, id: "org-entry", organizationId: "org-1" };
    expect(selectCatalogEntry({ entries: [entry, organizationEntry], organizationId: "org-1", sourceType: "native", sourceRef: "skill-creator" })?.id).toBe("org-entry");
  });
});

describe("SkillCatalogService.syncAndList", () => {
  it("preserves the managed scope and exposes owner, creator, and bound agent audiences", async () => {
    const managedEntry: SkillCatalogEntryRecord = {
      ...entry,
      id: "catalog-managed-1",
      catalogKey: "org:org-1:managed:managed-1",
      organizationId: "org-1",
      sourceType: "managed",
      sourceRef: "managed-1",
      canonicalName: "managed-report"
    };
    const repository = {
      ensureEntry: vi.fn().mockResolvedValue(managedEntry),
      list: vi.fn().mockResolvedValue([managedEntry])
    };
    const service = new SkillCatalogService(repository as never, {
      nativeSkills: { list: vi.fn().mockResolvedValue([]) },
      managedSkills: {
        listManagedSkills: vi.fn().mockResolvedValue([{
          id: "managed-1",
          organizationId: "org-1",
          ownerUserId: "user-1",
          scope: "agent_mode",
          skillName: "managed-report",
          slug: "managed-report",
          displayName: "Managed report",
          status: "active",
          version: "1.0.0",
          publishedPath: "/skills/managed-report",
          createdByUserId: "user-1",
          createdByDisplayName: "Old display name",
          createdByEmail: "old@example.com",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z"
        }])
      },
      users: {
        getById: vi.fn().mockResolvedValue({ id: "user-1", displayName: "Current name", email: "current@example.com" })
      },
      skillPackages: {
        list: vi.fn().mockResolvedValue([{
          id: "package-1",
          items: [{ runtimeBindings: [{
            runtimeType: "codex",
            bindingType: "codex_skill",
            bindingPayload: { managedSkillId: "managed-1", skillName: "managed-report" }
          }] }]
        }, {
          id: "package-other-owner",
          items: [{ runtimeBindings: [{
            runtimeType: "codex",
            bindingType: "codex_skill",
            bindingPayload: { managedSkillId: "managed-other", skillName: "managed-report" }
          }] }]
        }])
      },
      agentModes: {
        list: vi.fn().mockResolvedValue([{
          id: "mode-1",
          organizationId: undefined,
          name: "Finance assistant",
          slug: "finance-assistant",
          skillPackages: [{ skillPackageId: "package-1" }]
        }, {
          id: "mode-other",
          organizationId: "org-1",
          name: "Other owner's assistant",
          slug: "other-owner-assistant",
          skillPackages: [{ skillPackageId: "package-other-owner" }]
        }])
      },
      resourcePolicies: {
        listAll: vi.fn().mockResolvedValue([{
          organizationId: "org-1",
          subjectType: "user",
          subjectId: "user-2",
          resourceType: "skill_package",
          resourceId: "package-1",
          effect: "allow"
        }, {
          organizationId: "org-1",
          subjectType: "user",
          subjectId: "user-3",
          resourceType: "skill_package",
          resourceId: "package-other-owner",
          effect: "allow"
        }])
      }
    });

    const [record] = await service.syncAndList({ organizationId: "org-1", organizationName: "Internal Organization" });

    expect(record).toMatchObject({
      scope: "agent_mode",
      rawScope: "agent_mode",
      sourceStatus: "active",
      owner: { userId: "user-1", displayName: "Current name", email: "current@example.com" },
      createdBy: { userId: "user-1", displayName: "Current name", email: "current@example.com" },
      organization: { id: "org-1", name: "Internal Organization" },
      audiences: [{ type: "agent_mode", id: "mode-1", name: "Finance assistant", secondaryLabel: "finance-assistant" }],
      access: {
        packageIds: ["package-1"],
        subjects: [{
          subjectType: "user",
          subjectId: "user-2",
          effect: "allow"
        }]
      }
    });
  });
});
