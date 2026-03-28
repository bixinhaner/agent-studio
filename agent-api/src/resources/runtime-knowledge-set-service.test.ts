import { describe, expect, it } from "vitest";

import { RuntimeKnowledgeSetService } from "./runtime-knowledge-set-service.js";

describe("RuntimeKnowledgeSetService", () => {
  it("always mounts default knowledge sets when no optional selection is provided", async () => {
    const service = new RuntimeKnowledgeSetService({
      workspaces: new FakeWorkspaceRepository([
        {
          id: "ws-docs",
          status: "active",
          rootPath: "/workspace/docs"
        }
      ]),
      knowledgeSets: new FakeKnowledgeSetRepository(
        [
          {
            id: "ks-faq",
            status: "active",
            sourceType: "filesystem",
            rootPath: "/knowledge/faq"
          },
          {
            id: "ks-runbook",
            status: "active",
            sourceType: "managed_upload"
          }
        ],
        [
          { workspaceId: "ws-docs", knowledgeSetId: "ks-faq", mountType: "default" },
          { workspaceId: "ws-docs", knowledgeSetId: "ks-runbook", mountType: "optional" }
        ]
      ),
      policies: new FakePolicyService({
        workspace: ["ws-docs"],
        knowledge_set: ["ks-faq", "ks-runbook"]
      }),
      storage: {
        resolveReadableMountPath(knowledgeSetId: string) {
          return `/managed/${knowledgeSetId}`;
        }
      }
    });

    const result = await service.mergeSelectedKnowledgeSetsIntoRunConfig({
      userId: "employee-1",
      roleIds: ["employee"],
      departmentIds: [],
      workspacePath: "/workspace/docs",
      codexRunConfig: {
        mode: "standard",
        workspace: "/workspace/docs",
        additionalDirectories: ["/existing"]
      }
    });

    expect(result).toEqual({
      mode: "standard",
      workspace: "/workspace/docs",
      additionalDirectories: ["/existing", "/knowledge/faq"],
      _agentStudioKnowledgeSets: {
        workspacePath: "/workspace/docs",
        selectedOptionalIds: [],
        mountPaths: ["/knowledge/faq"]
      }
    });
  });

  it("adds authorized selected knowledge set mount paths to additionalDirectories", async () => {
    const service = new RuntimeKnowledgeSetService({
      workspaces: new FakeWorkspaceRepository([
        {
          id: "ws-docs",
          status: "active",
          rootPath: "/workspace/docs"
        }
      ]),
      knowledgeSets: new FakeKnowledgeSetRepository(
        [
          {
            id: "ks-faq",
            status: "active",
            sourceType: "filesystem",
            rootPath: "/knowledge/faq"
          },
          {
            id: "ks-runbook",
            status: "active",
            sourceType: "managed_upload"
          }
        ],
        [
          { workspaceId: "ws-docs", knowledgeSetId: "ks-faq", mountType: "optional" },
          { workspaceId: "ws-docs", knowledgeSetId: "ks-runbook", mountType: "optional" }
        ]
      ),
      policies: new FakePolicyService({
        workspace: ["ws-docs"],
        knowledge_set: ["ks-faq", "ks-runbook"]
      }),
      storage: {
        resolveReadableMountPath(knowledgeSetId: string) {
          return `/managed/${knowledgeSetId}`;
        }
      }
    });

    const result = await service.mergeSelectedKnowledgeSetsIntoRunConfig({
      userId: "employee-1",
      roleIds: ["employee"],
      departmentIds: ["dept-ops"],
      workspacePath: "/workspace/docs",
      knowledgeSetIds: ["ks-faq", "ks-runbook"],
      codexRunConfig: {
        mode: "standard",
        workspace: "/workspace/docs",
        additionalDirectories: ["/existing", "/knowledge/faq"]
      }
    });

    expect(result).toEqual({
      mode: "standard",
      workspace: "/workspace/docs",
      additionalDirectories: ["/existing", "/knowledge/faq", "/managed/ks-runbook"],
      _agentStudioKnowledgeSets: {
        workspacePath: "/workspace/docs",
        selectedOptionalIds: ["ks-faq", "ks-runbook"],
        mountPaths: ["/knowledge/faq", "/managed/ks-runbook"]
      }
    });
  });

  it("re-resolves mounts for a new workspace and removes stale knowledge set directories", async () => {
    const service = new RuntimeKnowledgeSetService({
      workspaces: new FakeWorkspaceRepository([
        {
          id: "ws-docs",
          status: "active",
          rootPath: "/workspace/docs"
        },
        {
          id: "ws-ops",
          status: "active",
          rootPath: "/workspace/ops"
        }
      ]),
      knowledgeSets: new FakeKnowledgeSetRepository(
        [
          {
            id: "ks-faq",
            status: "active",
            sourceType: "filesystem",
            rootPath: "/knowledge/faq"
          },
          {
            id: "ks-runbook",
            status: "active",
            sourceType: "managed_upload"
          },
          {
            id: "ks-ops",
            status: "active",
            sourceType: "filesystem",
            rootPath: "/knowledge/ops"
          }
        ],
        [
          { workspaceId: "ws-docs", knowledgeSetId: "ks-faq", mountType: "default" },
          { workspaceId: "ws-docs", knowledgeSetId: "ks-runbook", mountType: "optional" },
          { workspaceId: "ws-ops", knowledgeSetId: "ks-ops", mountType: "default" }
        ]
      ),
      policies: new FakePolicyService({
        workspace: ["ws-docs", "ws-ops"],
        knowledge_set: ["ks-faq", "ks-runbook", "ks-ops"]
      }),
      storage: {
        resolveReadableMountPath(knowledgeSetId: string) {
          return `/managed/${knowledgeSetId}`;
        }
      }
    });

    const result = await service.mergeSelectedKnowledgeSetsIntoRunConfig({
      userId: "employee-1",
      roleIds: ["employee"],
      departmentIds: [],
      workspacePath: "/workspace/ops",
      codexRunConfig: {
        mode: "standard",
        workspace: "/workspace/ops",
        additionalDirectories: ["/custom", "/knowledge/faq", "/managed/ks-runbook"],
        _agentStudioKnowledgeSets: {
          workspacePath: "/workspace/docs",
          selectedOptionalIds: ["ks-runbook"],
          mountPaths: ["/knowledge/faq", "/managed/ks-runbook"]
        }
      }
    });

    expect(result).toEqual({
      mode: "standard",
      workspace: "/workspace/ops",
      additionalDirectories: ["/custom", "/knowledge/ops"],
      _agentStudioKnowledgeSets: {
        workspacePath: "/workspace/ops",
        selectedOptionalIds: [],
        mountPaths: ["/knowledge/ops"]
      }
    });
  });

  it("rejects selected knowledge sets that are not authorized for the current user", async () => {
    const service = new RuntimeKnowledgeSetService({
      workspaces: new FakeWorkspaceRepository([
        {
          id: "ws-docs",
          status: "active",
          rootPath: "/workspace/docs"
        }
      ]),
      knowledgeSets: new FakeKnowledgeSetRepository(
        [
          {
            id: "ks-secret",
            status: "active",
            sourceType: "managed_upload"
          }
        ],
        [{ workspaceId: "ws-docs", knowledgeSetId: "ks-secret", mountType: "optional" }]
      ),
      policies: new FakePolicyService({
        workspace: ["ws-docs"],
        knowledge_set: []
      }),
      storage: {
        resolveReadableMountPath(knowledgeSetId: string) {
          return `/managed/${knowledgeSetId}`;
        }
      }
    });

    await expect(
      service.mergeSelectedKnowledgeSetsIntoRunConfig({
        userId: "employee-1",
        roleIds: ["employee"],
        departmentIds: [],
        workspacePath: "/workspace/docs",
        knowledgeSetIds: ["ks-secret"],
        codexRunConfig: { mode: "standard", workspace: "/workspace/docs" }
      })
    ).rejects.toThrow("knowledge set");
  });

  it("rejects selected knowledge sets that are not optionally bound to the requested workspace", async () => {
    const service = new RuntimeKnowledgeSetService({
      workspaces: new FakeWorkspaceRepository([
        {
          id: "ws-docs",
          status: "active",
          rootPath: "/workspace/docs"
        }
      ]),
      knowledgeSets: new FakeKnowledgeSetRepository(
        [
          {
            id: "ks-faq",
            status: "active",
            sourceType: "filesystem",
            rootPath: "/knowledge/faq"
          }
        ],
        [{ workspaceId: "ws-docs", knowledgeSetId: "ks-faq", mountType: "default" }]
      ),
      policies: new FakePolicyService({
        workspace: ["ws-docs"],
        knowledge_set: ["ks-faq"]
      }),
      storage: {
        resolveReadableMountPath(knowledgeSetId: string) {
          return `/managed/${knowledgeSetId}`;
        }
      }
    });

    await expect(
      service.mergeSelectedKnowledgeSetsIntoRunConfig({
        userId: "employee-1",
        roleIds: ["employee"],
        departmentIds: [],
        workspacePath: "/workspace/docs",
        knowledgeSetIds: ["ks-faq"],
        codexRunConfig: { mode: "standard", workspace: "/workspace/docs" }
      })
    ).rejects.toThrow("knowledge set");
  });
});

type WorkspaceRecord = {
  id: string;
  status: string;
  rootPath?: string;
};

type KnowledgeSetRecord = {
  id: string;
  status: string;
  sourceType: string;
  rootPath?: string;
};

type WorkspaceBindingRecord = {
  workspaceId: string;
  knowledgeSetId: string;
  mountType: string;
};

class FakeWorkspaceRepository {
  constructor(private readonly records: WorkspaceRecord[]) {}

  async list(): Promise<WorkspaceRecord[]> {
    return structuredClone(this.records);
  }
}

class FakeKnowledgeSetRepository {
  constructor(
    private readonly records: KnowledgeSetRecord[],
    private readonly bindings: WorkspaceBindingRecord[]
  ) {}

  async list(): Promise<KnowledgeSetRecord[]> {
    return structuredClone(this.records);
  }

  async listWorkspaceBindings(workspaceId: string): Promise<WorkspaceBindingRecord[]> {
    return structuredClone(this.bindings.filter((binding) => binding.workspaceId === workspaceId));
  }
}

class FakePolicyService {
  constructor(
    private readonly allowed: {
      workspace: string[];
      knowledge_set: string[];
    }
  ) {}

  async filterAllowedResources(input: {
    resourceType: "workspace" | "knowledge_set";
    candidateIds: string[];
  }): Promise<string[]> {
    const allowedIds = new Set(this.allowed[input.resourceType]);
    return input.candidateIds.filter((candidateId) => allowedIds.has(candidateId));
  }
}
