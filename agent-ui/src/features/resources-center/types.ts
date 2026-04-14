export type ResourceStatusFilter = "all" | "active" | "disabled";
export type ResourceTypeFilter = "all" | "managed_upload";

export type ResourcePolicySubjectType = "role" | "department" | "user";
export type ResourcePolicyEffect = "allow" | "deny";
export type ResourcePolicyResourceType = "knowledge_set";

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
  slug?: string;
  description?: string;
  status?: string;
  sourceType?: string;
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

export type DeleteKnowledgeSetResponse = {
  deletedId: string;
  warnings?: string[];
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

export type KnowledgeSetDocumentStatus = "ready" | "missing_meta" | "missing_doc" | "partial";

export type KnowledgeSetDocumentRecord = {
  id: string;
  kind: "document_unit" | "standalone_markdown";
  title: string;
  titleSource: "meta" | "path";
  relativePath: string;
  directoryPath: string;
  topLevelDirectory: string;
  docPath?: string;
  metaPath?: string;
  status: KnowledgeSetDocumentStatus;
  updatedAt?: string;
  totalFiles: number;
  markdownFileCount: number;
  mediaFileCount: number;
  imageCount: number;
  auxiliaryFileCount: number;
  hasDocMarkdown: boolean;
  hasMetaJson: boolean;
  hasMediaDirectory: boolean;
  sourceArchiveNames: string[];
};

export type KnowledgeSetSummaryDirectory = {
  path: string;
  label: string;
  documentCount: number;
  warningDocumentCount: number;
  fileCount: number;
};

export type KnowledgeSetLibrarySummary = {
  totalDocuments: number;
  readyDocuments: number;
  warningDocuments: number;
  totalVisibleFiles: number;
  totalMarkdownFiles: number;
  totalMediaFiles: number;
  looseFileCount: number;
  ignoredJsonlFileCount: number;
  topLevelDirectoryCount: number;
  lastUpdatedAt?: string;
};

export type KnowledgeSetLibraryResponse = {
  summary: KnowledgeSetLibrarySummary;
  directories: KnowledgeSetSummaryDirectory[];
  documents: KnowledgeSetDocumentRecord[];
  knownFileNames: string[];
};

export type KnowledgeSetTreeDirectoryEntry = {
  kind: "directory";
  name: string;
  relativePath: string;
  fileCount: number;
  documentCount: number;
  warningDocumentCount: number;
};

export type KnowledgeSetTreeFileEntry = {
  kind: "file";
  name: string;
  relativePath: string;
  sizeBytes?: string;
  updatedAt?: string;
  mimeType?: string;
  sourceArchiveName?: string;
  extension: string;
};

export type KnowledgeSetTreeEntry = KnowledgeSetTreeDirectoryEntry | KnowledgeSetTreeFileEntry;

export type KnowledgeSetTreeResponse = {
  currentPath: string;
  parentPath: string | null;
  hiddenEntryCount: number;
  entries: KnowledgeSetTreeEntry[];
};
