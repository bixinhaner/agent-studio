import { Router, type Request, type Response } from "express";

import type {
  ConversationRecoveryService,
  ConversationRecoveryStatus
} from "../operations/conversation-recovery-service.js";

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function parseInteger(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

function detailFromError(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

function parseStatus(value: unknown): ConversationRecoveryStatus | undefined {
  return value === "open" || value === "ready_to_notify" || value === "notified" || value === "closed"
    ? value
    : undefined;
}

export function createConversationRecoveryRouter(service: ConversationRecoveryService): Router {
  const router = Router();

  router.get("/customer-recovery/cases", async (req: Request, res: Response) => {
    try {
      res.json(
        await service.list({
          query: trimOrUndefined(String(req.query.query ?? "")),
          status: req.query.status === "open" || req.query.status === "ready_to_notify" || req.query.status === "notified" || req.query.status === "closed"
            ? req.query.status
            : "all",
          page: parseInteger(req.query.page, 1),
          pageSize: parseInteger(req.query.page_size, 20)
        })
      );
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.get("/customer-recovery/cases/:caseId", async (req: Request, res: Response) => {
    try {
      res.json(await service.get(req.params.caseId));
    } catch (error) {
      res.status(404).json({ detail: detailFromError(error) });
    }
  });

  router.patch("/customer-recovery/cases/:caseId", async (req: Request, res: Response) => {
    try {
      const status = parseStatus(req.body?.status);
      if (!status) {
        res.status(400).json({ detail: "status is required" });
        return;
      }
      const updated = await service.updateStatus({
        caseId: req.params.caseId,
        status,
        actorUserId: req.currentUser?.id ?? null
      });
      res.json({ case: updated });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/customer-recovery/cases/:caseId/send-email", async (req: Request, res: Response) => {
    try {
      const result = await service.sendResolutionEmail({
        caseId: req.params.caseId,
        recipientEmail: req.body?.recipientEmail,
        subject: String(req.body?.subject ?? ""),
        bodyText: String(req.body?.bodyText ?? ""),
        templateLanguage: req.body?.templateLanguage,
        rootCause: req.body?.rootCause,
        resolutionSummary: req.body?.resolutionSummary,
        actorUserId: req.currentUser?.id ?? null
      });
      res.status(201).json(result);
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/customer-recovery/cases/:caseId/grant-days", async (req: Request, res: Response) => {
    try {
      const result = await service.grantCompensationDays({
        caseId: req.params.caseId,
        planId: req.body?.planId,
        days: parseInteger(req.body?.days, 0),
        reason: req.body?.reason,
        actorUserId: req.currentUser?.id ?? null
      });
      res.status(201).json(result);
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  return router;
}
