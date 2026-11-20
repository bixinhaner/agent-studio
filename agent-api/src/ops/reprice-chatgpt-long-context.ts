import fs from "node:fs/promises";

import { Prisma, type PrismaClient } from "@prisma/client";

import { createDbClient } from "../db/client.js";
import { calculateEstimatedCost } from "../operations/usage-ingestion-service.js";
import { timeOfDayPricingFromMetadata } from "../operations/time-of-day-pricing.js";
import { UsageRollupService } from "../operations/usage-rollup-service.js";
import type { CostProfileRecord } from "../persistence/cost-profile-repository.js";
import { UsageEventRepository, type UsageEventRecord, type UsageEventRepositoryDb } from "../persistence/usage-event-repository.js";
import { UsageRollupRepository, type UsageRollupRepositoryDb } from "../persistence/usage-rollup-repository.js";

/**
 * Removes OpenAI's long-context surcharge from usage that Codex ran on the ChatGPT sign-in, which is
 * charged at the standard rate at any context length. Each event keeps the prices it was recorded with;
 * only the surcharge goes. An event is changed only when its recorded cost is reproduced from its own
 * price snapshot first, so a later correction is never overwritten by guesswork.
 *
 *   --dry-run (default)        print what would change
 *   --apply --backup <file>    write the original rows to <file> (must not exist), then update
 *   --restore <file>           put back the rows a backup holds
 * Affected UTC daily rollups are rebuilt after --apply and --restore.
 */

type CliOptions =
  | { mode: "dry-run" | "apply"; from: Date; to: Date; backup?: string }
  | { mode: "restore"; backup: string };

type BackupRow = { id: string; estimatedCost: string; internalCost: string; metadata: unknown; createdAt: string; organizationId: string | null };

const money = (value: string) => Number(value).toFixed(6);

const REASON = "chatgpt_sign_in_no_long_context_surcharge";
const API_PROVIDERS = new Set(["openai_api", "azure_openai"]);

function usage(): never {
  console.error([
    "Usage: node --env-file=.env dist/ops/reprice-chatgpt-long-context.js --from <ISO> [--to <ISO>] [--dry-run | --apply --backup <file>]",
    "       node --env-file=.env dist/ops/reprice-chatgpt-long-context.js --restore <file>"
  ].join("\n"));
  process.exit(2);
}

function parseArgs(argv: string[]): CliOptions {
  let mode: "dry-run" | "apply" | "restore" = "dry-run";
  let from: Date | undefined;
  let to = new Date();
  let backup: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--dry-run") mode = "dry-run";
    else if (arg === "--apply") mode = "apply";
    else if (arg === "--restore" && value) { mode = "restore"; backup = value; index += 1; }
    else if (arg === "--backup" && value) { backup = value; index += 1; }
    else if (arg === "--from" && value) { from = new Date(value); index += 1; }
    else if (arg === "--to" && value) { to = new Date(value); index += 1; }
    else usage();
  }
  if (mode === "restore") return backup ? { mode, backup } : usage();
  if (!from || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) usage();
  if (mode === "apply" && !backup) usage();
  return { mode, from, to, backup };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** The prices the event was recorded with. */
function recordedProfile(cost: Record<string, unknown>): CostProfileRecord | undefined {
  const id = text(cost.profileId);
  const model = text(cost.model);
  const inputTokenPrice = text(cost.inputTokenPrice);
  const cachedInputTokenPrice = text(cost.cachedInputTokenPrice);
  const outputTokenPrice = text(cost.outputTokenPrice);
  if (cost.matched !== true || !id || !model || !inputTokenPrice || !cachedInputTokenPrice || !outputTokenPrice) return undefined;
  return {
    id,
    organizationId: text(cost.organizationId),
    model,
    inputTokenPrice,
    cachedInputTokenPrice,
    cacheWriteTokenPrice: text(cost.cacheWriteTokenPrice) ?? "0",
    outputTokenPrice,
    longContextThresholdTokens: count(cost.longContextThresholdTokens) || undefined,
    longContextInputMultiplier: text(cost.longContextInputMultiplier) ?? "1",
    longContextOutputMultiplier: text(cost.longContextOutputMultiplier) ?? "1",
    internalCostMultiplier: text(cost.internalCostMultiplier) ?? "1",
    timeOfDayPricing: timeOfDayPricingFromMetadata(cost),
    isActive: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
}

function recordedInvocations(metadata: Record<string, unknown>) {
  const invocations = asRecord(metadata._usageAccounting)?.invocations;
  if (!Array.isArray(invocations)) return undefined;
  return invocations.map((item) => {
    const invocation = asRecord(item) ?? {};
    return {
      inputTokens: count(invocation.inputTokens),
      cachedInputTokens: count(invocation.cachedInputTokens),
      cacheWriteTokens: count(invocation.cacheWriteTokens),
      outputTokens: count(invocation.outputTokens)
    };
  });
}

type Plan = { event: UsageEventRecord; estimatedCost: string; internalCost: string; metadata: Record<string, unknown> };
type Skip = { event: UsageEventRecord; reason: string; detail?: string };

function planEvent(event: UsageEventRecord, correctedAt: string): Plan | Skip {
  const metadata = asRecord(event.metadata) ?? {};
  const cost = asRecord(metadata._costProfile);
  if (!cost) return { event, reason: "cost_profile_missing" };
  if (cost.billing !== undefined) return { event, reason: "billing_already_recorded" };
  if (API_PROVIDERS.has(text(metadata.provider) ?? "")) return { event, reason: "api_provider" };
  const profile = recordedProfile(cost);
  if (!profile) return { event, reason: "price_snapshot_missing" };
  const basis = cost.longContextPricingBasis === "model_invocation" ? "model_invocation" : "aggregate_request";
  const priced = (billing: "chatgpt" | "api") => calculateEstimatedCost({
    profile,
    inputTokens: event.inputTokens,
    cachedInputTokens: event.cachedInputTokens,
    cacheWriteTokens: event.cacheWriteTokens ?? 0,
    cacheWriteTelemetryAvailable: cost.costCompleteness !== "upper_bound_missing_cache_write_tokens",
    outputTokens: event.outputTokens,
    modelInvocations: basis === "model_invocation" ? recordedInvocations(metadata) : undefined,
    longContextPricingBasis: basis,
    pricedAt: new Date(event.createdAt),
    billing
  });
  const oldEstimatedCost = money(event.estimatedCost);
  const reproduced = priced("api");
  if (reproduced.estimatedCost !== oldEstimatedCost) {
    return { event, reason: "recorded_cost_not_reproduced", detail: `recorded=${oldEstimatedCost}|reproduced=${reproduced.estimatedCost}` };
  }
  const corrected = priced("chatgpt");
  const previousCorrection = metadata._usageCorrection;
  return {
    event,
    estimatedCost: corrected.estimatedCost,
    internalCost: corrected.internalCost,
    metadata: {
      ...metadata,
      _costProfile: { ...cost, billing: "chatgpt", longContextApplied: false, longContextInvocationCount: 0 },
      _usageCorrection: {
        version: 1,
        reason: REASON,
        correctedAt,
        oldEstimatedCost,
        estimatedCost: corrected.estimatedCost,
        oldInternalCost: money(event.internalCost),
        internalCost: corrected.internalCost,
        ...(previousCorrection ? { previous: previousCorrection } : {})
      }
    }
  };
}

async function rebuildRollups(db: PrismaClient, events: Array<{ createdAt: string; organizationId?: string | null }>): Promise<void> {
  const service = new UsageRollupService({
    usageEvents: new UsageEventRepository(db as unknown as UsageEventRepositoryDb),
    rollups: new UsageRollupRepository(db as unknown as UsageRollupRepositoryDb)
  });
  const targets = new Map<string, { rollupDate: string; organizationId: string | null }>();
  for (const event of events) {
    const rollupDate = new Date(event.createdAt).toISOString().slice(0, 10);
    const organizationId = event.organizationId ?? null;
    targets.set(`${rollupDate}:${organizationId ?? "global"}`, { rollupDate, organizationId });
  }
  for (const target of targets.values()) await service.rebuildDaily(target);
  console.log(`rollups_rebuilt|${targets.size}`);
}

async function updateInBatches(db: PrismaClient, rows: Array<{ id: string; estimatedCost: string; internalCost: string; metadata: unknown }>): Promise<void> {
  for (let start = 0; start < rows.length; start += 200) {
    const batch = rows.slice(start, start + 200);
    await db.$transaction(batch.map((row) => db.usageEvent.update({
      where: { id: row.id },
      data: { estimatedCost: row.estimatedCost, internalCost: row.internalCost, metadata: row.metadata as Prisma.InputJsonValue }
    })));
  }
}

async function restore(db: PrismaClient, file: string): Promise<void> {
  const rows = (await fs.readFile(file, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as BackupRow);
  await updateInBatches(db, rows);
  console.log(`restored_events|${rows.length}`);
  await rebuildRollups(db, rows);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const db = createDbClient();
  try {
    if (options.mode === "restore") {
      await restore(db, options.backup);
      return;
    }
    const events = (await new UsageEventRepository(db as unknown as UsageEventRepositoryDb)
      .listByExactCreatedAtRange({ from: options.from, to: options.to }))
      .filter((event) => asRecord(asRecord(event.metadata)?._costProfile)?.longContextApplied === true);
    const correctedAt = new Date().toISOString();
    const outcomes = events.map((event) => planEvent(event, correctedAt));
    const plans = outcomes.filter((item): item is Plan => "estimatedCost" in item);
    const skips = outcomes.filter((item): item is Skip => "reason" in item);

    const sum = (values: string[]) => values.reduce((total, value) => total + Number(value), 0).toFixed(6);
    console.log(`mode|${options.mode}`);
    console.log(`range|${options.from.toISOString()}..${options.to.toISOString()}`);
    console.log(`candidates|${events.length}|planned=${plans.length}|skipped=${skips.length}`);
    console.log(`estimated|old=${sum(plans.map((p) => p.event.estimatedCost))}|new=${sum(plans.map((p) => p.estimatedCost))}`);
    console.log(`internal|old=${sum(plans.map((p) => p.event.internalCost))}|new=${sum(plans.map((p) => p.internalCost))}`);
    const byModel = new Map<string, { events: number; old: number; next: number }>();
    for (const plan of plans) {
      const entry = byModel.get(plan.event.model) ?? { events: 0, old: 0, next: 0 };
      entry.events += 1;
      entry.old += Number(plan.event.estimatedCost);
      entry.next += Number(plan.estimatedCost);
      byModel.set(plan.event.model, entry);
    }
    for (const [model, entry] of [...byModel].sort()) {
      console.log(`model|${model}|events=${entry.events}|old=${entry.old.toFixed(6)}|new=${entry.next.toFixed(6)}`);
    }
    const reasons = new Map<string, number>();
    for (const skip of skips) reasons.set(skip.reason, (reasons.get(skip.reason) ?? 0) + 1);
    for (const [reason, total] of reasons) console.log(`skipped|${reason}|${total}`);
    for (const skip of skips.slice(0, 20)) console.log(`skipped_detail|${skip.event.id}|${skip.reason}${skip.detail ? `|${skip.detail}` : ""}`);
    if (options.mode !== "apply" || plans.length === 0) return;

    const backup: BackupRow[] = plans.map(({ event }) => ({
      id: event.id,
      estimatedCost: money(event.estimatedCost),
      internalCost: money(event.internalCost),
      metadata: event.metadata ?? null,
      createdAt: event.createdAt,
      organizationId: event.organizationId ?? null
    }));
    await fs.writeFile(options.backup!, backup.map((row) => JSON.stringify(row)).join("\n") + "\n", { flag: "wx", mode: 0o600 });
    console.log(`backup|${options.backup}|${backup.length}`);
    await updateInBatches(db, plans.map((plan) => ({
      id: plan.event.id, estimatedCost: plan.estimatedCost, internalCost: plan.internalCost, metadata: plan.metadata
    })));
    console.log(`updated_events|${plans.length}`);
    await rebuildRollups(db, plans.map((plan) => plan.event));
  } finally {
    await db.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
