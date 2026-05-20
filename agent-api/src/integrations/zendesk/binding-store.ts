import { randomUUID } from "node:crypto";

import { getDbClient } from "../../db/client.js";
import type { ZendeskBindingRecord } from "./types.js";
import { zendeskScopeKey } from "./run-store.js";

type ZendeskTicketBindingRow = {
  id: string;
  integrationInstanceId: string | null;
  scopeKey: string;
  ticketId: string;
  lastProcessedRequesterCommentId: number | bigint | string | null;
  lastAction: string | null;
  lastRunAt: Date | string | null;
  lastRunId: string | null;
  codexThreadId: string | null;
  workspacePath: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type ZendeskTicketBindingTable = {
  findUnique(args: { where: { scopeKey_ticketId: { scopeKey: string; ticketId: string } } }): Promise<ZendeskTicketBindingRow | null>;
  upsert(args: {
    where: { scopeKey_ticketId: { scopeKey: string; ticketId: string } };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<ZendeskTicketBindingRow>;
};

export type ZendeskBindingStoreDb = {
  zendeskTicketBinding: ZendeskTicketBindingTable;
};

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return undefined;
}

function toDate(value: string | undefined): Date | null {
  const raw = trimOrUndefined(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

function mapBinding(row: ZendeskTicketBindingRow): ZendeskBindingRecord {
  return {
    ticketId: row.ticketId,
    instanceId: trimOrUndefined(row.integrationInstanceId ?? undefined),
    lastProcessedRequesterCommentId: toSafeNumber(row.lastProcessedRequesterCommentId),
    lastAction:
      row.lastAction === "public_reply" ||
      row.lastAction === "internal_note" ||
      row.lastAction === "handoff" ||
      row.lastAction === "skip" ||
      row.lastAction === "error"
        ? row.lastAction
        : undefined,
    lastRunAt: toIsoString(row.lastRunAt),
    lastRunId: trimOrUndefined(row.lastRunId ?? undefined),
    codexThreadId: trimOrUndefined(row.codexThreadId ?? undefined),
    workspacePath: trimOrUndefined(row.workspacePath ?? undefined),
    createdAt: toIsoString(row.createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updatedAt) ?? new Date().toISOString()
  };
}

export class ZendeskBindingStore {
  constructor(private readonly db = getDbClient() as unknown as ZendeskBindingStoreDb) {}

  async get(ticketId: string, instanceId?: string): Promise<ZendeskBindingRecord | undefined> {
    const key = String(ticketId || "").trim();
    if (!key) return undefined;
    const row = await this.db.zendeskTicketBinding.findUnique({
      where: {
        scopeKey_ticketId: {
          scopeKey: zendeskScopeKey(instanceId),
          ticketId: key
        }
      }
    });
    return row ? mapBinding(row) : undefined;
  }

  async upsert(
    ticketId: string,
    patch: Partial<Omit<ZendeskBindingRecord, "ticketId" | "createdAt" | "updatedAt">>,
    instanceId?: string
  ): Promise<ZendeskBindingRecord> {
    const key = String(ticketId || "").trim();
    if (!key) throw new Error("ticketId 不能为空");

    const normalizedInstanceId = trimOrUndefined(instanceId);
    const scopeKey = zendeskScopeKey(normalizedInstanceId);
    const row = await this.db.zendeskTicketBinding.upsert({
      where: {
        scopeKey_ticketId: {
          scopeKey,
          ticketId: key
        }
      },
      create: {
        id: randomUUID(),
        integrationInstanceId: normalizedInstanceId ?? null,
        scopeKey,
        ticketId: key,
        lastProcessedRequesterCommentId: toBigIntOrNull(patch.lastProcessedRequesterCommentId),
        lastAction: trimOrUndefined(patch.lastAction) ?? null,
        lastRunAt: toDate(patch.lastRunAt),
        lastRunId: trimOrUndefined(patch.lastRunId) ?? null,
        codexThreadId: trimOrUndefined(patch.codexThreadId) ?? null,
        workspacePath: trimOrUndefined(patch.workspacePath) ?? null
      },
      update: {
        integrationInstanceId: normalizedInstanceId ?? null,
        lastProcessedRequesterCommentId:
          patch.lastProcessedRequesterCommentId === undefined
            ? undefined
            : toBigIntOrNull(patch.lastProcessedRequesterCommentId),
        lastAction: trimOrUndefined(patch.lastAction) ?? undefined,
        lastRunAt: patch.lastRunAt === undefined ? undefined : toDate(patch.lastRunAt),
        lastRunId: patch.lastRunId === undefined ? undefined : trimOrUndefined(patch.lastRunId) ?? null,
        codexThreadId: patch.codexThreadId === undefined ? undefined : trimOrUndefined(patch.codexThreadId) ?? null,
        workspacePath: patch.workspacePath === undefined ? undefined : trimOrUndefined(patch.workspacePath) ?? null
      }
    });
    return mapBinding(row);
  }
}
