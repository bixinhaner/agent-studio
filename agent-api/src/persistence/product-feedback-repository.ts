export type ProductFeedbackType = "bug" | "feature_request" | "usability_issue" | "other";
export type ProductFeedbackSeverity = "blocking" | "high" | "medium" | "low";
export type ProductFeedbackStatus = "open" | "triaged" | "in_progress" | "resolved" | "closed";

export type ProductFeedbackUser = {
  id: string;
  displayName: string | null;
  email: string | null;
  role: string;
  status: string;
};

export type ProductFeedbackRecord = {
  id: string;
  organizationId?: string;
  userId?: string;
  threadId?: string;
  type: ProductFeedbackType;
  severity?: ProductFeedbackSeverity;
  description: string;
  context?: unknown;
  status: ProductFeedbackStatus;
  assigneeUserId?: string;
  createdAt: string;
  updatedAt: string;
  user: ProductFeedbackUser | null;
};

export type CreateProductFeedbackInput = {
  organizationId?: string;
  userId?: string;
  threadId?: string;
  type: ProductFeedbackType;
  severity?: ProductFeedbackSeverity;
  description: string;
  context?: unknown;
};

type ProductFeedbackUserRow = {
  id: string;
  displayName: string | null;
  email: string | null;
  role: string | null;
  status: string | null;
};

type ProductFeedbackRow = {
  id: string;
  organizationId: string | null;
  userId: string | null;
  threadId: string | null;
  type: string;
  severity: string | null;
  description: string;
  context: unknown;
  status: string;
  assigneeUserId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  user?: ProductFeedbackUserRow | null;
};

type ProductFeedbackTable = {
  create(args: { data: Record<string, unknown>; include?: Record<string, unknown> }): Promise<ProductFeedbackRow>;
  findMany(args?: {
    where?: Record<string, unknown>;
    orderBy?: { createdAt?: "asc" | "desc"; updatedAt?: "asc" | "desc" };
    include?: Record<string, unknown>;
  }): Promise<ProductFeedbackRow[]>;
  findUnique(args: { where: { id: string }; include?: Record<string, unknown> }): Promise<ProductFeedbackRow | null>;
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
    include?: Record<string, unknown>;
  }): Promise<ProductFeedbackRow>;
};

export type ProductFeedbackRepositoryDb = {
  productFeedback: ProductFeedbackTable;
};

const PRODUCT_FEEDBACK_INCLUDE = {
  user: {
    select: {
      id: true,
      displayName: true,
      email: true,
      role: true,
      status: true
    }
  }
};

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function normalizeType(value: unknown): ProductFeedbackType {
  if (value === "feature_request" || value === "usability_issue" || value === "other") return value;
  return "bug";
}

function normalizeSeverity(value: unknown): ProductFeedbackSeverity | undefined {
  if (value === "blocking" || value === "high" || value === "medium" || value === "low") return value;
  return undefined;
}

function normalizeStatus(value: unknown): ProductFeedbackStatus {
  if (value === "triaged" || value === "in_progress" || value === "resolved" || value === "closed") return value;
  return "open";
}

function normalizeUser(row: ProductFeedbackUserRow | null | undefined): ProductFeedbackUser | null {
  if (!row) return null;
  return {
    id: row.id,
    displayName: trimOrUndefined(row.displayName) ?? null,
    email: trimOrUndefined(row.email) ?? null,
    role: trimOrUndefined(row.role) ?? "employee",
    status: trimOrUndefined(row.status) ?? "active"
  };
}

function mapProductFeedback(row: ProductFeedbackRow): ProductFeedbackRecord {
  const type = normalizeType(row.type);
  const severity = normalizeSeverity(row.severity);
  return {
    id: row.id,
    organizationId: trimOrUndefined(row.organizationId),
    userId: trimOrUndefined(row.userId),
    threadId: trimOrUndefined(row.threadId),
    type,
    severity: type === "bug" ? severity : undefined,
    description: row.description,
    context: row.context ?? undefined,
    status: normalizeStatus(row.status),
    assigneeUserId: trimOrUndefined(row.assigneeUserId),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
    user: normalizeUser(row.user)
  };
}

export class ProductFeedbackRepository {
  constructor(private readonly db: ProductFeedbackRepositoryDb) {}

  async create(input: CreateProductFeedbackInput): Promise<ProductFeedbackRecord> {
    const description = trimOrUndefined(input.description);
    if (!description) {
      throw new Error("feedback description is required");
    }
    const type = normalizeType(input.type);
    const created = await this.db.productFeedback.create({
      data: {
        organizationId: trimOrUndefined(input.organizationId) ?? null,
        userId: trimOrUndefined(input.userId) ?? null,
        threadId: trimOrUndefined(input.threadId) ?? null,
        type,
        severity: type === "bug" ? normalizeSeverity(input.severity) ?? null : null,
        description,
        context: input.context ?? null,
        status: "open"
      },
      include: PRODUCT_FEEDBACK_INCLUDE
    });
    return mapProductFeedback(created);
  }

  async list(): Promise<ProductFeedbackRecord[]> {
    const rows = await this.db.productFeedback.findMany({
      orderBy: { createdAt: "desc" },
      include: PRODUCT_FEEDBACK_INCLUDE
    });
    return rows.map(mapProductFeedback);
  }

  async get(id: string): Promise<ProductFeedbackRecord | null> {
    const normalizedId = trimOrUndefined(id);
    if (!normalizedId) return null;
    const row = await this.db.productFeedback.findUnique({
      where: { id: normalizedId },
      include: PRODUCT_FEEDBACK_INCLUDE
    });
    return row ? mapProductFeedback(row) : null;
  }

  async updateStatus(id: string, status: ProductFeedbackStatus): Promise<ProductFeedbackRecord | null> {
    const normalizedId = trimOrUndefined(id);
    if (!normalizedId) return null;
    const updated = await this.db.productFeedback.update({
      where: { id: normalizedId },
      data: { status: normalizeStatus(status) },
      include: PRODUCT_FEEDBACK_INCLUDE
    });
    return mapProductFeedback(updated);
  }
}
