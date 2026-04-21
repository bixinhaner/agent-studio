import { Router, type Request, type Response } from "express";
import { z } from "zod";

import type { createAccessRequestService } from "./service.js";

const publicAccessRequestSchema = z.object({
  applicantEmail: z.string().trim().email("Applicant email is invalid"),
  contactName: z.string().trim().min(1, "Contact name is required").max(120),
  companyName: z.string().trim().min(1, "Company name is required").max(200),
  countryRegion: z.string().trim().min(1, "Country / region is required").max(120),
  deviceInfoText: z.string().trim().min(1, "Device info is required").max(4000),
  purchaseDate: z.string().trim().min(1, "History purchase date is required"),
  poNumber: z.string().trim().min(1, "History PO number is required").max(120),
  snNumber: z.string().trim().min(1, "SN number is required").max(120),
  salesContactEmail: z.string().trim().email("Sales contact email is invalid"),
  customerNote: z.string().trim().max(4000).optional()
});

type AccessRequestService = ReturnType<typeof createAccessRequestService>;

function detailFromError(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

export function createPublicAccessRequestRouter(service: AccessRequestService): Router {
  const router = Router();

  router.post("/", async (req: Request, res: Response) => {
    try {
      const input = publicAccessRequestSchema.parse(req.body ?? {});
      const created = await service.submitPublicRequest(input);
      res.status(201).json(created);
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/:token", async (req: Request, res: Response) => {
    try {
      const token = String(req.params.token || "").trim();
      if (!token) {
        res.status(404).json({ detail: "Access request does not exist" });
        return;
      }
      res.json({ request: await service.getPublicRequestByToken(token) });
    } catch (error) {
      res.status(404).json({ detail: detailFromError(error) });
    }
  });

  router.patch("/:token", async (req: Request, res: Response) => {
    try {
      const token = String(req.params.token || "").trim();
      if (!token) {
        res.status(404).json({ detail: "Access request does not exist" });
        return;
      }
      const input = publicAccessRequestSchema.parse(req.body ?? {});
      res.json({ request: await service.resubmitPublicRequest(token, input) });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  return router;
}
