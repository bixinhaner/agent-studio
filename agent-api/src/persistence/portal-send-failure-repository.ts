export type PortalSendFailureSource = "server" | "client";

export type PortalSendFailureAttachment = {
  name: string;
  status?: string;
  failureCode?: string;
  sizeBytes?: number;
};

export type PortalSendFailureInput = {
  threadId?: string | null;
  organizationId?: string | null;
  userId?: string | null;
  source: PortalSendFailureSource;
  stage: string;
  errorCode?: string | null;
  httpStatus?: number | null;
  detail?: string | null;
  messagePreview?: string | null;
  attachments?: PortalSendFailureAttachment[] | null;
  clientRunId?: string | null;
  buildId?: string | null;
  userAgent?: string | null;
  createdAt?: Date;
};

export type PortalSendFailureRecord = {
  id: string;
  threadId?: string;
  userId?: string;
  source: PortalSendFailureSource;
  stage: string;
  errorCode?: string;
  httpStatus?: number;
  detail?: string;
  messagePreview?: string;
  attachments: PortalSendFailureAttachment[];
  clientRunId?: string;
  buildId?: string;
  userAgent?: string;
  createdAt: string;
};

type PortalSendFailureRow = {
  id: string;
  threadId: string | null;
  userId: string | null;
  source: string;
  stage: string;
  errorCode: string | null;
  httpStatus: number | null;
  detail: string | null;
  messagePreview: string | null;
  attachments: unknown;
  clientRunId: string | null;
  buildId: string | null;
  userAgent: string | null;
  createdAt: Date | string;
};

type PortalSendFailureCreateData = {
  threadId: string | null;
  organizationId: string | null;
  userId: string | null;
  source: string;
  stage: string;
  errorCode: string | null;
  httpStatus: number | null;
  detail: string | null;
  messagePreview: string | null;
  attachments?: PortalSendFailureAttachment[];
  clientRunId: string | null;
  buildId: string | null;
  userAgent: string | null;
  createdAt?: Date;
};

export type PortalSendFailureRepositoryDb = {
  portalSendFailure: {
    create(args: { data: PortalSendFailureCreateData }): Promise<PortalSendFailureRow>;
    findMany(args: {
      where: { threadId: string };
      orderBy: Array<{ createdAt: "asc" } | { id: "asc" }>;
      take?: number;
    }): Promise<PortalSendFailureRow[]>;
  };
};

const MAX_DETAIL = 4000;
const MAX_PREVIEW = 1000;
const MAX_ATTACHMENTS = 20;

function clip(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function normalizeAttachments(value: unknown): PortalSendFailureAttachment[] {
  if (!Array.isArray(value)) return [];
  const out: PortalSendFailureAttachment[] = [];
  for (const item of value.slice(0, MAX_ATTACHMENTS)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = clip(typeof record.name === "string" ? record.name : null, 300);
    if (!name) continue;
    out.push({
      name,
      ...(typeof record.status === "string" && record.status ? { status: record.status.slice(0, 40) } : {}),
      ...(typeof record.failureCode === "string" && record.failureCode
        ? { failureCode: record.failureCode.slice(0, 80) }
        : {}),
      ...(typeof record.sizeBytes === "number" && Number.isFinite(record.sizeBytes)
        ? { sizeBytes: Math.max(0, Math.round(record.sizeBytes)) }
        : {})
    });
  }
  return out;
}

function toRecord(row: PortalSendFailureRow): PortalSendFailureRecord {
  return {
    id: row.id,
    ...(row.threadId ? { threadId: row.threadId } : {}),
    ...(row.userId ? { userId: row.userId } : {}),
    source: row.source === "client" ? "client" : "server",
    stage: row.stage,
    ...(row.errorCode ? { errorCode: row.errorCode } : {}),
    ...(typeof row.httpStatus === "number" ? { httpStatus: row.httpStatus } : {}),
    ...(row.detail ? { detail: row.detail } : {}),
    ...(row.messagePreview ? { messagePreview: row.messagePreview } : {}),
    attachments: normalizeAttachments(row.attachments),
    ...(row.clientRunId ? { clientRunId: row.clientRunId } : {}),
    ...(row.buildId ? { buildId: row.buildId } : {}),
    ...(row.userAgent ? { userAgent: row.userAgent } : {}),
    createdAt: new Date(row.createdAt).toISOString()
  };
}

export class PortalSendFailureRepository {
  constructor(private readonly db: PortalSendFailureRepositoryDb) {}

  async create(input: PortalSendFailureInput): Promise<PortalSendFailureRecord> {
    const attachments = normalizeAttachments(input.attachments);
    const row = await this.db.portalSendFailure.create({
      data: {
        threadId: clip(input.threadId, 200),
        organizationId: clip(input.organizationId, 200),
        userId: clip(input.userId, 200),
        source: input.source,
        stage: clip(input.stage, 80) ?? "unknown",
        errorCode: clip(input.errorCode, 120),
        httpStatus: typeof input.httpStatus === "number" && Number.isFinite(input.httpStatus)
          ? Math.round(input.httpStatus)
          : null,
        detail: clip(input.detail, MAX_DETAIL),
        messagePreview: clip(input.messagePreview, MAX_PREVIEW),
        ...(attachments.length ? { attachments } : {}),
        clientRunId: clip(input.clientRunId, 200),
        buildId: clip(input.buildId, 120),
        userAgent: clip(input.userAgent, 300),
        ...(input.createdAt ? { createdAt: input.createdAt } : {})
      }
    });
    return toRecord(row);
  }

  async listForThread(threadId: string): Promise<PortalSendFailureRecord[]> {
    const rows = await this.db.portalSendFailure.findMany({
      where: { threadId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 200
    });
    return rows.map(toRecord);
  }
}
