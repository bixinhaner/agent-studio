export type KnowledgeSetOption = {
  id: string;
  label: string;
  slug: string;
};

export type PortalResourcesResponse = {
  knowledgeSets: KnowledgeSetOption[];
};
