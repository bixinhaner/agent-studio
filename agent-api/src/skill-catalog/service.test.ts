import { describe, expect, it } from "vitest";

import { resolveSkillCatalogPresentation, selectCatalogEntry } from "./service.js";
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
