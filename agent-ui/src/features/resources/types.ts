export type KnowledgeSetOption = {
  id: string;
  label: string;
  slug: string;
};

export type PortalWorkspaceResources = {
  id: string;
  label: string;
  slug: string;
  is_default: boolean;
  runtime_workspace_path: string | null;
  default_knowledge_sets: KnowledgeSetOption[];
  optional_knowledge_sets: KnowledgeSetOption[];
};

export type PortalResourcesResponse = {
  workspaces: PortalWorkspaceResources[];
};
