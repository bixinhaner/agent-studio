export type AiResponseReviewStatus = "pending" | "submitted" | "cancelled";
export type AiResponseReviewEffectiveStatus = AiResponseReviewStatus | "overdue";
export type AiResponseReviewSource = "zendesk" | string;
export type AiResponseReviewFilter =
  | "all"
  | "unreviewed"
  | "overdue_unreviewed"
  | "submitted"
  | "low_score"
  | "critical_low_score"
  | "lowest_score"
  | "with_suggestion"
  | "notification_failed"
  | "todo_failed"
  | "cancelled";
export type AiResponseReviewSort =
  | "auto"
  | "created_desc"
  | "due_asc"
  | "overdue_desc"
  | "submitted_desc"
  | "score_asc";

export type AiResponseReviewUser = {
  id: string;
  externalId: string | null;
  displayName: string | null;
  email: string | null;
  dingtalkUserId: string | null;
};

export type AiResponseReviewRecord = {
  id: string;
  source: AiResponseReviewSource;
  status: AiResponseReviewStatus;
  effectiveStatus: AiResponseReviewEffectiveStatus;
  required: boolean;
  organizationId?: string;
  integrationInstanceId?: string;
  threadId?: string;
  assistantMessageExternalId?: string;
  zendeskRunId?: string;
  ticketId?: string;
  ticketSubject?: string;
  ticketUrl?: string;
  zendeskCommentId?: string;
  zendeskRequesterCommentId?: string;
  reviewerUserId?: string;
  reviewerDingTalkUserId?: string;
  reviewerDisplayName?: string;
  reviewerEmail?: string;
  reviewer: AiResponseReviewUser | null;
  score?: number;
  suggestion?: string;
  submittedByUserId?: string;
  submittedAt?: string;
  dueAt?: string;
  notificationStatus?: string;
  notificationError?: string;
  notifiedAt?: string;
  reminderCount: number;
  lastRemindedAt?: string;
  dingtalkTodoStatus?: string;
  dingtalkTodoTaskId?: string;
  dingtalkTodoUnionId?: string;
  dingtalkTodoSourceId?: string;
  dingtalkTodoError?: string;
  dingtalkTodoCreatedAt?: string;
  dingtalkTodoCompletedAt?: string;
  reviewUrl?: string;
  snapshot?: unknown;
  createdAt: string;
  updatedAt: string;
};

export type AiResponseReviewCreateInput = {
  source: AiResponseReviewSource;
  organizationId?: string;
  integrationInstanceId?: string;
  threadId?: string;
  assistantMessageExternalId?: string;
  zendeskRunId?: string;
  ticketId?: string;
  ticketSubject?: string;
  ticketUrl?: string;
  zendeskCommentId?: number | string;
  zendeskRequesterCommentId?: number | string;
  reviewerUserId?: string;
  reviewerDingTalkUserId?: string;
  reviewerDisplayName?: string;
  reviewerEmail?: string;
  dueAt?: Date | string;
  reviewUrl?: string;
  snapshot?: unknown;
};

export type AiResponseReviewSummary = {
  total: number;
  pending: number;
  unreviewed: number;
  overdue: number;
  submitted: number;
  cancelled: number;
  required: number;
  averageScore: number | null;
  lowScoreCount: number;
  criticalLowScoreCount: number;
  lowestScore: number | null;
  lowestScoreCount: number;
  withSuggestion: number;
  notificationFailedCount: number;
  todoFailedCount: number;
};

type AiResponseReviewRow = {
  id: string;
  source: string;
  status: string;
  required: boolean;
  organizationId: string | null;
  integrationInstanceId: string | null;
  threadId: string | null;
  assistantMessageExternalId: string | null;
  zendeskRunId: string | null;
  ticketId: string | null;
  ticketSubject: string | null;
  ticketUrl: string | null;
  zendeskCommentId: bigint | number | string | null;
  zendeskRequesterCommentId: bigint | number | string | null;
  reviewerUserId: string | null;
  reviewerDingTalkUserId: string | null;
  reviewerDisplayName: string | null;
  reviewerEmail: string | null;
  score: number | null;
  suggestion: string | null;
  submittedByUserId: string | null;
  submittedAt: Date | string | null;
  dueAt: Date | string | null;
  notificationStatus: string | null;
  notificationError: string | null;
  notifiedAt: Date | string | null;
  reminderCount: number;
  lastRemindedAt: Date | string | null;
  dingtalkTodoStatus: string | null;
  dingtalkTodoTaskId: string | null;
  dingtalkTodoUnionId: string | null;
  dingtalkTodoSourceId: string | null;
  dingtalkTodoError: string | null;
  dingtalkTodoCreatedAt: Date | string | null;
  dingtalkTodoCompletedAt: Date | string | null;
  reviewUrl: string | null;
  snapshot: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type AiResponseReviewTable = {
  create(args: { data: Record<string, unknown> }): Promise<AiResponseReviewRow>;
  upsert(args: {
    where: Record<string, unknown>;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<AiResponseReviewRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<AiResponseReviewRow>;
  findUnique(args: { where: { id: string } }): Promise<AiResponseReviewRow | null>;
  findMany(args?: {
    where?: Record<string, unknown>;
    orderBy?: { createdAt?: "asc" | "desc"; updatedAt?: "asc" | "desc" };
    take?: number;
    skip?: number;
  }): Promise<AiResponseReviewRow[]>;
};

type AiResponseReviewUserRow = {
  id: string;
  externalId: string | null;
  displayName: string | null;
  email: string | null;
  dingtalkUserId: string | null;
};

type AiResponseReviewUserTable = {
  findMany(args?: {
    where?: Record<string, unknown>;
    select?: Record<string, unknown>;
    orderBy?: Record<string, unknown>;
  }): Promise<AiResponseReviewUserRow[]>;
  findUnique(args: { where: { id: string }; select?: Record<string, unknown> }): Promise<AiResponseReviewUserRow | null>;
};

export type AiResponseReviewRepositoryDb = {
  aiResponseReview: AiResponseReviewTable;
  user: AiResponseReviewUserTable;
};

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toBigIntOrNull(value: number | string | undefined): bigint | null {
  if (value === undefined) return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  return BigInt(text);
}

function idAsString(value: bigint | number | string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  return String(value);
}

function normalizeStatus(value: unknown): AiResponseReviewStatus {
  if (value === "submitted" || value === "cancelled") return value;
  return "pending";
}

function effectiveStatus(row: Pick<AiResponseReviewRow, "status" | "dueAt">, now = new Date()): AiResponseReviewEffectiveStatus {
  const status = normalizeStatus(row.status);
  if (status !== "pending") return status;
  const dueAt = toDate(row.dueAt);
  return dueAt && dueAt.getTime() < now.getTime() ? "overdue" : "pending";
}

function normalizeScore(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.max(1, Math.min(5, Math.round(numeric)));
}

function mapUser(row: AiResponseReviewUserRow | undefined | null): AiResponseReviewUser | null {
  if (!row) return null;
  return {
    id: row.id,
    externalId: trimOrUndefined(row.externalId) ?? null,
    displayName: trimOrUndefined(row.displayName) ?? null,
    email: trimOrUndefined(row.email) ?? null,
    dingtalkUserId: trimOrUndefined(row.dingtalkUserId) ?? null
  };
}

function mapReview(row: AiResponseReviewRow, userMap: Map<string, AiResponseReviewUser> = new Map()): AiResponseReviewRecord {
  const reviewer = row.reviewerUserId ? userMap.get(row.reviewerUserId) ?? null : null;
  return {
    id: row.id,
    source: trimOrUndefined(row.source) ?? "zendesk",
    status: normalizeStatus(row.status),
    effectiveStatus: effectiveStatus(row),
    required: Boolean(row.required),
    organizationId: trimOrUndefined(row.organizationId ?? undefined),
    integrationInstanceId: trimOrUndefined(row.integrationInstanceId ?? undefined),
    threadId: trimOrUndefined(row.threadId ?? undefined),
    assistantMessageExternalId: trimOrUndefined(row.assistantMessageExternalId ?? undefined),
    zendeskRunId: trimOrUndefined(row.zendeskRunId ?? undefined),
    ticketId: trimOrUndefined(row.ticketId ?? undefined),
    ticketSubject: trimOrUndefined(row.ticketSubject ?? undefined),
    ticketUrl: trimOrUndefined(row.ticketUrl ?? undefined),
    zendeskCommentId: idAsString(row.zendeskCommentId),
    zendeskRequesterCommentId: idAsString(row.zendeskRequesterCommentId),
    reviewerUserId: trimOrUndefined(row.reviewerUserId ?? undefined),
    reviewerDingTalkUserId: trimOrUndefined(row.reviewerDingTalkUserId ?? undefined),
    reviewerDisplayName: trimOrUndefined(row.reviewerDisplayName ?? undefined),
    reviewerEmail: trimOrUndefined(row.reviewerEmail ?? undefined),
    reviewer,
    score: normalizeScore(row.score ?? undefined),
    suggestion: trimOrUndefined(row.suggestion ?? undefined),
    submittedByUserId: trimOrUndefined(row.submittedByUserId ?? undefined),
    submittedAt: toIsoString(row.submittedAt),
    dueAt: toIsoString(row.dueAt),
    notificationStatus: trimOrUndefined(row.notificationStatus ?? undefined),
    notificationError: trimOrUndefined(row.notificationError ?? undefined),
    notifiedAt: toIsoString(row.notifiedAt),
    reminderCount: Number.isFinite(row.reminderCount) ? row.reminderCount : 0,
    lastRemindedAt: toIsoString(row.lastRemindedAt),
    dingtalkTodoStatus: trimOrUndefined(row.dingtalkTodoStatus ?? undefined),
    dingtalkTodoTaskId: trimOrUndefined(row.dingtalkTodoTaskId ?? undefined),
    dingtalkTodoUnionId: trimOrUndefined(row.dingtalkTodoUnionId ?? undefined),
    dingtalkTodoSourceId: trimOrUndefined(row.dingtalkTodoSourceId ?? undefined),
    dingtalkTodoError: trimOrUndefined(row.dingtalkTodoError ?? undefined),
    dingtalkTodoCreatedAt: toIsoString(row.dingtalkTodoCreatedAt),
    dingtalkTodoCompletedAt: toIsoString(row.dingtalkTodoCompletedAt),
    reviewUrl: trimOrUndefined(row.reviewUrl ?? undefined),
    snapshot: row.snapshot ?? undefined,
    createdAt: toIsoString(row.createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updatedAt) ?? new Date().toISOString()
  };
}

function rowDataFromCreateInput(input: AiResponseReviewCreateInput): Record<string, unknown> {
  return {
    source: trimOrUndefined(input.source) ?? "zendesk",
    status: "pending",
    required: true,
    organizationId: trimOrUndefined(input.organizationId) ?? null,
    integrationInstanceId: trimOrUndefined(input.integrationInstanceId) ?? null,
    threadId: trimOrUndefined(input.threadId) ?? null,
    assistantMessageExternalId: trimOrUndefined(input.assistantMessageExternalId) ?? null,
    zendeskRunId: trimOrUndefined(input.zendeskRunId) ?? null,
    ticketId: trimOrUndefined(input.ticketId) ?? null,
    ticketSubject: trimOrUndefined(input.ticketSubject) ?? null,
    ticketUrl: trimOrUndefined(input.ticketUrl) ?? null,
    zendeskCommentId: toBigIntOrNull(input.zendeskCommentId),
    zendeskRequesterCommentId: toBigIntOrNull(input.zendeskRequesterCommentId),
    reviewerUserId: trimOrUndefined(input.reviewerUserId) ?? null,
    reviewerDingTalkUserId: trimOrUndefined(input.reviewerDingTalkUserId) ?? null,
    reviewerDisplayName: trimOrUndefined(input.reviewerDisplayName) ?? null,
    reviewerEmail: trimOrUndefined(input.reviewerEmail) ?? null,
    dueAt: toDate(input.dueAt),
    reviewUrl: trimOrUndefined(input.reviewUrl) ?? null,
    snapshot: input.snapshot ?? null
  };
}

function reviewMatchesQuery(review: AiResponseReviewRecord, query: string | undefined): boolean {
  if (!query) return true;
  const haystack = [
    review.id,
    review.ticketId,
    review.ticketSubject,
    review.reviewerDisplayName,
    review.reviewerEmail,
    review.reviewerDingTalkUserId,
    review.suggestion,
    typeof review.snapshot === "string" ? review.snapshot : JSON.stringify(review.snapshot ?? "")
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function buildSummary(reviews: AiResponseReviewRecord[]): AiResponseReviewSummary {
  const submitted = reviews.filter((item) => item.status === "submitted");
  const scored = submitted.map((item) => item.score).filter((score): score is number => typeof score === "number");
  const scoreSum = scored.reduce((sum, score) => sum + score, 0);
  const lowestScore = scored.length > 0 ? Math.min(...scored) : null;
  return {
    total: reviews.length,
    pending: reviews.filter((item) => item.effectiveStatus === "pending").length,
    unreviewed: reviews.filter((item) => item.status === "pending").length,
    overdue: reviews.filter((item) => item.effectiveStatus === "overdue").length,
    submitted: submitted.length,
    cancelled: reviews.filter((item) => item.status === "cancelled").length,
    required: reviews.filter((item) => item.required).length,
    averageScore: scored.length > 0 ? Math.round((scoreSum / scored.length) * 10) / 10 : null,
    lowScoreCount: submitted.filter((item) => typeof item.score === "number" && item.score <= 3).length,
    criticalLowScoreCount: submitted.filter((item) => typeof item.score === "number" && item.score <= 2).length,
    lowestScore,
    lowestScoreCount:
      lowestScore === null ? 0 : submitted.filter((item) => typeof item.score === "number" && item.score === lowestScore).length,
    withSuggestion: reviews.filter((item) => Boolean(item.suggestion)).length,
    notificationFailedCount: reviews.filter((item) => item.notificationStatus === "failed").length,
    todoFailedCount: reviews.filter((item) => item.dingtalkTodoStatus === "failed" || item.dingtalkTodoStatus === "complete_failed").length
  };
}

function reviewMatchesFilter(
  review: AiResponseReviewRecord,
  filter: AiResponseReviewFilter,
  lowestScore: number | null
): boolean {
  if (filter === "all") return true;
  if (filter === "unreviewed") return review.status === "pending";
  if (filter === "overdue_unreviewed") return review.effectiveStatus === "overdue";
  if (filter === "submitted") return review.status === "submitted";
  if (filter === "low_score") return review.status === "submitted" && typeof review.score === "number" && review.score <= 3;
  if (filter === "critical_low_score") return review.status === "submitted" && typeof review.score === "number" && review.score <= 2;
  if (filter === "lowest_score") {
    return lowestScore !== null && review.status === "submitted" && review.score === lowestScore;
  }
  if (filter === "with_suggestion") return Boolean(review.suggestion);
  if (filter === "notification_failed") return review.notificationStatus === "failed";
  if (filter === "todo_failed") return review.dingtalkTodoStatus === "failed" || review.dingtalkTodoStatus === "complete_failed";
  if (filter === "cancelled") return review.status === "cancelled";
  return true;
}

function timestampForSort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compareByNumber(left: number, right: number): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function resolveSort(sort: AiResponseReviewSort | undefined, filter: AiResponseReviewFilter): AiResponseReviewSort {
  if (sort && sort !== "auto") return sort;
  if (filter === "unreviewed") return "due_asc";
  if (filter === "overdue_unreviewed") return "overdue_desc";
  if (filter === "submitted" || filter === "with_suggestion" || filter === "lowest_score") return "submitted_desc";
  if (filter === "low_score" || filter === "critical_low_score") return "score_asc";
  return "created_desc";
}

function filterFromLegacyStatus(status: AiResponseReviewEffectiveStatus | undefined): AiResponseReviewFilter {
  if (status === "pending") return "unreviewed";
  if (status === "overdue") return "overdue_unreviewed";
  if (status === "submitted") return "submitted";
  if (status === "cancelled") return "cancelled";
  return "all";
}

function compareReviews(
  left: AiResponseReviewRecord,
  right: AiResponseReviewRecord,
  sort: AiResponseReviewSort
): number {
  if (sort === "due_asc") {
    return (
      compareByNumber(timestampForSort(left.dueAt, Number.MAX_SAFE_INTEGER), timestampForSort(right.dueAt, Number.MAX_SAFE_INTEGER)) ||
      compareByNumber(timestampForSort(right.createdAt, 0), timestampForSort(left.createdAt, 0))
    );
  }
  if (sort === "overdue_desc") {
    return (
      compareByNumber(timestampForSort(left.dueAt, Number.MAX_SAFE_INTEGER), timestampForSort(right.dueAt, Number.MAX_SAFE_INTEGER)) ||
      compareByNumber(timestampForSort(right.createdAt, 0), timestampForSort(left.createdAt, 0))
    );
  }
  if (sort === "submitted_desc") {
    return (
      compareByNumber(timestampForSort(right.submittedAt, 0), timestampForSort(left.submittedAt, 0)) ||
      compareByNumber(timestampForSort(right.createdAt, 0), timestampForSort(left.createdAt, 0))
    );
  }
  if (sort === "score_asc") {
    return (
      compareByNumber(left.score ?? Number.MAX_SAFE_INTEGER, right.score ?? Number.MAX_SAFE_INTEGER) ||
      compareByNumber(timestampForSort(right.submittedAt, 0), timestampForSort(left.submittedAt, 0))
    );
  }
  return compareByNumber(timestampForSort(right.createdAt, 0), timestampForSort(left.createdAt, 0));
}

export class AiResponseReviewRepository {
  constructor(private readonly db: AiResponseReviewRepositoryDb) {}

  async upsertRequired(input: AiResponseReviewCreateInput): Promise<AiResponseReviewRecord> {
    const data = rowDataFromCreateInput(input);
    const zendeskRunId = trimOrUndefined(input.zendeskRunId);
    const reviewerDingTalkUserId = trimOrUndefined(input.reviewerDingTalkUserId);
    const row =
      zendeskRunId && reviewerDingTalkUserId
        ? await this.db.aiResponseReview.upsert({
            where: {
              zendeskRunId_reviewerDingTalkUserId: {
                zendeskRunId,
                reviewerDingTalkUserId
              }
            },
            create: data,
            update: {
              ...data,
              status: "pending",
              score: null,
              suggestion: null,
              submittedByUserId: null,
              submittedAt: null,
              dingtalkTodoStatus: null,
              dingtalkTodoTaskId: null,
              dingtalkTodoUnionId: null,
              dingtalkTodoSourceId: null,
              dingtalkTodoError: null,
              dingtalkTodoCreatedAt: null,
              dingtalkTodoCompletedAt: null
            }
          })
        : await this.db.aiResponseReview.create({ data });
    return mapReview(row, await this.loadUserMap([row]));
  }

  async updateReviewUrl(reviewId: string, reviewUrl: string): Promise<AiResponseReviewRecord | null> {
    const id = trimOrUndefined(reviewId);
    if (!id) return null;
    const row = await this.db.aiResponseReview.update({
      where: { id },
      data: { reviewUrl: trimOrUndefined(reviewUrl) ?? null }
    });
    return mapReview(row, await this.loadUserMap([row]));
  }

  async listForZendeskRun(runId: string): Promise<AiResponseReviewRecord[]> {
    const id = trimOrUndefined(runId);
    if (!id) return [];
    const rows = await this.db.aiResponseReview.findMany({
      where: {
        zendeskRunId: id
      },
      orderBy: { createdAt: "asc" }
    });
    return rows.map((row) => mapReview(row));
  }

  async markNotified(reviewId: string, input: { status: string; error?: string }): Promise<AiResponseReviewRecord | null> {
    const id = trimOrUndefined(reviewId);
    if (!id) return null;
    const row = await this.db.aiResponseReview.update({
      where: { id },
      data: {
        notificationStatus: trimOrUndefined(input.status) ?? "sent",
        notificationError: trimOrUndefined(input.error) ?? null,
        notifiedAt: new Date()
      }
    });
    return mapReview(row, await this.loadUserMap([row]));
  }

  async markDingTalkTodoCreated(reviewId: string, input: {
    taskId: string;
    unionId: string;
    sourceId: string;
  }): Promise<AiResponseReviewRecord | null> {
    const id = trimOrUndefined(reviewId);
    if (!id) return null;
    const row = await this.db.aiResponseReview.update({
      where: { id },
      data: {
        dingtalkTodoStatus: "created",
        dingtalkTodoTaskId: trimOrUndefined(input.taskId) ?? null,
        dingtalkTodoUnionId: trimOrUndefined(input.unionId) ?? null,
        dingtalkTodoSourceId: trimOrUndefined(input.sourceId) ?? null,
        dingtalkTodoError: null,
        dingtalkTodoCreatedAt: new Date(),
        dingtalkTodoCompletedAt: null
      }
    });
    return mapReview(row, await this.loadUserMap([row]));
  }

  async markDingTalkTodoFailed(reviewId: string, input: {
    status: string;
    error: string;
    unionId?: string;
    sourceId?: string;
  }): Promise<AiResponseReviewRecord | null> {
    const id = trimOrUndefined(reviewId);
    if (!id) return null;
    const row = await this.db.aiResponseReview.update({
      where: { id },
      data: {
        dingtalkTodoStatus: trimOrUndefined(input.status) ?? "failed",
        dingtalkTodoUnionId: trimOrUndefined(input.unionId) ?? undefined,
        dingtalkTodoSourceId: trimOrUndefined(input.sourceId) ?? undefined,
        dingtalkTodoError: trimOrUndefined(input.error) ?? "DingTalk todo sync failed"
      }
    });
    return mapReview(row, await this.loadUserMap([row]));
  }

  async markDingTalkTodoCompleted(reviewId: string): Promise<AiResponseReviewRecord | null> {
    const id = trimOrUndefined(reviewId);
    if (!id) return null;
    const row = await this.db.aiResponseReview.update({
      where: { id },
      data: {
        dingtalkTodoStatus: "completed",
        dingtalkTodoError: null,
        dingtalkTodoCompletedAt: new Date()
      }
    });
    return mapReview(row, await this.loadUserMap([row]));
  }

  async listPendingReminderCandidates(input: { integrationInstanceId?: string } = {}): Promise<AiResponseReviewRecord[]> {
    const integrationInstanceId = trimOrUndefined(input.integrationInstanceId);
    const rows = await this.db.aiResponseReview.findMany({
      where: {
        source: "zendesk",
        status: "pending",
        required: true,
        ...(integrationInstanceId ? { integrationInstanceId } : {})
      },
      orderBy: { createdAt: "desc" },
      take: 5000
    });
    const userMap = await this.loadUserMap(rows);
    return rows
      .map((row) => mapReview(row, userMap))
      .sort((left, right) => {
        const leftDueAt = left.dueAt ? new Date(left.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
        const rightDueAt = right.dueAt ? new Date(right.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
        const dueOrder = (Number.isFinite(leftDueAt) ? leftDueAt : Number.MAX_SAFE_INTEGER) -
          (Number.isFinite(rightDueAt) ? rightDueAt : Number.MAX_SAFE_INTEGER);
        if (dueOrder !== 0) return dueOrder;
        return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      });
  }

  async markReminderSent(reviewIds: string[], at = new Date()): Promise<number> {
    const ids = Array.from(
      new Set(reviewIds.map((item) => trimOrUndefined(item)).filter((item): item is string => Boolean(item)))
    );
    for (const id of ids) {
      await this.db.aiResponseReview.update({
        where: { id },
        data: {
          reminderCount: { increment: 1 },
          lastRemindedAt: at
        }
      });
    }
    return ids.length;
  }

  async get(reviewId: string): Promise<AiResponseReviewRecord | null> {
    const id = trimOrUndefined(reviewId);
    if (!id) return null;
    const row = await this.db.aiResponseReview.findUnique({ where: { id } });
    return row ? mapReview(row, await this.loadUserMap([row])) : null;
  }

  async getUserIdentity(userId: string): Promise<AiResponseReviewUser | null> {
    const id = trimOrUndefined(userId);
    if (!id) return null;
    const row = await this.db.user.findUnique({
      where: { id },
      select: {
        id: true,
        externalId: true,
        displayName: true,
        email: true,
        dingtalkUserId: true
      }
    });
    return mapUser(row);
  }

  async submit(input: {
    reviewId: string;
    score: number;
    suggestion?: string;
    submittedByUserId: string;
  }): Promise<AiResponseReviewRecord | null> {
    const id = trimOrUndefined(input.reviewId);
    const submittedByUserId = trimOrUndefined(input.submittedByUserId);
    const score = normalizeScore(input.score);
    if (!id || !submittedByUserId || score === undefined) return null;
    const row = await this.db.aiResponseReview.update({
      where: { id },
      data: {
        status: "submitted",
        score,
        suggestion: trimOrUndefined(input.suggestion) ?? null,
        submittedByUserId,
        submittedAt: new Date()
      }
    });
    return mapReview(row, await this.loadUserMap([row]));
  }

  async list(input: {
    query?: string;
    source?: string;
    status?: AiResponseReviewEffectiveStatus | "all";
    filter?: AiResponseReviewFilter;
    sort?: AiResponseReviewSort;
    page?: number;
    pageSize?: number;
  } = {}): Promise<{
    reviews: AiResponseReviewRecord[];
    summary: AiResponseReviewSummary;
    activeFilter: AiResponseReviewFilter;
    activeSort: AiResponseReviewSort;
    page: { page: number; pageSize: number; totalItems: number; totalPages: number };
  }> {
    const rows = await this.db.aiResponseReview.findMany({
      orderBy: { createdAt: "desc" },
      take: 2000
    });
    const userMap = await this.loadUserMap(rows);
    const source = trimOrUndefined(input.source);
    const status = input.status && input.status !== "all" ? input.status : undefined;
    const query = trimOrUndefined(input.query);
    const baseFiltered = rows
      .map((row) => mapReview(row, userMap))
      .filter((item) => !source || item.source === source)
      .filter((item) => reviewMatchesQuery(item, query));
    const summary = buildSummary(baseFiltered);
    const filter = input.filter ?? filterFromLegacyStatus(status);
    const sort = resolveSort(input.sort, filter);
    const filtered = baseFiltered
      .filter((item) => reviewMatchesFilter(item, filter, summary.lowestScore))
      .sort((left, right) => compareReviews(left, right, sort));
    const pageSize = Math.max(1, Math.min(100, Math.floor(input.pageSize ?? 24)));
    const totalItems = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const page = Math.max(1, Math.min(totalPages, Math.floor(input.page ?? 1)));
    const start = (page - 1) * pageSize;
    return {
      reviews: filtered.slice(start, start + pageSize),
      summary,
      activeFilter: filter,
      activeSort: sort,
      page: {
        page,
        pageSize,
        totalItems,
        totalPages
      }
    };
  }

  private async loadUserMap(rows: AiResponseReviewRow[]): Promise<Map<string, AiResponseReviewUser>> {
    const userIds = Array.from(
      new Set(rows.map((row) => trimOrUndefined(row.reviewerUserId ?? undefined)).filter((item): item is string => Boolean(item)))
    );
    if (userIds.length === 0) return new Map();
    const users = await this.db.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        externalId: true,
        displayName: true,
        email: true,
        dingtalkUserId: true
      }
    });
    return new Map(users.map((row) => [row.id, mapUser(row) as AiResponseReviewUser]));
  }
}
