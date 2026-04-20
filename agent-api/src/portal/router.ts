import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { isInternalOrganizationType, resolveResourceRoleIds } from "../auth/resource-role-context.js";
import type { SubscriptionEntitlementService } from "../operations/subscription-entitlement-service.js";
import type { ProductFeedbackRepository } from "../persistence/product-feedback-repository.js";
import { toPortalRuntimeOptions } from "./runtime-options.js";
import type { PortalRuntimeOptionService } from "./runtime-option-service.js";

const productFeedbackPayloadSchema = z.object({
  type: z.enum(["bug", "feature_request", "usability_issue", "other"]),
  severity: z.enum(["blocking", "high", "medium", "low"]).optional().nullable(),
  description: z.string().trim().min(1).max(4000),
  thread_id: z.string().trim().max(200).optional().nullable(),
  context: z.record(z.string(), z.unknown()).optional().nullable()
});

export function createPortalRouter(options: {
  runtimeOptions: Pick<PortalRuntimeOptionService, "resolve">;
  listDepartmentIdsForUser(userId: string): Promise<string[]>;
  productFeedback?: Pick<ProductFeedbackRepository, "create">;
  subscriptionEntitlements?: Pick<SubscriptionEntitlementService, "getPortalSubscriptionStatus">;
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

  router.post("/feedback", async (req: Request, res: Response) => {
    const currentUser = req.currentUser;
    if (!currentUser) {
      res.status(401).json({ detail: "Unauthorized" });
      return;
    }
    if (!options.productFeedback) {
      res.status(503).json({ detail: "Product feedback is not available" });
      return;
    }

    const parsed = productFeedbackPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ detail: parsed.error.issues[0]?.message ?? "Invalid feedback payload" });
      return;
    }

    try {
      const feedback = await options.productFeedback.create({
        organizationId: req.currentOrganization?.id,
        userId: currentUser.id,
        threadId: parsed.data.thread_id || undefined,
        type: parsed.data.type,
        severity: parsed.data.type === "bug" ? parsed.data.severity ?? undefined : undefined,
        description: parsed.data.description,
        context: parsed.data.context ?? undefined
      });
      res.status(201).json({
        feedback: {
          id: feedback.id,
          status: feedback.status,
          created_at: feedback.createdAt
        }
      });
    } catch (error) {
      res.status(500).json({
        detail: error instanceof Error ? error.message : "failed to submit product feedback"
      });
    }
  });

  router.get("/subscription-status", async (req: Request, res: Response) => {
    const currentUser = req.currentUser;
    if (!currentUser) {
      res.status(401).json({ detail: "Unauthorized" });
      return;
    }
    if (!options.subscriptionEntitlements) {
      res.status(503).json({ detail: "Subscription status is not available" });
      return;
    }

    try {
      const status = await options.subscriptionEntitlements.getPortalSubscriptionStatus({
        currentUser: {
          id: currentUser.id,
          organizationId: req.currentOrganization?.id ?? currentUser.primaryOrganizationId ?? "",
          organizationType: req.currentOrganization?.type
        },
        model: ""
      });
      res.json({
        status: {
          access_state: status.accessState,
          tone: status.tone,
          source_type: status.sourceType,
          source_label: status.sourceLabel,
          title: status.title,
          summary: status.summary,
          detail: status.detail,
          action_label: status.actionLabel,
          plan_name: status.planName,
          expires_at: status.expiresAt,
          cycle_ends_at: status.cycleEndsAt,
          remaining_completed_turns: status.remainingCompletedTurns,
          completed_turn_limit: status.completedTurnLimit,
          reason_code: status.reasonCode
        }
      });
    } catch (error) {
      res.status(500).json({
        detail: error instanceof Error ? error.message : "failed to resolve subscription status"
      });
    }
  });

  return router;
}
