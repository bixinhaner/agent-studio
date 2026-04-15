import { randomUUID } from "node:crypto";

import {
  normalizeManagedCodexProviderSnapshot,
  type ManagedCodexProviderSnapshot
} from "../managed-codex-provider.js";
import type { ReasoningEffort } from "../model-config.js";

export type SessionRecord = {
  sessionId: string;
  organizationId?: string;
  userId?: string;
  threadId?: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  workspace: string;
  codexRunConfig?: Record<string, unknown>;
  codexThreadId?: string;
  providerSnapshot?: ManagedCodexProviderSnapshot;
  createdAt: string;
  updatedAt: string;
};

type RuntimeSessionMetadata = {
  model: string;
  reasoningEffort: ReasoningEffort;
  workspace: string;
  codexRunConfig?: Record<string, unknown>;
  codexThreadId?: string;
  providerSnapshot?: ManagedCodexProviderSnapshot;
};

type RuntimeSessionRow = {
  id: string;
  organizationId: string | null;
  threadId: string | null;
  userId: string | null;
  externalId: string | null;
  metadata: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type RuntimeSessionTable = {
  count(args: { where?: { status?: "active" | "ended" | "failed" } }): Promise<number>;
  findUnique(args: { where: { externalId: string } }): Promise<RuntimeSessionRow | null>;
  findMany(args: {
    where?: {
      status?: "active" | "ended" | "failed";
      updatedAt?: { lt: Date };
      externalId?: { in: string[] };
    };
    select?: { externalId: true };
  }): Promise<Array<RuntimeSessionRow | { externalId: string | null }>>;
  create(args: { data: Record<string, unknown> }): Promise<RuntimeSessionRow>;
  update(args: { where: { externalId: string }; data: Record<string, unknown> }): Promise<RuntimeSessionRow>;
  deleteMany(args: { where: { externalId?: string; updatedAt?: { lt: Date } } }): Promise<{ count: number }>;
};

export type SessionRepositoryDb = {
  runtimeSession: RuntimeSessionTable;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function parseMetadata(value: unknown): RuntimeSessionMetadata {
  const obj = asRecord(value);
  return {
    model: typeof obj?.model === "string" ? obj.model : "",
    reasoningEffort: (typeof obj?.reasoningEffort === "string" ? obj.reasoningEffort : "high") as ReasoningEffort,
    workspace: typeof obj?.workspace === "string" ? obj.workspace : "",
    codexRunConfig: asRecord(obj?.codexRunConfig ?? undefined) ?? undefined,
    codexThreadId: typeof obj?.codexThreadId === "string" ? obj.codexThreadId : undefined,
    providerSnapshot: normalizeManagedCodexProviderSnapshot(obj?.providerSnapshot)
  };
}

export class SessionRepository {
  constructor(
    private readonly db: SessionRepositoryDb,
    private readonly ttlMs: number | null
  ) {}

  async create(payload: Omit<SessionRecord, "sessionId" | "createdAt" | "updatedAt">): Promise<SessionRecord> {
    const sessionId = randomUUID();
    const created = await this.db.runtimeSession.create({
      data: {
        organizationId: payload.organizationId ?? null,
        threadId: payload.threadId ?? null,
        userId: payload.userId ?? null,
        status: "active",
        provider: "codex",
        externalId: sessionId,
        metadata: {
          model: payload.model,
          reasoningEffort: payload.reasoningEffort,
          workspace: payload.workspace,
          codexRunConfig: payload.codexRunConfig,
          codexThreadId: payload.codexThreadId,
          providerSnapshot: payload.providerSnapshot
        }
      }
    });
    return this.mapSession(created);
  }

  async countActive(): Promise<number> {
    return this.db.runtimeSession.count({
      where: { status: "active" }
    });
  }

  async get(sessionId: string): Promise<SessionRecord | undefined> {
    const current = await this.peek(sessionId);
    if (!current) return undefined;

    const updated = await this.db.runtimeSession.update({
      where: { externalId: sessionId },
      data: {
        updatedAt: new Date()
      }
    });
    return this.mapSession(updated);
  }

  async getOwned(sessionId: string, userId: string, organizationId?: string): Promise<SessionRecord | undefined> {
    const session = await this.peek(sessionId);
    if (!session || session.userId !== userId) {
      return undefined;
    }
    const normalizedOrganizationId = trimOrUndefined(organizationId);
    if (normalizedOrganizationId && session.organizationId !== normalizedOrganizationId) {
      return undefined;
    }
    const updated = await this.db.runtimeSession.update({
      where: { externalId: sessionId },
      data: {
        updatedAt: new Date()
      }
    });
    return this.mapSession(updated);
  }

  async peek(sessionId: string): Promise<SessionRecord | undefined> {
    const row = await this.db.runtimeSession.findUnique({ where: { externalId: sessionId } });
    if (!row || !row.externalId) return undefined;

    const ttlMs = this.ttlMs;
    if (typeof ttlMs !== "number" || !Number.isFinite(ttlMs) || ttlMs <= 0) {
      return this.mapSession(row);
    }

    const updatedAt = new Date(row.updatedAt);
    if (Number.isNaN(updatedAt.getTime())) {
      return this.mapSession(row);
    }

    if (Date.now() - updatedAt.getTime() > ttlMs) {
      await this.remove(sessionId);
      return undefined;
    }

    return this.mapSession(row);
  }

  async update(
    sessionId: string,
    patch: Partial<
      Pick<SessionRecord, "model" | "reasoningEffort" | "workspace" | "codexRunConfig" | "codexThreadId" | "providerSnapshot">
    >
  ): Promise<SessionRecord> {
    const row = await this.db.runtimeSession.findUnique({ where: { externalId: sessionId } });
    if (!row || !row.externalId) {
      throw new Error("Session does not exist");
    }

    const metadata = parseMetadata(row.metadata);
    const hasCodexThreadIdPatch = Object.prototype.hasOwnProperty.call(patch, "codexThreadId");
    const hasProviderSnapshotPatch = Object.prototype.hasOwnProperty.call(patch, "providerSnapshot");
    const updated = await this.db.runtimeSession.update({
      where: { externalId: sessionId },
      data: {
        metadata: {
          model: patch.model ?? metadata.model,
          reasoningEffort: patch.reasoningEffort ?? metadata.reasoningEffort,
          workspace: patch.workspace ?? metadata.workspace,
          codexRunConfig: patch.codexRunConfig ?? metadata.codexRunConfig,
          codexThreadId: hasCodexThreadIdPatch ? patch.codexThreadId : metadata.codexThreadId,
          providerSnapshot: hasProviderSnapshotPatch ? patch.providerSnapshot : metadata.providerSnapshot
        }
      }
    });

    return this.mapSession(updated);
  }

  async remove(sessionId: string): Promise<void> {
    await this.db.runtimeSession.deleteMany({
      where: { externalId: sessionId }
    });
  }

  async cleanupExpired(): Promise<string[]> {
    const ttlMs = this.ttlMs;
    if (typeof ttlMs !== "number" || !Number.isFinite(ttlMs) || ttlMs <= 0) {
      return [];
    }

    const cutoff = new Date(Date.now() - ttlMs);
    const expired = (await this.db.runtimeSession.findMany({
      where: { updatedAt: { lt: cutoff } },
      select: { externalId: true }
    })) as Array<{ externalId: string | null }>;
    const sessionIds = expired.map((item) => item.externalId).filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    if (!sessionIds.length) {
      return [];
    }

    await this.db.runtimeSession.deleteMany({
      where: { updatedAt: { lt: cutoff } }
    });
    return sessionIds;
  }

  async listByIds(sessionIds: string[]): Promise<SessionRecord[]> {
    const normalizedIds = [...new Set(sessionIds.map((item) => trimOrUndefined(item)).filter(Boolean) as string[])];
    if (!normalizedIds.length) {
      return [];
    }
    const rows = (await this.db.runtimeSession.findMany({
      where: { externalId: { in: normalizedIds } }
    })) as RuntimeSessionRow[];
    return rows.map((row) => this.mapSession(row));
  }

  private mapSession(row: RuntimeSessionRow): SessionRecord {
    const metadata = parseMetadata(row.metadata);
    return {
      sessionId: row.externalId ?? row.id,
      organizationId: trimOrUndefined(row.organizationId),
      userId: row.userId ?? undefined,
      threadId: row.threadId ?? undefined,
      model: metadata.model,
      reasoningEffort: metadata.reasoningEffort,
      workspace: metadata.workspace,
      codexRunConfig: metadata.codexRunConfig,
      codexThreadId: metadata.codexThreadId,
      providerSnapshot: metadata.providerSnapshot,
      createdAt: toIsoString(row.createdAt),
      updatedAt: toIsoString(row.updatedAt)
    };
  }
}
