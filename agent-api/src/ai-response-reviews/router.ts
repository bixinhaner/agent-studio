import { Router, type Request, type Response } from "express";
import { z } from "zod";

import {
  AiResponseReviewRepository,
  type AiResponseReviewRecord,
  type AiResponseReviewRepositoryDb,
  type AiResponseReviewUser
} from "../persistence/ai-response-review-repository.js";
import type { AuthenticatedUser } from "../persistence/user-repository.js";

const submitReviewSchema = z.object({
  score: z.number().int().min(1).max(5),
  suggestion: z.string().trim().max(4000).optional().nullable()
});

function detailFromError(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isAdminUser(user: AuthenticatedUser): boolean {
  return user.role === "admin" || user.role === "super_admin";
}

function canAccessReview(review: AiResponseReviewRecord, user: AuthenticatedUser, identity: AiResponseReviewUser | null): boolean {
  if (isAdminUser(user)) return true;
  if (review.reviewerUserId && review.reviewerUserId === user.id) return true;
  const userEmail = normalizeEmail(user.email);
  if (review.reviewerEmail && userEmail && normalizeEmail(review.reviewerEmail) === userEmail) return true;
  if (
    review.reviewerDingTalkUserId &&
    identity?.dingtalkUserId &&
    review.reviewerDingTalkUserId === identity.dingtalkUserId
  ) {
    return true;
  }
  return false;
}

export function createAiResponseReviewRouter(options: {
  db: AiResponseReviewRepositoryDb;
  afterSubmit?: (
    review: AiResponseReviewRecord,
    repository: AiResponseReviewRepository
  ) => Promise<AiResponseReviewRecord | null | void>;
}): Router {
  const router = Router();
  const repository = new AiResponseReviewRepository(options.db);

  router.get("/:reviewId", async (req: Request, res: Response) => {
    try {
      if (!req.currentUser || req.currentOrganization?.type !== "internal") {
        res.status(403).json({ detail: "Internal reviewer access is required" });
        return;
      }
      const review = await repository.get(String(req.params.reviewId || ""));
      if (!review) {
        res.status(404).json({ detail: "Review task does not exist" });
        return;
      }
      const identity = await repository.getUserIdentity(req.currentUser.id);
      if (!canAccessReview(review, req.currentUser, identity)) {
        res.status(403).json({ detail: "You are not assigned to this AI response review" });
        return;
      }
      res.json({ review });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.post("/:reviewId/submit", async (req: Request, res: Response) => {
    try {
      if (!req.currentUser || req.currentOrganization?.type !== "internal") {
        res.status(403).json({ detail: "Internal reviewer access is required" });
        return;
      }
      const existing = await repository.get(String(req.params.reviewId || ""));
      if (!existing) {
        res.status(404).json({ detail: "Review task does not exist" });
        return;
      }
      const identity = await repository.getUserIdentity(req.currentUser.id);
      if (!canAccessReview(existing, req.currentUser, identity)) {
        res.status(403).json({ detail: "You are not assigned to this AI response review" });
        return;
      }
      const input = submitReviewSchema.parse(req.body ?? {});
      let review = await repository.submit({
        reviewId: existing.id,
        score: input.score,
        suggestion: input.suggestion ?? undefined,
        submittedByUserId: req.currentUser.id
      });
      if (review && options.afterSubmit) {
        review = (await options.afterSubmit(review, repository)) ?? review;
      }
      res.json({ review });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  return router;
}
