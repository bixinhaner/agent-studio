import { z } from "zod";

// Each connected business system publishes its own catalog, handbook and Skill.
// Studio reads these from the connector's admin-managed apiProfile instead of
// assuming OMC paths. Missing fields keep the original OMC values so existing
// OMC/OXM connectors behave exactly as before.
export const OMC_API_PROFILE = {
  sourceName: "xOMC",
  pathPrefix: "/api/v1/",
  catalog: {
    searchPath: "/api/v1/agent/catalog",
    searchOperationId: "get.agent.catalog",
    categoriesPath: "/api/v1/agent/catalog/categories",
    categoriesOperationId: "get.agent.catalog.categories",
    describePath: "/api/v1/agent/catalog/describe",
    describeOperationId: "get.agent.catalog.describe"
  },
  handbook: {
    manifestPath: "/api/v1/agent/handbook/manifest",
    manifestOperationId: "get.agent.handbook.manifest",
    chunkPathTemplate: "/api/v1/agent/handbook/chunks/{index}",
    chunkOperationId: "get.agent.handbook.chunks.by_index"
  },
  skillName: "omc-operations"
} as const;

const apiPath = z.string().trim().min(2).max(200).regex(/^\/[A-Za-z0-9._~\-/{}]*$/, "must be an absolute API path");
const operationId = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9._:-]+$/, "must be an operation ID");

export const apiProfileSchema = z
  .object({
    sourceName: z.string().trim().min(1).max(60).default(OMC_API_PROFILE.sourceName),
    pathPrefix: apiPath.refine((value) => value.endsWith("/"), "must end with /").default(OMC_API_PROFILE.pathPrefix),
    catalog: z
      .object({
        searchPath: apiPath.default(OMC_API_PROFILE.catalog.searchPath),
        searchOperationId: operationId.default(OMC_API_PROFILE.catalog.searchOperationId),
        categoriesPath: apiPath.default(OMC_API_PROFILE.catalog.categoriesPath),
        categoriesOperationId: operationId.default(OMC_API_PROFILE.catalog.categoriesOperationId),
        describePath: apiPath.default(OMC_API_PROFILE.catalog.describePath),
        describeOperationId: operationId.default(OMC_API_PROFILE.catalog.describeOperationId)
      })
      .default({}),
    // The handbook is mandatory: background assistants bootstrap every
    // connected system from its published, digest-verified handbook.
    handbook: z
      .object({
        manifestPath: apiPath.default(OMC_API_PROFILE.handbook.manifestPath),
        manifestOperationId: operationId.default(OMC_API_PROFILE.handbook.manifestOperationId),
        chunkPathTemplate: apiPath
          .refine((value) => value.split("{index}").length === 2, "must contain {index} exactly once")
          .default(OMC_API_PROFILE.handbook.chunkPathTemplate),
        chunkOperationId: operationId.default(OMC_API_PROFILE.handbook.chunkOperationId)
      })
      .default({}),
    skillName: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "must be a Skill name").default(OMC_API_PROFILE.skillName)
  })
  .superRefine((profile, ctx) => {
    const paths: Array<[string[], string]> = [
      [["catalog", "searchPath"], profile.catalog.searchPath],
      [["catalog", "categoriesPath"], profile.catalog.categoriesPath],
      [["catalog", "describePath"], profile.catalog.describePath],
      [["handbook", "manifestPath"], profile.handbook.manifestPath],
      [["handbook", "chunkPathTemplate"], profile.handbook.chunkPathTemplate]
    ];
    for (const [path, value] of paths) {
      if (!value.startsWith(profile.pathPrefix)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: `must start with pathPrefix ${profile.pathPrefix}` });
      }
    }
    const ids = [...discoveryOperationIds(profile), ...handbookOperationIds(profile)];
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["catalog"], message: "catalog and handbook operation IDs must be distinct" });
    }
  });

export type ApiProfile = z.infer<typeof apiProfileSchema>;

// Connectors without an admin-managed profile keep the original OMC contract.
export function resolveApiProfile(profile: ApiProfile | undefined): ApiProfile {
  return profile ?? apiProfileSchema.parse({});
}

export function discoveryOperationIds(profile: Pick<ApiProfile, "catalog">): string[] {
  return [profile.catalog.searchOperationId, profile.catalog.categoriesOperationId, profile.catalog.describeOperationId];
}

export function handbookOperationIds(profile: Pick<ApiProfile, "handbook">): string[] {
  return [profile.handbook.manifestOperationId, profile.handbook.chunkOperationId];
}

export function hasProfilePrefix(path: string, profile: Pick<ApiProfile, "pathPrefix">): boolean {
  return path.startsWith(profile.pathPrefix);
}
