export type ConversationSecurityReviewStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "failed_terminal"
  | "skipped";

export type ConversationSecurityReviewRecord = {
  id: string;
  organizationId?: string;
  userId: string;
  threadId: string;
  userMessageId: string;
  channel: string;
  audience: string;
  status: ConversationSecurityReviewStatus;
  attempts: number;
  nextAttemptAt: Date;
  lockedAt?: Date;
  reviewerProvider?: string;
  reviewerModel?: string;
  riskLevel?: string;
  riskScore?: number;
  confidence?: number;
  categories: string[];
  evidenceMessageIds: string[];
  reason?: string;
  assistantExposure?: string;
  recommendedAction?: string;
  contextSnapshot?: unknown;
  resultJson?: unknown;
  errorMessage?: string;
  alertEventId?: string;
  notifiedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

type ReviewRow = {
  id: string;
  organizationId: string | null;
  userId: string;
  threadId: string;
  userMessageId: string;
  channel: string;
  audience: string;
  status: string;
  attempts: number;
  nextAttemptAt: Date;
  lockedAt: Date | null;
  reviewerProvider: string | null;
  reviewerModel: string | null;
  riskLevel: string | null;
  riskScore: number | null;
  confidence: number | null;
  categories: unknown;
  evidenceMessageIds: unknown;
  reason: string | null;
  assistantExposure: string | null;
  recommendedAction: string | null;
  contextSnapshot: unknown;
  resultJson: unknown;
  errorMessage: string | null;
  alertEventId: string | null;
  notifiedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type ReviewTable = {
  create(args: { data: Record<string, unknown> }): Promise<ReviewRow>;
  findUnique(args: { where: Record<string, unknown> }): Promise<ReviewRow | null>;
  findFirst(args: { where: Record<string, unknown>; orderBy: Record<string, unknown> }): Promise<ReviewRow | null>;
  findMany(args: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, unknown>;
    take?: number;
    skip?: number;
  }): Promise<ReviewRow[]>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<ReviewRow>;
  updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
};

export type ConversationSecurityReviewRepositoryDb = {
  conversationSecurityReview: ReviewTable;
};

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
}

function text(value: string | null | undefined): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

function mapRow(row: ReviewRow): ConversationSecurityReviewRecord {
  return {
    id: row.id,
    organizationId: text(row.organizationId),
    userId: row.userId,
    threadId: row.threadId,
    userMessageId: row.userMessageId,
    channel: row.channel,
    audience: row.audience,
    status: row.status as ConversationSecurityReviewStatus,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt,
    lockedAt: row.lockedAt ?? undefined,
    reviewerProvider: text(row.reviewerProvider),
    reviewerModel: text(row.reviewerModel),
    riskLevel: text(row.riskLevel),
    riskScore: row.riskScore ?? undefined,
    confidence: row.confidence ?? undefined,
    categories: strings(row.categories),
    evidenceMessageIds: strings(row.evidenceMessageIds),
    reason: text(row.reason),
    assistantExposure: text(row.assistantExposure),
    recommendedAction: text(row.recommendedAction),
    contextSnapshot: row.contextSnapshot ?? undefined,
    resultJson: row.resultJson ?? undefined,
    errorMessage: text(row.errorMessage),
    alertEventId: text(row.alertEventId),
    notifiedAt: row.notifiedAt ?? undefined,
    completedAt: row.completedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function isUniqueError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  return record.code === "P2002" || (typeof record.message === "string" && /unique/i.test(record.message));
}

export class ConversationSecurityReviewRepository {
  constructor(private readonly db: ConversationSecurityReviewRepositoryDb) {}

  async enqueue(input: {
    organizationId?: string;
    userId: string;
    threadId: string;
    userMessageId: string;
    channel: string;
    audience: string;
    nextAttemptAt?: Date;
  }): Promise<ConversationSecurityReviewRecord> {
    try {
      return mapRow(await this.db.conversationSecurityReview.create({
        data: {
          organizationId: input.organizationId ?? null,
          userId: input.userId,
          threadId: input.threadId,
          userMessageId: input.userMessageId,
          channel: input.channel,
          audience: input.audience,
          status: "pending",
          nextAttemptAt: input.nextAttemptAt ?? new Date()
        }
      }));
    } catch (error) {
      if (!isUniqueError(error)) throw error;
      const existing = await this.db.conversationSecurityReview.findUnique({
        where: {
          threadId_userMessageId: {
            threadId: input.threadId,
            userMessageId: input.userMessageId
          }
        }
      });
      if (!existing) throw error;
      return mapRow(existing);
    }
  }

  async claimNext(now = new Date()): Promise<ConversationSecurityReviewRecord | undefined> {
    const staleLock = new Date(now.getTime() - 10 * 60_000);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = await this.db.conversationSecurityReview.findFirst({
        where: {
          OR: [
            { status: { in: ["pending", "failed"] }, nextAttemptAt: { lte: now } },
            { status: "processing", lockedAt: { lt: staleLock } }
          ]
        },
        orderBy: { createdAt: "asc" }
      });
      if (!candidate) return undefined;
      const claimed = await this.db.conversationSecurityReview.updateMany({
        where: {
          id: candidate.id,
          updatedAt: candidate.updatedAt
        },
        data: {
          status: "processing",
          lockedAt: now,
          attempts: { increment: 1 },
          errorMessage: null
        }
      });
      if (claimed.count === 0) continue;
      const row = await this.db.conversationSecurityReview.findUnique({ where: { id: candidate.id } });
      return row ? mapRow(row) : undefined;
    }
    return undefined;
  }

  async complete(input: {
    id: string;
    reviewerProvider: string;
    reviewerModel: string;
    riskLevel: string;
    riskScore: number;
    confidence?: number;
    categories: string[];
    evidenceMessageIds: string[];
    reason: string;
    assistantExposure: string;
    recommendedAction: string;
    contextSnapshot: unknown;
    resultJson: unknown;
  }): Promise<ConversationSecurityReviewRecord> {
    return mapRow(await this.db.conversationSecurityReview.update({
      where: { id: input.id },
      data: {
        status: "completed",
        lockedAt: null,
        completedAt: new Date(),
        reviewerProvider: input.reviewerProvider,
        reviewerModel: input.reviewerModel,
        riskLevel: input.riskLevel,
        riskScore: input.riskScore,
        confidence: input.confidence ?? null,
        categories: input.categories,
        evidenceMessageIds: input.evidenceMessageIds,
        reason: input.reason,
        assistantExposure: input.assistantExposure,
        recommendedAction: input.recommendedAction,
        contextSnapshot: input.contextSnapshot,
        resultJson: input.resultJson,
        errorMessage: null
      }
    }));
  }

  async skip(input: { id: string; reason: string }): Promise<void> {
    await this.db.conversationSecurityReview.update({
      where: { id: input.id },
      data: {
        status: "skipped",
        lockedAt: null,
        completedAt: new Date(),
        errorMessage: input.reason.slice(0, 1000)
      }
    });
  }

  async fail(input: { id: string; errorMessage: string; attempts: number; maxAttempts?: number }): Promise<void> {
    const maxAttempts = input.maxAttempts ?? 5;
    const terminal = input.attempts >= maxAttempts;
    const delayMinutes = Math.min(60, 2 ** Math.max(0, input.attempts - 1));
    await this.db.conversationSecurityReview.update({
      where: { id: input.id },
      data: {
        status: terminal ? "failed_terminal" : "failed",
        lockedAt: null,
        errorMessage: input.errorMessage.slice(0, 1000),
        nextAttemptAt: new Date(Date.now() + delayMinutes * 60_000)
      }
    });
  }

  async markAlert(input: { id: string; alertEventId: string; notified: boolean }): Promise<void> {
    await this.db.conversationSecurityReview.update({
      where: { id: input.id },
      data: {
        alertEventId: input.alertEventId,
        notifiedAt: input.notified ? new Date() : null
      }
    });
  }

  async listRecentForUser(input: {
    userId: string;
    since: Date;
    take: number;
    minimumScore?: number;
  }): Promise<ConversationSecurityReviewRecord[]> {
    const rows = await this.db.conversationSecurityReview.findMany({
      where: {
        userId: input.userId,
        status: "completed",
        createdAt: { gte: input.since },
        ...(input.minimumScore !== undefined ? { riskScore: { gte: input.minimumScore } } : {})
      },
      orderBy: { createdAt: "desc" },
      take: input.take
    });
    return rows.map(mapRow);
  }

  async findRecentNotified(input: { userId: string; since: Date }): Promise<ConversationSecurityReviewRecord | undefined> {
    const row = await this.db.conversationSecurityReview.findFirst({
      where: {
        userId: input.userId,
        notifiedAt: { gte: input.since }
      },
      orderBy: { notifiedAt: "desc" }
    });
    return row ? mapRow(row) : undefined;
  }

  async list(input: { status?: string; riskLevel?: string; userId?: string; take?: number; skip?: number } = {}) {
    const rows = await this.db.conversationSecurityReview.findMany({
      where: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.riskLevel ? { riskLevel: input.riskLevel } : {}),
        ...(input.userId ? { userId: input.userId } : {})
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(200, Math.max(1, input.take ?? 100)),
      skip: Math.max(0, input.skip ?? 0)
    });
    return rows.map(mapRow);
  }

  async get(id: string): Promise<ConversationSecurityReviewRecord | undefined> {
    const row = await this.db.conversationSecurityReview.findUnique({ where: { id } });
    return row ? mapRow(row) : undefined;
  }
}
