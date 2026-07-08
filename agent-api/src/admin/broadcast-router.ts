import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";

const targetSchema = z.object({
  target_type: z.enum(["all_users", "department", "role"]),
  target_id: z.string().trim().optional().nullable()
});

const contentSchema = z.object({
  subject: z.string().trim().min(1).optional(),
  body_markdown: z.string().trim().min(1).optional(),
  cta_label: z.string().trim().optional().nullable(),
  cta_url: z.string().trim().optional().nullable(),
  language: z.enum(["zh", "en"]).optional()
});

const audienceRuleSchema = z.object({
  type: z.enum([
    "all_users",
    "organization_type",
    "organization",
    "department",
    "user",
    "role",
    "disabled_users",
    "missing_email",
    "email_opt_out"
  ]),
  id: z.string().trim().optional().nullable(),
  value: z.string().trim().optional().nullable(),
  include_children: z.boolean().optional()
});

const audienceSchema = z.object({
  include: z.array(audienceRuleSchema).optional().default([]),
  exclude: z.array(audienceRuleSchema).optional().default([])
});

const createBroadcastSchema = z.object({
  title: z.string().min(1),
  body_markdown: z.string().min(1),
  channel_email_enabled: z.boolean().optional(),
  channel_in_app_enabled: z.boolean().optional(),
  dingtalk_delivery_enabled: z.boolean().optional(),
  content: contentSchema.optional(),
  audience: audienceSchema.optional(),
  targets: z.array(targetSchema).optional().default([])
});

const updateBroadcastSchema = z.object({
  title: z.string().min(1).optional(),
  body_markdown: z.string().min(1).optional(),
  channel_email_enabled: z.boolean().optional(),
  channel_in_app_enabled: z.boolean().optional(),
  dingtalk_delivery_enabled: z.boolean().optional(),
  content: contentSchema.optional(),
  audience: audienceSchema.optional(),
  targets: z.array(targetSchema).optional()
});

const testEmailSchema = z.object({
  test_email: z.string().trim().email(),
  simulated_user_id: z.string().trim().optional().nullable()
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

function mapContent(content: z.infer<typeof contentSchema> | undefined) {
  if (!content) return undefined;
  return {
    subject: content.subject,
    bodyMarkdown: content.body_markdown,
    ctaLabel: content.cta_label ?? undefined,
    ctaUrl: content.cta_url ?? undefined,
    language: content.language
  };
}

function mapAudience(audience: z.infer<typeof audienceSchema> | undefined) {
  if (!audience) return undefined;
  return {
    include: audience.include.map((rule) => ({
      type: rule.type,
      id: rule.id ?? undefined,
      value: rule.value ?? undefined,
      includeChildren: rule.include_children
    })),
    exclude: audience.exclude.map((rule) => ({
      type: rule.type,
      id: rule.id ?? undefined,
      value: rule.value ?? undefined,
      includeChildren: rule.include_children
    }))
  };
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
      channelEmailEnabled?: boolean;
      channelInAppEnabled?: boolean;
      dingtalkDeliveryEnabled?: boolean;
      content?: {
        subject?: string;
        bodyMarkdown?: string;
        ctaLabel?: string;
        ctaUrl?: string;
        language?: "zh" | "en";
      };
      audience?: ReturnType<typeof mapAudience>;
      targets: Array<{ targetType: "all_users" | "department" | "role"; targetId?: string }>;
    }): Promise<unknown>;
    updateDraft(input: {
      actorUserId: string;
      id: string;
      title?: string;
      bodyMarkdown?: string;
      channelEmailEnabled?: boolean;
      channelInAppEnabled?: boolean;
      dingtalkDeliveryEnabled?: boolean;
      content?: {
        subject?: string;
        bodyMarkdown?: string;
        ctaLabel?: string;
        ctaUrl?: string;
        language?: "zh" | "en";
      };
      audience?: ReturnType<typeof mapAudience>;
      targets?: Array<{ targetType: "all_users" | "department" | "role"; targetId?: string }>;
    }): Promise<unknown>;
    publish(input: { actorUserId: string; broadcastId: string }): Promise<unknown>;
    previewAudience(input: { actorUserId: string; broadcastId: string }): Promise<unknown>;
    sendTestEmail(input: {
      actorUserId: string;
      broadcastId: string;
      testEmail: string;
      simulatedUserId?: string;
    }): Promise<unknown>;
    listDeliveries(input: { actorUserId: string; broadcastId: string }): Promise<unknown[]>;
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
        channelEmailEnabled: input.channel_email_enabled,
        channelInAppEnabled: input.channel_in_app_enabled,
        dingtalkDeliveryEnabled: input.dingtalk_delivery_enabled,
        content: mapContent(input.content),
        audience: mapAudience(input.audience),
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
        channelEmailEnabled: input.channel_email_enabled,
        channelInAppEnabled: input.channel_in_app_enabled,
        dingtalkDeliveryEnabled: input.dingtalk_delivery_enabled,
        content: mapContent(input.content),
        audience: mapAudience(input.audience),
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

  router.post("/broadcasts/:broadcastId/audience-preview", async (req: Request, res: Response) => {
    if (!req.currentUser) {
      res.status(401).json({ detail: "Unauthorized" });
      return;
    }

    try {
      const preview = await options.service.previewAudience({
        actorUserId: req.currentUser.id,
        broadcastId: String(req.params.broadcastId || "").trim()
      });
      res.json({ preview });
    } catch (error) {
      res.status(statusFromError(error)).json({ detail: detailFromError(error) });
    }
  });

  router.post("/broadcasts/:broadcastId/test-email", async (req: Request, res: Response) => {
    if (!req.currentUser) {
      res.status(401).json({ detail: "Unauthorized" });
      return;
    }

    try {
      const input = testEmailSchema.parse(req.body || {});
      const result = await options.service.sendTestEmail({
        actorUserId: req.currentUser.id,
        broadcastId: String(req.params.broadcastId || "").trim(),
        testEmail: input.test_email,
        simulatedUserId: input.simulated_user_id ?? undefined
      });
      res.json(result);
    } catch (error) {
      res.status(statusFromError(error)).json({ detail: detailFromError(error) });
    }
  });

  router.get("/broadcasts/:broadcastId/deliveries", async (req: Request, res: Response) => {
    if (!req.currentUser) {
      res.status(401).json({ detail: "Unauthorized" });
      return;
    }

    try {
      const deliveries = await options.service.listDeliveries({
        actorUserId: req.currentUser.id,
        broadcastId: String(req.params.broadcastId || "").trim()
      });
      res.json({ deliveries });
    } catch (error) {
      res.status(statusFromError(error)).json({ detail: detailFromError(error) });
    }
  });

  return router;
}
