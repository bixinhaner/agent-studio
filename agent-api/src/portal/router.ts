import { Router, type NextFunction, type Request, type Response } from "express";
import multer, { MulterError } from "multer";
import { z } from "zod";

import { isInternalOrganizationType, resolveResourceRoleIds } from "../auth/resource-role-context.js";
import type { CustomerExperienceIssueReporter } from "../operations/customer-experience-issue-reporter.js";
import type { SubscriptionEntitlementService } from "../operations/subscription-entitlement-service.js";
import type { ProductFeedbackRepository } from "../persistence/product-feedback-repository.js";
import { toPortalRuntimeOptions } from "./runtime-options.js";
import type { PortalRuntimeOptionService } from "./runtime-option-service.js";

const MAX_PRODUCT_FEEDBACK_IMAGES = 3;
const MAX_PRODUCT_FEEDBACK_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const PRODUCT_FEEDBACK_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const productFeedbackImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: MAX_PRODUCT_FEEDBACK_IMAGES,
    fileSize: MAX_PRODUCT_FEEDBACK_IMAGE_SIZE_BYTES
  },
  fileFilter(_req, file, callback) {
    if (PRODUCT_FEEDBACK_IMAGE_MIME_TYPES.has(file.mimetype)) {
      callback(null, true);
      return;
    }
    callback(new Error("Only PNG, JPG, WebP, or GIF screenshots are supported"));
  }
});

const productFeedbackPayloadSchema = z.object({
  type: z.enum(["bug", "feature_request", "usability_issue", "other"]),
  severity: z.enum(["blocking", "high", "medium", "low"]).optional().nullable(),
  description: z.string().trim().min(1).max(4000),
  thread_id: z.string().trim().max(200).optional().nullable(),
  context: z.record(z.string(), z.unknown()).optional().nullable()
});

function normalizeProductFeedbackPayloadBody(value: unknown): unknown {
  const input = value && typeof value === "object" ? { ...(value as Record<string, unknown>) } : {};
  if (typeof input.context === "string") {
    const contextText = input.context.trim();
    input.context = contextText ? JSON.parse(contextText) : undefined;
  }
  if (input.severity === "") input.severity = undefined;
  if (input.thread_id === "") input.thread_id = undefined;
  return input;
}

function productFeedbackImagesFromRequest(req: Request) {
  const files = Array.isArray(req.files) ? req.files : [];
  return files
    .filter((file): file is Express.Multer.File => Boolean(file && PRODUCT_FEEDBACK_IMAGE_MIME_TYPES.has(file.mimetype)))
    .slice(0, MAX_PRODUCT_FEEDBACK_IMAGES)
    .map((file, index) => ({
      id: `image-${Date.now()}-${index + 1}`,
      name: file.originalname || `screenshot-${index + 1}`,
      mimeType: file.mimetype,
      size: file.size,
      dataUrl: `data:${file.mimetype};base64,${file.buffer.toString("base64")}`
    }));
}

function mergeProductFeedbackContextWithImages(context: Record<string, unknown> | null | undefined, images: ReturnType<typeof productFeedbackImagesFromRequest>) {
  if (images.length === 0) return context ?? undefined;
  const current = context ?? {};
  const currentAttachments =
    current.attachments && typeof current.attachments === "object" && !Array.isArray(current.attachments)
      ? (current.attachments as Record<string, unknown>)
      : {};
  return {
    ...current,
    attachments: {
      ...currentAttachments,
      images
    }
  };
}

function handleProductFeedbackUploadError(error: unknown, res: Response): boolean {
  if (!error) return false;
  if (error instanceof MulterError) {
    const detail =
      error.code === "LIMIT_FILE_SIZE"
        ? "Screenshot is too large. Each image must be 5 MB or less."
        : error.code === "LIMIT_FILE_COUNT"
          ? `You can upload up to ${MAX_PRODUCT_FEEDBACK_IMAGES} screenshots.`
          : "Screenshot upload exceeds the configured limits.";
    res.status(400).json({ detail });
    return true;
  }
  res.status(400).json({ detail: error instanceof Error ? error.message : "Screenshot upload failed" });
  return true;
}

function audienceFromOrganizationType(organizationType: string | null | undefined): "internal" | "external" | "unknown" {
  const normalized = typeof organizationType === "string" ? organizationType.trim() : "";
  if (!normalized) return "unknown";
  return isInternalOrganizationType(normalized) ? "internal" : "external";
}

export function createPortalRouter(options: {
  runtimeOptions: Pick<PortalRuntimeOptionService, "resolve">;
  listDepartmentIdsForUser(userId: string): Promise<string[]>;
  productFeedback?: Pick<ProductFeedbackRepository, "create">;
  customerExperienceIssues?: Pick<CustomerExperienceIssueReporter, "reportProductFeedback">;
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

  router.post(
    "/feedback",
    (req: Request, res: Response, next: NextFunction) => {
      productFeedbackImageUpload.array("images", MAX_PRODUCT_FEEDBACK_IMAGES)(req, res, (error) => {
        if (handleProductFeedbackUploadError(error, res)) return;
        next();
      });
    },
    async (req: Request, res: Response) => {
      const currentUser = req.currentUser;
      if (!currentUser) {
        res.status(401).json({ detail: "Unauthorized" });
        return;
      }
      if (!options.productFeedback) {
        res.status(503).json({ detail: "Product feedback is not available" });
        return;
      }

      let normalizedBody: unknown;
      try {
        normalizedBody = normalizeProductFeedbackPayloadBody(req.body);
      } catch {
        res.status(400).json({ detail: "Invalid feedback context" });
        return;
      }

      const parsed = productFeedbackPayloadSchema.safeParse(normalizedBody);
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
          context: mergeProductFeedbackContextWithImages(parsed.data.context, productFeedbackImagesFromRequest(req))
        });
        if (options.customerExperienceIssues) {
          void options.customerExperienceIssues.reportProductFeedback({
            id: feedback.id,
            organizationId: feedback.organizationId,
            userId: feedback.userId,
            threadId: feedback.threadId,
            type: feedback.type,
            severity: feedback.severity,
            description: feedback.description,
            context: feedback.context,
            createdAt: feedback.createdAt,
            audience: audienceFromOrganizationType(req.currentOrganization?.type)
          }).catch((error) => {
            console.warn("product feedback experience issue report failed", {
              feedbackId: feedback.id,
              detail: error instanceof Error ? error.message : String(error)
            });
          });
        }
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
    }
  );

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
