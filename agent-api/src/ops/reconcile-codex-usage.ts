import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma } from "@prisma/client";
import { createDbClient } from "../db/client.js";
import { calculateEstimatedCost } from "../operations/usage-ingestion-service.js";
import { readRolloutUsage, sumInvocations, usageHash, type RolloutTurnUsage } from "../operations/codex-usage-ledger.js";
import { UsageRollupService } from "../operations/usage-rollup-service.js";
import { UsageEventRepository } from "../persistence/usage-event-repository.js";
import { UsageRollupRepository } from "../persistence/usage-rollup-repository.js";
import type { CostProfileRecord } from "../persistence/cost-profile-repository.js";

export function historicalProfile(metadata: any): CostProfileRecord | undefined {
  const c = metadata?._costProfile;
  if (!c?.matched || !c.profileId || !c.model || c.inputTokenPrice === undefined || c.cachedInputTokenPrice === undefined || c.outputTokenPrice === undefined) return undefined;
  return {
    id: c.profileId, model: c.model, organizationId: c.organizationId,
    inputTokenPrice: String(c.inputTokenPrice), cachedInputTokenPrice: String(c.cachedInputTokenPrice),
    cacheWriteTokenPrice: String(c.cacheWriteTokenPrice ?? 0), outputTokenPrice: String(c.outputTokenPrice),
    internalCostMultiplier: String(c.internalCostMultiplier ?? 1),
    longContextThresholdTokens: c.longContextThresholdTokens,
    longContextInputMultiplier: String(c.longContextInputMultiplier ?? 1),
    longContextOutputMultiplier: String(c.longContextOutputMultiplier ?? 1),
    isActive: true, createdAt: "1970-01-01T00:00:00Z", updatedAt: "1970-01-01T00:00:00Z"
  };
}

export function matchTurn(event: any, turns: RolloutTurnUsage[]): RolloutTurnUsage | undefined {
  const meta = event.metadata;
  const explicit = meta?._usageAccounting?.turnId;
  if (explicit) return turns.find(t => t.id === explicit);
  const s = meta?._codexRuntimeUsage;
  const total = s?.kind === "turn_delta" ? s.cumulative : s;
  if (!total) return undefined;
  const at = new Date(event.createdAt).getTime();
  const matches = turns.filter(t => t.endedAt && Math.abs(new Date(t.endedAt).getTime() - at) <= 120_000 && t.snapshots.some(r =>
    r.inputTokens === total.inputTokens && r.cachedInputTokens === total.cachedInputTokens && r.outputTokens === total.outputTokens));
  return matches.length === 1 ? matches[0] : undefined;
}

export function correctionFor(event: any, turn: RolloutTurnUsage): { data?: any; blocked?: string } {
  if (event.metadata?._usageAccounting?.turnIds?.length > 1) return { blocked: "multi_turn_business_record" };
  if (turn.blocked) return { blocked: turn.blocked };
  if (!turn.model || turn.model !== event.model) return { blocked: "model_mismatch" };
  const profile = historicalProfile(event.metadata);
  if (!profile) return { blocked: "historical_price_missing" };
  const usage = sumInvocations(turn.invocations);
  const priced = calculateEstimatedCost({ profile, ...usage, cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    cacheWriteTelemetryAvailable: usage.cacheWriteTokens !== undefined, modelInvocations: turn.invocations, longContextPricingBasis: "model_invocation" });
  return { data: {
    ...usage, cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    estimatedCost: priced.estimatedCost, internalCost: priced.internalCost,
    metadata: { ...event.metadata,
      _costProfile: { ...event.metadata._costProfile,
        longContextApplied: priced.longContextApplied, longContextInvocationCount: priced.longContextInvocationCount,
        maxInvocationInputTokens: priced.maxInvocationInputTokens, longContextPricingBasis: priced.longContextPricingBasis,
        longContextPricingComplete: priced.longContextPricingComplete,
        costCompleteness: Number(profile.cacheWriteTokenPrice) > 0 && usage.cacheWriteTokens === undefined ? "upper_bound_missing_cache_write_tokens" : "complete" },
      _usageAccounting: { version: 1, status: "complete", source: turn.source, turnId: turn.id, invocations: turn.invocations }
    }
  } };
}

const editable = ["inputTokens", "cachedInputTokens", "cacheWriteTokens", "outputTokens", "estimatedCost", "internalCost", "metadata"] as const;
const selectBefore = (event: any) => Object.fromEntries(editable.map(k => [k, k === "estimatedCost" || k === "internalCost" ? Number(event[k]).toFixed(6) : event[k]]));
const numericChanged = (event: any, data: any) => editable.filter(k => k !== "metadata").some(k => {
  const difference = Math.abs(Number(event[k] ?? 0) - Number(data[k] ?? 0));
  return k === "estimatedCost" || k === "internalCost" ? difference > 0.0000011 : difference !== 0;
});
async function writeJson(file: string, value: any) {
  await fs.writeFile(file, JSON.stringify(value, null, 2), { mode: 0o600 });
}

async function indexRollouts(root: string, wanted: Set<string>): Promise<Map<string, string[]>> {
  const index = new Map<string, string[]>();
  const scan = async (dir: string, inSessions: boolean, depth: number): Promise<void> => {
    if (!inSessions && depth > 5) return;
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !["tmp", "workspaces", "skills", "node_modules", ".git", "memories", "shell_snapshots", "logs"].includes(entry.name)) {
        await scan(path.join(dir, entry.name), inSessions || entry.name === "sessions" || entry.name === "archived_sessions", depth + 1);
      } else if (inSessions && entry.isFile() && entry.name.endsWith(".jsonl")) {
        const id = entry.name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i)?.[1];
        if (id && wanted.has(id)) index.set(id, [...(index.get(id) ?? []), path.join(dir, entry.name)]);
      }
    }
  };
  await scan(root, false, 0);
  return index;
}

async function rebuild(db: any, rows: any[]) {
  const service = new UsageRollupService({ usageEvents: new UsageEventRepository(db), rollups: new UsageRollupRepository(db) });
  const targets = new Map<string, any>();
  for (const r of rows) {
    const target = { organizationId: r.organizationId ?? null, rollupDate: new Date(r.createdAt).toISOString().slice(0, 10) };
    targets.set(JSON.stringify(target), target);
  }
  for (const target of targets.values()) await service.rebuildDaily(target);
  return targets.size;
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag: string) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  const applyFile = value("--apply-plan");
  const rollbackFile = value("--rollback-plan");
  const output = path.resolve(value("--output") ?? "temp/usage-reconciliation");
  const db = createDbClient();
  try {
    if (applyFile || rollbackFile) {
      const plan = JSON.parse(await fs.readFile(applyFile ?? rollbackFile!, "utf8"));
      const { digest, ...payload } = plan;
      if (digest !== usageHash(payload)) throw new Error("plan digest mismatch");
      if (plan.version !== 1 || !Array.isArray(plan.corrections)) throw new Error("invalid plan");
      await fs.mkdir(output, { recursive: true, mode: 0o700 });
      let applied = 0, unchanged = 0;
      // Check the whole plan before the first write; each batch repeats CAS checks.
      for (const c of plan.corrections) {
        const row = await db.usageEvent.findUniqueOrThrow({ where: { id: c.id } });
        const hash = usageHash(selectBefore(JSON.parse(JSON.stringify(row))));
        if (hash !== usageHash(c.before) && hash !== usageHash(c.after)) throw new Error(`record changed since plan: ${c.id}`);
      }
      for (let start = 0; start < plan.corrections.length; start += 50) {
        await db.$transaction(async tx => {
          await tx.$queryRawUnsafe('SELECT 1::int AS "locked" FROM pg_advisory_xact_lock(hashtextextended($1, 0))', "usage-reconciliation-v1");
          for (const c of plan.corrections.slice(start, start + 50)) {
            await tx.$queryRawUnsafe('SELECT id FROM usage_events WHERE id = $1 FOR UPDATE', c.id);
            const row = await tx.usageEvent.findUniqueOrThrow({ where: { id: c.id } });
            const current = usageHash(selectBefore(JSON.parse(JSON.stringify(row))));
            const before = rollbackFile ? c.after : c.before;
            const after = rollbackFile ? c.before : c.after;
            if (current === usageHash(after)) { unchanged++; continue; }
            if (current !== usageHash(before)) throw new Error(`concurrent record change: ${c.id}`);
            await tx.usageEvent.update({ where: { id: c.id }, data: after as Prisma.UsageEventUpdateInput });
            applied++;
          }
        }, { timeout: 60_000 });
        console.log(JSON.stringify({ progress: Math.min(start + 50, plan.corrections.length), applied, unchanged }));
      }
      const rollups = await rebuild(db, plan.corrections);
      const result = { digest, mode: rollbackFile ? "rollback" : "apply", applied, unchanged, rollups };
      await writeJson(path.join(output, `${rollbackFile ? "rollback" : "apply"}-result.json`), result);
      console.log(JSON.stringify(result));
      return;
    }
    const from = new Date(value("--from") ?? "2026-06-10T16:00:00Z");
    const to = new Date(value("--to") ?? new Date().toISOString());
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) throw new Error("invalid time range");
    const root = path.resolve(value("--homes") ?? "temp/codex-homes");
    const events = JSON.parse(JSON.stringify(await new UsageEventRepository(db as any).listByExactCreatedAtRange({ from, to }))) as any[];
    const groups = new Map<string, any[]>();
    const blocked: any[] = [];
    for (const event of events) {
      const id = event.metadata?._codexRuntimeUsage?.codexThreadId ?? event.metadata?.codexThreadId;
      if (id) groups.set(id, [...(groups.get(id) ?? []), event]);
    }
    const files = await indexRollouts(root, new Set(groups.keys()));
    const corrections: any[] = [];
    const daily: Record<string, any> = {};
    let processed = 0, matched = 0;
    for (const [threadId, rows] of groups) {
      const candidates = files.get(threadId) ?? [];
      const merged = new Map<string, RolloutTurnUsage>();
      for (const file of candidates) {
        const parsed = await readRolloutUsage(file);
        for (const [id, turn] of parsed) {
          const previous = merged.get(id);
          if (previous && usageHash(previous.invocations) !== usageHash(turn.invocations)) {
            previous.blocked = "divergent_rollout_copies";
          } else merged.set(id, previous ?? turn);
        }
      }
      const matches = new Map<string, RolloutTurnUsage | undefined>();
      const owners = new Map<string, number>();
      for (const row of rows) {
        const turn = matchTurn(row, [...merged.values()]);
        matches.set(row.id, turn);
        if (turn) owners.set(turn.id, (owners.get(turn.id) ?? 0) + 1);
      }
      for (const row of rows) {
        const turn = matches.get(row.id);
        const result = !turn ? { blocked: candidates.length ? "no_unique_turn_match" : "rollout_missing" }
          : owners.get(turn.id)! > 1 ? { blocked: "multiple_business_rows_for_turn" } : correctionFor(row, turn);
        if (!result.data) { blocked.push({ id: row.id, createdAt: row.createdAt, model: row.model, reason: result.blocked }); continue; }
        matched++;
        if (!numericChanged(row, result.data)) continue;
        const after = result.data;
        after.metadata._usageReconciliation = { version: 1, sourceHash: usageHash(turn!.invocations), turnId: turn!.id, originalHash: usageHash(selectBefore(row)) };
        corrections.push({ id: row.id, organizationId: row.organizationId, createdAt: row.createdAt, model: row.model, before: selectBefore(row), after, files: candidates });
        const day = new Date(new Date(row.createdAt).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
        const key = `${day}/${row.model}`;
        const agg = daily[key] ??= { day, model: row.model, events: 0, oldCost: 0, newCost: 0, oldTokens: 0, newTokens: 0 };
        agg.events++; agg.oldCost += Number(row.estimatedCost); agg.newCost += Number(after.estimatedCost);
        agg.oldTokens += row.inputTokens + row.outputTokens; agg.newTokens += after.inputTokens + after.outputTokens;
      }
      if (++processed % 100 === 0) console.log(JSON.stringify({ threads: processed, total: groups.size, matched, corrections: corrections.length, blocked: blocked.length }));
    }
    await fs.mkdir(output, { recursive: true, mode: 0o700 });
    const plan = { version: 1, from: from.toISOString(), to: to.toISOString(), createdAt: new Date().toISOString(), corrections };
    await writeJson(path.join(output, "plan.json"), { ...plan, digest: usageHash(plan) });
    await writeJson(path.join(output, "blocked.json"), blocked);
    const summary = { scanned: events.length, threads: groups.size, matched, corrections: corrections.length,
      blocked: blocked.length, reasons: blocked.reduce((out, r) => ({ ...out, [r.reason]: (out[r.reason] ?? 0) + 1 }), {} as Record<string, number>),
      oldCost: corrections.reduce((n, c) => n + Number(c.before.estimatedCost), 0),
      newCost: corrections.reduce((n, c) => n + Number(c.after.estimatedCost), 0), daily: Object.values(daily) };
    await writeJson(path.join(output, "summary.json"), summary);
    console.log(JSON.stringify({ ...summary, daily: undefined }));
  } finally { await db.$disconnect(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
