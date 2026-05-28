export type AiResponseReviewStatus = "pending" | "submitted" | "cancelled";
export type AiResponseReviewEffectiveStatus = AiResponseReviewStatus | "overdue";
export type AiResponseReviewSource = "zendesk" | string;

export type AiResponseReviewUser = {
  id: string;
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
  overdue: number;
  submitted: number;
  cancelled: number;
  required: number;
  averageScore: number | null;
  lowScoreCount: number;
  withSuggestion: number;
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
  return {
    total: reviews.length,
    pending: reviews.filter((item) => item.effectiveStatus === "pending").length,
    overdue: reviews.filter((item) => item.effectiveStatus === "overdue").length,
    submitted: submitted.length,
    cancelled: reviews.filter((item) => item.status === "cancelled").length,
    required: reviews.filter((item) => item.required).length,
    averageScore: scored.length > 0 ? Math.round((scoreSum / scored.length) * 10) / 10 : null,
    lowScoreCount: submitted.filter((item) => typeof item.score === "number" && item.score <= 3).length,
    withSuggestion: reviews.filter((item) => Boolean(item.suggestion)).length
  };
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
              submittedAt: null
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
    page?: number;
    pageSize?: number;
  } = {}): Promise<{
    reviews: AiResponseReviewRecord[];
    summary: AiResponseReviewSummary;
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
    const filtered = rows
      .map((row) => mapReview(row, userMap))
      .filter((item) => !source || item.source === source)
      .filter((item) => !status || item.effectiveStatus === status || item.status === status)
      .filter((item) => reviewMatchesQuery(item, query));
    const pageSize = Math.max(1, Math.min(100, Math.floor(input.pageSize ?? 24)));
    const totalItems = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const page = Math.max(1, Math.min(totalPages, Math.floor(input.page ?? 1)));
    const start = (page - 1) * pageSize;
    return {
      reviews: filtered.slice(start, start + pageSize),
      summary: buildSummary(filtered),
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
        displayName: true,
        email: true,
        dingtalkUserId: true
      }
    });
    return new Map(users.map((row) => [row.id, mapUser(row) as AiResponseReviewUser]));
  }
}
