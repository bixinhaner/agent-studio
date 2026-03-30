import { describe, expect, it } from "vitest";

import { AgentModeRepository } from "./agent-mode-repository.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

type FakeAgentModeRow = {
  id: string;
  organizationId: string | null;
  name: string;
  slug: string;
  description: string | null;
  status: string | null;
  visibleToUsers: boolean;
  runProfileId: string;
  createdAt: Date;
  updatedAt: Date;
};

type FakeAgentModeSkillPackageRow = {
  id: string;
  agentModeId: string;
  skillPackageId: string;
  createdAt: Date;
  updatedAt: Date;
};

type FakeAgentModeWorkspaceRow = {
  id: string;
  agentModeId: string;
  workspaceId: string;
  isDefault: boolean;
  allowDirectorySelection: boolean;
  directoryScope: string;
  loadWorkspaceAgentsMd: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type FakeInstructionSourceRow = {
  id: string;
  agentModeId: string;
  sourceType: string;
  sourceRef: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

class FakeAgentModeDb {
  private agentModeCounter = 0;
  private skillPackageCounter = 0;
  private workspaceCounter = 0;
  private instructionSourceCounter = 0;

  readonly agentModes: FakeAgentModeRow[] = [];
  readonly skillPackageBindings: FakeAgentModeSkillPackageRow[] = [];
  readonly workspaceRules: FakeAgentModeWorkspaceRow[] = [];
  readonly instructionSources: FakeInstructionSourceRow[] = [];

  readonly agentMode = {
    findUnique: async ({ where }: { where: { id?: string; slug?: string } }) => {
      const row = this.agentModes.find((item) => {
        if (where.id) return item.id === where.id;
        if (where.slug) return item.slug === where.slug;
        return false;
      });
      return row ? clone(row) : null;
    },
    findMany: async ({ orderBy }: { orderBy?: { createdAt?: "asc" | "desc"; updatedAt?: "asc" | "desc" } } = {}) => {
      const rows = [...this.agentModes];
      const [field, direction] = orderBy?.updatedAt
        ? (["updatedAt", orderBy.updatedAt] as const)
        : orderBy?.createdAt
          ? (["createdAt", orderBy.createdAt] as const)
          : (["createdAt", "asc"] as const);
      rows.sort((left, right) => {
        const diff = left[field].getTime() - right[field].getTime();
        return direction === "asc" ? diff : -diff;
      });
      return clone(rows);
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeAgentModeRow = {
        id: typeof data.id === "string" ? data.id : `agent-mode-${++this.agentModeCounter}`,
        organizationId: typeof data.organizationId === "string" ? data.organizationId : null,
        name: typeof data.name === "string" ? data.name : "",
        slug: typeof data.slug === "string" ? data.slug : "",
        description: typeof data.description === "string" ? data.description : null,
        status: typeof data.status === "string" ? data.status : null,
        visibleToUsers: typeof data.visibleToUsers === "boolean" ? data.visibleToUsers : true,
        runProfileId: typeof data.runProfileId === "string" ? data.runProfileId : "",
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.agentModes.push(row);
      return clone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.agentModes.find((item) => item.id === where.id);
      if (!row) throw new Error("agent mode not found");
      Object.assign(row, clone(data));
      row.updatedAt = data.updatedAt instanceof Date ? data.updatedAt : new Date();
      return clone(row);
    }
  };

  readonly agentModeSkillPackage = {
    findMany: async ({ where, orderBy }: { where: { agentModeId: string }; orderBy?: { createdAt?: "asc" | "desc" } }) => {
      const rows = this.skillPackageBindings.filter((item) => item.agentModeId === where.agentModeId);
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    deleteMany: async ({ where }: { where: { agentModeId: string } }) => {
      const before = this.skillPackageBindings.length;
      this.skillPackageBindings.splice(
        0,
        this.skillPackageBindings.length,
        ...this.skillPackageBindings.filter((item) => item.agentModeId !== where.agentModeId)
      );
      return { count: before - this.skillPackageBindings.length };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeAgentModeSkillPackageRow = {
        id: typeof data.id === "string" ? data.id : `agent-mode-skill-package-${++this.skillPackageCounter}`,
        agentModeId: typeof data.agentModeId === "string" ? data.agentModeId : "",
        skillPackageId: typeof data.skillPackageId === "string" ? data.skillPackageId : "",
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.skillPackageBindings.push(row);
      return clone(row);
    }
  };

  readonly agentModeWorkspace = {
    findMany: async ({ where, orderBy }: { where: { agentModeId: string }; orderBy?: { createdAt?: "asc" | "desc" } }) => {
      const rows = this.workspaceRules.filter((item) => item.agentModeId === where.agentModeId);
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    deleteMany: async ({ where }: { where: { agentModeId: string } }) => {
      const before = this.workspaceRules.length;
      this.workspaceRules.splice(0, this.workspaceRules.length, ...this.workspaceRules.filter((item) => item.agentModeId !== where.agentModeId));
      return { count: before - this.workspaceRules.length };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeAgentModeWorkspaceRow = {
        id: typeof data.id === "string" ? data.id : `agent-mode-workspace-${++this.workspaceCounter}`,
        agentModeId: typeof data.agentModeId === "string" ? data.agentModeId : "",
        workspaceId: typeof data.workspaceId === "string" ? data.workspaceId : "",
        isDefault: typeof data.isDefault === "boolean" ? data.isDefault : false,
        allowDirectorySelection: typeof data.allowDirectorySelection === "boolean" ? data.allowDirectorySelection : false,
        directoryScope: typeof data.directoryScope === "string" ? data.directoryScope : "",
        loadWorkspaceAgentsMd: typeof data.loadWorkspaceAgentsMd === "boolean" ? data.loadWorkspaceAgentsMd : false,
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.workspaceRules.push(row);
      return clone(row);
    }
  };

  readonly agentModeInstructionSource = {
    findMany: async ({ where, orderBy }: { where: { agentModeId: string }; orderBy?: { sortOrder?: "asc" | "desc"; createdAt?: "asc" | "desc" } }) => {
      const rows = this.instructionSources.filter((item) => item.agentModeId === where.agentModeId);
      rows.sort((left, right) => {
        if (orderBy?.sortOrder) {
          const diff = left.sortOrder - right.sortOrder;
          if (diff !== 0) return orderBy.sortOrder === "asc" ? diff : -diff;
        }
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    deleteMany: async ({ where }: { where: { agentModeId: string } }) => {
      const before = this.instructionSources.length;
      this.instructionSources.splice(
        0,
        this.instructionSources.length,
        ...this.instructionSources.filter((item) => item.agentModeId !== where.agentModeId)
      );
      return { count: before - this.instructionSources.length };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeInstructionSourceRow = {
        id: typeof data.id === "string" ? data.id : `instruction-source-${++this.instructionSourceCounter}`,
        agentModeId: typeof data.agentModeId === "string" ? data.agentModeId : "",
        sourceType: typeof data.sourceType === "string" ? data.sourceType : "",
        sourceRef: typeof data.sourceRef === "string" ? data.sourceRef : "",
        sortOrder: typeof data.sortOrder === "number" ? data.sortOrder : 0,
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.instructionSources.push(row);
      return clone(row);
    }
  };

  async $transaction<T>(callback: (tx: FakeAgentModeDb) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

describe("AgentModeRepository", () => {
  it("replaces mode skill packages, workspace rules, and instruction sources", async () => {
    const repository = new AgentModeRepository(new FakeAgentModeDb() as never);
    const mode = await repository.create({
      name: "Coding Assistant",
      slug: "coding-assistant",
      runProfileId: "profile-1"
    });

    await repository.replaceSkillPackages(mode.id, ["skill-package-1", "skill-package-2"]);
    await repository.replaceWorkspaceRules(mode.id, [
      {
        workspaceId: "workspace-1",
        isDefault: true,
        allowDirectorySelection: true,
        directoryScope: "descendants_only",
        loadWorkspaceAgentsMd: true
      }
    ]);

    await repository.replaceInstructionSources(mode.id, [
      { sourceType: "inline_text", sourceRef: "Always write tests first.", sortOrder: 10 }
    ]);

    await repository.replaceSkillPackages(mode.id, ["skill-package-2"]);
    await repository.replaceWorkspaceRules(mode.id, [
      {
        workspaceId: "workspace-2",
        isDefault: false,
        allowDirectorySelection: false,
        directoryScope: "workspace_only",
        loadWorkspaceAgentsMd: false
      }
    ]);
    await repository.replaceInstructionSources(mode.id, [
      { sourceType: "workspace_agents_md", sourceRef: "workspace-root", sortOrder: 20 }
    ]);

    const loaded = await repository.get(mode.id);
    expect(loaded?.skillPackages.map((item) => item.skillPackageId)).toEqual(["skill-package-2"]);
    expect(loaded?.workspaceRules).toHaveLength(1);
    expect(loaded?.workspaceRules[0]?.loadWorkspaceAgentsMd).toBe(false);
    expect(loaded?.workspaceRules[0]).toMatchObject({
      workspaceId: "workspace-2",
      isDefault: false,
      allowDirectorySelection: false,
      directoryScope: "workspace_only",
      loadWorkspaceAgentsMd: false
    });
    expect(loaded?.instructionSources).toHaveLength(1);
    expect(loaded?.instructionSources[0]).toMatchObject({
      sourceType: "workspace_agents_md",
      sourceRef: "workspace-root",
      sortOrder: 20
    });

    const updated = await repository.update(mode.id, {
      description: " Test-first coding mode ",
      visibleToUsers: false,
      runProfileId: "profile-2"
    });

    expect(updated).toMatchObject({
      description: "Test-first coding mode",
      visibleToUsers: false,
      runProfileId: "profile-2"
    });
    await expect(repository.list()).resolves.toEqual([updated]);
  });

  it("replaces ordered workspace bindings and instruction sources", async () => {
    const repository = new AgentModeRepository(new FakeAgentModeDb() as never);
    const mode = await repository.create({
      name: "Support Assistant",
      slug: "support-assistant",
      runProfileId: "profile-support"
    });

    await repository.replaceWorkspaces(mode.id, [
      {
        workspaceId: "workspace-b",
        isDefault: false,
        allowDirectorySelection: false,
        directoryScope: "authorized_workspace_and_knowledge_set",
        loadWorkspaceAgentsMd: false
      },
      {
        workspaceId: "workspace-a",
        isDefault: true,
        allowDirectorySelection: true,
        directoryScope: "workspace_only",
        loadWorkspaceAgentsMd: true
      }
    ]);

    const updated = await repository.replaceInstructionSources(mode.id, [
      { sourceType: "inline", sourceRef: "You are concise.", sortOrder: 0 },
      { sourceType: "workspace_agents_md", sourceRef: "workspace-root", sortOrder: 1 }
    ]);

    expect(updated.workspaceRules.map((item) => item.workspaceId)).toEqual(["workspace-b", "workspace-a"]);
    expect(updated.workspaceRules).toEqual([
      expect.objectContaining({
        workspaceId: "workspace-b",
        directoryScope: "authorized_workspace_and_knowledge_set",
        loadWorkspaceAgentsMd: false
      }),
      expect.objectContaining({
        workspaceId: "workspace-a",
        directoryScope: "workspace_only",
        loadWorkspaceAgentsMd: true
      })
    ]);
    expect(updated.instructionSources.map((item) => item.sourceType)).toEqual(["inline", "workspace_agents_md"]);
  });

  it("copies an agent mode with run profile, skill packages, workspace rules, and instruction sources", async () => {
    const repository = new AgentModeRepository(new FakeAgentModeDb() as never);
    const mode = await repository.create({
      name: "Coding Assistant",
      slug: "coding-assistant",
      description: " Mode description ",
      status: "active",
      visibleToUsers: true,
      runProfileId: "profile-1"
    });

    await repository.replaceSkillPackages(mode.id, ["skill-package-1", "skill-package-2"]);
    await repository.replaceWorkspaces(mode.id, [
      {
        workspaceId: "workspace-1",
        isDefault: true,
        allowDirectorySelection: true,
        directoryScope: "workspace_only",
        loadWorkspaceAgentsMd: true
      }
    ]);
    await repository.replaceInstructionSources(mode.id, [
      { sourceType: "inline", sourceRef: "Be precise.", sortOrder: 0 }
    ]);

    const copied = await repository.copy(mode.id, {
      name: "Coding Assistant Copy",
      slug: "coding-assistant-copy",
      status: "disabled",
      visibleToUsers: false
    });

    expect(copied.id).not.toBe(mode.id);
    expect(copied).toMatchObject({
      name: "Coding Assistant Copy",
      slug: "coding-assistant-copy",
      description: "Mode description",
      status: "disabled",
      visibleToUsers: false,
      runProfileId: "profile-1"
    });
    expect(copied.skillPackages.map((item) => item.skillPackageId)).toEqual(["skill-package-1", "skill-package-2"]);
    expect(copied.workspaceRules).toEqual([
      expect.objectContaining({
        workspaceId: "workspace-1",
        isDefault: true,
        allowDirectorySelection: true,
        directoryScope: "workspace_only",
        loadWorkspaceAgentsMd: true
      })
    ]);
    expect(copied.instructionSources).toEqual([
      expect.objectContaining({
        sourceType: "inline",
        sourceRef: "Be precise.",
        sortOrder: 0
      })
    ]);
  });
});
