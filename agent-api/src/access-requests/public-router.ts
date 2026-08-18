import { Router, type Request, type Response } from "express";
import multer, { MulterError } from "multer";
import { z } from "zod";

import type { createAccessRequestService } from "./service.js";
import type { PurchaseProofUploadFile } from "./purchase-proof-storage.js";

const publicAccessRequestSchema = z.object({
  applicantEmail: z.string().trim().email("Applicant email is invalid"),
  contactName: z.string().trim().min(1, "Contact name is required").max(120),
  companyName: z.string().trim().min(1, "Company name is required").max(200),
  countryRegion: z.string().trim().min(1, "Country / region is required").max(120),
  deviceInfoText: z.string().trim().max(4000).optional().nullable(),
  purchaseDate: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((value) => (value ? value : null)),
  poNumber: z
    .string()
    .trim()
    .max(120)
    .optional()
    .nullable()
    .transform((value) => value ?? ""),
  snNumber: z.string().trim().min(1, "At least one device SN is required").max(500),
  salesContactEmail: z.string().trim().min(1, "Sales contact is required").max(200),
  customerNote: z.string().trim().max(4000).optional()
});

type AccessRequestService = ReturnType<typeof createAccessRequestService>;

const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 8,
    fileSize: 20 * 1024 * 1024
  }
});

function detailFromError(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

function withProofFiles(req: Request, res: Response, next: (error?: unknown) => void): void {
  proofUpload.array("purchaseProofFiles")(req, res, (error) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof MulterError) {
      res.status(400).json({
        detail: error.code === "LIMIT_FILE_SIZE" ? "Purchase proof file is too large" : "Purchase proof upload exceeds limits"
      });
      return;
    }
    next(error);
  });
}

function proofFilesFromRequest(req: Request): PurchaseProofUploadFile[] {
  return ((req.files as Express.Multer.File[] | undefined) ?? []).map((file) => ({
    originalName: file.originalname,
    mimeType: file.mimetype || "application/octet-stream",
    sizeBytes: file.size,
    buffer: file.buffer
  }));
}

function sendAttachmentFile(res: Response, file: Awaited<ReturnType<AccessRequestService["getPublicPurchaseProofFile"]>>): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.attachment.originalName)}`);
  res.type(file.attachment.mimeType || "application/octet-stream");
  res.status(200).send(file.content);
}

export function createPublicAccessRequestRouter(service: AccessRequestService): Router {
  const router = Router();

  router.post("/", withProofFiles, async (req: Request, res: Response) => {
    try {
      if (req.publicBrand && !req.publicBrand.accessRequestEnabled) {
        res.status(404).json({ detail: "Access requests are not available on this brand" });
        return;
      }
      if (req.publicBrand && (!req.publicBrand.emailSenderVerified || !req.publicBrand.emailFromAddress?.trim())) {
        res.status(503).json({ detail: `${req.publicBrand.platformName} email delivery is temporarily unavailable` });
        return;
      }
      const input = publicAccessRequestSchema.parse(req.body ?? {});
      const created = await service.submitPublicRequest({
        ...input,
        publicBrandId: req.publicBrand?.id ?? null,
        purchaseProofFiles: proofFilesFromRequest(req)
      });
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
      res.json({ request: await service.getPublicRequestByToken(token, req.publicBrand?.id ?? null) });
    } catch (error) {
      res.status(404).json({ detail: detailFromError(error) });
    }
  });

  router.get("/:token/proofs/:attachmentId/content", async (req: Request, res: Response) => {
    try {
      const token = String(req.params.token || "").trim();
      const attachmentId = String(req.params.attachmentId || "").trim();
      if (!token || !attachmentId) {
        res.status(404).json({ detail: "Purchase proof file does not exist" });
        return;
      }
      sendAttachmentFile(res, await service.getPublicPurchaseProofFile(token, attachmentId, req.publicBrand?.id ?? null));
    } catch (error) {
      res.status(404).json({ detail: detailFromError(error) });
    }
  });

  router.patch("/:token", withProofFiles, async (req: Request, res: Response) => {
    try {
      if (req.publicBrand && (!req.publicBrand.emailSenderVerified || !req.publicBrand.emailFromAddress?.trim())) {
        res.status(503).json({ detail: `${req.publicBrand.platformName} email delivery is temporarily unavailable` });
        return;
      }
      const token = String(req.params.token || "").trim();
      if (!token) {
        res.status(404).json({ detail: "Access request does not exist" });
        return;
      }
      const input = publicAccessRequestSchema.parse(req.body ?? {});
      res.json({
        request: await service.resubmitPublicRequest(token, {
          ...input,
          publicBrandId: req.publicBrand?.id ?? null,
          purchaseProofFiles: proofFilesFromRequest(req)
        })
      });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  return router;
}
