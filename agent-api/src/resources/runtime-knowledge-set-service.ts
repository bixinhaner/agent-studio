type WorkspaceRecord = {
  id: string;
  status: string;
  rootPath?: string | null;
};

type KnowledgeSetRecord = {
  id: string;
  status: string;
  sourceType: string;
  rootPath?: string | null;
};

type WorkspaceBindingRecord = {
  workspaceId: string;
  knowledgeSetId: string;
  mountType: string;
};

type WorkspaceRepositoryLike = {
  list(): Promise<WorkspaceRecord[]>;
};

type KnowledgeSetRepositoryLike = {
  list(): Promise<KnowledgeSetRecord[]>;
  listWorkspaceBindings(workspaceId: string): Promise<WorkspaceBindingRecord[]>;
};

type PolicyServiceLike = {
  filterAllowedResources(input: {
    userId: string;
    roleIds: string[];
    departmentIds: string[];
    resourceType: "workspace" | "knowledge_set";
    candidateIds: string[];
  }): Promise<string[]>;
};

type KnowledgeSetStorageLike = {
  resolveReadableMountPath(knowledgeSetId: string): string;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeIdList(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    const normalized = trimOrUndefined(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    ids.push(normalized);
  }
  return ids;
}

function normalizeAdditionalDirectories(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const directories: string[] = [];
  for (const item of value) {
    const normalized = trimOrUndefined(typeof item === "string" ? item : undefined);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    directories.push(normalized);
  }
  return directories;
}

function mergeAdditionalDirectories(
  codexRunConfig: Record<string, unknown> | undefined,
  mountPaths: string[]
): Record<string, unknown> | undefined {
  if (!codexRunConfig && mountPaths.length === 0) {
    return codexRunConfig;
  }
  const next = codexRunConfig ? { ...codexRunConfig } : {};
  const merged = normalizeAdditionalDirectories(next.additionalDirectories);
  const seen = new Set(merged);
  for (const mountPath of mountPaths) {
    const normalized = trimOrUndefined(mountPath);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push(normalized);
  }
  next.additionalDirectories = merged;
  return next;
}

export class RuntimeKnowledgeSetService {
  constructor(
    private readonly options: {
      workspaces: WorkspaceRepositoryLike;
      knowledgeSets: KnowledgeSetRepositoryLike;
      policies: PolicyServiceLike;
      storage: KnowledgeSetStorageLike;
    }
  ) {}

  async mergeSelectedKnowledgeSetsIntoRunConfig(input: {
    userId: string;
    roleIds: string[];
    departmentIds: string[];
    workspacePath: string;
    knowledgeSetIds?: string[];
    codexRunConfig?: Record<string, unknown>;
  }): Promise<Record<string, unknown> | undefined> {
    const selectedKnowledgeSetIds = normalizeIdList(input.knowledgeSetIds);
    if (selectedKnowledgeSetIds.length === 0) {
      return input.codexRunConfig;
    }

    const workspacePath = trimOrUndefined(input.workspacePath);
    if (!workspacePath) {
      throw new Error("workspace 不存在或无权限");
    }

    const workspaces = (await this.options.workspaces.list()).filter(
      (workspace) => workspace.status === "active" && trimOrUndefined(workspace.rootPath)
    );
    const allowedWorkspaceIds = new Set(
      await this.options.policies.filterAllowedResources({
        userId: input.userId,
        roleIds: input.roleIds,
        departmentIds: input.departmentIds,
        resourceType: "workspace",
        candidateIds: workspaces.map((workspace) => workspace.id)
      })
    );
    const workspace = workspaces.find(
      (candidate) => trimOrUndefined(candidate.rootPath) === workspacePath && allowedWorkspaceIds.has(candidate.id)
    );
    if (!workspace) {
      throw new Error("workspace 不存在或无权限");
    }

    const bindings = await this.options.knowledgeSets.listWorkspaceBindings(workspace.id);
    const optionalKnowledgeSetIdSet = new Set(
      bindings.filter((binding) => binding.mountType === "optional").map((binding) => binding.knowledgeSetId)
    );
    if (selectedKnowledgeSetIds.some((knowledgeSetId) => !optionalKnowledgeSetIdSet.has(knowledgeSetId))) {
      throw new Error("knowledge set 未授权或未绑定到当前 workspace");
    }

    const allowedKnowledgeSetIds = new Set(
      await this.options.policies.filterAllowedResources({
        userId: input.userId,
        roleIds: input.roleIds,
        departmentIds: input.departmentIds,
        resourceType: "knowledge_set",
        candidateIds: selectedKnowledgeSetIds
      })
    );
    if (selectedKnowledgeSetIds.some((knowledgeSetId) => !allowedKnowledgeSetIds.has(knowledgeSetId))) {
      throw new Error("knowledge set 未授权或未绑定到当前 workspace");
    }

    const knowledgeSetById = new Map(
      (await this.options.knowledgeSets.list())
        .filter((knowledgeSet) => knowledgeSet.status === "active")
        .map((knowledgeSet) => [knowledgeSet.id, knowledgeSet] as const)
    );

    const mountPaths = selectedKnowledgeSetIds.map((knowledgeSetId) => {
      const knowledgeSet = knowledgeSetById.get(knowledgeSetId);
      if (!knowledgeSet) {
        throw new Error("knowledge set 未授权或未绑定到当前 workspace");
      }
      if (knowledgeSet.sourceType === "managed_upload") {
        return this.options.storage.resolveReadableMountPath(knowledgeSetId);
      }
      const mountPath = trimOrUndefined(knowledgeSet.rootPath);
      if (!mountPath) {
        throw new Error("knowledge set 缺少可挂载路径");
      }
      return mountPath;
    });

    return mergeAdditionalDirectories(input.codexRunConfig, mountPaths);
  }
}
