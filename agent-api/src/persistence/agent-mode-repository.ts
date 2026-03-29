export type AgentModeSkillPackageRecord = {
  id: string;
  skillPackageId: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentModeWorkspaceRuleRecord = {
  id: string;
  workspaceId: string;
  isDefault: boolean;
  allowDirectorySelection: boolean;
  directoryScope: string;
  loadWorkspaceAgentsMd: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AgentModeInstructionSourceRecord = {
  id: string;
  sourceType: string;
  sourceRef: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type AgentModeRecord = {
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
  skillPackages: AgentModeSkillPackageRecord[];
  workspaceRules: AgentModeWorkspaceRuleRecord[];
  instructionSources: AgentModeInstructionSourceRecord[];
};

type CreateAgentModePayload = {
  id?: string;
  organizationId?: string;
  name: string;
  slug: string;
  description?: string;
  status?: string;
  visibleToUsers?: boolean;
  runProfileId: string;
};

type ReplaceWorkspaceRulesPayload = Array<{
  workspaceId: string;
  isDefault?: boolean;
  allowDirectorySelection?: boolean;
  directoryScope: string;
  loadWorkspaceAgentsMd?: boolean;
}>;

type ReplaceInstructionSourcesPayload = Array<{
  sourceType: string;
  sourceRef: string;
  sortOrder?: number;
}>;

type AgentModeRow = {
  id: string;
  organizationId: string | null;
  name: string;
  slug: string;
  description: string | null;
  status: string | null;
  visibleToUsers: boolean;
  runProfileId: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type AgentModeSkillPackageRow = {
  id: string;
  agentModeId: string;
  skillPackageId: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type AgentModeWorkspaceRow = {
  id: string;
  agentModeId: string;
  workspaceId: string;
  isDefault: boolean;
  allowDirectorySelection: boolean;
  directoryScope: string;
  loadWorkspaceAgentsMd: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type AgentModeInstructionSourceRow = {
  id: string;
  agentModeId: string;
  sourceType: string;
  sourceRef: string;
  sortOrder: number;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type AgentModeTable = {
  findUnique(args: { where: { id?: string; slug?: string } }): Promise<AgentModeRow | null>;
  findMany(args?: { orderBy?: { createdAt?: "asc" | "desc"; updatedAt?: "asc" | "desc" } }): Promise<AgentModeRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<AgentModeRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<AgentModeRow>;
};

type AgentModeSkillPackageTable = {
  findMany(args: { where: { agentModeId: string }; orderBy?: { createdAt?: "asc" | "desc" } }): Promise<AgentModeSkillPackageRow[]>;
  deleteMany(args: { where: { agentModeId: string } }): Promise<{ count: number }>;
  create(args: { data: Record<string, unknown> }): Promise<AgentModeSkillPackageRow>;
};

type AgentModeWorkspaceTable = {
  findMany(args: { where: { agentModeId: string }; orderBy?: { createdAt?: "asc" | "desc" } }): Promise<AgentModeWorkspaceRow[]>;
  deleteMany(args: { where: { agentModeId: string } }): Promise<{ count: number }>;
  create(args: { data: Record<string, unknown> }): Promise<AgentModeWorkspaceRow>;
};

type AgentModeInstructionSourceTable = {
  findMany(args: {
    where: { agentModeId: string };
    orderBy?: { sortOrder?: "asc" | "desc"; createdAt?: "asc" | "desc" };
  }): Promise<AgentModeInstructionSourceRow[]>;
  deleteMany(args: { where: { agentModeId: string } }): Promise<{ count: number }>;
  create(args: { data: Record<string, unknown> }): Promise<AgentModeInstructionSourceRow>;
};

export type AgentModeRepositoryDb = {
  agentMode: AgentModeTable;
  agentModeSkillPackage: AgentModeSkillPackageTable;
  agentModeWorkspace: AgentModeWorkspaceTable;
  agentModeInstructionSource: AgentModeInstructionSourceTable;
  $transaction<T>(callback: (tx: AgentModeRepositoryDb) => Promise<T>): Promise<T>;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function mapSkillPackage(row: AgentModeSkillPackageRow): AgentModeSkillPackageRecord {
  return {
    id: row.id,
    skillPackageId: row.skillPackageId,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

function mapWorkspaceRule(row: AgentModeWorkspaceRow): AgentModeWorkspaceRuleRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    isDefault: row.isDefault,
    allowDirectorySelection: row.allowDirectorySelection,
    directoryScope: row.directoryScope,
    loadWorkspaceAgentsMd: row.loadWorkspaceAgentsMd,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

function mapInstructionSource(row: AgentModeInstructionSourceRow): AgentModeInstructionSourceRecord {
  return {
    id: row.id,
    sourceType: row.sourceType,
    sourceRef: row.sourceRef,
    sortOrder: row.sortOrder,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

export class AgentModeRepository {
  constructor(private readonly db: AgentModeRepositoryDb) {}

  async create(payload: CreateAgentModePayload): Promise<AgentModeRecord> {
    const created = await this.db.agentMode.create({
      data: {
        id: trimOrUndefined(payload.id),
        organizationId: trimOrUndefined(payload.organizationId) ?? null,
        name: payload.name,
        slug: payload.slug,
        description: trimOrUndefined(payload.description) ?? null,
        status: trimOrUndefined(payload.status) ?? "active",
        visibleToUsers: payload.visibleToUsers ?? true,
        runProfileId: payload.runProfileId
      }
    });
    return this.loadRecord(this.db, created);
  }

  async get(id: string): Promise<AgentModeRecord | undefined> {
    const agentModeId = trimOrUndefined(id);
    if (!agentModeId) return undefined;
    const row = await this.db.agentMode.findUnique({ where: { id: agentModeId } });
    return row ? this.loadRecord(this.db, row) : undefined;
  }

  async list(): Promise<AgentModeRecord[]> {
    const rows = await this.db.agentMode.findMany({
      orderBy: { createdAt: "asc" }
    });
    return Promise.all(rows.map((row) => this.loadRecord(this.db, row)));
  }

  async update(id: string, payload: Partial<CreateAgentModePayload>): Promise<AgentModeRecord> {
    const agentModeId = trimOrUndefined(id);
    if (!agentModeId) {
      throw new Error("agent mode 不存在");
    }
    const existing = await this.db.agentMode.findUnique({ where: { id: agentModeId } });
    if (!existing) {
      throw new Error("agent mode 不存在");
    }
    const updated = await this.db.agentMode.update({
      where: { id: agentModeId },
      data: {
        organizationId:
          payload.organizationId === undefined ? existing.organizationId : trimOrUndefined(payload.organizationId) ?? null,
        name: payload.name ?? existing.name,
        slug: payload.slug ?? existing.slug,
        description:
          payload.description === undefined ? existing.description : trimOrUndefined(payload.description) ?? null,
        status: payload.status === undefined ? existing.status : trimOrUndefined(payload.status) ?? "active",
        visibleToUsers: payload.visibleToUsers === undefined ? existing.visibleToUsers : payload.visibleToUsers,
        runProfileId: payload.runProfileId ?? existing.runProfileId,
        updatedAt: new Date()
      }
    });
    return this.loadRecord(this.db, updated);
  }

  async replaceSkillPackages(agentModeId: string, skillPackageIds: string[]): Promise<AgentModeRecord> {
    return this.db.$transaction(async (tx) => {
      const record = await this.requireAgentMode(tx, agentModeId);
      await tx.agentModeSkillPackage.deleteMany({ where: { agentModeId: record.id } });
      for (const skillPackageId of skillPackageIds) {
        await tx.agentModeSkillPackage.create({
          data: {
            agentModeId: record.id,
            skillPackageId
          }
        });
      }
      const refreshed = await tx.agentMode.update({
        where: { id: record.id },
        data: {
          updatedAt: new Date()
        }
      });
      return this.loadRecord(tx, refreshed);
    });
  }

  async replaceWorkspaceRules(agentModeId: string, workspaceRules: ReplaceWorkspaceRulesPayload): Promise<AgentModeRecord> {
    return this.db.$transaction(async (tx) => {
      const record = await this.requireAgentMode(tx, agentModeId);
      await tx.agentModeWorkspace.deleteMany({ where: { agentModeId: record.id } });
      for (const workspaceRule of workspaceRules) {
        await tx.agentModeWorkspace.create({
          data: {
            agentModeId: record.id,
            workspaceId: workspaceRule.workspaceId,
            isDefault: workspaceRule.isDefault ?? false,
            allowDirectorySelection: workspaceRule.allowDirectorySelection ?? false,
            directoryScope: workspaceRule.directoryScope,
            loadWorkspaceAgentsMd: workspaceRule.loadWorkspaceAgentsMd ?? false
          }
        });
      }
      const refreshed = await tx.agentMode.update({
        where: { id: record.id },
        data: {
          updatedAt: new Date()
        }
      });
      return this.loadRecord(tx, refreshed);
    });
  }

  async replaceInstructionSources(
    agentModeId: string,
    instructionSources: ReplaceInstructionSourcesPayload
  ): Promise<AgentModeRecord> {
    return this.db.$transaction(async (tx) => {
      const record = await this.requireAgentMode(tx, agentModeId);
      await tx.agentModeInstructionSource.deleteMany({ where: { agentModeId: record.id } });
      for (const instructionSource of instructionSources) {
        await tx.agentModeInstructionSource.create({
          data: {
            agentModeId: record.id,
            sourceType: instructionSource.sourceType,
            sourceRef: instructionSource.sourceRef,
            sortOrder: instructionSource.sortOrder ?? 0
          }
        });
      }
      const refreshed = await tx.agentMode.update({
        where: { id: record.id },
        data: {
          updatedAt: new Date()
        }
      });
      return this.loadRecord(tx, refreshed);
    });
  }

  private async requireAgentMode(db: AgentModeRepositoryDb, agentModeId: string): Promise<AgentModeRow> {
    const normalized = trimOrUndefined(agentModeId);
    if (!normalized) {
      throw new Error("agent mode 不存在");
    }
    const row = await db.agentMode.findUnique({ where: { id: normalized } });
    if (!row) {
      throw new Error("agent mode 不存在");
    }
    return row;
  }

  private async loadRecord(db: AgentModeRepositoryDb, row: AgentModeRow): Promise<AgentModeRecord> {
    const [skillPackages, workspaceRules, instructionSources] = await Promise.all([
      db.agentModeSkillPackage
        .findMany({
          where: { agentModeId: row.id },
          orderBy: { createdAt: "asc" }
        })
        .then((records) => records.map(mapSkillPackage)),
      db.agentModeWorkspace
        .findMany({
          where: { agentModeId: row.id },
          orderBy: { createdAt: "asc" }
        })
        .then((records) => records.map(mapWorkspaceRule)),
      db.agentModeInstructionSource
        .findMany({
          where: { agentModeId: row.id },
          orderBy: { sortOrder: "asc", createdAt: "asc" }
        })
        .then((records) => records.map(mapInstructionSource))
    ]);

    return {
      id: row.id,
      organizationId: trimOrUndefined(row.organizationId),
      name: row.name,
      slug: row.slug,
      description: trimOrUndefined(row.description),
      status: trimOrUndefined(row.status) ?? "active",
      visibleToUsers: row.visibleToUsers,
      runProfileId: row.runProfileId,
      createdAt: toIsoString(row.createdAt),
      updatedAt: toIsoString(row.updatedAt),
      skillPackages,
      workspaceRules,
      instructionSources
    };
  }
}
