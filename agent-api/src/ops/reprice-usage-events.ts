import { Prisma, type PrismaClient } from "@prisma/client";

import { createDbClient } from "../db/client.js";
import { calculateEstimatedCost } from "../operations/usage-ingestion-service.js";
import { UsageRollupService } from "../operations/usage-rollup-service.js";
import { CostProfileRepository, type CostProfileRepositoryDb } from "../persistence/cost-profile-repository.js";
import { UsageEventRepository, type UsageEventRepositoryDb } from "../persistence/usage-event-repository.js";
import { UsageRollupRepository, type UsageRollupRepositoryDb } from "../persistence/usage-rollup-repository.js";

/**
 * Reprices one model's usage events in a time range with the model's current active global cost profile
 * (list prices, internal multiplier and peak/off-peak pricing, each event at its own created_at), then
 * rebuilds the affected UTC daily rollups. Used after a cost profile is corrected. Profiles with
 * long-context pricing are refused: their per-invocation pricing needs rollout data, see
 * backfill-codex-long-context-costs.ts.
 */

type CliOptions = { apply: boolean; model: string; from: Date; to: Date };

function usage(): never {
  console.error("Usage: node dist/ops/reprice-usage-events.js --model <model> --from <ISO> [--to <ISO>] [--dry-run|--apply]");
  process.exit(2);
}

function parseArgs(argv: string[]): CliOptions {
  const out: Partial<CliOptions> = { apply: false, to: new Date() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--dry-run") out.apply = false;
    else if (arg === "--apply") out.apply = true;
    else if (arg === "--model" && value) { out.model = value; index += 1; }
    else if (arg === "--from" && value) { out.from = new Date(value); index += 1; }
    else if (arg === "--to" && value) { out.to = new Date(value); index += 1; }
    else usage();
  }
  if (!out.model || !out.from || Number.isNaN(out.from.getTime()) || Number.isNaN(out.to!.getTime()) || out.to! <= out.from) usage();
  return out as CliOptions;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const db = createDbClient();
  try {
    const profile = await new CostProfileRepository(db as unknown as CostProfileRepositoryDb).getActiveByModel({ model: options.model });
    if (!profile || profile.organizationId) throw new Error(`No active global cost profile for ${options.model}`);
    if (profile.longContextThresholdTokens) throw new Error(`${profile.id} has long-context pricing; reprice it with the rollout backfill`);
    const events = (await new UsageEventRepository(db as unknown as UsageEventRepositoryDb)
      .listByExactCreatedAtRange({ from: options.from, to: options.to }))
      .filter((event) => event.model === options.model);
    const correctedAt = new Date().toISOString();
    const changes = events.map((event) => {
      const metadata = asRecord(event.metadata);
      const oldCost = asRecord(metadata._costProfile);
      const pricing = calculateEstimatedCost({
        profile,
        inputTokens: event.inputTokens,
        cachedInputTokens: event.cachedInputTokens,
        cacheWriteTokens: event.cacheWriteTokens ?? 0,
        outputTokens: event.outputTokens,
        cacheWriteTelemetryAvailable: oldCost.costCompleteness !== "upper_bound_missing_cache_write_tokens",
        pricedAt: new Date(event.createdAt)
      });
      const nextMetadata = {
        ...metadata,
        _costProfile: {
          ...oldCost,
          version: 3,
          matched: true,
          profileId: profile.id,
          organizationId: profile.organizationId,
          model: profile.model,
          inputTokenPrice: profile.inputTokenPrice,
          cachedInputTokenPrice: profile.cachedInputTokenPrice,
          cacheWriteTokenPrice: profile.cacheWriteTokenPrice,
          outputTokenPrice: profile.outputTokenPrice,
          internalCostMultiplier: profile.internalCostMultiplier,
          ...(profile.timeOfDayPricing
            ? { timeOfDayPricing: profile.timeOfDayPricing, pricingPeriod: pricing.pricingPeriod, timeOfDayMultiplier: pricing.timeOfDayMultiplier }
            : {})
        },
        _usageCorrection: {
          version: 1,
          reason: "cost_profile_reprice",
          correctedAt,
          oldEstimatedCost: Number(event.estimatedCost).toFixed(6),
          estimatedCost: pricing.estimatedCost,
          oldInternalCost: Number(event.internalCost).toFixed(6),
          internalCost: pricing.internalCost
        }
      };
      return { event, pricing, metadata: nextMetadata };
    });

    const sum = (values: Array<string | number>) => values.reduce<number>((total, value) => total + Number(value), 0).toFixed(6);
    console.log(`mode|${options.apply ? "apply" : "dry-run"}`);
    console.log(`profile|${profile.id}|internal_multiplier=${profile.internalCostMultiplier}|time_of_day=${profile.timeOfDayPricing ? "yes" : "no"}`);
    console.log(`range|${options.from.toISOString()}..${options.to.toISOString()}`);
    console.log(`events|${changes.length}|peak=${changes.filter((c) => c.pricing.pricingPeriod === "peak").length}|off_peak=${changes.filter((c) => c.pricing.pricingPeriod === "off_peak").length}`);
    console.log(`estimated|old=${sum(changes.map((c) => c.event.estimatedCost))}|new=${sum(changes.map((c) => c.pricing.estimatedCost))}`);
    console.log(`internal|old=${sum(changes.map((c) => c.event.internalCost))}|new=${sum(changes.map((c) => c.pricing.internalCost))}`);
    if (!options.apply) return;

    await db.$transaction(async (tx) => {
      for (const change of changes) {
        await tx.usageEvent.update({
          where: { id: change.event.id },
          data: {
            estimatedCost: change.pricing.estimatedCost,
            internalCost: change.pricing.internalCost,
            metadata: change.metadata as Prisma.InputJsonValue
          }
        });
      }
    }, { timeout: 60_000 });
    await rebuildRollups(db, changes.map((change) => change.event));
    console.log(`updated_events|${changes.length}`);
  } finally {
    await db.$disconnect();
  }
}

async function rebuildRollups(db: PrismaClient, events: Array<{ createdAt: string | Date; organizationId?: string | null }>): Promise<void> {
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
  for (const target of targets.values()) {
    await service.rebuildDaily(target);
    console.log(`rollup_rebuilt|${target.rollupDate}|${target.organizationId ?? "global"}`);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
