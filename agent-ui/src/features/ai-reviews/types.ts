export type AiResponseReviewRecord = {
  id: string;
  source: string;
  status: "pending" | "submitted" | "cancelled";
  effectiveStatus: "pending" | "overdue" | "submitted" | "cancelled";
  required: boolean;
  threadId?: string;
  ticketId?: string;
  ticketSubject?: string;
  ticketUrl?: string;
  reviewerDisplayName?: string;
  reviewerEmail?: string;
  reviewerDingTalkUserId?: string;
  score?: number;
  suggestion?: string;
  submittedAt?: string;
  dueAt?: string;
  dingtalkTodoStatus?: string;
  dingtalkTodoError?: string;
  dingtalkTodoCreatedAt?: string;
  dingtalkTodoCompletedAt?: string;
  reviewUrl?: string;
  snapshot?: unknown;
  createdAt: string;
  updatedAt: string;
};

export type AiResponseReviewResponse = {
  review: AiResponseReviewRecord;
};
