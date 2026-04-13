import { Router, type Request, type Response } from "express";

import { isInternalOrganizationType, resolveResourceRoleIds } from "../auth/resource-role-context.js";
import { toPortalRuntimeOptions } from "./runtime-options.js";
import type { PortalRuntimeOptionService } from "./runtime-option-service.js";

export function createPortalRouter(options: {
  runtimeOptions: Pick<PortalRuntimeOptionService, "resolve">;
  listDepartmentIdsForUser(userId: string): Promise<string[]>;
}): Router {
  const router = Router();

  router.get("/runtime-options", async (req: Request, res: Response) => {
    const currentUser = req.currentUser;
    if (!currentUser) {
      res.status(401).json({ detail: "Unauthorized" });
      return;
    }

    try {
      const roleIds = resolveResourceRoleIds({
        platformRole: currentUser.role,
        organizationType: req.currentOrganization?.type,
        membershipType: req.currentMembership?.membershipType
      });
      const departmentIds = isInternalOrganizationType(req.currentOrganization?.type)
        ? await options.listDepartmentIdsForUser(currentUser.id)
        : [];
      const resolved = await options.runtimeOptions.resolve({
        organizationId: req.currentOrganization?.id,
        userId: currentUser.id,
        roleIds,
        departmentIds
      });
      res.json(toPortalRuntimeOptions(resolved));
    } catch (error) {
      res.status(500).json({
        detail: error instanceof Error ? error.message : "failed to resolve portal runtime options"
      });
    }
  });

  return router;
}
