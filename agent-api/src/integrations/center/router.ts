import express, { type Request, type RequestHandler, type Response, type Router } from "express";

import type { IntegrationCenterService } from "./service.js";
import {
  integrationBindingsUpdateSchema,
  integrationExternalApiUsageQuerySchema,
  integrationInstanceBaseSchema,
  integrationInstanceUpdateSchema,
  integrationZendeskAiReviewEmailReminderSchema,
  integrationListQuerySchema,
  integrationPoliciesUpdateSchema,
  integrationZendeskCacheCleanupQuerySchema,
  integrationZendeskCacheCleanupRunSchema,
  integrationZendeskManualRunSchema
} from "./types.js";

function detailFromError(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败";
}

function isNotFoundError(error: unknown): boolean {
  const message = detailFromError(error).toLowerCase();
  return message.includes("not found") || message.includes("不存在");
}

function isForbiddenError(error: unknown): boolean {
  const message = detailFromError(error).toLowerCase();
  return message.includes("access denied") || message.includes("forbidden") || message.includes("not authorized");
}

type IntegrationCenterRouterOptions = {
  service: IntegrationCenterService;
  requirePermission: (permissionKey: string) => RequestHandler;
  dingtalkBot?: {
    getStatus(instanceId?: string): unknown;
    restart(instanceId?: string): Promise<unknown>;
    listRecentConversations(instanceId: string, take?: number): Promise<unknown>;
  };
  /** Action Connector host access: keys a business system enters, and the hosts that used them. */
  hostAccess?: {
    list(instanceId: string): Promise<unknown>;
    createKey(instanceId: string, input: { label: string; userId?: string | null }): Promise<unknown>;
    revokeKey(instanceId: string, keyId: string): Promise<boolean>;
    revokeDevice(instanceId: string, deviceId: string): Promise<boolean>;
  };
};

export function createIntegrationCenterRouter(options: IntegrationCenterRouterOptions): Router {
  const router = express.Router();
  const requireRead = options.requirePermission("integration.read");
  const requireWrite = options.requirePermission("integration.write");
  const requirePolicyRead = options.requirePermission("resource_policy.read");
  const requirePolicyWrite = options.requirePermission("resource_policy.write");

  router.get("/integrations", requireRead, async (req: Request, res: Response) => {
    try {
      const query = integrationListQuerySchema.parse(req.query ?? {});
      res.json(await options.service.listInstances({ currentUserId: req.currentUser!.id, type: query.type }));
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/integrations", requireWrite, async (req: Request, res: Response) => {
    try {
      const payload = integrationInstanceBaseSchema.parse(req.body ?? {});
      res.status(201).json(
        await options.service.saveInstance({
          currentUserId: req.currentUser!.id,
          payload
        })
      );
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/integrations/:instanceId", requireRead, async (req: Request, res: Response) => {
    try {
      res.json(
        await options.service.getInstanceDetail({
          currentUserId: req.currentUser!.id,
          instanceId: req.params.instanceId
        })
      );
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : isForbiddenError(error) ? 403 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.patch("/integrations/:instanceId", requireWrite, async (req: Request, res: Response) => {
    try {
      const payload = integrationInstanceUpdateSchema.parse(req.body ?? {});
      res.json(
        await options.service.saveInstance({
          currentUserId: req.currentUser!.id,
          instanceId: req.params.instanceId,
          payload
        })
      );
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : isForbiddenError(error) ? 403 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/integrations/:instanceId/validate", requireWrite, async (req: Request, res: Response) => {
    try {
      res.json(
        await options.service.validateInstance({
          currentUserId: req.currentUser!.id,
          instanceId: req.params.instanceId
        })
      );
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : isForbiddenError(error) ? 403 : 400).json({ detail: detailFromError(error) });
    }
  });

  async function actionConnectorFor(req: Request) {
    const detail = (await options.service.getInstanceDetail({ currentUserId: req.currentUser!.id, instanceId: req.params.instanceId })) as { instance?: { type?: string } };
    if (detail.instance?.type !== "action_connector") throw new Error("Integration instance not found");
    if (!options.hostAccess) throw new Error("Host access is unavailable");
    return options.hostAccess;
  }
  const hostAccessError = (res: Response, error: unknown) =>
    res.status(isNotFoundError(error) ? 404 : isForbiddenError(error) ? 403 : 400).json({ detail: detailFromError(error) });

  router.get("/integrations/:instanceId/host-access", requireRead, async (req: Request, res: Response) => {
    try { res.json(await (await actionConnectorFor(req)).list(req.params.instanceId)); }
    catch (error) { hostAccessError(res, error); }
  });
  router.post("/integrations/:instanceId/host-access/keys", requireWrite, async (req: Request, res: Response) => {
    try {
      const label = typeof req.body?.label === "string" ? req.body.label.trim().slice(0, 120) : "";
      if (!label) throw new Error("请填写用途，例如部署这台主机的业务系统名称");
      res.status(201).json(await (await actionConnectorFor(req)).createKey(req.params.instanceId, { label, userId: req.currentUser!.id }));
    } catch (error) { hostAccessError(res, error); }
  });
  router.delete("/integrations/:instanceId/host-access/keys/:keyId", requireWrite, async (req: Request, res: Response) => {
    try { res.json({ revoked: await (await actionConnectorFor(req)).revokeKey(req.params.instanceId, req.params.keyId) }); }
    catch (error) { hostAccessError(res, error); }
  });
  router.delete("/integrations/:instanceId/host-access/devices/:deviceId", requireWrite, async (req: Request, res: Response) => {
    try { res.json({ revoked: await (await actionConnectorFor(req)).revokeDevice(req.params.instanceId, req.params.deviceId) }); }
    catch (error) { hostAccessError(res, error); }
  });

  router.post("/integrations/:instanceId/zendesk/run", requireWrite, async (req: Request, res: Response) => {
    try {
      const payload = integrationZendeskManualRunSchema.parse(req.body ?? {});
      res.json(
        await options.service.runZendeskTicket({
          currentUserId: req.currentUser!.id,
          instanceId: req.params.instanceId,
          ticketId: payload.ticket_id
        })
      );
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : isForbiddenError(error) ? 403 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/integrations/:instanceId/zendesk/groups", requireRead, async (req: Request, res: Response) => {
    try {
      res.json(
        await options.service.listZendeskGroups({
          currentUserId: req.currentUser!.id,
          instanceId: req.params.instanceId
        })
      );
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : isForbiddenError(error) ? 403 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/integrations/:instanceId/zendesk/cache-cleanup", requireRead, async (req: Request, res: Response) => {
    try {
      const query = integrationZendeskCacheCleanupQuerySchema.parse(req.query ?? {});
      res.json(
        await options.service.previewZendeskCacheCleanup({
          currentUserId: req.currentUser!.id,
          instanceId: req.params.instanceId,
          retentionDays: query.retention_days,
          limit: query.limit
        })
      );
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : isForbiddenError(error) ? 403 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/integrations/:instanceId/zendesk/cache-cleanup", requireWrite, async (req: Request, res: Response) => {
    try {
      const payload = integrationZendeskCacheCleanupRunSchema.parse(req.body ?? {});
      res.json(
        await options.service.runZendeskCacheCleanup({
          currentUserId: req.currentUser!.id,
          instanceId: req.params.instanceId,
          retentionDays: payload.retention_days,
          limit: payload.limit
        })
      );
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : isForbiddenError(error) ? 403 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/integrations/:instanceId/zendesk/ai-review-email-reminders/send", requireWrite, async (req: Request, res: Response) => {
    try {
      const payload = integrationZendeskAiReviewEmailReminderSchema.parse(req.body ?? {});
      res.json(
        await options.service.sendZendeskAiReviewEmailReminder({
          currentUserId: req.currentUser!.id,
          currentUserEmail: req.currentUser!.email ?? undefined,
          instanceId: req.params.instanceId,
          mode: payload.mode,
          testEmail: payload.test_email
        })
      );
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : isForbiddenError(error) ? 403 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/integrations/:instanceId/history", requireRead, async (req: Request, res: Response) => {
    try {
      res.json(
        await options.service.listValidationHistory({
          currentUserId: req.currentUser!.id,
          instanceId: req.params.instanceId
        })
      );
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : isForbiddenError(error) ? 403 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/integrations/:instanceId/dingtalk-bot/status", requireRead, async (req: Request, res: Response) => {
    try {
      if (!options.dingtalkBot) {
        res.status(503).json({ detail: "DingTalk bot stream service is not available" });
        return;
      }
      await options.service.getInstanceDetail({ currentUserId: req.currentUser!.id, instanceId: req.params.instanceId });
      res.json({ statuses: options.dingtalkBot.getStatus(req.params.instanceId) });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : isForbiddenError(error) ? 403 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/integrations/:instanceId/dingtalk-bot/restart", requireWrite, async (req: Request, res: Response) => {
    try {
      if (!options.dingtalkBot) {
        res.status(503).json({ detail: "DingTalk bot stream service is not available" });
        return;
      }
      await options.service.getInstanceDetail({ currentUserId: req.currentUser!.id, instanceId: req.params.instanceId });
      res.json({ statuses: await options.dingtalkBot.restart(req.params.instanceId) });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : isForbiddenError(error) ? 403 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/integrations/:instanceId/dingtalk-bot/conversations", requireRead, async (req: Request, res: Response) => {
    try {
      if (!options.dingtalkBot) {
        res.status(503).json({ detail: "DingTalk bot stream service is not available" });
        return;
      }
      await options.service.getInstanceDetail({ currentUserId: req.currentUser!.id, instanceId: req.params.instanceId });
      const take = Number(req.query.take);
      res.json({
        items: await options.dingtalkBot.listRecentConversations(
          req.params.instanceId,
          Number.isFinite(take) ? Math.trunc(take) : undefined
        )
      });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : isForbiddenError(error) ? 403 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/integrations/:instanceId/external-api-usage", requireRead, async (req: Request, res: Response) => {
    try {
      const query = integrationExternalApiUsageQuerySchema.parse(req.query ?? {});
      res.json(
        await options.service.getExternalApiUsage({
          currentUserId: req.currentUser!.id,
          instanceId: req.params.instanceId,
          days: query.days,
          take: query.take
        })
      );
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : isForbiddenError(error) ? 403 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/integrations/:instanceId/bindings", requireRead, async (req: Request, res: Response) => {
    try {
      res.json(
        await options.service.listBindings({
          currentUserId: req.currentUser!.id,
          instanceId: req.params.instanceId
        })
      );
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : isForbiddenError(error) ? 403 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.put("/integrations/:instanceId/bindings", requireWrite, async (req: Request, res: Response) => {
    try {
      const payload = integrationBindingsUpdateSchema.parse(req.body ?? {});
      res.json(
        await options.service.replaceBindings({
          currentUserId: req.currentUser!.id,
          instanceId: req.params.instanceId,
          bindings: payload.bindings
        })
      );
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : isForbiddenError(error) ? 403 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/integrations/:instanceId/policies", requireRead, requirePolicyRead, async (req: Request, res: Response) => {
    try {
      res.json(
        await options.service.getPolicies({
          currentUserId: req.currentUser!.id,
          instanceId: req.params.instanceId
        })
      );
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : isForbiddenError(error) ? 403 : 400).json({ detail: detailFromError(error) });
    }
  });

  router.put("/integrations/:instanceId/policies", requireWrite, requirePolicyWrite, async (req: Request, res: Response) => {
    try {
      const payload = integrationPoliciesUpdateSchema.parse(req.body ?? {});
      const policies = await options.service.replacePolicies({
        currentUserId: req.currentUser!.id,
        instanceId: req.params.instanceId,
        policies:
          payload.policies ?? [
            ...(payload.roleAllowIds ?? []).map((subjectId) => ({ subjectType: "role" as const, subjectId, effect: "allow" as const })),
            ...(payload.roleDenyIds ?? []).map((subjectId) => ({ subjectType: "role" as const, subjectId, effect: "deny" as const })),
            ...(payload.departmentAllowIds ?? []).map((subjectId) => ({
              subjectType: "department" as const,
              subjectId,
              effect: "allow" as const
            })),
            ...(payload.departmentDenyIds ?? []).map((subjectId) => ({
              subjectType: "department" as const,
              subjectId,
              effect: "deny" as const
            })),
            ...(payload.userAllowIds ?? []).map((subjectId) => ({ subjectType: "user" as const, subjectId, effect: "allow" as const })),
            ...(payload.userDenyIds ?? []).map((subjectId) => ({ subjectType: "user" as const, subjectId, effect: "deny" as const }))
          ]
      });
      res.json(policies);
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : isForbiddenError(error) ? 403 : 400).json({ detail: detailFromError(error) });
    }
  });

  return router;
}
