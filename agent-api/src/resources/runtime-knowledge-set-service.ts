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

type KnowledgeSetRuntimeMetadata = {
  workspacePath: string;
  selectedOptionalIds: string[];
  mountPaths: string[];
};

type ResourceAccessLogServiceLike = {
  record(input: {
    userId?: string;
    departmentIdSnapshot?: string;
    resourceType: string;
    resourceId: string;
    actionType: string;
    resultStatus: string;
    metadata?: unknown;
  }): Promise<unknown>;
};

const KNOWLEDGE_SET_METADATA_KEY = "_agentStudioKnowledgeSets";

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

function replaceManagedKnowledgeSetDirectories(
  codexRunConfig: Record<string, unknown> | undefined,
  metadata: KnowledgeSetRuntimeMetadata
): Record<string, unknown> {
  const next = codexRunConfig ? { ...codexRunConfig } : {};
  const previousMetadata = readKnowledgeSetRuntimeMetadata(codexRunConfig);
  const previousMountPaths = new Set(previousMetadata?.mountPaths ?? []);
  const merged = normalizeAdditionalDirectories(next.additionalDirectories).filter(
    (directory) => !previousMountPaths.has(directory)
  );
  const seen = new Set(merged);
  for (const mountPath of metadata.mountPaths) {
    const normalized = trimOrUndefined(mountPath);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push(normalized);
  }
  next.additionalDirectories = merged;
  next[KNOWLEDGE_SET_METADATA_KEY] = metadata;
  return next;
}

function readKnowledgeSetRuntimeMetadata(value: unknown): KnowledgeSetRuntimeMetadata | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = (value as Record<string, unknown>)[KNOWLEDGE_SET_METADATA_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const workspacePathValue = (raw as Record<string, unknown>).workspacePath;
  const workspacePath = trimOrUndefined(typeof workspacePathValue === "string" ? workspacePathValue : undefined);
  if (!workspacePath) return undefined;
  return {
    workspacePath,
    selectedOptionalIds: normalizeIdList((raw as Record<string, unknown>).selectedOptionalIds as string[] | undefined),
    mountPaths: normalizeAdditionalDirectories((raw as Record<string, unknown>).mountPaths)
  };
}

function resolveSelectedOptionalKnowledgeSetIds(input: {
  workspacePath: string;
  knowledgeSetIds?: string[];
  codexRunConfig?: Record<string, unknown>;
}): string[] {
  if (input.knowledgeSetIds !== undefined) {
    return normalizeIdList(input.knowledgeSetIds);
  }

  const previousMetadata = readKnowledgeSetRuntimeMetadata(input.codexRunConfig);
  if (previousMetadata?.workspacePath === input.workspacePath) {
    return previousMetadata.selectedOptionalIds;
  }
  return [];
}

export class RuntimeKnowledgeSetService {
  constructor(
    private readonly options: {
      workspaces: WorkspaceRepositoryLike;
      knowledgeSets: KnowledgeSetRepositoryLike;
      policies: PolicyServiceLike;
      storage: KnowledgeSetStorageLike;
      resourceAccessLogs?: ResourceAccessLogServiceLike;
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
    const defaultKnowledgeSetIds = bindings
      .filter((binding) => binding.mountType === "default")
      .map((binding) => binding.knowledgeSetId);
    const optionalKnowledgeSetIdSet = new Set(
      bindings.filter((binding) => binding.mountType === "optional").map((binding) => binding.knowledgeSetId)
    );
    const selectedOptionalKnowledgeSetIds = resolveSelectedOptionalKnowledgeSetIds({
      workspacePath,
      knowledgeSetIds: input.knowledgeSetIds,
      codexRunConfig: input.codexRunConfig
    });
    if (selectedOptionalKnowledgeSetIds.some((knowledgeSetId) => !optionalKnowledgeSetIdSet.has(knowledgeSetId))) {
      throw new Error("knowledge set 未授权或未绑定到当前 workspace");
    }
    const resolvedKnowledgeSetIds = [...defaultKnowledgeSetIds, ...selectedOptionalKnowledgeSetIds];

    const allowedKnowledgeSetIds = new Set(
      await this.options.policies.filterAllowedResources({
        userId: input.userId,
        roleIds: input.roleIds,
        departmentIds: input.departmentIds,
        resourceType: "knowledge_set",
        candidateIds: resolvedKnowledgeSetIds
      })
    );
    if (resolvedKnowledgeSetIds.some((knowledgeSetId) => !allowedKnowledgeSetIds.has(knowledgeSetId))) {
      throw new Error("knowledge set 未授权或未绑定到当前 workspace");
    }

    const knowledgeSetById = new Map(
      (await this.options.knowledgeSets.list())
        .filter((knowledgeSet) => knowledgeSet.status === "active")
        .map((knowledgeSet) => [knowledgeSet.id, knowledgeSet] as const)
    );

    const mountPaths = resolvedKnowledgeSetIds.map((knowledgeSetId) => {
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

    if (this.options.resourceAccessLogs) {
      const departmentIdSnapshot = input.departmentIds[0];
      await this.options.resourceAccessLogs.record({
        userId: input.userId,
        departmentIdSnapshot,
        resourceType: "workspace",
        resourceId: workspace.id,
        actionType: "mount",
        resultStatus: "success",
        metadata: {
          workspacePath
        }
      });

      for (const knowledgeSetId of resolvedKnowledgeSetIds) {
        const knowledgeSet = knowledgeSetById.get(knowledgeSetId);
        if (!knowledgeSet) continue;
        await this.options.resourceAccessLogs.record({
          userId: input.userId,
          departmentIdSnapshot,
          resourceType: "knowledge_set",
          resourceId: knowledgeSetId,
          actionType: "mount",
          resultStatus: "success",
          metadata: {
            sourceType: knowledgeSet.sourceType,
            workspaceId: workspace.id
          }
        });
      }
    }

    return replaceManagedKnowledgeSetDirectories(input.codexRunConfig, {
      workspacePath,
      selectedOptionalIds: selectedOptionalKnowledgeSetIds,
      mountPaths
    });
  }
}
