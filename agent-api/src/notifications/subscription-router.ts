import type { PrismaClient } from "@prisma/client";
import { Router, type Request, type Response } from "express";
import { z } from "zod";

import type { DingTalkPushService } from "./dingtalk-push-service.js";
import {
  buildFindingsMarkdown,
  NotificationSubscriptionService,
  PROACTIVE_SCENARIOS,
  SEVERITY_ORDER,
  severitiesAtLeast,
  subscriptionOut,
  SubscriptionValidationError
} from "./subscription-service.js";

const bodySchema = z.object({
  target_type: z.enum(["user", "department", "role"]).default("user"),
  target_id: z.string().trim().min(1).max(200).optional(),
  scenario_key: z.string().trim().min(1).nullable().optional(),
  connector_id: z.string().trim().min(1).nullable().optional(),
  min_severity: z.enum(SEVERITY_ORDER).optional(),
  delivery_mode: z.enum(["realtime", "digest"]).optional(),
  digest_time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).nullable().optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  enabled: z.boolean().optional()
});

type Viewer = { userId: string; organizationId: string; internal: boolean };

function sendError(res: Response, error: unknown, fallback: string) {
  if (error instanceof z.ZodError) {
    res.status(400).json({ detail: error.issues[0]?.message ?? fallback, code: "invalid_input" });
    return;
  }
  if (error instanceof SubscriptionValidationError) {
    res.status(400).json({ detail: error.message, code: error.code });
    return;
  }
  res.status(500).json({ detail: error instanceof Error ? error.message : fallback });
}

export function createNotificationSubscriptionRouter(input: {
  service: NotificationSubscriptionService;
  push: DingTalkPushService;
  db: Pick<PrismaClient, "proactiveAgentFinding" | "integrationInstance" | "department" | "role" | "user">;
  resolveViewer(req: Request): Viewer;
  canManageShared(userId: string): Promise<boolean>;
}): Router {
  const router = Router();

  async function viewerContext(req: Request) {
    const viewer = input.resolveViewer(req);
    if (!viewer.internal) {
      const error = new SubscriptionValidationError("Subscriptions are available to internal members only", "internal_only");
      throw error;
    }
    return { ...viewer, canManageShared: await input.canManageShared(viewer.userId) };
  }

  router.get("/", async (req, res) => {
    try {
      const viewer = await viewerContext(req);
      const since = new Date(Date.now() - 30 * 24 * 60 * 60_000);
      const [subscriptions, connectorRows, me] = await Promise.all([
        input.service.listForViewer(viewer),
        input.db.proactiveAgentFinding.groupBy({
          by: ["connectorId"],
          where: { createdAt: { gte: since } },
          _count: { _all: true }
        }),
        input.db.user.findUnique({ where: { id: viewer.userId }, select: { dingtalkUserId: true } })
      ]);
      const instances = connectorRows.length
        ? await input.db.integrationInstance.findMany({
            where: { id: { in: connectorRows.map((row) => row.connectorId) } },
            select: { id: true, name: true }
          })
        : [];
      const names = new Map(instances.map((item) => [item.id, item.name]));
      res.setHeader("Cache-Control", "private, no-store");
      res.json({
        subscriptions,
        can_manage_shared: viewer.canManageShared,
        dingtalk_bound: Boolean(me?.dingtalkUserId),
        dingtalk_available: input.push.isAvailable(),
        scenarios: Object.entries(PROACTIVE_SCENARIOS).map(([key, label]) => ({ key, name_zh: label.zh, name_en: label.en })),
        connectors: connectorRows
          .map((row) => ({ id: row.connectorId, name: names.get(row.connectorId) ?? row.connectorId, finding_count_30d: row._count._all }))
          .sort((a, b) => b.finding_count_30d - a.finding_count_30d)
      });
    } catch (error) {
      sendError(res, error, "Failed to list subscriptions");
    }
  });

  router.get("/targets", async (req, res) => {
    try {
      const viewer = await viewerContext(req);
      if (!viewer.canManageShared) {
        res.status(403).json({ detail: "Permission denied" });
        return;
      }
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const [departments, roles] = await Promise.all([
        input.db.department.findMany({
          where: { status: "active", ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}) },
          select: { id: true, name: true },
          orderBy: { sortOrder: "asc" },
          take: 30
        }),
        input.db.role.findMany({
          where: { isActive: true, ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}) },
          select: { slug: true, name: true },
          take: 30
        })
      ]);
      res.json({
        departments: departments.map((item) => ({ id: item.id, name: item.name })),
        roles: roles.map((item) => ({ id: item.slug, name: item.name }))
      });
    } catch (error) {
      sendError(res, error, "Failed to search targets");
    }
  });

  router.post("/", async (req, res) => {
    try {
      const viewer = await viewerContext(req);
      const body = bodySchema.parse(req.body ?? {});
      if (body.target_type !== "user" && !viewer.canManageShared) {
        res.status(403).json({ detail: "Only administrators can subscribe departments or roles" });
        return;
      }
      const targetId = body.target_type === "user" && !viewer.canManageShared ? viewer.userId : body.target_id ?? viewer.userId;
      const created = await input.service.create({
        organizationId: viewer.organizationId,
        createdById: viewer.userId,
        targetType: body.target_type,
        targetId,
        scenarioKey: body.scenario_key,
        connectorId: body.connector_id,
        minSeverity: body.min_severity,
        deliveryMode: body.delivery_mode,
        digestTime: body.digest_time,
        timezone: body.timezone,
        enabled: body.enabled
      });
      res.status(201).json({ subscription: subscriptionOut(created) });
    } catch (error) {
      sendError(res, error, "Failed to create subscription");
    }
  });

  router.patch("/:id", async (req, res) => {
    try {
      const viewer = await viewerContext(req);
      const body = bodySchema.partial().parse(req.body ?? {});
      const updated = await input.service.update(
        String(req.params.id),
        {
          scenarioKey: body.scenario_key,
          connectorId: body.connector_id,
          minSeverity: body.min_severity,
          deliveryMode: body.delivery_mode,
          digestTime: body.digest_time,
          timezone: body.timezone,
          enabled: body.enabled
        },
        viewer
      );
      if (!updated) {
        res.status(404).json({ detail: "Subscription does not exist" });
        return;
      }
      res.json({ subscription: subscriptionOut(updated) });
    } catch (error) {
      sendError(res, error, "Failed to update subscription");
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      const viewer = await viewerContext(req);
      const removed = await input.service.remove(String(req.params.id), viewer);
      if (!removed) {
        res.status(404).json({ detail: "Subscription does not exist" });
        return;
      }
      res.json({ ok: true });
    } catch (error) {
      sendError(res, error, "Failed to delete subscription");
    }
  });

  /** Sends the latest matching finding to the requester only, to preview the card. */
  router.post("/:id/test", async (req, res) => {
    try {
      const viewer = await viewerContext(req);
      const [subscription] = (await input.service.listForViewer(viewer)).filter((item) => item.id === req.params.id);
      if (!subscription) {
        res.status(404).json({ detail: "Subscription does not exist" });
        return;
      }
      const finding = await input.db.proactiveAgentFinding.findFirst({
        where: {
          severity: { in: severitiesAtLeast(subscription.min_severity) },
          ...(subscription.scenario_key ? { scenarioKey: subscription.scenario_key } : {}),
          ...(subscription.connector_id ? { connectorId: subscription.connector_id } : {})
        },
        orderBy: { createdAt: "desc" }
      });
      const result = await input.push.pushClaimed({
        userId: viewer.userId,
        items: [{ sourceType: "proactive_test", sourceId: `${subscription.id}:${Date.now()}` }],
        build: (_claimed, { en }) => {
          if (!finding) {
            return {
              title: en ? "Subscription test" : "订阅测试",
              markdown: en ? "### Subscription test\n\nNo matching findings yet." : "### 订阅测试\n\n暂时没有符合条件的主动发现。"
            };
          }
          const message = buildFindingsMarkdown([finding], en);
          return { ...message, markdown: `${en ? "> Test delivery" : "> 测试推送"}\n\n${message.markdown}` };
        }
      });
      res.json({ result });
    } catch (error) {
      sendError(res, error, "Failed to send test");
    }
  });

  return router;
}
