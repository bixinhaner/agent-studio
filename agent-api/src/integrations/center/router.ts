import express, { type Request, type RequestHandler, type Response, type Router } from "express";

import type { IntegrationCenterService } from "./service.js";
import {
  integrationBindingsUpdateSchema,
  integrationExternalApiUsageQuerySchema,
  integrationInstanceBaseSchema,
  integrationInstanceUpdateSchema,
  integrationListQuerySchema,
  integrationPoliciesUpdateSchema,
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
