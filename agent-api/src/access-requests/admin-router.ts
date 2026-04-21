import { Router, type Request, type Response } from "express";
import { z } from "zod";

import type { createAccessRequestService } from "./service.js";

type AccessRequestService = ReturnType<typeof createAccessRequestService>;

const updateRequestSchema = z.object({
  ownerUserId: z.string().trim().optional().nullable(),
  adminNote: z.string().trim().optional().nullable(),
  reviewMode: z.enum(["any_to_approve", "all_to_approve", "minimum_approvals"]).optional(),
  minimumApprovals: z.number().int().min(1).optional().nullable(),
  rejectionMode: z.enum(["any_to_reject", "manual_on_conflict"]).optional(),
  requestedPlanId: z.string().trim().optional().nullable(),
  approvedPlanId: z.string().trim().optional().nullable(),
  reviewers: z
    .array(
      z.object({
        reviewerEmail: z.string().trim().email("Reviewer email is invalid"),
        reviewerUserId: z.string().trim().optional().nullable(),
        deliveryType: z.enum(["to", "cc"])
      })
    )
    .optional()
});

const policySchema = z.object({
  internalEmailDomains: z.array(z.string().trim().min(1)).min(1, "At least one internal domain is required").optional(),
  publicEmailBlocklistExtra: z.array(z.string().trim().min(1)).optional(),
  defaultTrialDays: z.number().int().min(1).max(365).optional()
});

const needsInfoSchema = z.object({
  message: z.string().trim().min(1, "Message is required").max(4000)
});

const rejectSchema = z.object({
  reason: z.string().trim().min(1, "Reason is required").max(4000)
});

const provisionSchema = z.object({
  targetMode: z.enum(["new_organization", "existing_organization"]),
  organizationName: z.string().trim().optional(),
  organizationId: z.string().trim().optional(),
  membershipType: z.enum(["customer_admin", "customer_member"]).optional(),
  planId: z.string().trim().optional(),
  startsAt: z.string().trim().optional().nullable(),
  expiresAt: z.string().trim().optional().nullable(),
  cycleAnchorAt: z.string().trim().optional().nullable(),
  completedTurnLimitOverride: z.number().int().min(0).optional().nullable(),
  tokenLimitOverride: z.number().int().min(0).optional().nullable(),
  note: z.string().trim().optional().nullable()
});

function detailFromError(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

function adminActor(req: Request) {
  return {
    actorType: "admin" as const,
    actorUserId: req.currentUser?.id ?? null,
    actorEmail: req.currentUser?.email ?? null,
    actorName: req.currentUser?.displayName ?? req.currentUser?.email ?? null
  };
}

export function createAdminAccessRequestRouter(service: AccessRequestService): Router {
  const router = Router();

  router.get("/", async (req: Request, res: Response) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const query = typeof req.query.query === "string" ? req.query.query : undefined;
      res.json(await service.listAdminWorkspace({ status, query }));
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/policy", async (req: Request, res: Response) => {
    try {
      res.json({ policy: await service.getPolicy() });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.put("/policy", async (req: Request, res: Response) => {
    try {
      const input = policySchema.parse(req.body ?? {});
      res.json({ policy: await service.updatePolicy(input, adminActor(req)) });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/:requestId", async (req: Request, res: Response) => {
    try {
      res.json({ request: await service.getAdminRequestDetail(String(req.params.requestId || "")) });
    } catch (error) {
      res.status(404).json({ detail: detailFromError(error) });
    }
  });

  router.patch("/:requestId", async (req: Request, res: Response) => {
    try {
      const input = updateRequestSchema.parse(req.body ?? {});
      res.json({ request: await service.updateAdminRequest(String(req.params.requestId || ""), input, adminActor(req)) });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/:requestId/send-review", async (req: Request, res: Response) => {
    try {
      res.json({ request: await service.sendReviewRequest(String(req.params.requestId || ""), adminActor(req)) });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/:requestId/needs-info", async (req: Request, res: Response) => {
    try {
      const input = needsInfoSchema.parse(req.body ?? {});
      res.json({ request: await service.markNeedsInfo(String(req.params.requestId || ""), input, adminActor(req)) });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/:requestId/reject", async (req: Request, res: Response) => {
    try {
      const input = rejectSchema.parse(req.body ?? {});
      res.json({ request: await service.rejectRequest(String(req.params.requestId || ""), input, adminActor(req)) });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/:requestId/provision", async (req: Request, res: Response) => {
    try {
      const input = provisionSchema.parse(req.body ?? {});
      res.json({ request: await service.provisionRequest(String(req.params.requestId || ""), input, adminActor(req)) });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  return router;
}
