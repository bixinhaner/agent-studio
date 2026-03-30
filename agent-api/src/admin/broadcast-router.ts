import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";

const targetSchema = z.object({
  target_type: z.enum(["all_users", "department", "role"]),
  target_id: z.string().trim().optional().nullable()
});

const createBroadcastSchema = z.object({
  title: z.string().min(1),
  body_markdown: z.string().min(1),
  dingtalk_delivery_enabled: z.boolean().optional(),
  targets: z.array(targetSchema).optional().default([])
});

const updateBroadcastSchema = z.object({
  title: z.string().min(1).optional(),
  body_markdown: z.string().min(1).optional(),
  dingtalk_delivery_enabled: z.boolean().optional(),
  targets: z.array(targetSchema).optional()
});

const statusSchema = z.enum(["draft", "published", "archived"]);

function detailFromError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? "invalid request";
  }
  return error instanceof Error ? error.message : "request failed";
}

function statusFromError(error: unknown): number {
  const detail = detailFromError(error).toLowerCase();
  if (detail.includes("unauthorized")) return 401;
  if (detail.includes("access denied") || detail.includes("forbidden")) return 403;
  if (detail.includes("not found") || detail.includes("不存在")) return 404;
  return 400;
}

function mapTargets(targets: Array<{ target_type: "all_users" | "department" | "role"; target_id?: string | null }>) {
  return targets.map((target) => ({
    targetType: target.target_type,
    targetId: target.target_id?.trim() || undefined
  }));
}

export function createBroadcastAdminRouter(options: {
  broadcasts: {
    list(status?: "draft" | "published" | "archived"): Promise<unknown[]>;
  };
  service: {
    createDraft(input: {
      actorUserId: string;
      title: string;
      bodyMarkdown: string;
      dingtalkDeliveryEnabled?: boolean;
      targets: Array<{ targetType: "all_users" | "department" | "role"; targetId?: string }>;
    }): Promise<unknown>;
    updateDraft(input: {
      actorUserId: string;
      id: string;
      title?: string;
      bodyMarkdown?: string;
      dingtalkDeliveryEnabled?: boolean;
      targets?: Array<{ targetType: "all_users" | "department" | "role"; targetId?: string }>;
    }): Promise<unknown>;
    publish(input: { actorUserId: string; broadcastId: string }): Promise<unknown>;
  };
  requirePermission?: (permissionKey: string) => RequestHandler;
}): Router {
  const router = Router();
  const requireBroadcastPermission = options.requirePermission?.("collaboration.broadcast.publish");

  if (requireBroadcastPermission) {
    router.use("/broadcasts", requireBroadcastPermission);
  }

  router.get("/broadcasts", async (req: Request, res: Response) => {
    try {
      const status = typeof req.query.status === "string" ? statusSchema.parse(req.query.status) : undefined;
      const broadcasts = await options.broadcasts.list(status);
      res.json({ broadcasts });
    } catch (error) {
      res.status(statusFromError(error)).json({ detail: detailFromError(error) });
    }
  });

  router.post("/broadcasts", async (req: Request, res: Response) => {
    if (!req.currentUser) {
      res.status(401).json({ detail: "Unauthorized" });
      return;
    }

    try {
      const input = createBroadcastSchema.parse(req.body || {});
      const broadcast = await options.service.createDraft({
        actorUserId: req.currentUser.id,
        title: input.title.trim(),
        bodyMarkdown: input.body_markdown.trim(),
        dingtalkDeliveryEnabled: input.dingtalk_delivery_enabled,
        targets: mapTargets(input.targets)
      });
      res.json({ broadcast });
    } catch (error) {
      res.status(statusFromError(error)).json({ detail: detailFromError(error) });
    }
  });

  router.patch("/broadcasts/:broadcastId", async (req: Request, res: Response) => {
    if (!req.currentUser) {
      res.status(401).json({ detail: "Unauthorized" });
      return;
    }

    try {
      const input = updateBroadcastSchema.parse(req.body || {});
      const broadcast = await options.service.updateDraft({
        actorUserId: req.currentUser.id,
        id: String(req.params.broadcastId || "").trim(),
        title: input.title?.trim(),
        bodyMarkdown: input.body_markdown?.trim(),
        dingtalkDeliveryEnabled: input.dingtalk_delivery_enabled,
        targets: input.targets ? mapTargets(input.targets) : undefined
      });
      res.json({ broadcast });
    } catch (error) {
      res.status(statusFromError(error)).json({ detail: detailFromError(error) });
    }
  });

  router.post("/broadcasts/:broadcastId/publish", async (req: Request, res: Response) => {
    if (!req.currentUser) {
      res.status(401).json({ detail: "Unauthorized" });
      return;
    }

    try {
      const broadcast = await options.service.publish({
        actorUserId: req.currentUser.id,
        broadcastId: String(req.params.broadcastId || "").trim()
      });
      res.json({ broadcast });
    } catch (error) {
      res.status(statusFromError(error)).json({ detail: detailFromError(error) });
    }
  });

  return router;
}
