import type { PublicBrandService } from "../public-brands/service.js";

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

type KnowledgeSetRecord = {
  id: string;
  organizationId?: string;
  status: string;
  sourceType: string;
  rootPath?: string | null;
  storageKey?: string | null;
};

type KnowledgeSetRepositoryLike = {
  list(): Promise<KnowledgeSetRecord[]>;
};

type PolicyServiceLike = {
  filterAllowedResources(input: {
    organizationId?: string;
    userId: string;
    roleIds: string[];
    departmentIds: string[];
    resourceType: "knowledge_set";
    candidateIds: string[];
  }): Promise<string[]>;
};

type KnowledgeSetStorageLike = {
  resolveReadableMountPath(knowledgeSetStorageKey: string): string;
};

type KnowledgeSetRuntimeMetadata = {
  workspacePath: string;
  selectedIds: string[];
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

type SecurityAlertServiceLike = {
  evaluateSecurityEvent(input: {
    scopeType: string;
    scopeId: string;
    resourceType?: string;
    resourceId?: string;
    actionType?: string;
    resultStatus?: string;
    userId?: string;
  }): Promise<unknown>;
};

const KNOWLEDGE_SET_METADATA_KEY = "_agentStudioKnowledgeSets";
const MANAGED_UPLOAD_SOURCE_TYPE = "managed_upload";

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
  const rawSelectedIds =
    (raw as Record<string, unknown>).selectedIds ?? (raw as Record<string, unknown>).selectedOptionalIds;
  return {
    workspacePath,
    selectedIds: normalizeIdList(rawSelectedIds as string[] | undefined),
    mountPaths: normalizeAdditionalDirectories((raw as Record<string, unknown>).mountPaths)
  };
}

function resolveSelectedKnowledgeSetIds(input: {
  workspacePath: string;
  knowledgeSetIds?: string[];
  codexRunConfig?: Record<string, unknown>;
}): string[] {
  if (input.knowledgeSetIds !== undefined) {
    return normalizeIdList(input.knowledgeSetIds);
  }

  const previousMetadata = readKnowledgeSetRuntimeMetadata(input.codexRunConfig);
  if (previousMetadata?.workspacePath === input.workspacePath) {
    return previousMetadata.selectedIds;
  }
  return [];
}

function resolveKnowledgeSetStorageKey(knowledgeSet: KnowledgeSetRecord): string {
  return trimOrUndefined(knowledgeSet.storageKey) ?? knowledgeSet.id;
}

function matchesOrganization(recordOrganizationId: string | undefined, organizationId: string | undefined): boolean {
  const normalizedRecordOrganizationId = trimOrUndefined(recordOrganizationId);
  const normalizedOrganizationId = trimOrUndefined(organizationId);
  if (normalizedRecordOrganizationId && normalizedOrganizationId) {
    return normalizedRecordOrganizationId === normalizedOrganizationId;
  }
  return !normalizedRecordOrganizationId;
}

export class RuntimeKnowledgeSetService {
  constructor(
    private readonly options: {
      knowledgeSets: KnowledgeSetRepositoryLike;
      policies: PolicyServiceLike;
      storage: KnowledgeSetStorageLike;
      resourceAccessLogs?: ResourceAccessLogServiceLike;
      securityAlerts?: SecurityAlertServiceLike;
      publicBrands?: Pick<PublicBrandService, "getForOrganization">;
    }
  ) {}

  async mergeSelectedKnowledgeSetsIntoRunConfig(input: {
    organizationId?: string;
    userId: string;
    roleIds: string[];
    departmentIds: string[];
    workspacePath: string;
    knowledgeSetIds?: string[];
    codexRunConfig?: Record<string, unknown>;
  }): Promise<Record<string, unknown> | undefined> {
    const workspacePath = trimOrUndefined(input.workspacePath);
    if (!workspacePath) {
      throw new Error("Session workspace does not exist or is invalid");
    }

    const brand = await this.options.publicBrands?.getForOrganization(input.organizationId);
    const selectedKnowledgeSetIds = brand
      ? [...brand.knowledgeSetIds]
      : resolveSelectedKnowledgeSetIds({
          workspacePath,
          knowledgeSetIds: input.knowledgeSetIds,
          codexRunConfig: input.codexRunConfig
        });

    const knowledgeSetById = new Map(
      (await this.options.knowledgeSets.list())
        .filter(
          (knowledgeSet) =>
            knowledgeSet.status === "active" &&
            trimOrUndefined(knowledgeSet.sourceType) === MANAGED_UPLOAD_SOURCE_TYPE &&
            matchesOrganization(knowledgeSet.organizationId, input.organizationId)
        )
        .map((knowledgeSet) => [knowledgeSet.id, knowledgeSet] as const)
    );

    const unavailableKnowledgeSetId = selectedKnowledgeSetIds.find((knowledgeSetId) => !knowledgeSetById.has(knowledgeSetId));
    if (unavailableKnowledgeSetId) {
      await this.options.securityAlerts?.evaluateSecurityEvent({
        scopeType: input.departmentIds[0] ? "department" : "platform",
        scopeId: input.departmentIds[0] ?? "platform",
        resourceType: "knowledge_set",
        resourceId: unavailableKnowledgeSetId,
        actionType: "mount",
        resultStatus: "denied",
        userId: input.userId
      });
      throw new Error("Knowledge set does not exist or is not enabled");
    }

    const allowedKnowledgeSetIds = new Set(
      brand
        ? selectedKnowledgeSetIds
        : await this.options.policies.filterAllowedResources({
            userId: input.userId,
            roleIds: input.roleIds,
            departmentIds: input.departmentIds,
            organizationId: input.organizationId,
            resourceType: "knowledge_set",
            candidateIds: selectedKnowledgeSetIds
          })
    );
    const deniedKnowledgeSetId = selectedKnowledgeSetIds.find((knowledgeSetId) => !allowedKnowledgeSetIds.has(knowledgeSetId));
    if (deniedKnowledgeSetId) {
      await this.options.securityAlerts?.evaluateSecurityEvent({
        scopeType: input.departmentIds[0] ? "department" : "platform",
        scopeId: input.departmentIds[0] ?? "platform",
        resourceType: "knowledge_set",
        resourceId: deniedKnowledgeSetId,
        actionType: "mount",
        resultStatus: "denied",
        userId: input.userId
      });
      throw new Error("Knowledge set is not authorized");
    }

    const mountPaths = selectedKnowledgeSetIds.map((knowledgeSetId) => {
      const knowledgeSet = knowledgeSetById.get(knowledgeSetId);
      if (!knowledgeSet) {
        throw new Error("Knowledge set does not exist or is not enabled");
      }
      return this.options.storage.resolveReadableMountPath(resolveKnowledgeSetStorageKey(knowledgeSet));
    });

    if (this.options.resourceAccessLogs) {
      const departmentIdSnapshot = input.departmentIds[0];
      for (const knowledgeSetId of selectedKnowledgeSetIds) {
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
            sourceType: knowledgeSet.sourceType
          }
        });
      }
    }

    return replaceManagedKnowledgeSetDirectories(input.codexRunConfig, {
      workspacePath,
      selectedIds: selectedKnowledgeSetIds,
      mountPaths
    });
  }
}
