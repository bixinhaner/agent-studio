export type ResourceCenterTab = "workspace" | "knowledge_set";
export type ResourceStatusFilter = "all" | "active" | "disabled";
export type ResourceTypeFilter = "all" | "filesystem" | "managed_upload";

export type ResourcePolicySubjectType = "role" | "department" | "user";
export type ResourcePolicyEffect = "allow" | "deny";
export type ResourcePolicyResourceType = "workspace" | "knowledge_set";

export type WorkspaceRecord = {
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

export type CreateWorkspaceInput = {
  organizationId?: string;
  name: string;
  slug: string;
  description?: string;
  status?: string;
  sourceType: string;
  rootPath?: string;
};

export type UpdateWorkspaceInput = Partial<CreateWorkspaceInput>;

export type WorkspaceListResponse = {
  workspaces: WorkspaceRecord[];
};

export type WorkspaceResponse = {
  workspace: WorkspaceRecord;
};

export type KnowledgeSetRecord = {
  id: string;
  organizationId?: string;
  name: string;
  slug: string;
  description?: string;
  status: string;
  sourceType: string;
  rootPath?: string;
  storageKey?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateKnowledgeSetInput = {
  organizationId?: string;
  name: string;
  slug: string;
  description?: string;
  status?: string;
  sourceType: string;
  rootPath?: string;
  storageKey?: string;
};

export type UpdateKnowledgeSetInput = Partial<CreateKnowledgeSetInput>;

export type KnowledgeSetListResponse = {
  knowledgeSets: KnowledgeSetRecord[];
};

export type KnowledgeSetResponse = {
  knowledgeSet: KnowledgeSetRecord;
};

export type WorkspaceKnowledgeSetBinding = {
  id?: string;
  workspaceId?: string;
  knowledgeSetId: string;
  mountType: string;
  createdAt?: string;
  updatedAt?: string;
};

export type WorkspaceKnowledgeSetBindingsResponse = {
  bindings: WorkspaceKnowledgeSetBinding[];
};

export type ResourcePolicyRecord = {
  id?: string;
  organizationId?: string;
  subjectType: ResourcePolicySubjectType;
  subjectId: string;
  resourceType: ResourcePolicyResourceType;
  resourceId: string;
  effect: ResourcePolicyEffect;
  createdAt?: string;
  updatedAt?: string;
};

export type ResourcePolicyInput = {
  subjectType: ResourcePolicySubjectType;
  subjectId: string;
  effect: ResourcePolicyEffect;
};

export type ResourcePoliciesResponse = {
  policies: ResourcePolicyRecord[];
};

export type KnowledgeSetItemRecord = {
  id?: string;
  kind: string;
  relativePath: string;
  displayName: string;
  mimeType?: string;
  sizeBytes?: string;
  checksum?: string;
  sourceArchiveName?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type KnowledgeSetItemsResponse = {
  items: KnowledgeSetItemRecord[];
  mountPath?: string;
};
