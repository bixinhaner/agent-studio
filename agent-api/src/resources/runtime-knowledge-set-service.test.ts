import { describe, expect, it, vi } from "vitest";

import { RuntimeKnowledgeSetService } from "./runtime-knowledge-set-service.js";

describe("RuntimeKnowledgeSetService public brand binding", () => {
  it("mounts the brand knowledge set and ignores a client-selected set", async () => {
    const filterAllowedResources = vi.fn(async ({ candidateIds }: { candidateIds: string[] }) => candidateIds);
    const service = new RuntimeKnowledgeSetService({
      knowledgeSets: {
        list: async () => [
          { id: "knowledge-ranley", status: "active", sourceType: "managed_upload", storageKey: "CRAI-Docs" },
          { id: "knowledge-bailey", status: "active", sourceType: "managed_upload", storageKey: "Docs" }
        ]
      },
      policies: { filterAllowedResources },
      storage: { resolveReadableMountPath: (key: string) => `/data/${key}` },
      publicBrands: {
        getForOrganization: async () => ({
          resourceBindingMode: "brand_managed",
          knowledgeSetIds: ["knowledge-ranley"],
          knowledgeIsolationMode: "direct"
        }),
        ensureKnowledgeProjection: async (brand: unknown) => brand
      }
    } as never);

    const result = await service.mergeSelectedKnowledgeSetsIntoRunConfig({
      organizationId: "org-ranley",
      userId: "user-ranley",
      roleIds: ["customer_member"],
      departmentIds: [],
      workspacePath: "/workspace/user-ranley",
      knowledgeSetIds: ["knowledge-bailey"]
    });

    expect(result?.additionalDirectories).toEqual(["/data/CRAI-Docs"]);
    expect(result?._agentStudioKnowledgeSets).toEqual({
      workspacePath: "/workspace/user-ranley",
      selectedIds: ["knowledge-ranley"],
      mountPaths: ["/data/CRAI-Docs"]
    });
    expect(filterAllowedResources).not.toHaveBeenCalled();
  });

  it("uses organization-authorized knowledge selections for brand employees", async () => {
    const filterAllowedResources = vi.fn(async ({ candidateIds }: { candidateIds: string[] }) => candidateIds);
    const service = new RuntimeKnowledgeSetService({
      knowledgeSets: {
        list: async () => [
          { id: "knowledge-customer", status: "active", sourceType: "managed_upload", storageKey: "Customer" },
          { id: "knowledge-employee", status: "active", sourceType: "managed_upload", storageKey: "Employee" }
        ]
      },
      policies: { filterAllowedResources },
      storage: { resolveReadableMountPath: (key: string) => `/data/${key}` },
      publicBrands: {
        getForOrganization: async () => ({
          resourceBindingMode: "brand_managed",
          knowledgeSetIds: ["knowledge-customer"],
          knowledgeIsolationMode: "direct"
        }),
        ensureKnowledgeProjection: async (brand: unknown) => brand
      }
    } as never);

    const result = await service.mergeSelectedKnowledgeSetsIntoRunConfig({
      organizationId: "org-ranley-employees",
      userId: "user-ranley",
      roleIds: ["org_external_user"],
      departmentIds: [],
      membershipType: "brand_employee",
      workspacePath: "/workspace/user-ranley",
      knowledgeSetIds: ["knowledge-employee"]
    });

    expect(result?.additionalDirectories).toEqual(["/data/Employee"]);
    expect(filterAllowedResources).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-ranley-employees",
      candidateIds: ["knowledge-employee"]
    }));
  });
});
