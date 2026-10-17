// A non-OMC source system profile shared by tests.
export const BOSS_API_PROFILE = {
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
