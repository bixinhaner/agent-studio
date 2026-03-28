import { Router, type Request, type Response } from "express";

import { PolicyService } from "./policy-service.js";

type WorkspaceRecord = {
  id: string;
  name: string;
  slug: string;
  status: string;
};

type KnowledgeSetRecord = {
  id: string;
  name: string;
  slug: string;
  status: string;
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

export function createResourcesPortalRouter(options: {
  workspaces: WorkspaceRepositoryLike;
  knowledgeSets: KnowledgeSetRepositoryLike;
  policies: Pick<PolicyService, "filterAllowedResources">;
  listDepartmentIdsForUser(userId: string): Promise<string[]>;
}): Router {
  const router = Router();

  router.get("/resources", async (req: Request, res: Response) => {
    const currentUser = req.currentUser;
    if (!currentUser) {
      res.status(401).json({ detail: "Unauthorized" });
      return;
    }

    const roleIds = [currentUser.role ?? "employee"];
    const departmentIds = await options.listDepartmentIdsForUser(currentUser.id);
    const allWorkspaces = await options.workspaces.list();
    const activeWorkspaces = allWorkspaces.filter((workspace) => workspace.status === "active");
    const visibleWorkspaceIds = await options.policies.filterAllowedResources({
      userId: currentUser.id,
      roleIds,
      departmentIds,
      resourceType: "workspace",
      candidateIds: activeWorkspaces.map((workspace) => workspace.id)
    });

    const allKnowledgeSets = await options.knowledgeSets.list();
    const activeKnowledgeSets = allKnowledgeSets.filter((knowledgeSet) => knowledgeSet.status === "active");
    const visibleKnowledgeSetIds = await options.policies.filterAllowedResources({
      userId: currentUser.id,
      roleIds,
      departmentIds,
      resourceType: "knowledge_set",
      candidateIds: activeKnowledgeSets.map((knowledgeSet) => knowledgeSet.id)
    });
    const visibleKnowledgeSetIdSet = new Set(visibleKnowledgeSetIds);
    const knowledgeSetById = new Map(activeKnowledgeSets.map((knowledgeSet) => [knowledgeSet.id, knowledgeSet] as const));

    const workspaces = [];
    for (const workspaceId of visibleWorkspaceIds) {
      const workspace = activeWorkspaces.find((item) => item.id === workspaceId);
      if (!workspace) continue;

      const bindings = await options.knowledgeSets.listWorkspaceBindings(workspace.id);
      const defaultKnowledgeSets = bindings
        .filter((binding) => binding.mountType === "default")
        .map((binding) => knowledgeSetById.get(binding.knowledgeSetId))
        .filter((knowledgeSet): knowledgeSet is KnowledgeSetRecord => Boolean(knowledgeSet))
        .filter((knowledgeSet) => visibleKnowledgeSetIdSet.has(knowledgeSet.id))
        .map((knowledgeSet) => ({
          id: knowledgeSet.id,
          label: knowledgeSet.name,
          slug: knowledgeSet.slug
        }));

      const optionalKnowledgeSets = bindings
        .filter((binding) => binding.mountType === "optional")
        .map((binding) => knowledgeSetById.get(binding.knowledgeSetId))
        .filter((knowledgeSet): knowledgeSet is KnowledgeSetRecord => Boolean(knowledgeSet))
        .filter((knowledgeSet) => visibleKnowledgeSetIdSet.has(knowledgeSet.id))
        .map((knowledgeSet) => ({
          id: knowledgeSet.id,
          label: knowledgeSet.name,
          slug: knowledgeSet.slug
        }));

      workspaces.push({
        id: workspace.id,
        label: workspace.name,
        slug: workspace.slug,
        is_default: workspaces.length === 0,
        default_knowledge_sets: defaultKnowledgeSets,
        optional_knowledge_sets: optionalKnowledgeSets
      });
    }

    res.json({ workspaces });
  });

  return router;
}
