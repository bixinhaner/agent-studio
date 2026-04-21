import { Router, type Request, type Response } from "express";
import { z } from "zod";

import type { createAccessRequestService } from "./service.js";

type AccessRequestService = ReturnType<typeof createAccessRequestService>;

const decisionSchema = z.object({
  decision: z.enum(["approved", "rejected", "needs_info"]),
  comment: z.string().trim().max(4000).optional().nullable()
});

function detailFromError(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

export function createAccessRequestReviewRouter(service: AccessRequestService): Router {
  const router = Router();

  router.get("/:requestId", async (req: Request, res: Response) => {
    try {
      if (!req.currentUser || req.currentOrganization?.type !== "internal") {
        res.status(403).json({ detail: "Internal reviewer access is required" });
        return;
      }
      res.json(await service.getReviewerView(String(req.params.requestId || ""), req.currentUser));
    } catch (error) {
      res.status(403).json({ detail: detailFromError(error) });
    }
  });

  router.post("/:requestId/decision", async (req: Request, res: Response) => {
    try {
      if (!req.currentUser || req.currentOrganization?.type !== "internal") {
        res.status(403).json({ detail: "Internal reviewer access is required" });
        return;
      }
      const input = decisionSchema.parse(req.body ?? {});
      res.json(await service.submitReviewerDecision(String(req.params.requestId || ""), req.currentUser, input));
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  return router;
}
