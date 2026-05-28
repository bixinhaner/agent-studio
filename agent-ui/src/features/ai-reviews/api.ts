import { api } from "../../lib/api";
import type { AiResponseReviewResponse } from "./types";

export async function fetchAiResponseReview(reviewId: string): Promise<AiResponseReviewResponse> {
  return api<AiResponseReviewResponse>(`/api/ai-response-reviews/${encodeURIComponent(reviewId)}`);
}

export async function submitAiResponseReview(
  reviewId: string,
  input: { score: number; suggestion?: string | null }
): Promise<AiResponseReviewResponse> {
  return api<AiResponseReviewResponse>(`/api/ai-response-reviews/${encodeURIComponent(reviewId)}/submit`, {
    method: "POST",
    json: input
  });
}
