import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

export type InvocationUsage = {
  key: string;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens?: number;
  outputTokens: number;
  model?: string;
};
export type RolloutTurnUsage = {
  id: string;
  threadId: string;
  model?: string;
  startedAt?: string;
  endedAt?: string;
  invocations: InvocationUsage[];
  snapshots: Array<{ at: string; inputTokens: number; cachedInputTokens: number; outputTokens: number }>;
  source: "response_id" | "legacy_token_count";
  blocked?: string;
};
function stable(value: any): any {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
export const usageHash = (value: unknown): string => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
export const usageTurnKey = (threadId: string, turnId: string): string => `codex-turn-${usageHash([threadId, turnId])}`;

export function parseInvocation(value: any): Omit<InvocationUsage, "key"> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const token = (v: unknown): number | undefined => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
  const inputTokens = token(value.input_tokens);
  const cachedInputTokens = token(value.cached_input_tokens);
  const outputTokens = token(value.output_tokens);
  const cacheWriteTokens = token(value.cache_write_tokens ?? value.cache_write_input_tokens);
  if (inputTokens === undefined || cachedInputTokens === undefined || outputTokens === undefined || cachedInputTokens > inputTokens) return undefined;
  if (cacheWriteTokens !== undefined && cacheWriteTokens > inputTokens - cachedInputTokens) return undefined;
  return { inputTokens, cachedInputTokens, outputTokens, ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }) };
}

export function sumInvocations(calls: Array<Omit<InvocationUsage, "key">>): Omit<InvocationUsage, "key"> {
  return {
    inputTokens: calls.reduce((n, c) => n + c.inputTokens, 0),
    cachedInputTokens: calls.reduce((n, c) => n + c.cachedInputTokens, 0),
    outputTokens: calls.reduce((n, c) => n + c.outputTokens, 0),
    ...(calls.every(c => c.cacheWriteTokens !== undefined)
      ? { cacheWriteTokens: calls.reduce((n, c) => n + c.cacheWriteTokens!, 0) } : {})
  };
}

// Keep task boundaries and response IDs. Counter decreases alone never identify a new call.
export async function parseRolloutUsage(lines: AsyncIterable<string>): Promise<Map<string, RolloutTurnUsage>> {
  let threadId = "";
  let currentTurn = "";
  let model: string | undefined;
  const turns = new Map<string, RolloutTurnUsage>();
  const active = new Set<string>();
  const canonical = new Map<string, Map<string, InvocationUsage>>();
  const legacy = new Map<string, Map<string, InvocationUsage>>();
  const legacyOwners = new Map<string, string>();
  const get = (id: string) => {
    if (!turns.has(id)) turns.set(id, { id, threadId, invocations: [], snapshots: [], source: "legacy_token_count" });
    return turns.get(id)!;
  };
  for await (const line of lines) {
    let row: any;
    try { row = JSON.parse(line); } catch { if (line.trim() && currentTurn) get(currentTurn).blocked = "invalid_json_record"; continue; }
    const p = row.payload ?? {};
    if (row.type === "session_meta") threadId = p.id ?? threadId;
    if (row.type === "event_msg" && p.type === "task_started" && p.turn_id) {
      currentTurn = p.turn_id;
      active.add(currentTurn);
      get(currentTurn).startedAt = row.timestamp;
    }
    if (row.type === "turn_context") {
      currentTurn = p.turn_id ?? currentTurn;
      model = p.model ?? model;
      if (currentTurn) get(currentTurn).model = model;
    }
    if (row.type === "event_msg" && ["task_complete", "turn_aborted"].includes(p.type) && p.turn_id) {
      get(p.turn_id).endedAt = row.timestamp;
      active.delete(p.turn_id);
    }
    if (row.type === "token_usage_record") {
      const turnId = p.turn_id;
      if (!turnId) continue;
      const turn = get(turnId);
      const usage = parseInvocation(p.usage);
      if (!usage || !p.response_id || (p.thread_id && p.thread_id !== threadId)) { turn.blocked = "invalid_response_usage"; continue; }
      const key = `response:${usageHash([threadId, turnId, p.response_id])}`;
      const call = { ...usage, key, model: p.model ?? p.model_slug ?? turn.model };
      const records = canonical.get(turnId) ?? new Map();
      const existing = records.get(key);
      if (existing && JSON.stringify(existing) !== JSON.stringify(call)) turn.blocked = "conflicting_response_usage";
      records.set(key, call);
      canonical.set(turnId, records);
    }
    if (row.type === "event_msg" && p.type === "token_count" && currentTurn) {
      const turnId = p.turn_id ?? currentTurn;
      const turn = get(turnId);
      const total = parseInvocation(p.info?.total_token_usage);
      const last = parseInvocation(p.info?.last_token_usage);
      if (!total || !last) continue;
      turn.snapshots.push({ at: row.timestamp, inputTokens: total.inputTokens, cachedInputTokens: total.cachedInputTokens, outputTokens: total.outputTokens });
      if (!p.turn_id && active.size > 1) turn.blocked = "overlapping_legacy_turns";
      const fingerprint = usageHash([total, last]);
      const priorOwner = legacyOwners.get(fingerprint);
      if (priorOwner && priorOwner !== turnId) turn.blocked = "repeated_legacy_snapshot_across_turns";
      legacyOwners.set(fingerprint, turnId);
      const key = `snapshot:${usageHash([threadId, turnId, total, last])}`;
      const records = legacy.get(turnId) ?? new Map();
      records.set(key, { ...last, key, model: turn.model });
      legacy.set(turnId, records);
    }
  }
  for (const turn of turns.values()) {
    const responses = canonical.get(turn.id);
    turn.invocations = [...(responses ?? legacy.get(turn.id) ?? new Map()).values()];
    turn.source = responses ? "response_id" : "legacy_token_count";
    if (responses && ["overlapping_legacy_turns", "repeated_legacy_snapshot_across_turns"].includes(turn.blocked ?? "")) delete turn.blocked;
    if (!turn.startedAt || !turn.endedAt) turn.blocked = turn.blocked ?? "incomplete_turn";
    if (!turn.invocations.length) turn.blocked = turn.blocked ?? "no_invocation_usage";
    if (turn.invocations.some(c => c.model && turn.model && c.model !== turn.model)) turn.blocked = "mixed_model_turn";
  }
  return turns;
}

export async function readRolloutUsage(file: string, options: { start?: number; threadId?: string } = {}): Promise<Map<string, RolloutTurnUsage>> {
  const stream = createReadStream(file, { encoding: "utf8", start: options.start ?? 0 });
  async function* records() {
    if (options.threadId) yield JSON.stringify({ type: "session_meta", payload: { id: options.threadId } });
    yield* readline.createInterface({ input: stream, crlfDelay: Infinity });
  }
  try { return await parseRolloutUsage(records()); }
  finally { stream.destroy(); }
}

export async function findThreadRollout(home: string, threadId: string): Promise<string | undefined> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f-]+$/i.test(threadId)) return undefined;
  const millis = parseInt(threadId.replaceAll("-", "").slice(0, 12), 16);
  for (const offset of [0, -86400000, 86400000]) {
    const day = new Date(millis + offset).toISOString().slice(0, 10).replaceAll("-", "/");
    const directory = path.join(home, "sessions", day);
    const names = await fs.readdir(directory).catch(() => [] as string[]);
    const found = names.filter(n => n.endsWith(`${threadId}.jsonl`));
    if (found.length === 1) return path.join(directory, found[0]);
  }
  return undefined;
}
