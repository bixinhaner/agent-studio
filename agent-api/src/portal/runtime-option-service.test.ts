import { describe, expect, it } from "vitest";

import { PolicyService } from "../resources/policy-service.js";
import { ResourcePolicyRepository, type ResourcePolicyRecord } from "../persistence/resource-policy-repository.js";
import { PortalRuntimeOptionService } from "./runtime-option-service.js";

type FakeWorkspaceRecord = {
  id: string;
  organizationId?: string;
  name: string;
  slug: string;
  description?: string;
  status: string;
  sourceType: string;
  rootPath?: string;
  createdAt: string;
  updatedAt: string;
};

type FakeRunProfileRecord = {
  id: string;
  organizationId?: string;
  name: string;
  slug: string;
  description?: string;
  status: string;
  defaultModel: string;
  allowedModels: string[];
  defaultReasoningEffort: string;
  sandboxMode: string;
  approvalPolicy: string;
  networkAccessEnabled: boolean;
  webSearchMode: string;
  createdAt: string;
  updatedAt: string;
};

type FakeSkillPackageRecord = {
  id: string;
  organizationId?: string;
  name: string;
  slug: string;
  description?: string;
  status: string;
  visibleToUsers: boolean;
  createdAt: string;
  updatedAt: string;
  items: Array<{
    id: string;
    capabilityKey: string;
    description?: string;
    createdAt: string;
    updatedAt: string;
    runtimeBindings: Array<{
      id: string;
      runtimeType: string;
      bindingType: string;
      bindingPayload: unknown;
      createdAt: string;
      updatedAt: string;
    }>;
  }>;
};

type FakeAgentModeRecord = {
  id: string;
  organizationId?: string;
  name: string;
  slug: string;
  description?: string;
  status: string;
  visibleToUsers: boolean;
  runProfileId: string;
  createdAt: string;
  updatedAt: string;
  skillPackages: Array<{
    id: string;
    skillPackageId: string;
    createdAt: string;
    updatedAt: string;
  }>;
  workspaceRules: Array<{
    id: string;
    workspaceId: string;
    isDefault: boolean;
    allowDirectorySelection: boolean;
    directoryScope: string;
    loadWorkspaceAgentsMd: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  instructionSources: Array<{
    id: string;
    sourceType: string;
    sourceRef: string;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
  }>;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

class FakeResourcePolicyDb {
  constructor(readonly rows: ResourcePolicyRecord[] = []) {}

  readonly resourcePolicy = {
    findMany: async ({
      where
    }: {
      where?: {
        resourceType?: ResourcePolicyRecord["resourceType"];
        OR?: Array<{ subjectType: ResourcePolicyRecord["subjectType"]; subjectId: string }>;
      };
      orderBy?: { createdAt?: "asc" | "desc" };
    }) => {
      const rows = this.rows.filter((item) => {
        if (where?.resourceType && item.resourceType !== where.resourceType) {
          return false;
        }
        if (where?.OR?.length) {
          return where.OR.some(
            (subject) => item.subjectType === subject.subjectType && item.subjectId === subject.subjectId
          );
        }
        return true;
      });
      return clone(rows);
    }
  };
}

class FakeWorkspaceRepository {
  constructor(private readonly rows: FakeWorkspaceRecord[]) {}

  async list(): Promise<FakeWorkspaceRecord[]> {
    return clone(this.rows);
  }
}

class FakeRunProfileRepository {
  constructor(private readonly rows: FakeRunProfileRecord[]) {}

  async list(): Promise<FakeRunProfileRecord[]> {
    return clone(this.rows);
  }
}

class FakeSkillPackageRepository {
  constructor(private readonly rows: FakeSkillPackageRecord[]) {}

  async list(): Promise<FakeSkillPackageRecord[]> {
    return clone(this.rows);
  }
}

class FakeAgentModeRepository {
  constructor(private readonly rows: FakeAgentModeRecord[]) {}

  async list(): Promise<FakeAgentModeRecord[]> {
    return clone(this.rows);
  }
}

function createServiceFixture(input: {
  modes: FakeAgentModeRecord[];
  workspaces: FakeWorkspaceRecord[];
  runProfiles: FakeRunProfileRecord[];
  skillPackages: FakeSkillPackageRecord[];
  policies: ResourcePolicyRecord[];
}) {
  const policies = new ResourcePolicyRepository(new FakeResourcePolicyDb(input.policies) as never);
  return {
    service: new PortalRuntimeOptionService({
      modes: new FakeAgentModeRepository(input.modes) as never,
      workspaces: new FakeWorkspaceRepository(input.workspaces) as never,
      runProfiles: new FakeRunProfileRepository(input.runProfiles) as never,
      skillPackages: new FakeSkillPackageRepository(input.skillPackages) as never,
      policies: new PolicyService(policies)
    })
  };
}

describe("PortalRuntimeOptionService", () => {
  it("returns only authorized visible modes with resolved runtime profile snapshots", async () => {
    const { service } = createServiceFixture({
      modes: [
        {
          id: "mode-code",
          name: "代码助手",
          slug: "mode-code",
          description: "面向代码任务",
          status: "active",
          visibleToUsers: true,
          runProfileId: "profile-code",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z",
          skillPackages: [
            {
              id: "mode-code-skill-package",
              skillPackageId: "skill-package-code",
              createdAt: "2026-03-29T00:00:00.000Z",
              updatedAt: "2026-03-29T00:00:00.000Z"
            }
          ],
          workspaceRules: [
            {
              id: "mode-code-workspace-primary",
              workspaceId: "workspace-primary",
              isDefault: true,
              allowDirectorySelection: true,
              directoryScope: "descendants_only",
              loadWorkspaceAgentsMd: true,
              createdAt: "2026-03-29T00:00:00.000Z",
              updatedAt: "2026-03-29T00:00:00.000Z"
            },
            {
              id: "mode-code-workspace-secondary",
              workspaceId: "workspace-secondary",
              isDefault: false,
              allowDirectorySelection: false,
              directoryScope: "workspace_only",
              loadWorkspaceAgentsMd: false,
              createdAt: "2026-03-29T00:00:00.000Z",
              updatedAt: "2026-03-29T00:00:00.000Z"
            }
          ],
          instructionSources: []
        }
      ],
      workspaces: [
        {
          id: "workspace-primary",
          name: "Primary Workspace",
          slug: "workspace-primary",
          status: "active",
          sourceType: "local",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        },
        {
          id: "workspace-secondary",
          name: "Secondary Workspace",
          slug: "workspace-secondary",
          status: "active",
          sourceType: "local",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        }
      ],
      runProfiles: [
        {
          id: "profile-code",
          name: "Coding Default",
          slug: "profile-code",
          status: "active",
          defaultModel: "gpt-5.4",
          allowedModels: ["gpt-5.4", "gpt-5.4-mini"],
          defaultReasoningEffort: "high",
          sandboxMode: "workspace-write",
          approvalPolicy: "never",
          networkAccessEnabled: true,
          webSearchMode: "disabled",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        }
      ],
      skillPackages: [
        {
          id: "skill-package-code",
          name: "Code Tools",
          slug: "skill-package-code",
          status: "active",
          visibleToUsers: true,
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z",
          items: []
        }
      ],
      policies: [
        {
          id: "policy-mode",
          organizationId: null,
          subjectType: "role",
          subjectId: "employee",
          resourceType: "agent_mode",
          resourceId: "mode-code",
          effect: "allow",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        },
        {
          id: "policy-profile",
          organizationId: null,
          subjectType: "department",
          subjectId: "dept-rd",
          resourceType: "run_profile",
          resourceId: "profile-code",
          effect: "allow",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        },
        {
          id: "policy-skill-package",
          organizationId: null,
          subjectType: "user",
          subjectId: "user-1",
          resourceType: "skill_package",
          resourceId: "skill-package-code",
          effect: "allow",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        },
        {
          id: "policy-workspace-primary",
          organizationId: null,
          subjectType: "role",
          subjectId: "employee",
          resourceType: "workspace",
          resourceId: "workspace-primary",
          effect: "allow",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        }
      ]
    });

    const resolved = await service.resolve({
      userId: "user-1",
      roleIds: ["employee"],
      departmentIds: ["dept-rd"]
    });

    expect(resolved).toEqual({
      modes: [
        {
          id: "mode-code",
          label: "代码助手",
          description: "面向代码任务",
          runtimeProfile: expect.objectContaining({
            id: "profile-code",
            defaultModel: "gpt-5.4",
            allowedModels: ["gpt-5.4", "gpt-5.4-mini"]
          }),
          allowDirectorySelection: true,
          skillPackages: [
            {
              id: "skill-package-code",
              label: "Code Tools"
            }
          ],
          workspaces: [
            {
              id: "workspace-primary",
              label: "Primary Workspace",
              isDefault: true,
              allowDirectorySelection: true,
              directoryScope: "descendants_only",
              loadWorkspaceAgentsMd: true
            }
          ],
          instructionSources: []
        }
      ],
      workspaces: [
        {
          id: "workspace-primary",
          label: "Primary Workspace",
          isDefault: true
        }
      ],
      canUpload: true,
      defaults: {
        mode: "mode-code",
        workspace: "workspace-primary"
      }
    });
  });

  it("excludes modes whose run profile is inactive or unauthorized", async () => {
    const { service } = createServiceFixture({
      modes: [
        {
          id: "mode-good",
          name: "Good Mode",
          slug: "mode-good",
          status: "active",
          visibleToUsers: true,
          runProfileId: "profile-good",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z",
          skillPackages: [
            {
              id: "mode-good-skill-package",
              skillPackageId: "skill-package-good",
              createdAt: "2026-03-29T00:00:00.000Z",
              updatedAt: "2026-03-29T00:00:00.000Z"
            }
          ],
          workspaceRules: [],
          instructionSources: []
        },
        {
          id: "mode-inactive-profile",
          name: "Inactive Profile Mode",
          slug: "mode-inactive-profile",
          status: "active",
          visibleToUsers: true,
          runProfileId: "profile-inactive",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z",
          skillPackages: [
            {
              id: "mode-inactive-profile-skill-package",
              skillPackageId: "skill-package-good",
              createdAt: "2026-03-29T00:00:00.000Z",
              updatedAt: "2026-03-29T00:00:00.000Z"
            }
          ],
          workspaceRules: [],
          instructionSources: []
        },
        {
          id: "mode-unauthorized-profile",
          name: "Unauthorized Profile Mode",
          slug: "mode-unauthorized-profile",
          status: "active",
          visibleToUsers: true,
          runProfileId: "profile-unauthorized",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z",
          skillPackages: [
            {
              id: "mode-unauthorized-profile-skill-package",
              skillPackageId: "skill-package-good",
              createdAt: "2026-03-29T00:00:00.000Z",
              updatedAt: "2026-03-29T00:00:00.000Z"
            }
          ],
          workspaceRules: [],
          instructionSources: []
        }
      ],
      workspaces: [
        {
          id: "workspace-good",
          name: "Good Workspace",
          slug: "workspace-good",
          status: "active",
          sourceType: "local",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        }
      ],
      runProfiles: [
        {
          id: "profile-good",
          name: "Good Profile",
          slug: "profile-good",
          status: "active",
          defaultModel: "gpt-5.4",
          allowedModels: ["gpt-5.4"],
          defaultReasoningEffort: "medium",
          sandboxMode: "workspace-write",
          approvalPolicy: "never",
          networkAccessEnabled: true,
          webSearchMode: "disabled",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        },
        {
          id: "profile-inactive",
          name: "Inactive Profile",
          slug: "profile-inactive",
          status: "inactive",
          defaultModel: "gpt-5.4",
          allowedModels: ["gpt-5.4"],
          defaultReasoningEffort: "medium",
          sandboxMode: "workspace-write",
          approvalPolicy: "never",
          networkAccessEnabled: true,
          webSearchMode: "disabled",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        },
        {
          id: "profile-unauthorized",
          name: "Unauthorized Profile",
          slug: "profile-unauthorized",
          status: "active",
          defaultModel: "gpt-5.4",
          allowedModels: ["gpt-5.4"],
          defaultReasoningEffort: "medium",
          sandboxMode: "workspace-write",
          approvalPolicy: "never",
          networkAccessEnabled: true,
          webSearchMode: "disabled",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        }
      ],
      skillPackages: [
        {
          id: "skill-package-good",
          name: "Good Package",
          slug: "skill-package-good",
          status: "active",
          visibleToUsers: true,
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z",
          items: []
        }
      ],
      policies: [
        {
          id: "policy-mode-good",
          organizationId: null,
          subjectType: "role",
          subjectId: "employee",
          resourceType: "agent_mode",
          resourceId: "mode-good",
          effect: "allow",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        },
        {
          id: "policy-mode-inactive-profile",
          organizationId: null,
          subjectType: "role",
          subjectId: "employee",
          resourceType: "agent_mode",
          resourceId: "mode-inactive-profile",
          effect: "allow",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        },
        {
          id: "policy-mode-unauthorized-profile",
          organizationId: null,
          subjectType: "role",
          subjectId: "employee",
          resourceType: "agent_mode",
          resourceId: "mode-unauthorized-profile",
          effect: "allow",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        },
        {
          id: "policy-profile-good",
          organizationId: null,
          subjectType: "role",
          subjectId: "employee",
          resourceType: "run_profile",
          resourceId: "profile-good",
          effect: "allow",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        },
        {
          id: "policy-skill-package-good",
          organizationId: null,
          subjectType: "role",
          subjectId: "employee",
          resourceType: "skill_package",
          resourceId: "skill-package-good",
          effect: "allow",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        },
        {
          id: "policy-workspace-good",
          organizationId: null,
          subjectType: "role",
          subjectId: "employee",
          resourceType: "workspace",
          resourceId: "workspace-good",
          effect: "allow",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        },
        {
          id: "policy-profile-inactive",
          organizationId: null,
          subjectType: "role",
          subjectId: "employee",
          resourceType: "run_profile",
          resourceId: "profile-inactive",
          effect: "allow",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        }
      ]
    });

    const resolved = await service.resolve({
      userId: "user-1",
      roleIds: ["employee"],
      departmentIds: []
    });

    expect(resolved.modes.map((mode) => mode.id)).toEqual(["mode-good"]);
    expect(resolved.defaults).toEqual({
      mode: "mode-good",
      workspace: "workspace-good"
    });
  });

  it("excludes modes whose skill packages are inactive or unauthorized", async () => {
    const { service } = createServiceFixture({
      modes: [
        {
          id: "mode-good",
          name: "Good Mode",
          slug: "mode-good",
          status: "active",
          visibleToUsers: true,
          runProfileId: "profile-good",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z",
          skillPackages: [
            {
              id: "mode-good-skill-package",
              skillPackageId: "skill-package-good",
              createdAt: "2026-03-29T00:00:00.000Z",
              updatedAt: "2026-03-29T00:00:00.000Z"
            }
          ],
          workspaceRules: [],
          instructionSources: []
        },
        {
          id: "mode-inactive-package",
          name: "Inactive Package Mode",
          slug: "mode-inactive-package",
          status: "active",
          visibleToUsers: true,
          runProfileId: "profile-inactive-package",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z",
          skillPackages: [
            {
              id: "mode-inactive-package-skill-package",
              skillPackageId: "skill-package-inactive",
              createdAt: "2026-03-29T00:00:00.000Z",
              updatedAt: "2026-03-29T00:00:00.000Z"
            }
          ],
          workspaceRules: [],
          instructionSources: []
        },
        {
          id: "mode-unauthorized-package",
          name: "Unauthorized Package Mode",
          slug: "mode-unauthorized-package",
          status: "active",
          visibleToUsers: true,
          runProfileId: "profile-unauthorized-package",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z",
          skillPackages: [
            {
              id: "mode-unauthorized-package-skill-package",
              skillPackageId: "skill-package-unauthorized",
              createdAt: "2026-03-29T00:00:00.000Z",
              updatedAt: "2026-03-29T00:00:00.000Z"
            }
          ],
          workspaceRules: [],
          instructionSources: []
        }
      ],
      workspaces: [
        {
          id: "workspace-good",
          name: "Good Workspace",
          slug: "workspace-good",
          status: "active",
          sourceType: "local",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        }
      ],
      runProfiles: [
        {
          id: "profile-good",
          name: "Good Profile",
          slug: "profile-good",
          status: "active",
          defaultModel: "gpt-5.4",
          allowedModels: ["gpt-5.4"],
          defaultReasoningEffort: "medium",
          sandboxMode: "workspace-write",
          approvalPolicy: "never",
          networkAccessEnabled: true,
          webSearchMode: "disabled",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        },
        {
          id: "profile-inactive-package",
          name: "Inactive Package Profile",
          slug: "profile-inactive-package",
          status: "active",
          defaultModel: "gpt-5.4",
          allowedModels: ["gpt-5.4"],
          defaultReasoningEffort: "medium",
          sandboxMode: "workspace-write",
          approvalPolicy: "never",
          networkAccessEnabled: true,
          webSearchMode: "disabled",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        },
        {
          id: "profile-unauthorized-package",
          name: "Unauthorized Package Profile",
          slug: "profile-unauthorized-package",
          status: "active",
          defaultModel: "gpt-5.4",
          allowedModels: ["gpt-5.4"],
          defaultReasoningEffort: "medium",
          sandboxMode: "workspace-write",
          approvalPolicy: "never",
          networkAccessEnabled: true,
          webSearchMode: "disabled",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        }
      ],
      skillPackages: [
        {
          id: "skill-package-good",
          name: "Good Package",
          slug: "skill-package-good",
          status: "active",
          visibleToUsers: true,
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z",
          items: []
        },
        {
          id: "skill-package-inactive",
          name: "Inactive Package",
          slug: "skill-package-inactive",
          status: "inactive",
          visibleToUsers: true,
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z",
          items: []
        },
        {
          id: "skill-package-unauthorized",
          name: "Unauthorized Package",
          slug: "skill-package-unauthorized",
          status: "active",
          visibleToUsers: true,
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z",
          items: []
        }
      ],
      policies: [
        {
          id: "policy-mode-good",
          organizationId: null,
          subjectType: "role",
          subjectId: "employee",
          resourceType: "agent_mode",
          resourceId: "mode-good",
          effect: "allow",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        },
        {
          id: "policy-mode-inactive-package",
          organizationId: null,
          subjectType: "role",
          subjectId: "employee",
          resourceType: "agent_mode",
          resourceId: "mode-inactive-package",
          effect: "allow",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        },
        {
          id: "policy-mode-unauthorized-package",
          organizationId: null,
          subjectType: "role",
          subjectId: "employee",
          resourceType: "agent_mode",
          resourceId: "mode-unauthorized-package",
          effect: "allow",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        },
        {
          id: "policy-profile-good",
          organizationId: null,
          subjectType: "role",
          subjectId: "employee",
          resourceType: "run_profile",
          resourceId: "profile-good",
          effect: "allow",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        },
        {
          id: "policy-profile-inactive-package",
          organizationId: null,
          subjectType: "role",
          subjectId: "employee",
          resourceType: "run_profile",
          resourceId: "profile-inactive-package",
          effect: "allow",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        },
        {
          id: "policy-profile-unauthorized-package",
          organizationId: null,
          subjectType: "role",
          subjectId: "employee",
          resourceType: "run_profile",
          resourceId: "profile-unauthorized-package",
          effect: "allow",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        },
        {
          id: "policy-workspace-good",
          organizationId: null,
          subjectType: "role",
          subjectId: "employee",
          resourceType: "workspace",
          resourceId: "workspace-good",
          effect: "allow",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        },
        {
          id: "policy-skill-package-good",
          organizationId: null,
          subjectType: "role",
          subjectId: "employee",
          resourceType: "skill_package",
          resourceId: "skill-package-good",
          effect: "allow",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        },
        {
          id: "policy-skill-package-inactive",
          organizationId: null,
          subjectType: "role",
          subjectId: "employee",
          resourceType: "skill_package",
          resourceId: "skill-package-inactive",
          effect: "allow",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z"
        }
      ]
    });

    const resolved = await service.resolve({
      userId: "user-1",
      roleIds: ["employee"],
      departmentIds: []
    });

    expect(resolved.modes.map((mode) => mode.id)).toEqual(["mode-good"]);
    expect(resolved.defaults).toEqual({
      mode: "mode-good",
      workspace: "workspace-good"
    });
  });
});
