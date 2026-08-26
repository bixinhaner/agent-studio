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

function sendAttachmentFile(res: Response, file: Awaited<ReturnType<AccessRequestService["getReviewerPurchaseProofFile"]>>): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.attachment.originalName)}`);
  res.type(file.attachment.mimeType || "application/octet-stream");
  res.status(200).send(file.content);
}

export function createAccessRequestReviewRouter(service: AccessRequestService): Router {
  const router = Router();

  function reviewToken(req: Request): string | undefined {
    return typeof req.query.token === "string" ? req.query.token.trim() || undefined : undefined;
  }

  router.get("/:requestId", async (req: Request, res: Response) => {
    try {
      const token = reviewToken(req);
      if (token) {
        res.json(await service.getExternalReviewerView(String(req.params.requestId || ""), token));
        return;
      }
      if (!req.currentUser || req.currentOrganization?.type !== "internal") {
        res.status(403).json({ detail: "Internal reviewer access is required" });
        return;
      }
      res.json(await service.getReviewerView(String(req.params.requestId || ""), req.currentUser));
    } catch (error) {
      res.status(403).json({ detail: detailFromError(error) });
    }
  });

  router.get("/:requestId/proofs/:attachmentId/content", async (req: Request, res: Response) => {
    try {
      const token = reviewToken(req);
      if (token) {
        sendAttachmentFile(
          res,
          await service.getExternalReviewerPurchaseProofFile(
            String(req.params.requestId || ""),
            String(req.params.attachmentId || ""),
            token
          )
        );
        return;
      }
      if (!req.currentUser || req.currentOrganization?.type !== "internal") {
        res.status(403).json({ detail: "Internal reviewer access is required" });
        return;
      }
      sendAttachmentFile(
        res,
        await service.getReviewerPurchaseProofFile(
          String(req.params.requestId || ""),
          String(req.params.attachmentId || ""),
          req.currentUser
        )
      );
    } catch (error) {
      res.status(404).json({ detail: detailFromError(error) });
    }
  });

  router.post("/:requestId/decision", async (req: Request, res: Response) => {
    try {
      const token = reviewToken(req);
      const input = decisionSchema.parse(req.body ?? {});
      if (token) {
        res.json(await service.submitExternalReviewerDecision(String(req.params.requestId || ""), token, input));
        return;
      }
      if (!req.currentUser || req.currentOrganization?.type !== "internal") {
        res.status(403).json({ detail: "Internal reviewer access is required" });
        return;
      }
      res.json(await service.submitReviewerDecision(String(req.params.requestId || ""), req.currentUser, input));
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  return router;
}
