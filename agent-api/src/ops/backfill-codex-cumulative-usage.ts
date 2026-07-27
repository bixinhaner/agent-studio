import { Prisma, type PrismaClient } from "@prisma/client";

import { createDbClient } from "../db/client.js";
import { calculateEstimatedCost } from "../operations/usage-ingestion-service.js";
import { UsageRollupService } from "../operations/usage-rollup-service.js";
import { UsageEventRepository, type UsageEventRepositoryDb } from "../persistence/usage-event-repository.js";
import { UsageRollupRepository, type UsageRollupRepositoryDb } from "../persistence/usage-rollup-repository.js";
import type { CostProfileRecord } from "../persistence/cost-profile-repository.js";

type TokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens?: number;
  outputTokens: number;
};

type RuntimeSnapshot = TokenUsage & {
  kind: "cumulative_snapshot" | "turn_delta";
  codexThreadId: string;
};

type EventRow = {
  id: string;
  organizationId: string | null;
  featureType: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  estimatedCost: string;
  internalCost: string;
  metadata: unknown;
  createdAt: Date;
};

type Correction = {
  event: EventRow;
  usage: Required<TokenUsage>;
  estimatedCost: string;
  internalCost: string;
  metadata: Record<string, unknown>;
};

function parseArgs(argv: string[]): { apply: boolean } {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === "--dry-run")) return { apply: false };
  if (argv.length === 1 && argv[0] === "--apply") return { apply: true };
  throw new Error("Usage: backfill-codex-cumulative-usage [--dry-run|--apply]");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function token(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : undefined;
}

function runtimeSnapshot(metadata: unknown): RuntimeSnapshot | undefined {
  const root = asRecord(metadata);
  const snapshot = asRecord(root?._codexRuntimeUsage);
  if (!snapshot) return undefined;
  const source = snapshot.kind === "turn_delta" ? asRecord(snapshot.cumulative) : snapshot;
  const inputTokens = token(source?.inputTokens);
  const cachedInputTokens = token(source?.cachedInputTokens);
  const cacheWriteTokens = token(source?.cacheWriteTokens);
  const outputTokens = token(source?.outputTokens);
  const codexThreadId = String(snapshot.codexThreadId ?? root?.codexThreadId ?? "").trim();
  if (!codexThreadId || inputTokens === undefined || cachedInputTokens === undefined || outputTokens === undefined) {
    return undefined;
  }
  return {
    kind: snapshot.kind === "turn_delta" ? "turn_delta" : "cumulative_snapshot",
    codexThreadId,
    inputTokens,
    cachedInputTokens,
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    outputTokens
  };
}

function historicalProfile(metadata: unknown): CostProfileRecord | null {
  const cost = asRecord(asRecord(metadata)?._costProfile);
  if (!cost || cost.matched !== true) return null;
  const string = (key: string): string | undefined => {
    const value = cost[key];
    return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
  };
  const id = string("profileId");
  const model = string("model");
  const inputTokenPrice = string("inputTokenPrice");
  const cachedInputTokenPrice = string("cachedInputTokenPrice");
  const outputTokenPrice = string("outputTokenPrice");
  if (!id || !model || !inputTokenPrice || !cachedInputTokenPrice || !outputTokenPrice) return null;
  return {
    id,
    organizationId: string("organizationId"),
    model,
    inputTokenPrice,
    cachedInputTokenPrice,
    cacheWriteTokenPrice: string("cacheWriteTokenPrice") ?? "0",
    outputTokenPrice,
    longContextThresholdTokens: token(cost.longContextThresholdTokens),
    longContextInputMultiplier: string("longContextInputMultiplier") ?? "1",
    longContextOutputMultiplier: string("longContextOutputMultiplier") ?? "1",
    internalCostMultiplier: string("internalCostMultiplier") ?? "1",
    isActive: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
}

function delta(current: number, previous: number | undefined): number {
  return previous === undefined || current < previous ? current : current - previous;
}

function sameUsage(event: EventRow, usage: Required<TokenUsage>): boolean {
  return event.inputTokens === usage.inputTokens &&
    event.cachedInputTokens === usage.cachedInputTokens &&
    event.cacheWriteTokens === usage.cacheWriteTokens &&
    event.outputTokens === usage.outputTokens;
}

function decimal(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(6) : "0.000000";
}

async function rebuildRollups(db: PrismaClient, corrections: Correction[]): Promise<void> {
  const service = new UsageRollupService({
    usageEvents: new UsageEventRepository(db as unknown as UsageEventRepositoryDb),
    rollups: new UsageRollupRepository(db as unknown as UsageRollupRepositoryDb)
  });
  const targets = new Map<string, { rollupDate: string; organizationId: string | null }>();
  for (const { event } of corrections) {
    const rollupDate = event.createdAt.toISOString().slice(0, 10);
    targets.set(`${rollupDate}:${event.organizationId ?? ""}`, {
      rollupDate,
      organizationId: event.organizationId
    });
  }
  for (const target of targets.values()) await service.rebuildDaily(target);
}

async function main(): Promise<void> {
  const { apply } = parseArgs(process.argv.slice(2));
  const db = createDbClient();
  try {
    const usageEvents = new UsageEventRepository(db as unknown as UsageEventRepositoryDb);
    const events = (await usageEvents.listByExactCreatedAtRange({
      from: new Date("2020-01-01T00:00:00.000Z"),
      to: new Date("2100-01-01T00:00:00.000Z")
    }))
      .filter((event) => asRecord(event.metadata)?._codexRuntimeUsage)
      .map((event) => ({
        ...event,
        organizationId: event.organizationId ?? null,
        createdAt: new Date(event.createdAt)
      }))
      .sort((left, right) =>
        left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id)
      ) as EventRow[];
    const cursors = new Map<string, TokenUsage>();
    const corrections: Correction[] = [];
    const blocked: Array<{ eventId: string; reason: string }> = [];
    let skippedInvalidSnapshots = 0;
    const correctedAt = new Date().toISOString();

    for (const event of events) {
      const snapshot = runtimeSnapshot(event.metadata);
      if (!snapshot) {
        skippedInvalidSnapshots += 1;
        continue;
      }
      const key = `${event.featureType}\u0000${snapshot.codexThreadId}`;
      const previous = cursors.get(key);
      if (snapshot.kind === "cumulative_snapshot") {
        const usage = {
          inputTokens: delta(snapshot.inputTokens, previous?.inputTokens),
          cachedInputTokens: delta(snapshot.cachedInputTokens, previous?.cachedInputTokens),
          cacheWriteTokens: snapshot.cacheWriteTokens === undefined
            ? 0
            : delta(snapshot.cacheWriteTokens, previous?.cacheWriteTokens),
          outputTokens: delta(snapshot.outputTokens, previous?.outputTokens)
        };
        if (!sameUsage(event, usage)) {
          const costMetadata = asRecord(asRecord(event.metadata)?._costProfile);
          if (costMetadata?.longContextApplied === true) {
            blocked.push({ eventId: event.id, reason: "corrected_event_has_long_context_multiplier" });
          } else {
            const profile = historicalProfile(event.metadata);
            if (!profile && (decimal(event.estimatedCost) !== "0.000000" || decimal(event.internalCost) !== "0.000000")) {
              blocked.push({ eventId: event.id, reason: "historical_cost_profile_missing" });
            } else {
              const priced = calculateEstimatedCost({
                profile,
                ...usage,
                cacheWriteTelemetryAvailable: snapshot.cacheWriteTokens !== undefined
              });
              const metadata = {
                ...(asRecord(event.metadata) ?? {}),
                _usageCorrection: {
                  version: 1,
                  reason: "cross_session_codex_cumulative_snapshot_backfill",
                  correctedAt,
                  oldUsage: {
                    inputTokens: event.inputTokens,
                    cachedInputTokens: event.cachedInputTokens,
                    cacheWriteTokens: event.cacheWriteTokens,
                    outputTokens: event.outputTokens
                  },
                  oldEstimatedCost: decimal(event.estimatedCost),
                  oldInternalCost: decimal(event.internalCost)
                }
              };
              corrections.push({
                event,
                usage,
                estimatedCost: priced.estimatedCost,
                internalCost: priced.internalCost,
                metadata
              });
            }
          }
        }
      }
      cursors.set(key, snapshot);
    }

    const summary = {
      mode: apply ? "apply" : "dry-run",
      scannedEvents: events.length,
      correctedEvents: corrections.length,
      blockedEvents: blocked.length,
      skippedInvalidSnapshots,
      oldTokens: corrections.reduce((sum, item) =>
        sum + item.event.inputTokens + item.event.outputTokens, 0),
      correctedTokens: corrections.reduce((sum, item) =>
        sum + item.usage.inputTokens + item.usage.outputTokens, 0),
      oldEstimatedCost: corrections.reduce((sum, item) => sum + Number(item.event.estimatedCost), 0).toFixed(6),
      correctedEstimatedCost: corrections.reduce((sum, item) => sum + Number(item.estimatedCost), 0).toFixed(6),
      affectedUtcDays: [...new Set(corrections.map((item) => item.event.createdAt.toISOString().slice(0, 10)))],
      blocked: blocked.slice(0, 20)
    };
    console.log(JSON.stringify(summary, null, 2));

    if (!apply) return;
    if (blocked.length > 0) throw new Error(`apply aborted: ${blocked.length} events cannot be reconciled exactly`);
    await db.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("LOCK TABLE usage_events IN SHARE ROW EXCLUSIVE MODE");
      for (const item of corrections) {
        await transaction.usageEvent.update({
          where: { id: item.event.id },
          data: {
            ...item.usage,
            estimatedCost: item.estimatedCost,
            internalCost: item.internalCost,
            metadata: item.metadata as Prisma.InputJsonValue
          }
        });
      }
    }, { maxWait: 30_000, timeout: 180_000 });
    await rebuildRollups(db, corrections);
    console.log(JSON.stringify({ applied: corrections.length, rollupsRebuilt: true }));
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
