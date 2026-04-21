export type AccessRequestReviewerRecord = {
  id: string;
  accessRequestId: string;
  reviewerEmail: string;
  reviewerUserId?: string;
  deliveryType: string;
  decision: string;
  comment?: string;
  notifiedAt?: string;
  decidedAt?: string;
  createdAt: string;
  updatedAt: string;
};

type AccessRequestReviewerRow = {
  id: string;
  accessRequestId: string;
  reviewerEmail: string;
  reviewerUserId: string | null;
  deliveryType: string | null;
  decision: string | null;
  comment: string | null;
  notifiedAt: Date | string | null;
  decidedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type AccessRequestReviewerTable = {
  findMany(args?: {
    where?: {
      accessRequestId?: string | { in: string[] };
      reviewerEmail?: string;
      reviewerUserId?: string;
    };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<AccessRequestReviewerRow[]>;
  createMany(args: {
    data: Array<Record<string, unknown>>;
    skipDuplicates?: boolean;
  }): Promise<{ count: number }>;
  deleteMany(args: { where?: { accessRequestId?: string } }): Promise<{ count: number }>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<AccessRequestReviewerRow>;
};

export type AccessRequestReviewerRepositoryDb = {
  accessRequestReviewer: AccessRequestReviewerTable;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
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

function mapReviewer(row: AccessRequestReviewerRow): AccessRequestReviewerRecord {
  return {
    id: row.id,
    accessRequestId: row.accessRequestId,
    reviewerEmail: row.reviewerEmail,
    reviewerUserId: trimOrUndefined(row.reviewerUserId),
    deliveryType: trimOrUndefined(row.deliveryType) ?? "to",
    decision: trimOrUndefined(row.decision) ?? "pending",
    comment: trimOrUndefined(row.comment),
    notifiedAt: toIsoString(row.notifiedAt),
    decidedAt: toIsoString(row.decidedAt),
    createdAt: toIsoString(row.createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updatedAt) ?? new Date().toISOString()
  };
}

export class AccessRequestReviewerRepository {
  constructor(private readonly db: AccessRequestReviewerRepositoryDb) {}

  async listForRequest(accessRequestId: string): Promise<AccessRequestReviewerRecord[]> {
    const normalized = trimOrUndefined(accessRequestId);
    if (!normalized) return [];
    const rows = await this.db.accessRequestReviewer.findMany({
      where: { accessRequestId: normalized },
      orderBy: { createdAt: "asc" }
    });
    return rows.map(mapReviewer);
  }

  async listForRequests(accessRequestIds: string[]): Promise<AccessRequestReviewerRecord[]> {
    const normalized = [...new Set(accessRequestIds.map((item) => trimOrUndefined(item)).filter(Boolean) as string[])];
    if (!normalized.length) return [];
    const rows = await this.db.accessRequestReviewer.findMany({
      where: { accessRequestId: { in: normalized } },
      orderBy: { createdAt: "asc" }
    });
    return rows.map(mapReviewer);
  }

  async replaceForRequest(
    accessRequestId: string,
    reviewers: Array<{ reviewerEmail: string; reviewerUserId?: string | null; deliveryType?: string; decision?: string }>
  ): Promise<AccessRequestReviewerRecord[]> {
    const normalized = trimOrUndefined(accessRequestId);
    if (!normalized) {
      throw new Error("access request id is required");
    }
    await this.db.accessRequestReviewer.deleteMany({ where: { accessRequestId: normalized } });
    if (!reviewers.length) {
      return [];
    }
    await this.db.accessRequestReviewer.createMany({
      data: reviewers.map((reviewer) => ({
        accessRequestId: normalized,
        reviewerEmail: reviewer.reviewerEmail.trim().toLowerCase(),
        reviewerUserId: trimOrUndefined(reviewer.reviewerUserId ?? undefined) ?? null,
        deliveryType: trimOrUndefined(reviewer.deliveryType) ?? "to",
        decision: trimOrUndefined(reviewer.decision) ?? "pending"
      })),
      skipDuplicates: true
    });
    return this.listForRequest(normalized);
  }

  async resetDecisions(accessRequestId: string): Promise<AccessRequestReviewerRecord[]> {
    const reviewers = await this.listForRequest(accessRequestId);
    for (const reviewer of reviewers) {
      await this.db.accessRequestReviewer.update({
        where: { id: reviewer.id },
        data: {
          decision: "pending",
          comment: null,
          notifiedAt: reviewer.notifiedAt ? new Date(reviewer.notifiedAt) : null,
          decidedAt: null,
          updatedAt: new Date()
        }
      });
    }
    return this.listForRequest(accessRequestId);
  }

  async markNotified(accessRequestId: string): Promise<AccessRequestReviewerRecord[]> {
    const reviewers = await this.listForRequest(accessRequestId);
    const now = new Date();
    for (const reviewer of reviewers) {
      await this.db.accessRequestReviewer.update({
        where: { id: reviewer.id },
        data: {
          notifiedAt: now,
          updatedAt: now
        }
      });
    }
    return this.listForRequest(accessRequestId);
  }

  async decide(input: { reviewerId: string; decision: string; comment?: string | null }): Promise<AccessRequestReviewerRecord> {
    const normalized = trimOrUndefined(input.reviewerId);
    if (!normalized) {
      throw new Error("reviewer id is required");
    }
    const row = await this.db.accessRequestReviewer.update({
      where: { id: normalized },
      data: {
        decision: trimOrUndefined(input.decision) ?? "pending",
        comment: trimOrUndefined(input.comment ?? undefined) ?? null,
        decidedAt: new Date(),
        updatedAt: new Date()
      }
    });
    return mapReviewer(row);
  }
}
