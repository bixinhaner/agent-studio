import { randomUUID } from "node:crypto";

import { getDbClient } from "../../db/client.js";
import type { ZendeskRunRecord, ZendeskRunStatus } from "./types.js";

type ZendeskRunRow = {
  id: string;
  integrationInstanceId: string | null;
  scopeKey: string;
  ticketId: string;
  source: string;
  status: string;
  detail: string;
  decision: string | null;
  commentId: number | bigint | string | null;
  requesterCommentId: number | bigint | string | null;
  ticketSubject: string | null;
  error: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type ZendeskRunTable = {
  findMany(args: {
    where?: Record<string, unknown>;
    orderBy?: { createdAt?: "asc" | "desc" };
    take?: number;
  }): Promise<ZendeskRunRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<ZendeskRunRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<ZendeskRunRow>;
};

export type ZendeskRunStoreDb = {
  zendeskRun: ZendeskRunTable;
};

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function zendeskScopeKey(instanceId?: string): string {
  return trimOrUndefined(instanceId) ?? "legacy";
}

function toIsoString(value: Date | string | null | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return new Date().toISOString();
}

function toBigIntOrNull(value: number | null | undefined): bigint | null {
  return typeof value === "number" && Number.isFinite(value) ? BigInt(value) : null;
}

function toSafeNumber(value: number | bigint | string | null | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) ? numeric : undefined;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) ? numeric : undefined;
  }
  return undefined;
}

function mapRun(row: ZendeskRunRow): ZendeskRunRecord {
  return {
    id: row.id,
    instanceId: trimOrUndefined(row.integrationInstanceId ?? undefined),
    ticketId: row.ticketId,
    source: row.source === "manual" ? "manual" : "webhook",
    status: row.status as ZendeskRunStatus,
    detail: row.detail,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
    decision:
      row.decision === "public_reply" || row.decision === "internal_note" || row.decision === "handoff"
        ? row.decision
        : undefined,
    commentId: toSafeNumber(row.commentId),
    requesterCommentId: toSafeNumber(row.requesterCommentId),
    ticketSubject: trimOrUndefined(row.ticketSubject ?? undefined),
    error: trimOrUndefined(row.error ?? undefined)
  };
}

export class ZendeskRunStore {
  constructor(private readonly db = getDbClient() as unknown as ZendeskRunStoreDb) {}

  async list(limit = 50): Promise<ZendeskRunRecord[]> {
    const safeLimit = Math.max(1, Math.min(200, limit));
    const rows = await this.db.zendeskRun.findMany({
      orderBy: { createdAt: "desc" },
      take: safeLimit
    });
    return rows.map(mapRun);
  }

  async listForInstance(limit = 50, instanceId?: string): Promise<ZendeskRunRecord[]> {
    const safeLimit = Math.max(1, Math.min(200, limit));
    const scopeKey = zendeskScopeKey(instanceId);
    const rows = await this.db.zendeskRun.findMany({
      where: trimOrUndefined(instanceId) ? { scopeKey } : undefined,
      orderBy: { createdAt: "desc" },
      take: safeLimit
    });
    return rows.map(mapRun);
  }

  async create(input: {
    instanceId?: string;
    ticketId: string;
    source: "webhook" | "manual";
    status: ZendeskRunStatus;
    detail: string;
    ticketSubject?: string;
  }): Promise<ZendeskRunRecord> {
    const instanceId = trimOrUndefined(input.instanceId);
    const row = await this.db.zendeskRun.create({
      data: {
        id: randomUUID(),
        integrationInstanceId: instanceId ?? null,
        scopeKey: zendeskScopeKey(instanceId),
        ticketId: input.ticketId,
        source: input.source,
        status: input.status,
        detail: input.detail,
        ticketSubject: trimOrUndefined(input.ticketSubject) ?? null
      }
    });
    return mapRun(row);
  }

  async update(
    runId: string,
    patch: Partial<Omit<ZendeskRunRecord, "id" | "ticketId" | "source" | "createdAt">>
  ): Promise<ZendeskRunRecord | undefined> {
    const id = trimOrUndefined(runId);
    if (!id) return undefined;
    try {
      const row = await this.db.zendeskRun.update({
        where: { id },
        data: {
          ...(patch.instanceId !== undefined
            ? {
                integrationInstanceId: trimOrUndefined(patch.instanceId) ?? null,
                scopeKey: zendeskScopeKey(patch.instanceId)
              }
            : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.detail !== undefined ? { detail: patch.detail } : {}),
          ...(patch.decision !== undefined ? { decision: patch.decision ?? null } : {}),
          ...(patch.commentId !== undefined ? { commentId: toBigIntOrNull(patch.commentId) } : {}),
          ...(patch.requesterCommentId !== undefined ? { requesterCommentId: toBigIntOrNull(patch.requesterCommentId) } : {}),
          ...(patch.ticketSubject !== undefined ? { ticketSubject: trimOrUndefined(patch.ticketSubject) ?? null } : {}),
          ...(patch.error !== undefined ? { error: trimOrUndefined(patch.error) ?? null } : {})
        }
      });
      return mapRun(row);
    } catch {
      return undefined;
    }
  }
}
