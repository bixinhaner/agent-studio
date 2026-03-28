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
  default_knowledge_sets: KnowledgeSetOption[];
  optional_knowledge_sets: KnowledgeSetOption[];
};

export type PortalResourcesResponse = {
  workspaces: PortalWorkspaceResources[];
};
