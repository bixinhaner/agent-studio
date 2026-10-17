import { describe, expect, it } from "vitest";
import { BOSS_API_PROFILE } from "./api-profile.fixtures.js";
import { OMC_API_PROFILE, apiProfileSchema, discoveryOperationIds, handbookOperationIds, resolveApiProfile } from "./api-profile.js";

describe("connector API profile", () => {
  it("defaults every field to the original OMC contract", () => {
    expect(apiProfileSchema.parse({})).toEqual(OMC_API_PROFILE);
    expect(resolveApiProfile(undefined)).toEqual(OMC_API_PROFILE);
    expect(discoveryOperationIds(OMC_API_PROFILE)).toEqual(["get.agent.catalog", "get.agent.catalog.categories", "get.agent.catalog.describe"]);
    expect(handbookOperationIds(OMC_API_PROFILE)).toEqual(["get.agent.handbook.manifest", "get.agent.handbook.chunks.by_index"]);
  });

  it("accepts a source system's own paths, operation IDs and Skill", () => {
    expect(apiProfileSchema.parse(BOSS_API_PROFILE)).toEqual(BOSS_API_PROFILE);
    expect(apiProfileSchema.parse({ skillName: "boss-operations" })).toMatchObject({ pathPrefix: "/api/v1/", skillName: "boss-operations" });
  });

  it("rejects paths outside the prefix, duplicate operation IDs and malformed chunk templates", () => {
    const issues = (input: unknown) => {
      const result = apiProfileSchema.safeParse(input);
      return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    };
    expect(issues({ ...BOSS_API_PROFILE, catalog: { ...BOSS_API_PROFILE.catalog, searchPath: "/api/v1/agent/catalog" } }))
      .toEqual(["catalog.searchPath: must start with pathPrefix /api/agent/"]);
    expect(issues({ ...BOSS_API_PROFILE, handbook: { ...BOSS_API_PROFILE.handbook, chunkOperationId: "boss.catalog.search" } }))
      .toEqual(["catalog: catalog and handbook operation IDs must be distinct"]);
    expect(issues({ ...BOSS_API_PROFILE, handbook: { ...BOSS_API_PROFILE.handbook, chunkPathTemplate: "/api/agent/ai-assistant/handbook/chunks" } }))
      .toEqual(["handbook.chunkPathTemplate: must contain {index} exactly once"]);
    expect(issues({ ...BOSS_API_PROFILE, pathPrefix: "/api/agent" })).toContain("pathPrefix: must end with /");
    expect(issues({ ...BOSS_API_PROFILE, skillName: "../omc" })).toEqual(["skillName: must be a Skill name"]);
  });
});
