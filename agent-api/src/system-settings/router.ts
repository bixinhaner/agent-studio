import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";

import { systemSettingsPayloadPatchSchema } from "./types.js";
import type { SystemSettingsState, SystemSettingsService } from "./service.js";

type SystemSettingsRouterOptions = {
  service: Pick<SystemSettingsService, "read" | "updateDraft" | "publish">;
  requirePermission(permissionKey: string): RequestHandler;
};

function detailFromError(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败";
}

function sendValidationError(res: Response, error: z.ZodError): void {
  res.status(400).json({
    detail: error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ")
  });
}

function sendState(res: Response, state: SystemSettingsState): void {
  res.json(state);
}

function requireCurrentUser(req: Request, res: Response): req is Request & { currentUser: NonNullable<Request["currentUser"]> } {
  if (!req.currentUser) {
    res.status(401).json({ detail: "Unauthorized" });
    return false;
  }
  return true;
}

export function createSystemSettingsRouter(options: SystemSettingsRouterOptions): Router {
  const router = Router();
  const requireRead = options.requirePermission("system_settings.read");
  const requireWrite = options.requirePermission("system_settings.write");
  const requirePublish = options.requirePermission("system_settings.publish");

  router.get("/", requireRead, async (req: Request, res: Response) => {
    if (!requireCurrentUser(req, res)) {
      return;
    }
    try {
      sendState(res, await options.service.read());
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.put("/draft", requireWrite, async (req: Request, res: Response) => {
    if (!requireCurrentUser(req, res)) {
      return;
    }
    try {
      const patch = systemSettingsPayloadPatchSchema.parse(req.body ?? {});
      sendState(
        res,
        await options.service.updateDraft({
          actorUserId: req.currentUser.id,
          patch
        })
      );
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendValidationError(res, error);
        return;
      }
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.post("/publish", requirePublish, async (req: Request, res: Response) => {
    if (!requireCurrentUser(req, res)) {
      return;
    }
    try {
      z.object({}).strict().parse(req.body ?? {});
      sendState(
        res,
        await options.service.publish({
          actorUserId: req.currentUser.id
        })
      );
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendValidationError(res, error);
        return;
      }
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  return router;
}
