import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";

import {
  TrainingCatalogAccessError,
  type TrainingCatalogConfigurationStatus,
  type TrainingCatalogService,
  type TrainingCatalogViewer
} from "../workspaces/training-catalog-service.js";

const updateConfigurationSchema = z.object({
  enabled: z.boolean(),
  source_email: z.string().trim().email(),
  root_folder_name: z.string().trim().min(1).max(240)
});

function resolveViewer(req: Request): TrainingCatalogViewer {
  if (!req.currentUser || !req.currentOrganization) {
    throw new TrainingCatalogAccessError("Unauthorized", 401);
  }
  return {
    userId: req.currentUser.id,
    organizationId: req.currentOrganization.id,
    organizationType: req.currentOrganization.type
  };
}

function statusOut(status: TrainingCatalogConfigurationStatus) {
  return {
    enabled: status.enabled,
    source_email: status.sourceEmail,
    root_folder_name: status.rootFolderName,
    validation_status: status.validationStatus,
    validation_message: status.validationMessage,
    folder_count: status.folderCount,
    thread_count: status.threadCount,
    updated_at: status.updatedAt ?? null
  };
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof TrainingCatalogAccessError) {
    res.status(error.status).json({ detail: error.message });
    return;
  }
  if (error instanceof z.ZodError) {
    res.status(400).json({ detail: error.issues[0]?.message ?? "配置格式不正确" });
    return;
  }
  res.status(400).json({ detail: error instanceof Error ? error.message : "培训案例配置失败" });
}

export function createTrainingCatalogAdminRouter(input: {
  service: TrainingCatalogService;
  requirePermission?: (permissionKey: string) => RequestHandler;
}): Router {
  const router = Router();
  const requirePermission = input.requirePermission?.("collaboration.broadcast.publish");
  if (requirePermission) router.use("/training-catalog", requirePermission);

  router.get("/training-catalog/config", async (req, res) => {
    try {
      const status = await input.service.getConfigurationStatus(resolveViewer(req));
      res.setHeader("Cache-Control", "private, no-store");
      res.json({ configuration: statusOut(status) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.put("/training-catalog/config", async (req, res) => {
    try {
      if (!req.currentUser) throw new TrainingCatalogAccessError("Unauthorized", 401);
      const body = updateConfigurationSchema.parse(req.body || {});
      const status = await input.service.saveConfiguration({
        viewer: resolveViewer(req),
        actorUserId: req.currentUser.id,
        enabled: body.enabled,
        sourceEmail: body.source_email,
        rootFolderName: body.root_folder_name
      });
      res.json({ configuration: statusOut(status) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/training-catalog/root-folders", async (req, res) => {
    try {
      const sourceEmail = typeof req.query.source_email === "string" ? req.query.source_email : "";
      const folders = await input.service.listRootFolderOptions({
        viewer: resolveViewer(req),
        sourceEmail
      });
      res.json({
        folders: folders.map((folder) => ({
          id: folder.id,
          name: folder.name,
          workspace_id: folder.workspaceId
        }))
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}
