import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACTION_CONNECTOR_API_PROFILE,
  parseApiProfile,
  sameApiProfile,
  trimApiProfile,
  validateApiProfile,
  writeApiProfileField
} from "./actionConnectorApiProfile";

const BOSS = {
  sourceName: "BOSS",
  pathPrefix: "/api/agent/",
  catalog: {
    searchPath: "/api/agent/ai-assistant/catalog",
    searchOperationId: "boss.catalog.search",
    categoriesPath: "/api/agent/ai-assistant/catalog/categories",
    categoriesOperationId: "boss.catalog.categories",
    describePath: "/api/agent/ai-assistant/catalog/describe",
    describeOperationId: "boss.catalog.describe"
  },
  handbook: {
    manifestPath: "/api/agent/ai-assistant/handbook/manifest",
    manifestOperationId: "boss.handbook.manifest",
    chunkPathTemplate: "/api/agent/ai-assistant/handbook/chunks/{index}",
    chunkOperationId: "boss.handbook.chunk"
  },
  skillName: "boss-operations"
};

describe("action connector API profile draft", () => {
  it("falls back to OMC defaults field by field", () => {
    expect(parseApiProfile(undefined)).toEqual(DEFAULT_ACTION_CONNECTOR_API_PROFILE);
    expect(parseApiProfile({ skillName: "boss-operations", catalog: { searchPath: 1 } })).toEqual({ ...DEFAULT_ACTION_CONNECTOR_API_PROFILE, skillName: "boss-operations" });
    expect(parseApiProfile(BOSS)).toEqual(BOSS);
    expect(sameApiProfile(parseApiProfile({}), DEFAULT_ACTION_CONNECTOR_API_PROFILE)).toBe(true);
  });

  it("validates like the server and points at the offending field", () => {
    expect(validateApiProfile(BOSS)).toEqual({});
    expect(validateApiProfile(DEFAULT_ACTION_CONNECTOR_API_PROFILE)).toEqual({});
    expect(validateApiProfile(writeApiProfileField(BOSS, "catalog.searchPath", "/api/v1/agent/catalog"))).toEqual({ "catalog.searchPath": "必须以 /api/agent/ 开头" });
    expect(validateApiProfile(writeApiProfileField(BOSS, "handbook.chunkOperationId", "boss.catalog.search"))).toEqual({ "handbook.chunkOperationId": "与其他 operationId 重复" });
    expect(validateApiProfile(writeApiProfileField(BOSS, "handbook.chunkPathTemplate", "/api/agent/ai-assistant/handbook/chunks"))).toEqual({ "handbook.chunkPathTemplate": "必须且只能包含一次 {index}" });
    expect(validateApiProfile(writeApiProfileField(BOSS, "skillName", ""))).toEqual({ skillName: "必填" });
    expect(trimApiProfile(writeApiProfileField(BOSS, "sourceName", " BOSS "))).toEqual(BOSS);
  });
});
