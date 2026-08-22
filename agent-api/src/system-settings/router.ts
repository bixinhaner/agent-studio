import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import multer, { MulterError } from "multer";
import { z } from "zod";

import { parseBrandingAssetKind, type BrandingAssetStorage } from "./branding-assets.js";
import {
  parseSystemSettingsPayloadPatch,
  systemSettingsConversationSecurityReviewSchema
} from "./types.js";
import type { SystemSettingsState, SystemSettingsService } from "./service.js";
import type { ExternalWebAccessService } from "../external-web-access.js";
import type { NotificationRecordRepository } from "../persistence/notification-record-repository.js";

type SystemSettingsRouterOptions = {
  service: Pick<SystemSettingsService, "read" | "updateDraft" | "publish">;
  requirePermission(permissionKey: string): RequestHandler;
  assetStorage?: Pick<BrandingAssetStorage, "save">;
  externalWebAccess?: Pick<ExternalWebAccessService, "getState" | "setMaintenanceEnabled">;
  notificationRecords?: Pick<NotificationRecordRepository, "list">;
  conversationSecurityReviewTest?: (input: {
    settings: z.infer<typeof systemSettingsConversationSecurityReviewSchema>;
    question: string;
    actorUserId: string;
    organizationId?: string;
  }) => Promise<unknown>;
};

const brandingAssetUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: 5 * 1024 * 1024
  }
});

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

function withBrandingAssetFile(fieldName: string): RequestHandler {
  const middleware = brandingAssetUpload.single(fieldName);
  return (req: Request, res: Response, next: NextFunction) => {
    middleware(req, res, (error) => {
      if (error) {
        next(error);
        return;
      }
      next();
    });
  };
}

export function createSystemSettingsRouter(options: SystemSettingsRouterOptions): Router {
  const router = Router();
  const requireRead = options.requirePermission("system_settings.read");
  const requireWrite = options.requirePermission("system_settings.write");
  const requirePublish = options.requirePermission("system_settings.publish");

  router.get("/external-web-access", requireRead, async (_req: Request, res: Response) => {
    if (!options.externalWebAccess) {
      res.status(501).json({ detail: "External Web access control is not configured" });
      return;
    }
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(await options.externalWebAccess.getState());
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.put("/external-web-access", requirePublish, async (req: Request, res: Response) => {
    if (!requireCurrentUser(req, res)) {
      return;
    }
    if (!options.externalWebAccess) {
      res.status(501).json({ detail: "External Web access control is not configured" });
      return;
    }
    try {
      const input = z
        .object({
          maintenance_enabled: z.boolean()
        })
        .strict()
        .parse(req.body ?? {});
      res.setHeader("Cache-Control", "no-store");
      res.json(
        await options.externalWebAccess.setMaintenanceEnabled({
          maintenanceEnabled: input.maintenance_enabled,
          actorUserId: req.currentUser.id,
          organizationId: req.currentOrganization?.id
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

  router.get("/admin-email-notifications/records", requireRead, async (req: Request, res: Response) => {
    if (!options.notificationRecords) {
      res.json({ records: [] });
      return;
    }
    try {
      const query = z.object({
        status: z.enum(["pending", "sent", "failed"]).optional(),
        take: z.coerce.number().int().min(1).max(250).default(100)
      }).parse(req.query);
      const records = await options.notificationRecords.list({
        channelType: "email",
        status: query.status,
        take: 250,
        order: "desc"
      });
      res.setHeader("Cache-Control", "no-store");
      res.json({
        records: records
          .filter((record) => record.eventType.startsWith("access_request."))
          .slice(0, query.take)
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendValidationError(res, error);
        return;
      }
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.post("/conversation-security-review/test", requireWrite, async (req: Request, res: Response) => {
    if (!requireCurrentUser(req, res)) return;
    if (!options.conversationSecurityReviewTest) {
      res.status(501).json({ detail: "对话安全审查测试未配置" });
      return;
    }
    try {
      const input = z
        .object({
          question: z.string().trim().min(1).max(8000),
          settings: systemSettingsConversationSecurityReviewSchema
        })
        .strict()
        .parse(req.body ?? {});
      res.json(await options.conversationSecurityReviewTest({
        ...input,
        actorUserId: req.currentUser.id,
        organizationId: req.currentOrganization?.id
      }));
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendValidationError(res, error);
        return;
      }
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.put("/draft", requireWrite, async (req: Request, res: Response) => {
    if (!requireCurrentUser(req, res)) {
      return;
    }
    try {
      const patch = parseSystemSettingsPayloadPatch(req.body ?? {});
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

  router.post("/assets", requireWrite, withBrandingAssetFile("file"), async (req: Request, res: Response) => {
    if (!requireCurrentUser(req, res)) {
      return;
    }
    if (!options.assetStorage) {
      res.status(501).json({ detail: "Branding asset storage is not configured" });
      return;
    }

    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ detail: "file is required" });
        return;
      }
      const kind = parseBrandingAssetKind(req.body?.kind);
      const saved = await options.assetStorage.save({ kind, file });
      res.status(201).json({
        asset: {
          url: saved.url,
          file_name: saved.fileName,
          mime_type: saved.mimeType,
          size_bytes: saved.sizeBytes
        }
      });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
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

  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (error instanceof MulterError) {
      res.status(400).json({
        detail: error.code === "LIMIT_FILE_SIZE" ? "uploaded file is too large" : "multipart upload exceeds configured limits"
      });
      return;
    }
    next(error);
  });

  return router;
}
