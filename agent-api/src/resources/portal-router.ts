import { Router, type Request, type Response } from "express";

import { PolicyService } from "./policy-service.js";

type KnowledgeSetRecord = {
  id: string;
  name: string;
  slug: string;
  status: string;
};

type KnowledgeSetRepositoryLike = {
  list(): Promise<KnowledgeSetRecord[]>;
};

export function createResourcesPortalRouter(options: {
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
    const knowledgeSets = activeKnowledgeSets
      .filter((knowledgeSet) => visibleKnowledgeSetIdSet.has(knowledgeSet.id))
      .map((knowledgeSet) => ({
        id: knowledgeSet.id,
        label: knowledgeSet.name,
        slug: knowledgeSet.slug
      }));

    res.json({ knowledgeSets });
  });

  return router;
}
