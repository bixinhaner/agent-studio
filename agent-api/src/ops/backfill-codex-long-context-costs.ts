import fs from "node:fs/promises";
import path from "node:path";

import { Prisma, type PrismaClient } from "@prisma/client";

import { appConfig } from "../config.js";
import { createDbClient } from "../db/client.js";
import { calculateEstimatedCost } from "../operations/usage-ingestion-service.js";
import { UsageRollupService } from "../operations/usage-rollup-service.js";
import { UsageEventRepository, type UsageEventRepositoryDb } from "../persistence/usage-event-repository.js";
import { UsageRollupRepository, type UsageRollupRepositoryDb } from "../persistence/usage-rollup-repository.js";
import type { CostProfileRecord } from "../persistence/cost-profile-repository.js";

type CliOptions = {
  apply: boolean;
  from: Date;
  to: Date;
};

type TokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens?: number;
  outputTokens: number;
};

type RolloutUsage = {
  total: TokenUsage;
  last: TokenUsage;
  modelContextWindow?: number;
};

type UsageEventRow = {
  id: string;
  organizationId: string | null;
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
  event: UsageEventRow;
  metadata: Record<string, unknown>;
  estimatedCost: string;
  internalCost: string;
  oldEstimatedCost: string;
  invocationCount: number;
  maxInvocationInputTokens: number;
  longContextInvocationCount: number;
};

const DEFAULT_FROM = "2026-07-10T00:00:00.000Z";

function usage(): never {
  console.error([
    "Usage: node dist/ops/backfill-codex-long-context-costs.js [--dry-run|--apply] [--from <ISO>] [--to <ISO>]",
    "",
    "Dry-run is the default. --apply updates only events that can be matched exactly to rollout token snapshots,",
    "then rebuilds affected UTC daily rollups. Apply aborts if any candidate cannot be reconciled."
  ].join("\n"));
  process.exit(2);
}

function parseDate(value: string | undefined): Date {
  if (!value) usage();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) usage();
  return date;
}

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = {
    apply: false,
    from: new Date(DEFAULT_FROM),
    to: new Date()
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      out.apply = false;
      continue;
    }
    if (arg === "--apply") {
      out.apply = true;
      continue;
    }
    if (arg === "--from") {
      out.from = parseDate(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--to") {
      out.to = parseDate(argv[index + 1]);
      index += 1;
      continue;
    }
    usage();
  }
  if (out.to <= out.from) usage();
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function toTokenCount(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return undefined;
  return Math.round(numeric);
}

function parseTokenUsage(value: unknown): TokenUsage | undefined {
  const usage = asRecord(value);
  if (!usage) return undefined;
  const inputTokens = toTokenCount(usage.input_tokens ?? usage.inputTokens);
  const cachedInputTokens = toTokenCount(usage.cached_input_tokens ?? usage.cachedInputTokens);
  const cacheWriteTokens = toTokenCount(usage.cache_write_tokens ?? usage.cacheWriteTokens);
  const outputTokens = toTokenCount(usage.output_tokens ?? usage.outputTokens);
  if (inputTokens === undefined || cachedInputTokens === undefined || outputTokens === undefined) return undefined;
  return {
    inputTokens,
    cachedInputTokens,
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    outputTokens
  };
}

function runtimeSnapshot(metadata: unknown): { codexThreadId: string; usage: TokenUsage } | undefined {
  const root = asRecord(metadata);
  const snapshot = asRecord(root?._codexRuntimeUsage);
  if (!snapshot) return undefined;
  const cumulative = snapshot.kind === "turn_delta" ? asRecord(snapshot.cumulative) : snapshot;
  const usage = parseTokenUsage(cumulative);
  const codexThreadId = typeof snapshot.codexThreadId === "string"
    ? snapshot.codexThreadId.trim()
    : typeof root?.codexThreadId === "string"
      ? root.codexThreadId.trim()
      : "";
  return usage && codexThreadId ? { codexThreadId, usage } : undefined;
}

function historicalProfile(metadata: unknown): CostProfileRecord | undefined {
  const cost = asRecord(asRecord(metadata)?._costProfile);
  if (!cost || cost.matched !== true) return undefined;
  const stringValue = (key: string): string | undefined => {
    const value = cost[key];
    return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
  };
  const id = stringValue("profileId");
  const model = stringValue("model");
  const inputTokenPrice = stringValue("inputTokenPrice");
  const cachedInputTokenPrice = stringValue("cachedInputTokenPrice");
  const cacheWriteTokenPrice = stringValue("cacheWriteTokenPrice") ?? "0";
  const outputTokenPrice = stringValue("outputTokenPrice");
  if (!id || !model || !inputTokenPrice || !cachedInputTokenPrice || !outputTokenPrice) return undefined;
  return {
    id,
    organizationId: stringValue("organizationId"),
    model,
    inputTokenPrice,
    cachedInputTokenPrice,
    cacheWriteTokenPrice,
    outputTokenPrice,
    longContextThresholdTokens: toTokenCount(cost.longContextThresholdTokens),
    longContextInputMultiplier: stringValue("longContextInputMultiplier") ?? "1",
    longContextOutputMultiplier: stringValue("longContextOutputMultiplier") ?? "1",
    internalCostMultiplier: stringValue("internalCostMultiplier") ?? "1",
    isActive: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
}

function longContextWasApplied(metadata: unknown): boolean {
  return asRecord(asRecord(metadata)?._costProfile)?.longContextApplied === true;
}

async function listJsonlFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(target);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(target);
      }
    }));
  };
  await visit(root);
  return files;
}

async function loadRolloutUsage(file: string): Promise<{ threadId?: string; records: RolloutUsage[] }> {
  const text = await fs.readFile(file, "utf8");
  let threadId: string | undefined;
  const records: RolloutUsage[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const payload = asRecord(row.payload);
    if (row.type === "session_meta" && typeof payload?.id === "string") {
      threadId = payload.id.trim() || undefined;
    }
    if (payload?.type !== "token_count") continue;
    const info = asRecord(payload.info);
    const total = parseTokenUsage(info?.total_token_usage);
    const last = parseTokenUsage(info?.last_token_usage);
    if (!total || !last) continue;
    records.push({
      total,
      last,
      modelContextWindow: toTokenCount(info?.model_context_window)
    });
  }
  return { threadId, records };
}

function sameUsage(left: TokenUsage, right: TokenUsage): boolean {
  return left.inputTokens === right.inputTokens &&
    left.cachedInputTokens === right.cachedInputTokens &&
    left.outputTokens === right.outputTokens;
}

function sumUsage(records: RolloutUsage[]): TokenUsage {
  return records.reduce<TokenUsage>((sum, record) => ({
    inputTokens: sum.inputTokens + record.last.inputTokens,
    cachedInputTokens: sum.cachedInputTokens + record.last.cachedInputTokens,
    cacheWriteTokens: (sum.cacheWriteTokens ?? 0) + (record.last.cacheWriteTokens ?? 0),
    outputTokens: sum.outputTokens + record.last.outputTokens
  }), { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 });
}

function localDay(date: Date): string {
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function updateCostMetadata(input: {
  metadata: unknown;
  correction: ReturnType<typeof calculateEstimatedCost>;
  oldEstimatedCost: string;
  oldInternalCost: string;
  estimatedCost: string;
  internalCost: string;
  invocationCount: number;
  correctedAt: string;
}): Record<string, unknown> {
  const root = { ...(asRecord(input.metadata) ?? {}) };
  const cost = { ...(asRecord(root._costProfile) ?? {}) };
  root._costProfile = {
    ...cost,
    version: 3,
    longContextApplied: input.correction.longContextApplied,
    longContextInvocationCount: input.correction.longContextInvocationCount,
    maxInvocationInputTokens: input.correction.maxInvocationInputTokens,
    longContextPricingBasis: "model_invocation",
    longContextPricingComplete: input.correction.longContextPricingComplete
  };
  root._usageCorrection = {
    version: 1,
    reason: "codex_long_context_model_invocation_backfill",
    source: "codex_rollout_token_count",
    correctedAt: input.correctedAt,
    invocationCount: input.invocationCount,
    oldEstimatedCost: input.oldEstimatedCost,
    estimatedCost: input.estimatedCost,
    oldInternalCost: input.oldInternalCost,
    internalCost: input.internalCost
  };
  return root;
}

async function rebuildRollups(db: PrismaClient, corrections: Correction[]): Promise<void> {
  const service = new UsageRollupService({
    usageEvents: new UsageEventRepository(db as unknown as UsageEventRepositoryDb),
    rollups: new UsageRollupRepository(db as unknown as UsageRollupRepositoryDb)
  });
  const targets = new Map<string, { rollupDate: string; organizationId: string | null }>();
  for (const correction of corrections) {
    const rollupDate = correction.event.createdAt.toISOString().slice(0, 10);
    const organizationId = correction.event.organizationId;
    targets.set(`${rollupDate}:${organizationId ?? "global"}`, { rollupDate, organizationId });
  }
  for (const target of targets.values()) {
    await service.rebuildDaily(target);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const db = createDbClient();
  const usageEvents = new UsageEventRepository(db as unknown as UsageEventRepositoryDb);
  const correctedAt = new Date().toISOString();
  try {
    const rangedEvents = (await usageEvents.listByExactCreatedAtRange({
      from: options.from,
      to: options.to
    }))
      .map((event) => ({ ...event, organizationId: event.organizationId ?? null, createdAt: new Date(event.createdAt) }))
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime()) as UsageEventRow[];
    const candidates = rangedEvents.filter((event) => longContextWasApplied(event.metadata));
    const candidateThreadIds = new Set(candidates.map((event) => runtimeSnapshot(event.metadata)?.codexThreadId).filter(Boolean) as string[]);
    const allEvents = (await usageEvents.listByExactCreatedAtRange({
      from: new Date("2026-01-01T00:00:00.000Z"),
      to: options.to
    }))
      .map((event) => ({ ...event, organizationId: event.organizationId ?? null, createdAt: new Date(event.createdAt) }))
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime()) as UsageEventRow[];
    const relevantEvents = allEvents.filter((event) => {
      const snapshot = runtimeSnapshot(event.metadata);
      return snapshot ? candidateThreadIds.has(snapshot.codexThreadId) : false;
    });

    const rolloutFiles = await listJsonlFiles(path.resolve(appConfig.codex.sessionHomeRoot));
    const filesByThread = new Map<string, { file: string; size: number }>();
    for (const file of rolloutFiles) {
      const match = path.basename(file).match(/([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/i);
      if (!match?.[1] || !candidateThreadIds.has(match[1])) continue;
      const size = (await fs.stat(file)).size;
      const existing = filesByThread.get(match[1]);
      if (!existing || size > existing.size) filesByThread.set(match[1], { file, size });
    }
    const rolloutByThread = new Map<string, RolloutUsage[]>();
    for (const [threadId, candidate] of filesByThread) {
      const file = candidate.file;
      const loaded = await loadRolloutUsage(file);
      if (loaded.threadId === threadId) rolloutByThread.set(threadId, loaded.records);
    }

    const eventsByThread = new Map<string, UsageEventRow[]>();
    for (const event of relevantEvents) {
      const threadId = runtimeSnapshot(event.metadata)?.codexThreadId;
      if (!threadId) continue;
      const rows = eventsByThread.get(threadId) ?? [];
      rows.push(event);
      eventsByThread.set(threadId, rows);
    }

    const candidateIds = new Set(candidates.map((event) => event.id));
    const corrections: Correction[] = [];
    const skipped: Array<{ eventId: string; reason: string }> = [];
    for (const [threadId, events] of eventsByThread) {
      const rollout = rolloutByThread.get(threadId);
      let cursor = -1;
      for (const event of events) {
        const snapshot = runtimeSnapshot(event.metadata);
        if (!snapshot) continue;
        const currentIndex = rollout?.findIndex((record, index) => index >= Math.max(0, cursor) && sameUsage(record.total, snapshot.usage)) ?? -1;
        if (!candidateIds.has(event.id)) {
          if (currentIndex >= 0) cursor = currentIndex;
          continue;
        }
        if (!rollout) {
          skipped.push({ eventId: event.id, reason: "rollout_not_found" });
          continue;
        }
        if (currentIndex < 0) {
          skipped.push({ eventId: event.id, reason: "cumulative_snapshot_not_found" });
          continue;
        }
        const invocations = rollout.slice(cursor + 1, currentIndex + 1);
        const total = sumUsage(invocations);
        if (
          total.inputTokens !== event.inputTokens ||
          total.cachedInputTokens !== event.cachedInputTokens ||
          total.outputTokens !== event.outputTokens
        ) {
          skipped.push({ eventId: event.id, reason: "invocation_totals_do_not_match_event" });
          cursor = currentIndex;
          continue;
        }
        const profile = historicalProfile(event.metadata);
        if (!profile) {
          skipped.push({ eventId: event.id, reason: "historical_cost_profile_missing" });
          cursor = currentIndex;
          continue;
        }
        const costProfileMetadata = asRecord(asRecord(event.metadata)?._costProfile);
        const cacheWriteTelemetryAvailable = costProfileMetadata?.costCompleteness !== "upper_bound_missing_cache_write_tokens";
        const correction = calculateEstimatedCost({
          profile,
          inputTokens: event.inputTokens,
          cachedInputTokens: event.cachedInputTokens,
          cacheWriteTokens: event.cacheWriteTokens,
          outputTokens: event.outputTokens,
          cacheWriteTelemetryAvailable,
          modelInvocations: invocations.map((record) => ({ ...record.last, modelContextWindow: record.modelContextWindow })),
          longContextPricingBasis: "model_invocation"
        });
        const oldEstimatedCost = Number(event.estimatedCost).toFixed(6);
        const oldInternalCost = Number(event.internalCost).toFixed(6);
        const metadata = updateCostMetadata({
          metadata: event.metadata,
          correction,
          oldEstimatedCost,
          oldInternalCost,
          estimatedCost: correction.estimatedCost,
          internalCost: correction.internalCost,
          invocationCount: invocations.length,
          correctedAt
        });
        corrections.push({
          event,
          metadata,
          estimatedCost: correction.estimatedCost,
          internalCost: correction.internalCost,
          oldEstimatedCost,
          invocationCount: invocations.length,
          maxInvocationInputTokens: correction.maxInvocationInputTokens,
          longContextInvocationCount: correction.longContextInvocationCount
        });
        cursor = currentIndex;
      }
    }

    const foundCandidateIds = new Set([...corrections.map((item) => item.event.id), ...skipped.map((item) => item.eventId)]);
    for (const candidate of candidates) {
      if (!foundCandidateIds.has(candidate.id)) skipped.push({ eventId: candidate.id, reason: "thread_event_sequence_missing" });
    }

    const summary = new Map<string, { events: number; oldCost: number; newCost: number; longInvocations: number; maxInput: number }>();
    for (const correction of corrections) {
      const key = `${localDay(correction.event.createdAt)}|${correction.event.model}`;
      const current = summary.get(key) ?? { events: 0, oldCost: 0, newCost: 0, longInvocations: 0, maxInput: 0 };
      current.events += 1;
      current.oldCost += Number(correction.oldEstimatedCost);
      current.newCost += Number(correction.estimatedCost);
      current.longInvocations += correction.longContextInvocationCount;
      current.maxInput = Math.max(current.maxInput, correction.maxInvocationInputTokens);
      summary.set(key, current);
    }

    console.log(`mode|${options.apply ? "apply" : "dry-run"}`);
    console.log(`range|${options.from.toISOString()}..${options.to.toISOString()}`);
    console.log(`candidate_events|${candidates.length}`);
    console.log(`matched_events|${corrections.length}`);
    console.log(`skipped_events|${skipped.length}`);
    console.log(`rollout_threads|${rolloutByThread.size}/${candidateThreadIds.size}`);
    for (const [key, value] of [...summary.entries()].sort()) {
      console.log(`summary|${key}|events=${value.events}|old=${value.oldCost.toFixed(6)}|new=${value.newCost.toFixed(6)}|delta=${(value.newCost - value.oldCost).toFixed(6)}|long_invocations=${value.longInvocations}|max_input=${value.maxInput}`);
    }
    const skippedByReason = skipped.reduce((counts, item) => {
      counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
      return counts;
    }, new Map<string, number>());
    for (const [reason, count] of skippedByReason) {
      console.log(`skipped|${reason}|${count}`);
    }

    if (options.apply && skipped.length > 0) {
      throw new Error(`Refusing to apply with ${skipped.length} unreconciled candidate events`);
    }
    if (!options.apply) return;

    await db.$transaction(async (tx) => {
      for (const correction of corrections) {
        await tx.usageEvent.update({
          where: { id: correction.event.id },
          data: {
            estimatedCost: correction.estimatedCost,
            internalCost: correction.internalCost,
            metadata: correction.metadata as Prisma.InputJsonValue
          }
        });
      }
    }, { timeout: 60_000 });
    await rebuildRollups(db, corrections);
    console.log(`updated_events|${corrections.length}`);
    console.log("rollups_rebuilt|true");
  } finally {
    await db.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
